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
 * Env:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  collector base URL, e.g. http://otel-collector:4318
 *                                UNSET = tracing disabled entirely (dev default)
 *   OTEL_SERVICE_NAME            service.name (default: lastest-app)
 *   OTEL_EXCLUDE_PATHS           comma-separated path prefixes never traced
 *                                (default: /api/health)
 *   OTEL_TRACES_SAMPLER_ARG      head-sampling ratio 0..1 for ROOT spans only
 *                                (default: 1). Requests arriving with a
 *                                traceparent honour the caller's decision
 *                                instead — see ParentBasedSampler below.
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
  // ParentBased is what makes this app a well-behaved participant in a trace
  // that started at Traefik: when a request arrives with a sampled
  // `traceparent` we keep it, and when it arrives unsampled we drop it, rather
  // than re-rolling the dice and producing half-populated traces.
  //
  // Consequence worth knowing: Traefik's own sampleRate becomes the effective
  // ceiling for everything entering through the ingress. OTEL_TRACES_SAMPLER_ARG
  // only governs traces that START here (cron loops, boot work, direct calls).
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

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return false;

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
    // itself, so the env var stays a bare base URL.
    traceExporter: new OTLPTraceExporter(),
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
      `sampleRatio=${ratio} exclude=${excluded.join(",")}`,
  );
  return true;
}
