#!/usr/bin/env node
/**
 * Database migration script for Docker deployments.
 * Runs drizzle-kit push to sync schema with PostgreSQL.
 *
 * Pre-creates tables that drizzle-kit might confuse with renames
 * (e.g. user_consents vs suites) to avoid interactive prompts.
 */
const { execSync } = require("child_process");

// Tables drizzle-kit may wrongly interpret as renames of existing tables.
// Add CREATE TABLE IF NOT EXISTS statements here as needed.
const PRE_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS user_consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    consent_type TEXT NOT NULL,
    granted BOOLEAN NOT NULL,
    version TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    granted_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS csv_data_sources (
    id TEXT PRIMARY KEY,
    repository_id TEXT,
    team_id TEXT,
    alias TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT,
    cached_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
    cached_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_count INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
  );
`;

async function preCreate() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    await sql.unsafe(PRE_CREATE_SQL);
    console.log("[migrate] Pre-create done");
  } catch (e) {
    console.log("[migrate] Pre-create skipped:", e.message);
  } finally {
    if (sql) await sql.end();
  }
}

// Null out orphan FK references that would block drizzle-kit push --force
// when it re-applies FK constraints (e.g. routes / tests pointing at a
// functional_area_id that was hard-deleted before onDelete:'set null' existed).
async function nullOrphans() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    const targets = [
      {
        table: "routes",
        col: "functional_area_id",
        refTable: "functional_areas",
        refCol: "id",
      },
      {
        table: "tests",
        col: "functional_area_id",
        refTable: "functional_areas",
        refCol: "id",
      },
    ];
    for (const t of targets) {
      try {
        const r = await sql.unsafe(`
          UPDATE "${t.table}"
          SET "${t.col}" = NULL
          WHERE "${t.col}" IS NOT NULL
            AND "${t.col}" NOT IN (SELECT "${t.refCol}" FROM "${t.refTable}")
        `);
        const c = (r && r.count) || 0;
        if (c > 0) {
          console.warn(
            `[migrate] nulled ${c} orphan(s) in ${t.table}.${t.col}`,
          );
        }
      } catch (e) {
        console.warn(
          `[migrate] orphan-null skipped for ${t.table}.${t.col}:`,
          e.message,
        );
      }
    }
  } catch (e) {
    console.log("[migrate] orphan cleanup skipped:", e.message);
  } finally {
    if (sql) await sql.end();
  }
}

// Bump pool capacity on the existing global playwright_settings row to the
// new defaults. Schema defaults only apply to fresh rows, so without this
// the old prod values (maxParallelEBs=10, ebPoolMax=30) stick forever. Uses
// GREATEST() so user-customized higher values are never reduced.
async function bumpPoolDefaults() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    const r = await sql.unsafe(`
      UPDATE "playwright_settings"
      SET "max_parallel_ebs"      = GREATEST(COALESCE("max_parallel_ebs", 0), 30),
          "eb_pool_max"            = GREATEST(COALESCE("eb_pool_max", 0), 50),
          "eb_idle_ttl_seconds"    = GREATEST(COALESCE("eb_idle_ttl_seconds", 0), 120)
      WHERE "repository_id" IS NULL
        AND (COALESCE("max_parallel_ebs", 0) < 30
          OR COALESCE("eb_pool_max", 0) < 50
          OR COALESCE("eb_idle_ttl_seconds", 0) < 120)
    `);
    const c = (r && r.count) || 0;
    if (c > 0) {
      console.log(
        `[migrate] bumped pool defaults on global playwright_settings (rows=${c})`,
      );
    }
  } catch (e) {
    console.warn("[migrate] pool default bump skipped:", e.message);
  } finally {
    if (sql) await sql.end();
  }
}

// Unique indexes whose CREATE can be blocked by pre-existing duplicate data.
// drizzle-kit push has NO dedup step, so if a table accumulated duplicate rows
// while the index was missing (chicken-and-egg: ON CONFLICT kept failing → dupes
// piled up → push could never add the unique index), push fails this DDL on every
// boot and silently continues. We clear the blocker (dedup, keeping the newest
// row per key) and create the index ourselves so it converges on any environment.
// Add an entry here whenever a new uniqueIndex() is introduced over data that may
// already contain duplicates in the wild.
const DEDUP_UNIQUE_INDEXES = [
  {
    table: "remote_recording_events",
    columns: ["session_id", "sequence"],
    indexName: "idx_remote_recording_events_session_seq",
    // keep the most-recently-written row per (session_id, sequence)
    keepOrder: "created_at DESC, ctid DESC",
  },
];

async function ensureUniqueIndexes() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    for (const ix of DEDUP_UNIQUE_INDEXES) {
      const cols = ix.columns.map((c) => `"${c}"`).join(", ");
      try {
        // 1. Remove rows that would violate the unique constraint, keeping the
        //    canonical (newest) copy per key.
        const del = await sql.unsafe(`
          DELETE FROM "${ix.table}" t WHERE t.ctid NOT IN (
            SELECT DISTINCT ON (${cols}) ctid FROM "${ix.table}"
            ORDER BY ${cols}, ${ix.keepOrder}
          )
        `);
        const dc = (del && del.count) || 0;
        if (dc > 0) {
          console.warn(
            `[migrate] deduped ${dc} row(s) in ${ix.table} for ${ix.indexName}`,
          );
        }
        // 2. Create the index explicitly (idempotent) so ON CONFLICT works even
        //    if drizzle-kit push doesn't reconcile it. Same name + column order
        //    as the schema declaration, so push then treats it as a no-op.
        await sql.unsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${ix.indexName}" ON "${ix.table}" (${cols})`,
        );
      } catch (e) {
        console.warn(
          `[migrate] unique-index ensure skipped for ${ix.indexName}:`,
          e.message,
        );
      }
    }
  } catch (e) {
    console.log("[migrate] unique-index ensure skipped:", e.message);
  } finally {
    if (sql) await sql.end();
  }
}

// `agent_*` → `explorer_*` renames the explorer plugin split needs done BEFORE
// `drizzle-kit push --force` below, or push reads the vanished/appeared table
// names as DROP + CREATE and destroys every row — including
// agent_knowledge.cred_password, an encrypted credential nobody can re-derive.
// This is the plain-JS port of scripts/migrate-explorer-plugin-tables.ts (kept
// for local `pnpm tsx` runs); it has to live here because this file — not that
// one — is what Dockerfile.migrate and docker-entrypoint.sh actually run.
const EXPLORER_RENAMES = [
  ["agent_knowledge", "explorer_knowledge"],
  ["agent_experience", "explorer_experience"],
  ["agent_findings", "explorer_findings"],
];

async function migrateExplorerTables() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);

    const tableExists = async (name) => {
      const rows = await sql`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = ${name}
        ) as exists`;
      return rows[0]?.exists ?? false;
    };
    const rowCount = async (name) => {
      const rows = await sql.unsafe(
        `select count(*)::text as n from "${name}"`,
      );
      return Number(rows[0]?.n ?? 0);
    };
    const columnExists = async (table, column) => {
      const rows = await sql`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}
        ) as exists`;
      return rows[0]?.exists ?? false;
    };

    for (const [from, to] of EXPLORER_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        // Empty destination is what a prior `push` left behind when someone
        // pushed before this ran. Safe to drop because it is empty.
        await sql.unsafe(`drop table "${to}"`);
      }
      if (from === "agent_findings") {
        const [{ n }] = await sql.unsafe(
          `select count(*)::text as n from agent_findings where bug_report_id is not null`,
        );
        if (Number(n) > 0) {
          console.warn(
            `[migrate] ${n} finding(s) carry bug_report_id — preserved across the rename` +
              ` (explorer_findings.bug_report_id exists, so push will not drop it)`,
          );
        }
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] ${from} -> ${to}: renamed`);
    }

    // `agent_sessions` holds five agent kinds; only the `explorer` slice moves,
    // as a filtered copy (source rows stay in place, re-runnable/reversible).
    if (
      (await tableExists("agent_sessions")) &&
      (await columnExists("agent_sessions", "kind"))
    ) {
      const destExists = await tableExists("explorer_sessions");
      const destPopulated =
        destExists && (await rowCount("explorer_sessions")) > 0;
      if (!destPopulated) {
        const [{ n: total }] = await sql.unsafe(
          `select count(*)::text as n from agent_sessions where kind = 'explorer'`,
        );
        if (Number(total) > 0) {
          await sql.unsafe(`
            update agent_sessions s
               set team_id = r.team_id
              from repositories r
             where s.repository_id = r.id
               and s.kind = 'explorer'
               and s.team_id is null
               and r.team_id is not null`);

          const [{ n: orphaned }] = await sql.unsafe(
            `select count(*)::text as n from agent_sessions where kind = 'explorer' and team_id is null`,
          );
          if (Number(orphaned) > 0) {
            console.warn(
              `[migrate] ${orphaned} explorer session(s) have no resolvable team_id — NOT migrated, left in agent_sessions`,
            );
          }

          if (destExists) await sql.unsafe(`drop table explorer_sessions`);
          await sql.unsafe(`
            create table explorer_sessions as
            select id, repository_id, team_id, status, current_step_id,
                   steps, metadata, created_at, updated_at, completed_at
              from agent_sessions
             where kind = 'explorer' and team_id is not null`);
          console.log(
            `[migrate] agent_sessions -> explorer_sessions: copied explorer rows (source left in place)`,
          );
        }
      }
    }
  } catch (e) {
    console.warn("[migrate] explorer table migration skipped:", e.message);
  } finally {
    if (sql) await sql.end();
  }
}

async function main() {
  await preCreate();
  await migrateExplorerTables();
  await nullOrphans();
  await bumpPoolDefaults();
  await ensureUniqueIndexes();

  console.log("[migrate] Running drizzle-kit push...");
  try {
    execSync("./node_modules/.bin/drizzle-kit push --force 2>&1", {
      stdio: "inherit",
    });
    console.log("[migrate] Done");
  } catch (e) {
    console.error("[migrate] Failed:", e.message);
    process.exit(1);
  }
}

main();
