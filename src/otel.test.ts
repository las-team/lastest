/**
 * Cross-checks the two tracing samplers against each other.
 *
 * `src/otel.ts` (Next app) and `packages/pool-service/src/otel.ts` are
 * deliberate duplicates — they cannot share a module because the app must
 * resolve the OTel packages from node_modules at runtime while the pool
 * service ships as a dependency-free esbuild bundle. This file is what keeps
 * the copies honest: every case runs against BOTH, so a fix applied to one
 * tree and not the other fails here rather than in production.
 */
import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from "@opentelemetry/api";
import type { Attributes, Context } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it } from "vitest";

import { dbTracingEnabled } from "@lastest/db/tracing";
import {
  batchConfigFromEnv as appBatchConfig,
  buildSampler as buildAppSampler,
  otelGate as appGate,
} from "@/otel";
import {
  batchConfigFromEnv as poolBatchConfig,
  buildSampler as buildPoolSampler,
  otelGate as poolGate,
} from "@lastest/pool-service/otel";

const IMPLS = [
  ["app", buildAppSampler],
  ["pool-service", buildPoolSampler],
] as const;

/**
 * The gate has a THIRD copy in `packages/db/src/tracing.ts` (it cannot import
 * either otel.ts — see the comment there), so it is checked here too. Its
 * signature differs (a plain boolean plus the OTEL_DB_TRACING escape hatch),
 * so it is adapted to the same shape rather than listed in GATE_IMPLS raw.
 */
const GATE_IMPLS = [
  ["app", (env: Record<string, string | undefined>) => appGate(env).enabled],
  [
    "pool-service",
    (env: Record<string, string | undefined>) => poolGate(env).enabled,
  ],
  ["db", (env: Record<string, string | undefined>) => dbTracingEnabled(env)],
] as const;

const BATCH_IMPLS = [
  ["app", appBatchConfig],
  ["pool-service", poolBatchConfig],
] as const;

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";

function parentContext(sampled: boolean, isRemote: boolean): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote,
  });
}

describe.each(IMPLS)("%s tracing sampler", (_name, buildSampler) => {
  const sample = (
    attributes: Attributes,
    {
      ratio = 1,
      ctx = ROOT_CONTEXT,
      excluded = ["/api/health", "/health"],
    } = {},
  ) =>
    buildSampler(excluded, ratio).shouldSample(
      ctx,
      TRACE_ID,
      "GET /whatever",
      SpanKind.SERVER,
      attributes,
      [],
    ).decision;

  const RECORDED = SamplingDecision.RECORD_AND_SAMPLED;
  const DROPPED = SamplingDecision.NOT_RECORD;

  describe("path exclusion", () => {
    it("drops a root span on an excluded path", () => {
      expect(sample({ "url.path": "/api/health" })).toBe(DROPPED);
    });

    it("keeps a root span on any other path", () => {
      expect(sample({ "url.path": "/api/builds" })).toBe(RECORDED);
    });

    it("reads the legacy http.target Next.js still emits, query and all", () => {
      expect(sample({ "http.target": "/api/health?probe=1" })).toBe(DROPPED);
    });

    it("reads http.route and next.route", () => {
      expect(sample({ "http.route": "/health" })).toBe(DROPPED);
      expect(sample({ "next.route": "/api/health" })).toBe(DROPPED);
    });

    it("extracts the path from a full URL on client spans", () => {
      expect(sample({ "url.full": "http://lastest:3000/api/health" })).toBe(
        DROPPED,
      );
      expect(sample({ "http.url": "http://lastest:3000/api/builds" })).toBe(
        RECORDED,
      );
    });

    it("matches on a path segment boundary, not a bare prefix", () => {
      // /api/healthcheck is a different route and must survive.
      expect(sample({ "url.path": "/api/healthcheck" })).toBe(RECORDED);
      expect(sample({ "url.path": "/api/health/db" })).toBe(DROPPED);
    });

    it("falls through to the delegate when no path attribute is present", () => {
      expect(sample({ "db.system": "postgresql" })).toBe(RECORDED);
      expect(sample({}, { ratio: 0 })).toBe(DROPPED);
    });
  });

  describe("default (ratio 1): tail sampling, head records everything", () => {
    it("records under an UNSAMPLED remote parent", () => {
      // The regression this guards. Traefik head-samples and forwards
      // `traceparent` with the sampled flag clear; a ParentBased sampler drops
      // that (its unset `remoteParentNotSampled` branch defaults to AlwaysOff),
      // and a trace dropped at the head can never be recovered by a tail
      // sampler in the collector. Traefik's sampleRate must not be a ceiling.
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 1, ctx: parentContext(false, true) },
        ),
      ).toBe(RECORDED);
    });

    it("records under an unsampled LOCAL parent", () => {
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 1, ctx: parentContext(false, false) },
        ),
      ).toBe(RECORDED);
    });

    it("still records under a sampled remote parent", () => {
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 1, ctx: parentContext(true, true) },
        ),
      ).toBe(RECORDED);
    });

    it("still excludes health paths regardless of parent state", () => {
      // Path exclusion is the one thing that must survive always-on: there is
      // no point shipping kubelet probes to the collector for a policy to drop.
      for (const ctx of [
        ROOT_CONTEXT,
        parentContext(true, true),
        parentContext(false, true),
        // The orphan-root case: Next's own per-request spans inherit the local
        // parent, so the exclusion has to hold there too.
        parentContext(true, false),
      ]) {
        expect(sample({ "url.path": "/api/health" }, { ratio: 1, ctx })).toBe(
          DROPPED,
        );
        expect(sample({ "next.route": "/api/health" }, { ratio: 1, ctx })).toBe(
          DROPPED,
        );
      }
    });
  });

  describe("ratio < 1: explicit head-sampling opt-out", () => {
    it("honours a sampled remote parent even when the local ratio is 0", () => {
      // With head sampling deliberately on, the ingress' decision is the one
      // that counts — re-rolling here would punch a hole in the middle of a
      // trace that Traefik already chose to keep.
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 0, ctx: parentContext(true, true) },
        ),
      ).toBe(RECORDED);
    });

    it("honours an unsampled remote parent", () => {
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 0.5, ctx: parentContext(false, true) },
        ),
      ).toBe(DROPPED);
    });

    it("drops root spans at ratio 0", () => {
      expect(sample({ "url.path": "/api/builds" }, { ratio: 0 })).toBe(DROPPED);
    });

    it("still excludes health paths under a sampled remote parent", () => {
      expect(
        sample(
          { "url.path": "/api/health" },
          { ratio: 0.5, ctx: parentContext(true, true) },
        ),
      ).toBe(DROPPED);
    });
  });
});

describe.each(BATCH_IMPLS)("%s batch export config", (_name, batchConfig) => {
  const BSP_VARS = [
    "OTEL_BSP_MAX_QUEUE_SIZE",
    "OTEL_BSP_MAX_EXPORT_BATCH_SIZE",
    "OTEL_BSP_SCHEDULE_DELAY",
    "OTEL_BSP_EXPORT_TIMEOUT",
  ];

  afterEach(() => {
    for (const v of BSP_VARS) delete process.env[v];
  });

  it("defaults the queue well above the SDK's stock 2048", () => {
    // Always-on head sampling multiplies span volume by 1/oldRatio. The
    // BatchSpanProcessor drops silently past maxQueueSize, so the stock
    // default would quietly lose the error traces tail sampling exists for.
    const cfg = batchConfig();
    expect(cfg.maxQueueSize).toBeGreaterThan(2048);
    expect(cfg.maxExportBatchSize).toBeLessThanOrEqual(cfg.maxQueueSize);
  });

  it("honours the standard OTEL_BSP_* overrides", () => {
    process.env.OTEL_BSP_MAX_QUEUE_SIZE = "100";
    process.env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE = "10";
    process.env.OTEL_BSP_SCHEDULE_DELAY = "250";
    process.env.OTEL_BSP_EXPORT_TIMEOUT = "1500";
    expect(batchConfig()).toEqual({
      maxQueueSize: 100,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 250,
      exportTimeoutMillis: 1500,
    });
  });

  it("ignores junk and non-positive values rather than disabling batching", () => {
    process.env.OTEL_BSP_MAX_QUEUE_SIZE = "not-a-number";
    process.env.OTEL_BSP_SCHEDULE_DELAY = "0";
    const cfg = batchConfig();
    expect(cfg.maxQueueSize).toBeGreaterThan(2048);
    expect(cfg.scheduledDelayMillis).toBeGreaterThan(0);
  });
});

/**
 * Tracing is opt-in AND Kubernetes-only. Both halves matter:
 *
 *  - opt-in, because OTEL_EXPORTER_OTLP_ENDPOINT alone used to be the whole
 *    switch, so an endpoint inherited from a shared ConfigMap (or a stray
 *    `.env.local` key) silently started exporting;
 *  - Kubernetes-only, because the collector is an in-cluster Service and the
 *    single-container self-host image (root Dockerfile) must never pay for the
 *    instrumentation.
 */
describe.each(GATE_IMPLS)("%s tracing gate", (_name, enabled) => {
  const ON = {
    OTEL_TRACING_ENABLED: "1",
    KUBERNETES_SERVICE_HOST: "10.43.0.1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
  } satisfies Record<string, string>;

  it("is on when all three conditions hold", () => {
    expect(enabled({ ...ON })).toBe(true);
  });

  it("is off with no opt-in flag, however complete the rest of the config", () => {
    const { OTEL_TRACING_ENABLED: _flag, ...rest } = ON;
    expect(enabled(rest)).toBe(false);
  });

  it("is off when the flag is explicitly falsy", () => {
    for (const v of ["0", "false", "no", "off", "", "  "]) {
      expect(enabled({ ...ON, OTEL_TRACING_ENABLED: v })).toBe(false);
    }
  });

  it("accepts the usual truthy spellings, case-insensitively", () => {
    for (const v of ["1", "true", "TRUE", "yes", "On", " true "]) {
      expect(enabled({ ...ON, OTEL_TRACING_ENABLED: v })).toBe(true);
    }
  });

  it("is off outside Kubernetes even when opted in with an endpoint", () => {
    // The self-host / dev case: KUBERNETES_SERVICE_HOST is injected by the
    // kubelet in every pod and exists nowhere else.
    const { KUBERNETES_SERVICE_HOST: _k8s, ...rest } = ON;
    expect(enabled(rest)).toBe(false);
    expect(enabled({ ...rest, KUBERNETES_SERVICE_HOST: "" })).toBe(false);
  });

  it("is off with no collector endpoint", () => {
    const { OTEL_EXPORTER_OTLP_ENDPOINT: _ep, ...rest } = ON;
    expect(enabled(rest)).toBe(false);
  });
});

describe("app/pool gate reasons", () => {
  it.each([
    ["app", appGate],
    ["pool-service", poolGate],
  ])("%s reports why it stayed off", (_name, gate) => {
    expect(gate({})).toEqual({ enabled: false, reason: "opt-out" });
    expect(gate({ OTEL_TRACING_ENABLED: "1" })).toEqual({
      enabled: false,
      reason: "not-kubernetes",
    });
    expect(
      gate({ OTEL_TRACING_ENABLED: "1", KUBERNETES_SERVICE_HOST: "10.43.0.1" }),
    ).toEqual({ enabled: false, reason: "no-endpoint" });
    expect(
      gate({
        OTEL_TRACING_ENABLED: "1",
        KUBERNETES_SERVICE_HOST: "10.43.0.1",
        OTEL_EXPORTER_OTLP_ENDPOINT: " http://collector:4318 ",
      }),
    ).toEqual({ enabled: true, endpoint: "http://collector:4318" });
  });
});

describe("db gate escape hatch", () => {
  it("still honours OTEL_DB_TRACING=0 with everything else on", () => {
    expect(
      dbTracingEnabled({
        OTEL_TRACING_ENABLED: "1",
        KUBERNETES_SERVICE_HOST: "10.43.0.1",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
        OTEL_DB_TRACING: "0",
      }),
    ).toBe(false);
  });
});
