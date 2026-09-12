import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./schema";

/**
 * The invariants the tenancy fix rests on, asserted rather than reviewed.
 *
 * The review that prompted this migration found the engine's state keyed by
 * nothing (`runs`), by nothing (`watermarks`), or by a `vault_dns` string a
 * tenant types into their own connector (`id_map`, `probe_results`). The fix is
 * a schema property — `project_id` leading every engine key — and a schema
 * property is exactly the kind of thing that regresses silently when someone
 * adds a fourteenth table. So it is a test.
 *
 * `src/lib/core/manifests.test.ts` already covers the prefix rule through
 * `resolveRegistry`; the duplicate here is deliberate, because this file is
 * where someone adding a table will be looking.
 */

/** Tables holding the lead's decisions. Everything else is engine state. */
const APP_TABLES = new Set([
  "veeva_migration_projects",
  "veeva_migration_waves",
  "veeva_migration_runs",
  "veeva_migration_finding_acks",
]);

/** Core tables a plugin table must not reference (`core-scope.md` §6). */
const CORE_TABLES = new Set([
  "repositories",
  "users",
  "sut_connectors",
  "environments",
  "teams",
  "background_jobs",
]);

// `Object.values` also yields `MIGRATION_STAGES` and the mode/status arrays, so
// this filters by drizzle's own `is(x, Table)` rather than a type predicate the
// union would not accept.
const tables = (Object.values(schema) as unknown[])
  .filter((value) => is(value, Table))
  .map((value) => value as Table)
  .map((table) => ({
    table,
    name: getTableName(table),
    columns: Object.keys(getTableColumns(table)),
    config: getTableConfig(table),
  }));

describe("veeva-migration schema", () => {
  it("declares both halves of the feature", () => {
    // 4 decision tables + 13 engine tables. `schema_migrations` is deliberately
    // not translated: core owns DDL now.
    expect(tables).toHaveLength(17);
    for (const name of APP_TABLES) {
      expect(tables.map((t) => t.name)).toContain(name);
    }
  });

  it("namespaces every table to the plugin id", () => {
    for (const { name } of tables) {
      expect(name.startsWith("veeva_migration_")).toBe(true);
    }
  });

  it("holds no foreign key to a core table", () => {
    for (const { name, config } of tables) {
      const targets = config.foreignKeys.map((fk) =>
        getTableName(fk.reference().foreignTable),
      );
      for (const target of targets) {
        expect(
          CORE_TABLES.has(target),
          `${name} references core table ${target}`,
        ).toBe(false);
      }
    }
  });

  it("keys every engine table on the project", () => {
    const engine = tables.filter((t) => !APP_TABLES.has(t.name));
    expect(engine.length).toBe(13);
    for (const { name, columns, config } of engine) {
      expect(columns, `${name} has no projectId`).toContain("projectId");
      // A leading `project_id` is what makes the key scoped rather than
      // filtered: `watermarks` was `(object_key, country, kind)`, so two
      // projects in one team shared a high-water mark and the second one
      // silently skipped rows.
      const key = config.primaryKeys[0];
      if (key) {
        expect(
          key.columns[0]?.name,
          `${name}: primary key does not lead with project_id`,
        ).toBe("project_id");
      } else {
        // The two bigserial-id tables (findings, audit log) have no composite
        // key, so their scoping is the index the store queries through.
        const indexed = config.indexes.some((idx) => {
          const first = idx.config.columns[0];
          return (
            first !== undefined &&
            "name" in first &&
            first.name === "project_id"
          );
        });
        expect(indexed, `${name}: no index leading with project_id`).toBe(true);
      }
    }
  });

  it("cascades every engine table from the project row", () => {
    // This is the deletion path the old engine schema had no equivalent of:
    // its rows outlived the project, the repo and the team. A plugin-internal
    // FK breaks no rule and is what makes `deletion.ts` a four-line file.
    for (const { name, config } of tables) {
      if (name === "veeva_migration_projects") continue;
      const toProjects = config.foreignKeys.find(
        (fk) =>
          getTableName(fk.reference().foreignTable) ===
          "veeva_migration_projects",
      );
      expect(toProjects, `${name} does not hang off the project`).toBeDefined();
      expect(toProjects?.onDelete).toBe("cascade");
    }
  });

  it("has no run_dir anywhere", () => {
    // It was free text from a settings form handed to `fs.mkdir`. The run
    // directory is derived by the host and never stored.
    for (const { name, columns } of tables) {
      expect(columns, `${name} still has a runDir`).not.toContain("runDir");
    }
  });
});
