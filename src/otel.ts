/**
 * OpenTelemetry tracing bootstrap for the Next.js app.
 *
 * Loaded from `src/instrumentation.ts` (nodejs runtime only), before any other
 * boot step, so the HTTP/undici instrumentations are in place before the first
 * `require("http")` or `fetch()`.
 *
 * Wire format is OTLP over HTTP/protobuf (collector port 4318). gRPC is
 * deliberately not used: it would add `@grpc/grpc-js` to the standalone image
 * for no benefit at this trace volume.
 *
 * Tracing is OPT-IN and Kubernetes-only — see `otelGate()`. Nothing here runs
 * unless OTEL_TRACING_ENABLED is truthy AND the process is inside a pod AND a
 * collector endpoint is configured.
 *
 * Env:
 *   OTEL_TRACING_ENABLED         "1"/"true"/"yes"/"on" — the opt-in switch.
 *                                UNSET = tracing disabled entirely (the
 *                                default everywhere: dev, self-host, CI)
 *   OTEL_EXPORTER_OTLP_ENDPOINT  collector base URL, e.g. http://otel-collector:4318
 *                                Required once opted in; on its own it does
 *                                nothing.
 *   OTEL_SERVICE_NAME            service.name (default: lastest-app)
 *   OTEL_EXCLUDE_PATHS           comma-separated path prefixes never traced
 *                                (default: /api/health)
 *   OTEL_TRACES_SAMPLER_ARG      head-sampling ratio 0..1 (default: 1 =
 *                                record everything and let the collector's
 *                                tail sampler decide). Below 1 this re-enables
 *                                parent-based head sampling — see buildSampler.
 *                                NOTE this is NOT the OTel spec's variable of
 *                                that name: its partner OTEL_TRACES_SAMPLER is
 *                                ignored here, because `NodeSDK` is handed an
 *                                explicit `sampler` and explicit config beats
 *                                env-based sampler selection.
 *   OTEL_BSP_MAX_QUEUE_SIZE      batch export tuning; see batchConfigFromEnv.
 *   OTEL_BSP_MAX_EXPORT_BATCH_SIZE
 *   OTEL_BSP_SCHEDULE_DELAY
 *   OTEL_BSP_EXPORT_TIMEOUT
 *   OTEL_DIAG_LOG_LEVEL          none|error|warn|info|debug|verbose|all
 *                                (default: error) — OTel's own internal logs
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  SamplingDecision,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import type { Sampler, SamplingResult } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const DEFAULT_EXCLUDE_PATHS = ["/api/health"];

/**
 * Attribute keys that can carry the request path, newest semconv first. Next
 * 16's own spans still emit the legacy `http.target`, while
 * `@opentelemetry/instrumentation-http` emits stable `url.path`, so both have
 * to be checked or the exclusion silently misses half the spans.
 */
const PATH_ATTRS = ["url.path", "http.route", "http.target", "next.route"];

function pathFromAttributes(attributes: Attributes): string | undefined {
  for (const key of PATH_ATTRS) {
    const value = attributes[key];
    if (typeof value === "string" && value.startsWith("/")) {
      // `http.target` includes the query string.
      const q = value.indexOf("?");
      return q === -1 ? value : value.slice(0, q);
    }
  }
  // Fall back to the full URL on outgoing/client spans.
  for (const key of ["url.full", "http.url"]) {
    const value = attributes[key];
    if (typeof value !== "string") continue;
    try {
      return new URL(value).pathname;
    } catch {
      /* not a parseable URL — ignore */
    }
  }
  return undefined;
}

function isExcluded(path: string, excluded: string[]): boolean {
  return excluded.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Drops spans whose path matches an excluded prefix, otherwise defers to
 * `delegate`.
 *
 * This exists because `ignoreIncomingRequestHook` on the HTTP instrumentation
 * is not sufficient on its own: Next.js emits its OWN spans for a request
 * (`BaseServer.handleRequest` and friends). Suppressing only the outer `http`
 * span leaves those as parentless roots, so `/api/health` probes still show up
 * in the collector as a stream of orphan traces. Filtering in the sampler
 * catches them wherever they originate.
 */
class ExcludePathSampler implements Sampler {
  constructor(
    private readonly delegate: Sampler,
    private readonly excluded: string[],
  ) {}

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const path = pathFromAttributes(attributes);
    if (path && isExcluded(path, this.excluded)) {
      return { decision: SamplingDecision.NOT_RECORD };
    }
    return this.delegate.shouldSample(
      context,
      traceId,
      spanName,
      spanKind,
      attributes,
      links,
    );
  }

  toString(): string {
    return `ExcludePath{${this.excluded.join(",")}}(${this.delegate.toString()})`;
  }
}

export function buildSampler(excluded: string[], ratio: number): Sampler {
  // Head sampling is OFF by default (ratio 1), because the collector runs a
  // tail sampler: it can only apply a policy like "keep every trace that
  // errored or exceeded a latency budget" to traces it actually received, so
  // whatever the head drops is unrecoverable. Recording everything and letting
  // the collector decide is the whole point of tail sampling.
  //
  // Deliberately NOT ParentBased here. ParentBased would honour the sampled
  // flag on Traefik's inbound `traceparent`, and its unset `remoteParentNotSampled`
  // branch defaults to AlwaysOff — so Traefik's own sampleRate would silently
  // become a hard ceiling on everything entering through the ingress, and the
  // tail sampler would only ever choose from the fraction Traefik had already
  // picked at random. Set Traefik's sampleRate to 1.0 to match, or its spans
  // (not ours) go missing from the trace.
  if (ratio >= 1) {
    return new ExcludePathSampler(new AlwaysOnSampler(), excluded);
  }

  // Explicit opt-out: OTEL_TRACES_SAMPLER_ARG < 1 turns head sampling back on
  // for deployments with no tail-sampling collector (self-hosted, or a plain
  // OTLP backend that ingests everything it is sent). Here ParentBased IS the
  // right shape — it keeps a trace that started at the ingress intact instead
  // of re-rolling the dice and punching a hole in the middle of it.
  return new ParentBasedSampler({
    root: new ExcludePathSampler(new TraceIdRatioBasedSampler(ratio), excluded),
    // Exclusion also applies under a sampled parent, so a probe that somehow
    // arrives with a traceparent still can't drag health-check spans in.
    remoteParentSampled: new ExcludePathSampler(
      new AlwaysOnSampler(),
      excluded,
    ),
    localParentSampled: new ExcludePathSampler(new AlwaysOnSampler(), excluded),
  });
}

function parseRatio(raw: string | undefined): number {
  const n = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(n) || n < 0 || n > 1) return 1;
  return n;
}

function parseExcludePaths(raw: string | undefined): string[] {
  if (raw === undefined) return DEFAULT_EXCLUDE_PATHS;
  const paths = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return paths.length > 0 ? paths : DEFAULT_EXCLUDE_PATHS;
}

const DIAG_LEVELS: Record<string, DiagLogLevel> = {
  none: DiagLogLevel.NONE,
  error: DiagLogLevel.ERROR,
  warn: DiagLogLevel.WARN,
  info: DiagLogLevel.INFO,
  debug: DiagLogLevel.DEBUG,
  verbose: DiagLogLevel.VERBOSE,
  all: DiagLogLevel.ALL,
};

/**
 * Batch export tuning.
 *
 * Batching itself is not new — `NodeSDK` already wrapped the exporter in a
 * `BatchSpanProcessor` built from the OTEL_BSP_* env vars. It is spelled out
 * here because the sampler above now records every request instead of the
 * sampled fraction, and the SDK's stock `maxQueueSize` of 2048 is sized for
 * the latter. Overflow is not loud — `BatchSpanProcessor` drops the excess and
 * only reports it through `diag` — so under a burst you would lose exactly the
 * error traces the tail sampler exists to keep, with nothing in the app log to
 * say so. Raise OTEL_DIAG_LOG_LEVEL to `warn` to see the drop counter.
 *
 * Every value stays overridable through its standard env var, so this only
 * moves the defaults.
 */
export function batchConfigFromEnv() {
  const num = (name: string, fallback: number): number => {
    const n = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    maxQueueSize: num("OTEL_BSP_MAX_QUEUE_SIZE", 8192),
    maxExportBatchSize: num("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", 1024),
    scheduledDelayMillis: num("OTEL_BSP_SCHEDULE_DELAY", 5000),
    exportTimeoutMillis: num("OTEL_BSP_EXPORT_TIMEOUT", 30000),
  };
}

/**
 * Name of the opt-in flag, exported so the tests and the log line below can
 * refer to it without re-typing it.
 */
export const OTEL_ENABLE_FLAG = "OTEL_TRACING_ENABLED";

/** Why the gate is shut. `opt-out` is the default and is not an error. */
export type OtelOffReason = "opt-out" | "not-kubernetes" | "no-endpoint";

export type OtelGate =
  | { enabled: true; endpoint: string }
  | { enabled: false; reason: OtelOffReason };

/** Only the keys read here — `process.env` is assignable to this. */
type EnvLike = Record<string, string | undefined>;

function flagOn(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Tracing is OFF unless ALL THREE hold. Setting the endpoint alone is
 * deliberately NOT enough any more — it used to be the whole switch, which
 * meant an OTEL_EXPORTER_OTLP_ENDPOINT inherited from a shared ConfigMap or a
 * developer's `.env.local` silently turned instrumentation on.
 *
 *   1. OTEL_TRACING_ENABLED is truthy — the explicit opt-in.
 *   2. The process is running inside a Kubernetes pod. Tracing is a
 *      Kubernetes-only capability here: the collector is an in-cluster
 *      Service, and the single-container self-host image (root Dockerfile,
 *      Zima/CasaOS) ships no collector and must never pay for the
 *      instrumentation. KUBERNETES_SERVICE_HOST is the kubelet-injected
 *      marker for the default `kubernetes` Service — it is present in every
 *      pod regardless of `enableServiceLinks`, and absent everywhere else.
 *   3. OTEL_EXPORTER_OTLP_ENDPOINT names a collector.
 */
export function otelGate(env: EnvLike = process.env): OtelGate {
  if (!flagOn(env[OTEL_ENABLE_FLAG])) {
    return { enabled: false, reason: "opt-out" };
  }
  if (!env.KUBERNETES_SERVICE_HOST?.trim()) {
    return { enabled: false, reason: "not-kubernetes" };
  }
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return { enabled: false, reason: "no-endpoint" };
  return { enabled: true, endpoint };
}

/**
 * Explains a disabled gate for an operator who asked for tracing and did not
 * get it. `opt-out` is the normal state and is never logged.
 */
export function gateExplanation(reason: OtelOffReason): string {
  return reason === "not-kubernetes"
    ? "this process is not running inside a Kubernetes pod (no KUBERNETES_SERVICE_HOST) — tracing is Kubernetes-only"
    : "OTEL_EXPORTER_OTLP_ENDPOINT is unset";
}

let sdk: NodeSDK | undefined;

/**
 * A module-local flag is not enough: this module can be evaluated more than
 * once in a single process (Next can instantiate `instrumentation.ts` per
 * compilation context in dev). Only the first `sdk.start()` wins the global
 * provider, so a second one silently leaks a BatchSpanProcessor, an exporter
 * and their timers. Guard on globalThis so there is exactly one per process.
 */
const STARTED = Symbol.for("lastest.otel.started");
type OtelGlobal = typeof globalThis & { [STARTED]?: boolean };

/**
 * Idempotent. No-op (returns false) when OTEL_EXPORTER_OTLP_ENDPOINT is unset,
 * which is the normal state in a dev checkout and for self-hosted installs
 * with no collector.
 */
export function startOtel(): boolean {
  if (sdk) return true;
  if ((globalThis as OtelGlobal)[STARTED]) return true;

  const gate = otelGate();
  if (!gate.enabled) {
    // Silence is right for the default (no flag): dev, self-host and the
    // migrate Job all land here every boot. A flag that was set and could not
    // be honoured is a misconfiguration and must be loud.
    if (gate.reason !== "opt-out") {
      console.warn(
        `[OTel] ${OTEL_ENABLE_FLAG} is set but ${gateExplanation(gate.reason)} — tracing stays off.`,
      );
    }
    return false;
  }
  const endpoint = gate.endpoint;

  (globalThis as OtelGlobal)[STARTED] = true;

  diag.setLogger(
    new DiagConsoleLogger(),
    DIAG_LEVELS[process.env.OTEL_DIAG_LOG_LEVEL?.toLowerCase() ?? "error"] ??
      DiagLogLevel.ERROR,
  );

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "lastest-app";
  const excluded = parseExcludePaths(process.env.OTEL_EXCLUDE_PATHS);
  const ratio = parseRatio(process.env.OTEL_TRACES_SAMPLER_ARG);

  sdk = new NodeSDK({
    // `OTLPTraceExporter` appends `/v1/traces` to OTEL_EXPORTER_OTLP_ENDPOINT
    // itself, so the env var stays a bare base URL. Passing `spanProcessors`
    // rather than `traceExporter` opts out of the SDK building the batch
    // processor itself — see batchConfigFromEnv above for why.
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter(), batchConfigFromEnv()),
    ],
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.NEXT_PUBLIC_GIT_HASH ?? "unknown",
    }),
    sampler: buildSampler(excluded, ratio),
    instrumentations: [
      new HttpInstrumentation({
        // Cheaper than sampling the span away, and it keeps the excluded paths
        // out of the context propagation path entirely. The sampler above is
        // still required — see ExcludePathSampler.
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? "").split("?")[0];
          return path.startsWith("/") && isExcluded(path, excluded);
        },
        // Never trace the exporter's own POSTs to the collector. The OTLP
        // exporter already suppresses tracing around its sends; this is the
        // belt to that pair of braces, because a feedback loop here is a
        // runaway, not a degradation.
        ignoreOutgoingRequestHook: (options) => {
          const host = options.hostname ?? options.host ?? "";
          return endpoint.includes(host) && host !== "";
        },
      }),
      // Node's global `fetch` is undici, and every app→pool-service call goes
      // through it. This is the instrumentation that injects `traceparent`
      // outbound, so it is what produces the app→pool→provisioning waterfall.
      new UndiciInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk?.shutdown().catch(() => {
      /* flushing traces must never block or fail a shutdown */
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  console.log(
    `[OTel] tracing enabled — service=${serviceName} endpoint=${endpoint} ` +
      `headSampling=${ratio >= 1 ? "off (tail)" : ratio} ` +
      `exclude=${excluded.join(",")}`,
  );
  return true;
}
