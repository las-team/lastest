/**
 * Structured server-side logging.
 *
 * Production (`NODE_ENV=production`): pino writes newline-delimited JSON to
 * stdout — one object per line, ready for a log shipper (k8s/Loki/CloudWatch).
 * Development: the same API, but rendered as a short human-readable line so
 * `pnpm dev` output stays readable.
 *
 * Server-only. Do NOT import this from a `*-client.tsx` component — use it in
 * server actions, route handlers, and `src/lib/**` server modules.
 *
 * Env:
 *   LOG_LEVEL — trace|debug|info|warn|error|fatal|silent (default: info in
 *               production, debug in development)
 */
import os from "node:os";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const LEVEL = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

/**
 * Paths scrubbed from every log record. Objects logged from this codebase
 * routinely carry request headers, EB bootstrap tokens and Stripe keys; pino's
 * redaction runs on the serialized record so it covers `console.*` bridged
 * output too.
 */
const REDACT_PATHS = [
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "encryptionKey",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.authorization",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
];

/**
 * Dev renderer: `12:04:31 WARN [GC] message {extra:"fields"}`. Kept dependency
 * free on purpose — pino-pretty is a transport that spawns a worker thread,
 * which fights with Next's dev-server reloads.
 */
function devDestination() {
  return {
    write(line: string) {
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line);
      } catch {
        process.stdout.write(line);
        return;
      }

      const {
        level,
        time,
        msg,
        scope,
        pid: _pid,
        hostname: _hostname,
        service: _service,
        env: _env,
        gitHash: _gitHash,
        err,
        ...rest
      } = rec as Record<string, unknown> & { level: string; time: string };

      const ts = time.slice(11, 23);
      const name = level.toUpperCase().padEnd(5);
      const prefix = scope ? ` [${scope}]` : "";
      const extras = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
      const stack =
        err && typeof err === "object" && "stack" in err
          ? `\n${(err as { stack?: string }).stack}`
          : "";

      process.stdout.write(
        `${ts} ${name}${prefix} ${msg ?? ""}${extras}${stack}\n`,
      );
    },
  };
}

export const logger = pino(
  {
    level: LEVEL,
    // A custom `base` replaces pino's default, so pid/hostname are restated
    // here — under k8s `hostname` is the pod name, which is how you tell the
    // user-facing pod's logs from the companion pod's.
    base: {
      pid: process.pid,
      hostname: os.hostname(),
      service: "lastest-app",
      env: process.env.NODE_ENV ?? "development",
      gitHash: process.env.NEXT_PUBLIC_GIT_HASH,
    },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // ISO timestamps beat epoch millis for anything that greps logs by hand.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // `"level":"info"` instead of `"level":30` — most log backends expect the
      // string form.
      level: (label) => ({ level: label }),
    },
  },
  isProduction ? pino.destination({ dest: 1, sync: false }) : devDestination(),
);

/**
 * Child logger tagged with a `scope` field, e.g. `getLogger("GC")` produces
 * `{"scope":"GC",...}`. Mirrors the `[Prefix]` convention already used across
 * the codebase's console calls.
 */
export function getLogger(scope: string, bindings?: Record<string, unknown>) {
  return logger.child({ scope, ...bindings });
}

export type Logger = typeof logger;
