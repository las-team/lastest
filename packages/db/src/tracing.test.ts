/**
 * The redaction cases here are the security-relevant half of DB tracing:
 * span attributes bypass pino's REDACT_PATHS entirely, so this file is the
 * only thing standing between a `sql.raw()` and a secret in the collector.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeStatement,
  instrumentPostgresClient,
  MAX_STATEMENT_LENGTH,
  redactStatement,
} from "./tracing";

describe("redactStatement", () => {
  it("leaves a fully parameterised statement untouched", () => {
    // Drizzle's normal output — values travel out-of-band as $1/$2.
    const sql = `select "id", "email" from "users" where "team_id" = $1 limit $2`;
    expect(redactStatement(sql)).toBe(sql);
  });

  it("strips a string literal that was inlined via sql.raw", () => {
    expect(
      redactStatement(`select * from users where token = 'sk_live_abc123'`),
    ).toBe(`select * from users where token = '?'`);
  });

  it("strips a literal containing SQL's doubled-quote escape", () => {
    expect(
      redactStatement(`insert into t (a) values ('O''Brien secret')`),
    ).toBe(`insert into t (a) values ('?')`);
  });

  it("strips every literal in a multi-value insert", () => {
    expect(
      redactStatement(
        `insert into api_keys (name, secret) values ('prod', 'shhh'), ('dev', 'also-shhh')`,
      ),
    ).toBe(`insert into api_keys (name, secret) values ('?', '?'), ('?', '?')`);
  });

  it("strips dollar-quoted bodies, apostrophes and all", () => {
    expect(redactStatement(`select $$it's a secret$$`)).toBe(`select $$?$$`);
    expect(redactStatement(`select $tag$multi\nline$tag$`)).toBe(
      `select $tag$?$tag$`,
    );
  });

  it("strips bare numerics without touching $n placeholders", () => {
    expect(redactStatement(`select * from t where id = 42 and x = $1`)).toBe(
      `select * from t where id = ? and x = $1`,
    );
    expect(redactStatement(`select * from t where v = 3.14`)).toBe(
      `select * from t where v = ?`,
    );
  });

  it("does not mangle identifiers that contain digits", () => {
    expect(redactStatement(`select t1.col2 from tbl3 as t1`)).toBe(
      `select t1.col2 from tbl3 as t1`,
    );
  });

  it("caps absurdly long statements", () => {
    const long = `select * from t where x in (${"'a', ".repeat(5000)}'b')`;
    const out = redactStatement(long);
    expect(out.length).toBe(MAX_STATEMENT_LENGTH + 1); // + the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("never leaves an unredacted quoted literal behind", () => {
    // Property-ish sweep over shapes that have leaked in other codebases.
    const secrets = [
      `select * from s where k='eyJhbGciOiJIUzI1NiJ9.payload.sig'`,
      `update t set p = 'argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ' where id = 1`,
      `insert into oauth (tok) values ('gho_16C7e42F292c6912E7710c838347Ae178B4a')`,
    ];
    for (const s of secrets) {
      const out = redactStatement(s);
      expect(out).not.toMatch(/eyJ|argon2id|gho_/);
    }
  });
});

describe("describeStatement", () => {
  it.each([
    [`select "id" from "builds" where x = $1`, "SELECT", "builds"],
    [`insert into "test_runs" ("id") values ($1)`, "INSERT", "test_runs"],
    [`update "teams" set "plan" = $1`, "UPDATE", "teams"],
    [`delete from "sessions" where "id" = $1`, "DELETE", "sessions"],
    [`select * from public.visual_diffs`, "SELECT", "public.visual_diffs"],
  ])("parses %s", (sql, operation, table) => {
    expect(describeStatement(sql)).toEqual({ operation, table });
  });

  it("falls back to SQL for anything unrecognised", () => {
    expect(describeStatement(`listen channel_x`).operation).toBe("SQL");
  });

  it("reports an operation even with no parseable table", () => {
    expect(describeStatement(`begin`)).toEqual({ operation: "BEGIN" });
  });
});

describe("instrumentPostgresClient", () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  /** Minimal stand-in for postgres.js: callable, with unsafe/begin/end. */
  function fakeClient(onQuery?: (sql: string) => void) {
    const makeQuery = (sql: string) => {
      const q = {
        sql,
        values() {
          return q;
        },
        then(res: (v: unknown) => unknown) {
          onQuery?.(sql);
          return Promise.resolve([{ ok: true }]).then(res);
        },
      };
      return q;
    };
    const client = Object.assign(
      (strings: TemplateStringsArray) => makeQuery(strings.join("$1")),
      {
        unsafe: (sql: string) => makeQuery(sql),
        begin: async (fn: (c: unknown) => unknown) => fn(client),
        end: () => Promise.resolve("ended"),
      },
    );
    return client;
  }

  it("is a pass-through when tracing is not opted in", () => {
    // The default everywhere: dev, self-host, CI. Gate cases live in
    // src/otel.test.ts, which checks this predicate against both otel.ts copies.
    delete process.env.OTEL_TRACING_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const client = fakeClient();
    expect(instrumentPostgresClient(client)).toBe(client);
  });

  it("is a pass-through when OTEL_DB_TRACING=0", () => {
    process.env.OTEL_TRACING_ENABLED = "1";
    process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
    process.env.OTEL_DB_TRACING = "0";
    const client = fakeClient();
    expect(instrumentPostgresClient(client)).toBe(client);
  });

  describe("when enabled", () => {
    function enabled(onQuery?: (sql: string) => void) {
      process.env.OTEL_TRACING_ENABLED = "1";
      process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      delete process.env.OTEL_DB_TRACING;
      return instrumentPostgresClient(
        fakeClient(onQuery),
        "postgresql://u:p@h:5432/lastest",
      );
    }

    it("still resolves queries, and only executes them once", async () => {
      const seen: string[] = [];
      const client = enabled((s) => seen.push(s));
      await expect(client.unsafe("select 1 from t")).resolves.toEqual([
        { ok: true },
      ]);
      expect(seen).toEqual(["select 1 from t"]);
    });

    it("keeps .values() chainable through the proxy", async () => {
      const client = enabled();
      // Drizzle does exactly this for row-array mode.
      await expect(client.unsafe("select 1 from t").values()).resolves.toEqual([
        { ok: true },
      ]);
    });

    it("preserves the tagged-template call form", async () => {
      const client = enabled();
      await expect(client`select * from teams`).resolves.toEqual([
        { ok: true },
      ]);
    });

    it("passes non-query methods straight through", async () => {
      const client = enabled();
      await expect(client.end()).resolves.toBe("ended");
    });

    it("instruments the client handed to a transaction callback", async () => {
      const seen: string[] = [];
      const client = enabled((s) => seen.push(s));
      await client.begin(async (tx: ReturnType<typeof fakeClient>) => {
        await tx.unsafe("insert into t values ($1)");
      });
      expect(seen).toEqual(["insert into t values ($1)"]);
    });

    it("propagates rejections instead of swallowing them", async () => {
      process.env.OTEL_TRACING_ENABLED = "1";
      process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      const boom = {
        then: (_r: unknown, rej: (e: unknown) => unknown) =>
          Promise.reject(new Error("boom")).catch(rej as never),
      };
      const client = instrumentPostgresClient({
        unsafe: () => boom,
      } as unknown as { unsafe: () => unknown });
      await expect(
        (client.unsafe() as Promise<unknown>).catch((e: Error) => e.message),
      ).resolves.toBe("boom");
    });

    it("never attaches bound parameters to a span", async () => {
      // The whole point: params are passed to unsafe() but must not appear in
      // anything the tracer sees.
      //
      // resetModules FIRST so the fresh ./tracing picks up the same (spied)
      // @opentelemetry/api instance and starts with an empty tracer cache —
      // otherwise it memoised a real tracer during an earlier test.
      vi.resetModules();
      const attrs: Array<Record<string, unknown>> = [];
      const otel = await import("@opentelemetry/api");
      vi.spyOn(otel.trace, "getTracer").mockReturnValue({
        startSpan: (
          _n: string,
          opts?: { attributes?: Record<string, unknown> },
        ) => {
          attrs.push(opts?.attributes ?? {});
          return {
            end() {},
            recordException() {},
            setStatus() {},
          } as never;
        },
      } as never);
      const { instrumentPostgresClient: freshInstrument } =
        await import("./tracing");

      process.env.OTEL_TRACING_ENABLED = "1";
      process.env.KUBERNETES_SERVICE_HOST = "10.43.0.1";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      delete process.env.OTEL_DB_TRACING;
      const client = freshInstrument(
        fakeClient(),
        "postgresql://u:p@h:5432/lastest",
      );
      await client.unsafe("insert into oauth (tok) values ($1)", [
        "gho_SUPERSECRET",
      ]);

      expect(attrs).toHaveLength(1);
      expect(JSON.stringify(attrs[0])).not.toContain("gho_SUPERSECRET");
      expect(attrs[0]["db.query.text"]).toBe(
        "insert into oauth (tok) values ($1)",
      );
      expect(attrs[0]["db.collection.name"]).toBe("oauth");
      expect(attrs[0]["db.namespace"]).toBe("lastest");
      vi.restoreAllMocks();
    });
  });
});
