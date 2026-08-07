/**
 * Routes `console.*` through pino so the ~500 existing console call sites emit
 * structured JSON in production without being rewritten one by one.
 *
 * Installed from `src/instrumentation.ts` at server boot, production only.
 * New code should prefer `getLogger(scope)` from `@/lib/logger` directly — the
 * bridge is a floor, not a replacement.
 */
import { format } from "node:util";
import { logger } from "@/lib/logger";

/** `[Boot] refreshDevPool failed:` → scope "Boot". */
const SCOPE_PREFIX = /^\[([\w .:/-]{1,40})\]\s*/;

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug" | "trace";

const LEVEL_BY_METHOD: Record<
  ConsoleMethod,
  "info" | "warn" | "error" | "debug" | "trace"
> = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
  trace: "trace",
};

let originals: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> =
  {};

/**
 * Re-entrancy guard: if anything inside pino's write path calls `console.*`
 * we must fall back to the real console instead of recursing forever.
 */
let emitting = false;

function toRecord(args: unknown[]): {
  msg: string;
  fields: Record<string, unknown>;
} {
  // Errors carry a stack; hand them to pino's `err` serializer rather than
  // letting util.format flatten them into the message.
  const errors = args.filter((a): a is Error => a instanceof Error);
  const rest = args.filter((a) => !(a instanceof Error));

  const fields: Record<string, unknown> = {};
  if (errors.length > 0) fields.err = errors[0];
  if (errors.length > 1) fields.errs = errors.slice(1);

  let msg =
    rest.length > 0
      ? format(...(rest as [unknown, ...unknown[]]))
      : (errors[0]?.message ?? "");

  const scopeMatch = SCOPE_PREFIX.exec(msg);
  if (scopeMatch) {
    fields.scope = scopeMatch[1];
    msg = msg.slice(scopeMatch[0].length);
  }

  return { msg: msg.trimEnd(), fields };
}

/**
 * Patch the global console. Idempotent; returns a function that restores the
 * original methods (used by tests).
 */
export function installConsoleBridge(): () => void {
  if (Object.keys(originals).length > 0) return uninstallConsoleBridge;

  const methods = Object.keys(LEVEL_BY_METHOD) as ConsoleMethod[];

  for (const method of methods) {
    const original = console[method].bind(console) as (
      ...args: unknown[]
    ) => void;
    originals[method] = original;

    console[method] = (...args: unknown[]) => {
      if (emitting) {
        original(...args);
        return;
      }
      emitting = true;
      try {
        const { msg, fields } = toRecord(args);
        logger[LEVEL_BY_METHOD[method]](fields, msg);
      } catch {
        original(...args);
      } finally {
        emitting = false;
      }
    };
  }

  return uninstallConsoleBridge;
}

export function uninstallConsoleBridge(): void {
  for (const [method, fn] of Object.entries(originals)) {
    console[method as ConsoleMethod] = fn as typeof console.log;
  }
  originals = {};
}
