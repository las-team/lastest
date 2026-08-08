/**
 * Query tracing for the shared Postgres client.
 *
 * Wraps the postgres.js client so every statement Drizzle executes becomes a
 * CLIENT span nested under whatever request span is active. Both consumers get
 * it for free — the Next app and the pool service import the same client from
 * `@lastest/db`.
 *
 * WHY NOT DRIZZLE'S OWN TRACING: `drizzle-orm/tracing` has the instrumentation
 * points already written (`drizzle.execute` / `drizzle.driver.execute` /
 * `drizzle.mapResponse`), but as of 0.45.2 its `otel` binding is declared and
 * never assigned, so `startActiveSpan` unconditionally short-circuits — it is
 * dead code. It also sets `drizzle.query.params: JSON.stringify(params)` on
 * every span, which in this database would ship argon2 password hashes,
 * session/bearer tokens, EB bootstrap tokens and provider API keys to the
 * collector. Do not enable it if a future Drizzle release revives the binding
 * without making that attribute opt-in.
 *
 * WHY NOT instrumentation-pg: that package patches `pg` (node-postgres). This
 * codebase uses `postgres` (postgres.js) via `drizzle-orm/postgres-js`, for
 * which no OTel instrumentation is published.
 *
 * REDACTION POLICY — the counterpart to pino's REDACT_PATHS in
 * `src/lib/logger.ts`, because span attributes do NOT pass through pino and
 * are therefore not covered by it:
 *   1. Bound parameters are NEVER attached to a span, in any form. Drizzle
 *      passes values out-of-band as $1/$2/…, so the statement text is already
 *      free of them.
 *   2. The statement text is additionally scrubbed of inline literals
 *      (`redactStatement`) before it is attached, so a `sql.raw()` call that
 *      interpolated a value directly still cannot leak it.
 *   3. The text is capped at MAX_STATEMENT_LENGTH.
 *
 * Env:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  unset = no tracing at all, so no DB spans
 *   OTEL_DB_TRACING              "0" disables DB spans while leaving HTTP
 *                                tracing on
 *   OTEL_DB_STATEMENT            "0" omits db.query.text entirely (belt and
 *                                braces; the text is redacted regardless)
 */
import { context, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import {
  ATTR_DB_COLLECTION_NAME,
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_QUERY_TEXT,
  ATTR_DB_SYSTEM_NAME,
} from "@opentelemetry/semantic-conventions";

export const MAX_STATEMENT_LENGTH = 2048;

/** SQL verbs we surface as `db.operation.name`; anything else becomes SQL. */
const OPERATIONS = new Set([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "WITH",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "SET",
  "SHOW",
  "EXPLAIN",
  "COPY",
  "VACUUM",
  "ANALYZE",
  "REFRESH",
]);

/** `"schema"."table"` / `schema.table` / `table`, quoted or bare. */
const IDENT = String.raw`(?:"[^"]*"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]*"|[A-Za-z_][\w$]*))?`;

const TABLE_PATTERNS: Array<RegExp> = [
  new RegExp(String.raw`\binsert\s+into\s+(${IDENT})`, "i"),
  new RegExp(String.raw`\bupdate\s+(?:only\s+)?(${IDENT})`, "i"),
  new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?(${IDENT})`, "i"),
  new RegExp(String.raw`\bfrom\s+(${IDENT})`, "i"),
  new RegExp(String.raw`\binto\s+(${IDENT})`, "i"),
];

/**
 * Strips inline literals from a statement so nothing user-supplied can ride
 * along in `db.query.text`.
 *
 * Drizzle parameterises everything, so in practice this is a no-op on its
 * output — it exists for `sql.raw()` and any hand-built statement, where a
 * value CAN end up inline. Order matters: dollar-quoted bodies are removed
 * first (they may legally contain apostrophes), then quoted strings, and only
 * then bare numbers, so digits inside a string are already gone by the time
 * the numeric pass runs.
 */
export function redactStatement(sqlText: string): string {
  const redacted = sqlText
    // $$ … $$ and $tag$ … $tag$ bodies (function definitions, COPY payloads).
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$1$$?$$$1$$")
    // '…' with SQL's doubled-quote escape ('' inside a literal).
    .replace(/'(?:[^']|'')*'/g, "'?'")
    // Bare numerics — but never the $1/$2 placeholders, a digit inside an
    // identifier (col1), or a decimal's second half.
    .replace(/(?<![\w$.])\d+(?:\.\d+)?(?![\w$])/g, "?");

  return redacted.length > MAX_STATEMENT_LENGTH
    ? `${redacted.slice(0, MAX_STATEMENT_LENGTH)}…`
    : redacted;
}

/** Best-effort `{ operation, table }` for span naming, from the raw text. */
export function describeStatement(sqlText: string): {
  operation: string;
  table?: string;
} {
  const head = sqlText.trimStart().slice(0, 4096);
  const verb = /^([A-Za-z]+)/.exec(head)?.[1]?.toUpperCase();
  const operation = verb && OPERATIONS.has(verb) ? verb : "SQL";

  for (const pattern of TABLE_PATTERNS) {
    const table = pattern.exec(head)?.[1];
    if (table) return { operation, table: table.replace(/"/g, "") };
  }
  return { operation };
}

function dbTracingEnabled(): boolean {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) return false;
  return process.env.OTEL_DB_TRACING !== "0";
}

/** Database name for `db.namespace`, parsed from the connection string. */
function namespaceOf(connectionString: string): string | undefined {
  try {
    const name = new URL(connectionString).pathname.replace(/^\//, "");
    return name || undefined;
  } catch {
    return undefined;
  }
}

let cachedTracer: Tracer | undefined;
function tracer(): Tracer {
  // `getTracer` hands back a ProxyTracer that resolves the global provider on
  // first use, so caching it here does not race the SDK's registration.
  cachedTracer ??= trace.getTracer("@lastest/db");
  return cachedTracer;
}

function attributesFor(sqlText: string, namespace?: string): Attributes {
  const { operation, table } = describeStatement(sqlText);
  const attrs: Attributes = {
    [ATTR_DB_SYSTEM_NAME]: "postgresql",
    [ATTR_DB_OPERATION_NAME]: operation,
  };
  if (table) attrs[ATTR_DB_COLLECTION_NAME] = table;
  if (namespace) attrs[ATTR_DB_NAMESPACE] = namespace;
  if (process.env.OTEL_DB_STATEMENT !== "0") {
    attrs[ATTR_DB_QUERY_TEXT] = redactStatement(sqlText);
  }
  return attrs;
}

function spanNameFor(sqlText: string): string {
  const { operation, table } = describeStatement(sqlText);
  return table ? `${operation} ${table}` : operation;
}

/**
 * Never let telemetry break a query. A bad regex or a provider that throws
 * during registration must degrade to "no span", not to a failed database
 * call — this wrapper is the only thing that guarantees that.
 */
function startQuerySpan(sqlText: string, namespace?: string): Span | undefined {
  try {
    return tracer().startSpan(spanNameFor(sqlText), {
      kind: SpanKind.CLIENT,
      attributes: attributesFor(sqlText, namespace),
    });
  } catch {
    return undefined;
  }
}

function finish(span: Span | undefined, err?: unknown): void {
  if (!span) return;
  if (err) {
    span.recordException(err as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  span.end();
}

/**
 * Wraps a postgres.js Query (a lazy thenable) so the span measures the actual
 * round trip.
 *
 * The span has to start in `then` rather than here: postgres.js does not send
 * anything until the query is awaited, and Drizzle routinely builds one, calls
 * `.values()` on it, and only then awaits. Chainable methods return the query
 * itself, so those are re-wrapped to keep the proxy in the chain.
 */
function wrapQuery<T extends object>(
  query: T,
  rawSqlText: unknown,
  namespace?: string,
): T {
  // Defensive: postgres.js accepts a few call shapes, and a non-string here
  // must degrade to a poorly-named span rather than throwing inside `then`.
  const sqlText = typeof rawSqlText === "string" ? rawSqlText : "";

  const proxy: T = new Proxy(query, {
    get(target, prop) {
      if (prop === "then") {
        return (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => {
          const span = startQuerySpan(sqlText, namespace);
          const then = Reflect.get(target, "then") as (
            f: (v: unknown) => unknown,
            r: (e: unknown) => unknown,
          ) => unknown;
          // Make the span current while the caller's continuation runs, so
          // anything it starts nests under this query rather than beside it.
          const active = span
            ? trace.setSpan(context.active(), span)
            : context.active();
          return context.with(active, () =>
            then.call(
              target,
              (value: unknown) => {
                finish(span);
                return onFulfilled ? onFulfilled(value) : value;
              },
              (err: unknown) => {
                finish(span, err);
                if (onRejected) return onRejected(err);
                throw err;
              },
            ),
          );
        };
      }

      // `catch`/`finally` delegate to the raw `then` internally, which would
      // bypass the span above — route them back through the proxy instead.
      if (prop === "catch") {
        return (onRejected?: (reason: unknown) => unknown) =>
          (proxy as PromiseLike<unknown>).then(undefined, onRejected);
      }
      if (prop === "finally") {
        return (onFinally?: () => void) =>
          (proxy as PromiseLike<unknown>).then(
            (v) => {
              onFinally?.();
              return v;
            },
            (e) => {
              onFinally?.();
              throw e;
            },
          );
      }

      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
          return result === target ? proxy : result;
        };
      }
      return value;
    },
  }) as T;

  return proxy;
}

/** Reconstructs the statement from a tagged-template call, params as $n. */
function templateText(strings: readonly string[]): string {
  return strings.reduce(
    (acc, part, i) => acc + part + (i < strings.length - 1 ? `$${i + 1}` : ""),
    "",
  );
}

function isTemplateStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && "raw" in value;
}

/**
 * Returns a traced view of a postgres.js client. Pass-through (same object)
 * when tracing is disabled, so the non-traced path costs nothing.
 *
 * Covers reads and writes alike — everything Drizzle runs goes through
 * `client.unsafe(query, params)`, and transactions go through `client.begin`.
 */
export function instrumentPostgresClient<C extends object>(
  client: C,
  connectionString?: string,
): C {
  if (!dbTracingEnabled()) return client;

  const namespace = connectionString
    ? namespaceOf(connectionString)
    : undefined;

  return new Proxy(client, {
    // `sql\`select …\`` — but the same callable is also the helper form
    // `sql(value)` / `sql(obj, ...keys)`, which builds a fragment rather than
    // a query and must not be wrapped.
    apply(target, thisArg, args: unknown[]) {
      const result = Reflect.apply(
        target as unknown as (...a: unknown[]) => unknown,
        thisArg,
        args,
      );
      if (!isTemplateStrings(args[0]) || typeof result !== "object" || !result)
        return result;
      return wrapQuery(result, templateText(args[0]), namespace);
    },

    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      // The single execution point for every Drizzle statement.
      if (prop === "unsafe") {
        return (query: string, ...rest: unknown[]) => {
          const result = (
            value as (q: string, ...r: unknown[]) => unknown
          ).call(target, query, ...rest);
          return typeof result === "object" && result
            ? wrapQuery(result, query, namespace)
            : result;
        };
      }

      // Transactions: one span for the transaction, with the statements
      // inside it nested under that span (the callback's client is itself
      // instrumented, and the span is made current for its duration).
      if (prop === "begin") {
        return (...args: unknown[]) => {
          const callback = args[args.length - 1];
          if (typeof callback !== "function")
            return (value as (...a: unknown[]) => unknown).apply(target, args);

          const span = tracer().startSpan("transaction", {
            kind: SpanKind.CLIENT,
            attributes: {
              [ATTR_DB_SYSTEM_NAME]: "postgresql",
              [ATTR_DB_OPERATION_NAME]: "BEGIN",
              ...(namespace ? { [ATTR_DB_NAMESPACE]: namespace } : {}),
            },
          });

          const wrapped = (txClient: object, ...rest: unknown[]) =>
            (callback as (...a: unknown[]) => unknown)(
              instrumentPostgresClient(txClient, connectionString),
              ...rest,
            );

          return context.with(trace.setSpan(context.active(), span), () =>
            (value as (...a: unknown[]) => Promise<unknown>)
              .apply(target, [...args.slice(0, -1), wrapped])
              .then(
                (v: unknown) => {
                  finish(span);
                  return v;
                },
                (e: unknown) => {
                  finish(span, e);
                  throw e;
                },
              ),
          );
        };
      }

      return value;
    },
  });
}
