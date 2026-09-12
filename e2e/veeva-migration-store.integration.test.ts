/**
 * `PluginDataStateStore` against a real Postgres, held to the engine's own
 * behavioural contract.
 *
 * **Lives here, not in the plugin**, for one reason: it needs a real `postgres`
 * client to play the part of the composition root, and a plugin's manifest must
 * not list `postgres` at all (recipe §0 rule 2 — the manifest is the
 * enforcement, and a devDependency a reviewer has to reason about defeats the
 * point). `core/data/src/scoped-db.integration.test.ts` is the same shape for
 * the same reason. The app is allowed to open a connection; the plugin is not,
 * and that is exactly what this file proves the store does not need.
 *
 * Skipped unless `MIG_TEST_DATABASE_URL` (or `DATABASE_URL`) is set:
 *
 *     docker compose up -d && pnpm db:push && pnpm test:integration
 *
 * The tables must already exist. That is the point of the migration: DDL is
 * core's job now, not something the store does on open under an advisory
 * lock.
 *
 * Two suites here, and the second is the one that matters most:
 *
 *  - the shared `stateStoreContract`, so this implementation is held to exactly
 *    the same behaviour as `MemoryStateStore` and `FileStateStore`;
 *  - `tenancy`, which asserts the two defects the review found are actually
 *    gone rather than merely refactored: no cross-project watermark collision,
 *    and no cross-project read of runs or the id map.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTRACT_VAULT_DNS,
  stateStoreContract,
} from "@lastest/veeva-migration/store/contract";
import type { IdMapRow, RunRecord } from "@lastest/veeva-migration/types";

import * as schema from "@lastest/plugin-veeva-migration/schema";
import { veevaMigrationProjects } from "@lastest/plugin-veeva-migration/schema";
import { PluginDataStateStore } from "@lastest/plugin-veeva-migration/store";

const url = process.env.MIG_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const maybe = url ? describe : describe.skip;

/**
 * A raw client here, unlike production.
 *
 * The store never opens a connection — `core/data` hands it a handle — so the
 * test has to play the part of the composition root.
 */
const client = url ? postgres(url, { max: 4, prepare: false }) : undefined;
const db = client ? drizzle(client, { schema }) : undefined;

const projects: string[] = [];

const run = (runId: string): RunRecord => ({
  runId,
  mode: "init",
  countries: ["US"],
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "succeeded",
  toolVersion: "0.1.0",
  configHash: "c",
});

/** A fresh, empty, project-scoped store. Isolation IS the new project id. */
async function makeStore(vaultDns = CONTRACT_VAULT_DNS) {
  const projectId = `test-${randomUUID()}`;
  projects.push(projectId);
  await db!.insert(veevaMigrationProjects).values({
    id: projectId,
    repositoryId: `repo-${projectId}`,
    teamId: `team-${projectId}`,
    name: projectId,
    config: {},
  });
  return new PluginDataStateStore({
    db: db!,
    projectId,
    vaultDns,
    // Small, so the batching and keyset-pagination paths are exercised by the
    // contract's handful of rows rather than only in production.
    batchSize: 2,
  });
}

maybe("PluginDataStateStore", () => {
  beforeAll(() => {
    expect(db).toBeDefined();
  });

  afterAll(async () => {
    // The plugin-internal FK cascades, so deleting the project rows reaps every
    // engine row this file wrote. That cascade is itself the fix for the review's
    // "no deletion path" finding.
    if (db && projects.length)
      await db
        .delete(veevaMigrationProjects)
        .where(inArray(veevaMigrationProjects.id, projects));
    await client?.end({ timeout: 5 });
  });

  stateStoreContract("plugin-data", () => makeStore());

  describe("tenancy", () => {
    it("two projects do not share a watermark", async () => {
      const uat = await makeStore();
      const prod = await makeStore();
      const wm = {
        objectKey: "account" as const,
        country: "US" as const,
        kind: "modstamp" as const,
        runId: "r1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      await uat.watermarks.set({ ...wm, value: "2026-06-01T00:00:00.000Z" });

      // The whole bug, in one assertion. The old key was
      // `(object_key, country, kind)`, so PROD's first init read UAT's
      // high-water mark and skipped every row written before it.
      expect(
        await prod.watermarks.get("account", "US", "modstamp"),
      ).toBeUndefined();
      expect(await prod.watermarks.list()).toEqual([]);

      await prod.watermarks.set({ ...wm, value: "2020-01-01T00:00:00.000Z" });
      expect(
        (await uat.watermarks.get("account", "US", "modstamp"))?.value,
      ).toBe("2026-06-01T00:00:00.000Z");
    });

    it("runs are not visible across projects", async () => {
      const a = await makeStore();
      const b = await makeStore();
      await a.runs.create(run("r-a"));

      // `runs.list()` used to filter on `status` alone, and `latestSucceeded()`
      // on nothing else at all — so a cross-tenant `MAP_HASH_CHANGED` or
      // `SF_ORG_MISMATCH` check compared against another customer's run.
      expect(await b.runs.list()).toEqual([]);
      expect(await b.runs.latestSucceeded()).toBeUndefined();
      expect(await b.runs.get("r-a")).toBeUndefined();
      expect((await a.runs.list()).map((r) => r.runId)).toEqual(["r-a"]);
    });

    it("the id map is not readable across projects, even on the same vault", async () => {
      const a = await makeStore("shared.veevavault.com");
      const b = await makeStore("shared.veevavault.com");
      const row: IdMapRow = {
        objectKey: "account",
        sfdcId: "001000000000001AAA",
        vaultDns: "shared.veevavault.com",
        vaultObject: "account__v",
        vaultId: "V0001",
        country: "US",
        matchMethod: "created",
        firstSeenRun: "r1",
        lastSeenRun: "r1",
      };
      await a.idMap.put(row);

      // Same Vault DNS on purpose: `vault_dns` was the *only* scope the id map
      // had, and it is a string the tenant types into their own connector.
      expect(await b.idMap.get("account", row.sfdcId)).toBeUndefined();
      expect(await b.idMap.byVaultId("account__v", "V0001")).toBeUndefined();
      expect(await b.idMap.count("account")).toBe(0);
      expect(await a.idMap.count("account")).toBe(1);
    });

    it("refuses to be constructed without a tenant key", async () => {
      expect(
        () =>
          new PluginDataStateStore({
            db: db!,
            projectId: "",
            vaultDns: CONTRACT_VAULT_DNS,
          }),
      ).toThrow(/projectId/);
    });
  });

  describe("deletion", () => {
    it("deleting the project row reaps its engine state", async () => {
      const store = await makeStore();
      const projectId = projects[projects.length - 1]!;
      await store.runs.create(run("r-gone"));
      await store.auditLog.append({
        at: "2026-01-01T00:00:00.000Z",
        actor: "user-1",
        event: "run.start",
      });

      await db!
        .delete(veevaMigrationProjects)
        .where(eq(veevaMigrationProjects.id, projectId));

      const left = await db!
        .select()
        .from(schema.veevaMigrationEngineRuns)
        .where(eq(schema.veevaMigrationEngineRuns.projectId, projectId));
      const audit = await db!
        .select()
        .from(schema.veevaMigrationAuditLog)
        .where(eq(schema.veevaMigrationAuditLog.projectId, projectId));
      expect(left).toEqual([]);
      // The old engine schema kept the audit log — actors and per-record ids —
      // after the project, the repo and the team were gone.
      expect(audit).toEqual([]);
    });
  });
});
