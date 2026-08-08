/**
 * OpenTelemetry tracing bootstrap for the pool service.
 *
 * DUPLICATE OF `src/otel.ts` (the Next.js app) — change both together. They
 * cannot share a module today: the app resolves the OTel packages from
 * node_modules at runtime (`serverExternalPackages`, because webpack-bundled
 * copies can't be patched), while this process is shipped as a single
 * esbuild bundle with no node_modules at all. The differences are confined to
 * the defaults at the bottom of `startOtel()`; the sampler above it is
 * verbatim identical and is covered by `otel.test.ts` in both trees.
 *
 * Loaded via `--require dist/otel-bootstrap.cjs` ahead of `dist/main.cjs`, so
 * `require("https")` in provisioner.ts is patched before the first k8s API
 * call. See the Dockerfile and the `start` script.
 *
 * Env: identical to the app's — OTEL_EXPORTER_OTLP_ENDPOINT (unset disables
 * tracing entirely), OTEL_SERVICE_NAME (default lastest-pool),
 * OTEL_EXCLUDE_PATHS (default /health), OTEL_TRACES_SAMPLER_ARG,
 * OTEL_DIAG_LOG_LEVEL.
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

const DEFAULT_EXCLUDE_PATHS = ["/health"];

const PATH_ATTRS = ["url.path", "http.route", "http.target", "next.route"];

function pathFromAttributes(attributes: Attributes): string | undefined {
  for (const key of PATH_ATTRS) {
    const value = attributes[key];
    if (typeof value === "string" && value.startsWith("/")) {
      const q = value.indexOf("?");
      return q === -1 ? value : value.slice(0, q);
    }
  }
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
 * `delegate`. Filtering here rather than only in
 * `ignoreIncomingRequestHook` catches spans the HTTP instrumentation never
 * sees — in this process, the kubelet's 4-per-minute /health probes.
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
  // Almost every span here has a remote parent (the app's fetch), so
  // ParentBased is what keeps a provisioning waterfall intact instead of
  // re-sampling and truncating it halfway.
  return new ParentBasedSampler({
    root: new ExcludePathSampler(new TraceIdRatioBasedSampler(ratio), excluded),
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
 * A module-local flag is not enough: a preloaded bundle can be evaluated more
 * than once in a single process (a CJS `--require` plus an ESM loader that
 * re-resolves it, for instance). Only the first `sdk.start()` wins the global
 * provider, so a second one silently leaks a BatchSpanProcessor, an exporter
 * and their timers. Guard on globalThis so there is exactly one per process.
 */
const STARTED = Symbol.for("lastest.otel.started");
type OtelGlobal = typeof globalThis & { [STARTED]?: boolean };

/**
 * Idempotent. No-op (returns false) when OTEL_EXPORTER_OTLP_ENDPOINT is unset
 * — the normal state in a dev checkout and for self-hosted installs with no
 * collector.
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

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "lastest-pool";
  const excluded = parseExcludePaths(process.env.OTEL_EXCLUDE_PATHS);
  const ratio = parseRatio(process.env.OTEL_TRACES_SAMPLER_ARG);

  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: process.env.GIT_HASH ?? "unknown",
    }),
    sampler: buildSampler(excluded, ratio),
    instrumentations: [
      // Covers BOTH directions that matter here: the inbound /v1/* server span
      // (the app's end of the waterfall) and the outbound `https.request` to
      // the Kubernetes API in provisioner.ts — which is the actual
      // provisioning latency this whole exercise exists to measure.
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const path = (req.url ?? "").split("?")[0];
          return path.startsWith("/") && isExcluded(path, excluded);
        },
        ignoreOutgoingRequestHook: (options) => {
          const host = options.hostname ?? options.host ?? "";
          return endpoint.includes(host) && host !== "";
        },
      }),
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
