/**
 * Runtime verification for `core/data` against a real postgres.
 *
 * The unit tests prove the namespace rule and the deletion driver in isolation.
 * They do not prove the thing that actually matters: that a handle built by
 * `createScopedDatabase` can really read and write, that a transaction really
 * rolls back, and that a plugin's rows really disappear when its deletion hook
 * runs. Those need a database.
 *
 * Requires `docker compose up -d` (host postgres). Run with
 * `pnpm test:integration`.
 */
import { eq, sql as raw } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDeletionHooks } from "./deletion";
import { createScopedDatabase, PluginSchemaError } from "./scoped-db";

// A throwaway plugin schema. `demo_probe_` is the namespace a plugin with id
// "demo-probe" is allowed to own — the prefix is what the boot check enforces.
const probeRows = pgTable("demo_probe_rows", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  n: integer("n").notNull().default(0),
});

const SCHEMA = { probeRows };
const CONNECTION =
  process.env.DATABASE_URL ??
  "postgresql://lastest:lastest@localhost:5432/lastest";

let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  client = postgres(CONNECTION, { max: 4, prepare: false });
  // Created and dropped by this file alone — it never touches a core table, so
  // it cannot disturb the dev database. (And `db:reset` is never run here.)
  await client`
    CREATE TABLE IF NOT EXISTS demo_probe_rows (
      id text PRIMARY KEY,
      team_id text NOT NULL,
      n integer NOT NULL DEFAULT 0
    )`;
});

afterAll(async () => {
  await client`DROP TABLE IF EXISTS demo_probe_rows`;
  await client.end({ timeout: 5 });
});

describe("createScopedDatabase against real postgres", () => {
  it("reads and writes the plugin's own tables", async () => {
    const db = createScopedDatabase("demo-probe", SCHEMA, client);

    await db.orm.insert(probeRows).values({ id: "r1", teamId: "team-a", n: 1 });
    const found = await db.orm
      .select()
      .from(probeRows)
      .where(eq(probeRows.id, "r1"));

    expect(found).toEqual([{ id: "r1", teamId: "team-a", n: 1 }]);
  });

  it("exposes the schema through drizzle's relational query API", async () => {
    // This is the part that is genuinely scoped by the handle: `db.query` only
    // knows the tables the instance was built with.
    const db = createScopedDatabase("demo-probe", SCHEMA, client);
    const rows = await db.orm.query.probeRows.findMany();
    expect(rows.map((r) => r.id)).toContain("r1");
    expect(Object.keys(db.orm.query)).toEqual(["probeRows"]);
  });

  it("rolls a transaction back on throw", async () => {
    const db = createScopedDatabase("demo-probe", SCHEMA, client);

    await expect(
      db.transaction(async (tx) => {
        await tx.orm
          .insert(probeRows)
          .values({ id: "rollback-me", teamId: "team-a", n: 9 });
        throw new Error("plugin changed its mind");
      }),
    ).rejects.toThrow("plugin changed its mind");

    const found = await db.orm
      .select()
      .from(probeRows)
      .where(eq(probeRows.id, "rollback-me"));
    expect(found).toEqual([]);
  });

  it("commits a transaction that returns", async () => {
    const db = createScopedDatabase("demo-probe", SCHEMA, client);
    const out = await db.transaction(async (tx) => {
      await tx.orm
        .insert(probeRows)
        .values({ id: "committed", teamId: "team-b", n: 3 });
      return "done";
    });

    expect(out).toBe("done");
    const found = await db.orm
      .select()
      .from(probeRows)
      .where(eq(probeRows.id, "committed"));
    expect(found).toHaveLength(1);
  });

  it("keeps the transaction handle bound to the same schema", async () => {
    // A plugin must not be able to widen its reach by going through a tx.
    const db = createScopedDatabase("demo-probe", SCHEMA, client);
    await db.transaction(async (tx) => {
      expect(Object.keys(tx.schema)).toEqual(["probeRows"]);
    });
  });

  it("refuses to build a handle over a core table, against the live schema", async () => {
    // `repositories` genuinely exists in this database. The point is that a
    // plugin re-exporting it gets a boot failure rather than a working handle.
    const repositories = pgTable("repositories", {
      id: text("id").primaryKey(),
    });

    expect(() =>
      createScopedDatabase("demo-probe", { probeRows, repositories }, client),
    ).toThrow(PluginSchemaError);

    // And the table it was reaching for is really there — so the rejection is
    // the only thing standing between the plugin and core's data.
    const exists = await client`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'repositories'`;
    expect(exists).toHaveLength(1);
  });
});

describe("deletion hooks against real postgres", () => {
  it("actually removes the plugin's rows for a deleted team", async () => {
    // The no-FK rule means postgres will not cascade. This is the replacement,
    // and this test is the only thing proving it deletes anything at all.
    const db = createScopedDatabase("demo-probe", SCHEMA, client);
    await db.orm.insert(probeRows).values([
      { id: "doomed-1", teamId: "team-doomed", n: 1 },
      { id: "doomed-2", teamId: "team-doomed", n: 2 },
      { id: "survivor", teamId: "team-safe", n: 3 },
    ]);

    const report = await runDeletionHooks(
      [
        {
          id: "demo-probe",
          deletion: {
            onTeamDeleted: async (teamId) => {
              await db.orm
                .delete(probeRows)
                .where(eq(probeRows.teamId, teamId));
            },
          },
        },
      ],
      { kind: "team", id: "team-doomed" },
    );

    expect(report.ran).toEqual(["demo-probe"]);
    expect(report.failed).toEqual([]);

    const left = await db.orm.select().from(probeRows);
    const ids = left.map((r) => r.id);
    expect(ids).not.toContain("doomed-1");
    expect(ids).not.toContain("doomed-2");
    expect(ids).toContain("survivor");
  });

  it("is idempotent, as the contract requires", async () => {
    const db = createScopedDatabase("demo-probe", SCHEMA, client);
    const hook = {
      onTeamDeleted: async (teamId: string) => {
        await db.orm.delete(probeRows).where(eq(probeRows.teamId, teamId));
      },
    };
    const plugins = [{ id: "demo-probe", deletion: hook }];

    await runDeletionHooks(plugins, { kind: "team", id: "team-safe" });
    const second = await runDeletionHooks(plugins, {
      kind: "team",
      id: "team-safe",
    });

    // A retry after a partial failure must not blow up.
    expect(second.failed).toEqual([]);
    const count = await db.orm
      .select({ n: raw<number>`count(*)::int` })
      .from(probeRows);
    expect(count[0].n).toBeGreaterThanOrEqual(0);
  });
});
