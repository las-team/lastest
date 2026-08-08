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
import { describe, expect, it } from "vitest";

import { buildSampler as buildAppSampler } from "@/otel";
import { buildSampler as buildPoolSampler } from "@lastest/pool-service/otel";

const IMPLS = [
  ["app", buildAppSampler],
  ["pool-service", buildPoolSampler],
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

  describe("parent-based propagation", () => {
    it("honours a sampled remote parent even when the local ratio is 0", () => {
      // This is the Traefik case: the ingress already decided to trace, so
      // re-rolling here would produce a trace with a hole in the middle.
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 0, ctx: parentContext(true, true) },
        ),
      ).toBe(RECORDED);
    });

    it("honours an unsampled remote parent even when the local ratio is 1", () => {
      expect(
        sample(
          { "url.path": "/api/builds" },
          { ratio: 1, ctx: parentContext(false, true) },
        ),
      ).toBe(DROPPED);
    });

    it("still excludes health paths under a sampled remote parent", () => {
      expect(
        sample(
          { "url.path": "/api/health" },
          { ratio: 1, ctx: parentContext(true, true) },
        ),
      ).toBe(DROPPED);
    });

    it("still excludes health paths under a sampled local parent", () => {
      // The orphan-root case: Next's own per-request spans inherit the local
      // parent, so the exclusion has to hold here too.
      expect(
        sample(
          { "next.route": "/api/health" },
          { ratio: 1, ctx: parentContext(true, false) },
        ),
      ).toBe(DROPPED);
    });
  });

  describe("ratio", () => {
    it("drops everything at ratio 0 and keeps everything at ratio 1", () => {
      expect(sample({ "url.path": "/api/builds" }, { ratio: 0 })).toBe(DROPPED);
      expect(sample({ "url.path": "/api/builds" }, { ratio: 1 })).toBe(
        RECORDED,
      );
    });
  });
});
