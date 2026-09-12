/**
 * Package-local structured logging (spec §8.5), mirroring the app's
 * `src/lib/logger.ts` conventions without OpenTelemetry.
 *
 * Production (`NODE_ENV=production`): pino writes newline-delimited JSON to
 * stdout. Development: the same API rendered as a short readable line.
 *
 * Env:
 *   LOG_LEVEL — trace|debug|info|warn|error|fatal|silent (default: info in
 *               production, debug otherwise)
 *
 * Rules (§8.5): every line should carry `run_id`, `object_key`, `country` where
 * applicable — pass them as `bindings` to `getLogger(scope, bindings)`. Never
 * log record payloads or field values at `info`; the redaction list below
 * scrubs credentials and the payload keys named in §7.5.
 */
import os from "node:os";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const LEVEL = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

/** Paths scrubbed from every record (§8.5 + §7.5). */
export const REDACT_PATHS = [
  "password",
  "sessionId",
  "session_id",
  "access_token",
  "accessToken",
  "assertion",
  "authorization",
  "Authorization",
  "token",
  "secret",
  "clientSecret",
  "client_secret",
  "privateKey",
  "cookie",
  // payload keys — values never leave the staging DB (§7.5)
  "row",
  "payload",
  "record",
  "values",
  "*.password",
  "*.sessionId",
  "*.session_id",
  "*.access_token",
  "*.accessToken",
  "*.assertion",
  "*.authorization",
  "*.Authorization",
  "*.token",
  "*.secret",
  "*.clientSecret",
  "*.client_secret",
  "*.privateKey",
  "*.cookie",
  "*.row",
  "*.payload",
  "*.record",
  "*.values",
  "headers.authorization",
  "headers.Authorization",
  "req.headers.authorization",
];

/** Dev renderer: `12:04:31 WARN [Load] message {extra:"fields"}`. */
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
        err,
        ...rest
      } = rec as Record<string, unknown> & { level: string; time: string };
      const ts = typeof time === "string" ? time.slice(11, 23) : "";
      const name = String(level).toUpperCase().padEnd(5);
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
    base: {
      pid: process.pid,
      hostname: os.hostname(),
      service: "veeva-migration",
      env: process.env.NODE_ENV ?? "development",
    },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  isProduction ? pino.destination({ dest: 1, sync: false }) : devDestination(),
);

/**
 * Child logger tagged with `scope` (§8.5 scopes: Preflight, Extract, Closure,
 * Transform, Load, Reconcile, Sfdc, Vault, Store, Config, Cli) plus optional
 * bindings such as `{ run_id, object_key, country }`.
 */
export function getLogger(scope: string, bindings?: Record<string, unknown>) {
  return logger.child({ scope, ...bindings });
}

export type Logger = ReturnType<typeof getLogger>;
