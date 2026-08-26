#!/usr/bin/env node
/**
 * Database migration script for Docker deployments.
 * Runs drizzle-kit push to sync schema with PostgreSQL.
 *
 * Pre-creates tables that drizzle-kit might confuse with renames
 * (e.g. user_consents vs suites) to avoid interactive prompts.
 *
 * Failure policy: the plugin-table rename/backfill/FK-drop steps below are
 * FATAL on unexpected errors — they rethrow, main() exits non-zero, and
 * `drizzle-kit push --force` never runs. Push cannot see a rename: a skipped
 * rename step means old-name-present/new-name-absent, which push resolves as
 * DROP old + CREATE new, destroying the rows these steps exist to protect.
 * Only steps whose skip cannot make push destructive (preCreate, nullOrphans,
 * bumpPoolDefaults, ensureUniqueIndexes) stay warn-and-continue.
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
    // Safe to skip against push --force: these tables are in the schema, so a
    // missed pre-create only leaves push to CREATE them itself — never a DROP.
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
        // Safe to skip against push --force: leftover orphans make push FAIL
        // on the FK re-add (exit non-zero) — a stuck boot, not lost rows.
        console.warn(
          `[migrate] orphan-null skipped for ${t.table}.${t.col}:`,
          e.message,
        );
      }
    }
  } catch (e) {
    // Safe to skip against push --force: same as above — worst case push
    // fails on the FK constraint and exits non-zero; nothing is dropped.
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
    // Safe to skip against push --force: a pure UPDATE of settings values —
    // no table/column shape changes, so push has nothing extra to drop.
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
        // Safe to skip against push --force: without the dedup, push merely
        // fails the CREATE UNIQUE INDEX DDL and moves on — no DROP involved.
        console.warn(
          `[migrate] unique-index ensure skipped for ${ix.indexName}:`,
          e.message,
        );
      }
    }
  } catch (e) {
    // Safe to skip against push --force: same as above — a failed index DDL
    // in push is non-destructive.
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
    // FATAL — never warn-and-continue here. A transient failure (lock timeout
    // on the ALTER, dropped connection) would leave the old names in place,
    // and `drizzle-kit push --force` below would resolve that as DROP old +
    // CREATE new, destroying the rows. Rethrow so main() exits before push;
    // `finally` still closes the connection on this path.
    console.error("[migrate] explorer table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// `a11y_baselines` became `@lastest/plugin-a11y`'s own table (RFC §9 phase 3).
// The table name did not change, but two things about its shape did, and both
// must happen BEFORE `drizzle-kit push --force` below:
//
//   1. `repository_id` / `team_id` are new and NOT NULL. Push would add them
//      with no default against a populated table and fail — or, worse, on some
//      paths drop and recreate. So they are added nullable here, backfilled by
//      joining `a11y_baselines -> tests -> repositories`, and only then set NOT
//      NULL.
//   2. The FK `test_id REFERENCES tests(id) ON DELETE CASCADE` is dropped. A
//      plugin table carries no FK to a core table (core-scope.md §6); the rows
//      are reaped by the plugin's deletion hook instead.
//
// Rows whose team cannot be resolved (orphaned test/repo) are deleted rather
// than migrated — they are already unreachable: the FK's own cascade would
// have removed them when their test went away.
async function migrateA11yBaselineOwnership() {
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
    const columnExists = async (table, column) => {
      const rows = await sql`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}
        ) as exists`;
      return rows[0]?.exists ?? false;
    };

    if (!(await tableExists("a11y_baselines"))) return;

    // Idempotent: a re-run finds the columns already NOT NULL and does nothing.
    if (!(await columnExists("a11y_baselines", "repository_id"))) {
      await sql.unsafe(
        `alter table a11y_baselines add column repository_id text`,
      );
      console.log("[migrate] a11y_baselines: added repository_id");
    }
    if (!(await columnExists("a11y_baselines", "team_id"))) {
      await sql.unsafe(`alter table a11y_baselines add column team_id text`);
      console.log("[migrate] a11y_baselines: added team_id");
    }

    await sql.unsafe(`
      update a11y_baselines b
         set repository_id = t.repository_id,
             team_id      = r.team_id
        from tests t
        join repositories r on r.id = t.repository_id
       where b.test_id = t.id
         and (b.repository_id is null or b.team_id is null)
         and t.repository_id is not null
         and r.team_id is not null`);

    const [{ n: orphaned }] = await sql.unsafe(
      `select count(*)::text as n from a11y_baselines
        where repository_id is null or team_id is null`,
    );
    if (Number(orphaned) > 0) {
      // Unreachable rows: their test or repo is gone, so the FK cascade this
      // migration removes would have deleted them anyway.
      await sql.unsafe(
        `delete from a11y_baselines where repository_id is null or team_id is null`,
      );
      console.warn(
        `[migrate] a11y_baselines: deleted ${orphaned} row(s) with no resolvable repo/team (orphaned by their test)`,
      );
    }

    await sql.unsafe(
      `alter table a11y_baselines alter column repository_id set not null`,
    );
    await sql.unsafe(
      `alter table a11y_baselines alter column team_id set not null`,
    );

    // Drop the FK to tests(id) by name-agnostic lookup — the constraint was
    // created implicitly, so its name differs between environments.
    const fks = await sql`
      select con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
       where rel.relname = 'a11y_baselines' and con.contype = 'f'`;
    for (const { name } of fks) {
      await sql.unsafe(`alter table a11y_baselines drop constraint "${name}"`);
      console.log(`[migrate] a11y_baselines: dropped FK ${name}`);
    }
  } catch (e) {
    // FATAL — a half-done run (columns added but not backfilled/NOT NULL, FK
    // still present) is exactly what push must never see: it would apply the
    // NOT NULL/FK delta itself, and against a populated table that path can
    // drop rows. Rethrow so main() exits before push (see migrateExplorerTables).
    console.error("[migrate] a11y baseline migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// Person-scoped plugin tables: drop their FKs to `users(id)`.
//
// The seven `launch_*` tables became `@lastest/plugin-launch`'s own and
// `playground_achievements` became `@lastest/plugin-playground`'s (RFC §9
// phase 4). Nothing about their *shape* changed — same names, same columns, so
// no backfill and no drop/recreate risk. What changed is that six FKs to
// `users(id)` are gone (`core-scope.md` §6: a plugin table carries no FK to a
// core table), and the rows are reaped by each plugin's `onUserDeleted` hook
// instead.
//
// This runs BEFORE `drizzle-kit push --force` for one reason: push would drop
// those constraints itself, but by name, and the names differ between
// environments because they were created implicitly. Dropping them here by
// catalogue lookup makes the outcome the same everywhere.
//
// FKs *between* a plugin's own tables (`profile_id -> launch_profiles.id`) are
// deliberately left alone — both sides are plugin-owned, so they break no rule
// and still cascade.
async function dropPluginUserForeignKeys() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);

    // `conname` is unpredictable; find FKs pointing at `users` by catalogue.
    const fks = await sql`
      select rel.relname as table_name, con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname = 'users'
         and rel.relname in (
           'launch_profiles', 'launch_votes', 'launch_comments',
           'launch_reactions', 'playground_achievements'
         )`;
    for (const { table_name: table, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> users)`);
    }
  } catch (e) {
    // FATAL — if these FKs survive into push, it drops them by schema-derived
    // names that don't match the implicitly-created ones, and how --force
    // reconciles that mismatch is not something to bet the launch_* rows on.
    // Rethrow so main() exits before push (see migrateExplorerTables).
    console.error("[migrate] plugin FK migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// The six Beat-the-Bot tables became `@lastest/plugin-gamification`'s own
// (RFC §9 phase 4). Unlike every migration before it, five of them had to be
// **renamed**: `core/data` requires a plugin's tables to carry its id as a
// prefix, and only `gamification_seasons` already did.
//
// This is the step that must not be skipped. `drizzle-kit push` cannot see a
// rename — it compares names, finds `bots` absent from the schema and
// `gamification_bots` missing from the database, and resolves that by dropping
// the first and creating the second. Every score, achievement and bot row in
// the product would go with it.
//
// Idempotent: skips a table that is already gone, and skips a destination that
// already holds rows. A destination that exists but is *empty* is what a `push`
// run before this one leaves behind, and is safe to drop.
const GAMIFICATION_RENAMES = [
  ["bots", "gamification_bots"],
  ["bug_blitz_events", "gamification_bug_blitz_events"],
  ["score_events", "gamification_score_events"],
  ["user_scores", "gamification_user_scores"],
  ["achievements", "gamification_achievements"],
];

async function migrateGamificationTables() {
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

    for (const [from, to] of GAMIFICATION_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        // Empty destination is what a prior `push` left behind. Safe to drop.
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs `bots` et al. and CREATEs the
    // `gamification_*` names empty. Rethrow so main() exits before push
    // (see migrateExplorerTables).
    console.error("[migrate] gamification rename FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// The two CI-provider config tables became `@lastest/plugin-ci`'s own
// (RFC §9 phase 4). Both had to be renamed for the `ci_` prefix `core/data`
// requires — the second migration in a row that did, after `gamification`.
//
// Same reason it must not be skipped: `drizzle-kit push` cannot see a rename.
// It would drop `github_action_configs`, create `ci_github_action_configs`, and
// take every customer's deployed workflow config with it — including
// `gitlab_pipeline_configs.webhook_secret`, whose counterpart lives in the
// customer's GitLab project hook and cannot be re-derived. Losing that side
// turns every subsequent delivery into a 401 until someone redeploys by hand.
//
// Idempotent in the same way as the two above: skips a source that is already
// gone, skips a destination that already holds rows, and drops an *empty*
// destination (what a `push` run before this one leaves behind).
const CI_RENAMES = [
  ["github_action_configs", "ci_github_action_configs"],
  ["gitlab_pipeline_configs", "ci_gitlab_pipeline_configs"],
];

async function migrateCiTables() {
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

    for (const [from, to] of CI_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }

    // Then the three FKs into core, by catalogue lookup for the same reason
    // `dropPluginUserForeignKeys` does it that way: push would drop them by
    // name, and implicitly-created names differ between environments.
    //
    // `ALTER TABLE … RENAME` carries constraints across, so this runs *after*
    // the renames and looks them up under the new table names.
    const fks = await sql`
      select rel.relname as table_name, ref.relname as points_at,
             con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname in ('teams', 'runners', 'repositories')
         and rel.relname in (
           'ci_github_action_configs', 'ci_gitlab_pipeline_configs'
         )`;
    for (const { table_name: table, points_at: target, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> ${target})`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs the old config tables,
    // webhook secrets included. Rethrow so main() exits before push
    // (see migrateExplorerTables).
    console.error("[migrate] ci table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// `public_shares` became `@lastest/plugin-share`'s own table (RFC §9 phase
// 4), renamed for the `share_` prefix `core/data` requires — same shape as
// `GAMIFICATION_RENAMES`, and for the same reason `drizzle-kit push` cannot
// see a rename. No FK cleanup needed afterward: `buildId`/`testId`/
// `repositoryId`/`ownerTeamId`/`publishedByUserId`/`claimedByTeamId`/
// `claimedByUserId` were always convention-only references, never
// constrained — the same finding `gamification` made.
const SHARE_RENAMES = [["public_shares", "share_public_shares"]];

async function migrateShareTables() {
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

    for (const [from, to] of SHARE_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs `public_shares`. Rethrow so
    // main() exits before push (see migrateExplorerTables).
    console.error("[migrate] share table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// `repo_awards` became `@lastest/plugin-awards`'s own table (RFC §9 phase 4,
// ninth plugin), renamed for the `awards_` prefix `core/data` requires — same
// shape as `GAMIFICATION_RENAMES`/`CI_RENAMES`, and for the same reason
// `drizzle-kit push` cannot see a rename: it would drop `repo_awards`, create
// `awards_repo_awards` empty, and take every earned tier with it.
//
// Unlike `share`, this one DOES carry a real FK to a core table
// (`repository_id -> repositories.id ON DELETE CASCADE`), which
// `core-scope.md` §6 forbids a plugin from declaring. Dropped by catalogue
// lookup after the rename, the same shape `migrateCiTables` uses — implicitly
// -created constraint names differ between environments, so `pg_constraint`
// is the only reliable way to find it. `deletion.ts`'s `onRepoDeleted` is
// what replaces the cascade from here on.
const AWARDS_RENAMES = [["repo_awards", "awards_repo_awards"]];

async function migrateAwardsTables() {
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

    for (const [from, to] of AWARDS_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }

    // Then the FK into `repositories`, by catalogue lookup — `ALTER TABLE …
    // RENAME` carries constraints across, so this runs after the rename and
    // looks it up under the new table name.
    const fks = await sql`
      select rel.relname as table_name, ref.relname as points_at,
             con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname = 'repositories'
         and rel.relname = 'awards_repo_awards'`;
    for (const { table_name: table, points_at: target, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> ${target})`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs `repo_awards`. Rethrow so
    // main() exits before push (see migrateExplorerTables).
    console.error("[migrate] awards table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// `csv_data_sources` and `google_sheets_data_sources` became
// `@lastest/plugin-data-sources`'s own tables (RFC §9 phase 4, twelfth
// plugin), renamed for the `data_sources_` prefix `core/data` requires —
// same shape as `CI_RENAMES`/`AWARDS_RENAMES`, and for the same reason
// `drizzle-kit push` cannot see a rename: it would drop each source table,
// create its replacement empty, and take every team's cached CSV/sheet data
// with it.
//
// Both tables carried FKs into `teams`/`repositories`, which
// `core-scope.md` §6 forbids a plugin from declaring — dropped by catalogue
// lookup after the rename. `google_sheets_data_sources` also pointed at
// `google_sheets_accounts` (the OAuth credential table, which stays core);
// that FK goes too, convention-only from here. `deletion.ts`'s
// `onTeamDeleted`/`onRepoDeleted` are what replace the cascades.
const DATA_SOURCES_RENAMES = [
  ["csv_data_sources", "data_sources_csv_sources"],
  ["google_sheets_data_sources", "data_sources_google_sheets"],
];

async function migrateDataSourcesTables() {
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

    for (const [from, to] of DATA_SOURCES_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }

    // Then the FKs into core (teams/repositories/google_sheets_accounts), by
    // catalogue lookup for the same reason `migrateCiTables` does it that
    // way: push would drop them by name, and implicitly-created names differ
    // between environments. `ALTER TABLE … RENAME` carries constraints
    // across, so this runs after the renames and looks them up under the new
    // table names.
    const fks = await sql`
      select rel.relname as table_name, ref.relname as points_at,
             con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname in ('teams', 'repositories', 'google_sheets_accounts')
         and rel.relname in (
           'data_sources_csv_sources', 'data_sources_google_sheets'
         )`;
    for (const { table_name: table, points_at: target, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> ${target})`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs both data-source tables.
    // Rethrow so main() exits before push (see migrateExplorerTables).
    console.error("[migrate] data-sources table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// `build_schedules` became `@lastest/plugin-scheduling`'s own table (RFC §9
// phase 4, thirteenth plugin), renamed for the `scheduling_` prefix
// `core/data` requires — same shape as `AWARDS_RENAMES`/`DATA_SOURCES_RENAMES`,
// and for the same reason `drizzle-kit push` cannot see a rename: it would
// drop `build_schedules`, create `scheduling_build_schedules` empty, and take
// every configured recurring run with it.
//
// This one DOES carry a real FK to a core table
// (`repository_id -> repositories.id ON DELETE CASCADE`), which
// `core-scope.md` §6 forbids a plugin from declaring. Dropped by catalogue
// lookup after the rename, the same shape `migrateAwardsTables` uses.
// `deletion.ts`'s `onRepoDeleted` is what replaces the cascade from here on.
const SCHEDULING_RENAMES = [["build_schedules", "scheduling_build_schedules"]];

async function migrateSchedulingTables() {
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

    for (const [from, to] of SCHEDULING_RENAMES) {
      if (!(await tableExists(from))) continue;
      if (await tableExists(to)) {
        if ((await rowCount(to)) > 0) {
          console.log(`[migrate] ${from} -> ${to}: already migrated`);
          continue;
        }
        await sql.unsafe(`drop table "${to}"`);
      }
      await sql.unsafe(`alter table "${from}" rename to "${to}"`);
      console.log(`[migrate] renamed ${from} -> ${to}`);
    }

    // Then the FK into `repositories`, by catalogue lookup — `ALTER TABLE …
    // RENAME` carries constraints across, so this runs after the rename and
    // looks it up under the new table name.
    const fks = await sql`
      select rel.relname as table_name, ref.relname as points_at,
             con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname = 'repositories'
         and rel.relname = 'scheduling_build_schedules'`;
    for (const { table_name: table, points_at: target, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> ${target})`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs `build_schedules`. Rethrow so
    // main() exits before push (see migrateExplorerTables).
    console.error("[migrate] scheduling table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

async function main() {
  await preCreate();
  await migrateExplorerTables();
  await migrateA11yBaselineOwnership();
  await migrateGamificationTables();
  await migrateCiTables();
  await migrateShareTables();
  await migrateAwardsTables();
  await migrateDataSourcesTables();
  await migrateSchedulingTables();
  await dropPluginUserForeignKeys();
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

// A rethrown pre-push step lands here: the step already console.error'd and
// closed its connection in `finally`; exit non-zero so `drizzle-kit push
// --force` never runs against a half-migrated database.
main().catch((e) => {
  console.error("[migrate] aborted before drizzle-kit push:", e.message);
  process.exit(1);
});
