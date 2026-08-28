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
 *
 * dropRetiredColumns() is FATAL for the same reason renameCarriedConstraints()
 * is: a release that both adds and drops a column on one table hands push an
 * add/drop pair it resolves as a rename PROMPT, hanging the deploy.
 *
 * renameCarriedConstraints() is FATAL for a different reason: skipping it does
 * not destroy anything, it HANGS the deploy on an unanswerable drizzle-kit
 * prompt until the Job's activeDeadlineSeconds kills the pod.
 */
const { execSync } = require("child_process");

// Upper bound on `drizzle-kit push`. See the catch in main() for why a wall
// clock is needed at all. A real push is seconds of work (26s against
// production), so 300s is ~10x headroom while still leaving room for a second
// attempt inside the Job's 600s activeDeadlineSeconds — the deadline reports
// nothing but a deadline, this reports the cause.
const PUSH_TIMEOUT_MS = Number(process.env.MIGRATE_PUSH_TIMEOUT_MS || 300_000);

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

/**
 * Columns retired from the schema, dropped explicitly before push runs.
 *
 * `drizzle-kit push` cannot tell a DROP from a RENAME. When one release both
 * adds a column and removes another on the SAME table, push sees an add/drop
 * pair and asks — a prompt nothing can answer, so the deploy hangs until the
 * Job's deadline kills it (see the header). Applying the DROPs here first
 * leaves push with an add-only diff, which it applies without asking.
 *
 * The rule for adding an entry: a column removed from `packages/db/src/schema`
 * goes here in the SAME release, not the next one. `IF EXISTS` makes it a
 * no-op on a database that already dropped it, so re-running is free and an
 * entry is safe to leave in place across releases.
 *
 * These are genuinely destructive — that is what a schema removal means — and
 * they are FATAL on unexpected errors below for the same reason the rename
 * steps are: a skipped drop hands push the prompt this exists to prevent.
 */
const RETIRED_COLUMNS = [
  // Retired with the /run and /builds pages (PR #123). `regulated_mode` is
  // added to the same table by the pharma onboarding change lower in the
  // stack, which is exactly the add+drop pair described above.
  { table: "teams", column: "verify_phase_enabled" },
  { table: "teams", column: "web_mcp_enabled" },
];

async function dropRetiredColumns() {
  if (!process.env.DATABASE_URL) return;
  if (RETIRED_COLUMNS.length === 0) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    for (const { table, column } of RETIRED_COLUMNS) {
      await sql.unsafe(
        `ALTER TABLE IF EXISTS "${table}" DROP COLUMN IF EXISTS "${column}"`,
      );
      console.log(`[migrate] dropped retired column ${table}.${column}`);
    }
  } catch (e) {
    // FATAL. A skipped drop is not a lost row — it is the add+drop pair that
    // hangs push on an unanswerable rename prompt, which is worse than a
    // failed deploy because it reports nothing but a deadline.
    console.error("[migrate] retired-column drop FAILED:", e.message);
    throw e;
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

// `agent_sessions.metadata` was a shared jsonb bag for five agent kinds, so
// every explorer field carried an `explorer`/`quickstart` prefix to stay out of
// the other four agents' namespace. `ExplorerSessionMetadata` in
// plugins/explorer/src/types.ts is a *closed* bag owned by one feature, so the
// prefixes are gone — and nothing in the plugin reads the old names or maps
// them. A verbatim copy therefore hands the plugin rows it silently reads as
// empty. Two consequences, both of which this map exists to prevent:
//
//   1. Functional: a resumed legacy session loses its target URL, its
//      credentials, its BFS frontier and its resume cursor — the plugin sees
//      `metadata.targetUrl === undefined` and refuses to run.
//   2. Security: `quickstartPassword` holds an AES-256-GCM ciphertext, and
//      scripts/rotate-encryption-key.ts's `rotateExplorerSessions` re-encrypts
//      `metadata.password` and nothing else. A ciphertext left under the old
//      key is invisible to every future key rotation — permanently orphaned,
//      decryptable only with a retired key. This is why the transform below
//      REMOVES the old key rather than duplicating the value into the new one.
//
// Left-hand side verified against `AgentSessionMetadata` on `main`
// (packages/db/src/schema.ts) and against the writers in
// `main:src/server/actions/explorer-agent.ts`; right-hand side against
// `ExplorerSessionMetadata` in the plugin. Keys read UNCHANGED by the plugin
// (`credsProvided`, `streamUrl`, `queuedForBrowser`) are deliberately absent —
// they must pass through untouched, and so must anything else in the bag.
const EXPLORER_METADATA_KEY_MAP = [
  ["explorerTargetUrl", "targetUrl"],
  ["explorerMaxIterations", "maxIterations"],
  ["explorerIteration", "iteration"],
  ["explorerStyleRotation", "styleRotation"],
  ["explorerStateHistory", "stateHistory"],
  ["explorerFrontier", "frontier"],
  ["explorerVisitedUrls", "visitedUrls"],
  ["explorerPageMap", "pageMap"],
  ["explorerCurrentState", "currentState"],
  ["explorerCurrentPlan", "currentPlan"],
  ["explorerActionLogs", "actionLogs"],
  ["explorerFindingIds", "findingIds"],
  ["explorerReport", "report"],
  ["explorerKeptTestIds", "keptTestIds"],
  ["explorerAuth", "auth"],
  ["explorerTrigger", "trigger"],
  ["explorerStuck", "stuck"],
  // The two credential fields the explorer borrowed from QuickStart so they
  // would get the query layer's encryption-at-rest treatment. `password` is
  // the ciphertext the key-rotation script tracks.
  ["quickstartEmail", "email"],
  ["quickstartPassword", "password"],
];

// `array['explorerTargetUrl', …]::text[]` — the legacy keys, for both the `-`
// removal and the repair pass's guard.
const EXPLORER_LEGACY_KEYS_SQL = `array[${EXPLORER_METADATA_KEY_MAP.map(
  ([oldKey]) => `'${oldKey}'`,
).join(", ")}]::text[]`;

// A jsonb expression that rewrites `col` (a jsonb metadata value) old → new:
//
//   (metadata - <legacy keys>)          drop every old key, whatever else stays
//   || jsonb_strip_nulls(jsonb_build_object(
//        'targetUrl', coalesce(metadata->'targetUrl', metadata->'explorerTargetUrl'),
//        …))                            set each new key from new-then-old
//
// `coalesce(new, old)` is the precedence rule: a row that somehow already has
// the new key keeps its value — a legacy leftover never clobbers a newer one.
// A pair where neither key is present coalesces to SQL NULL, which
// `jsonb_build_object` turns into a JSON null and `jsonb_strip_nulls` then
// removes, so absent fields are not resurrected as nulls. Every `->` reads the
// ORIGINAL column value (one expression, one row), so the `-` on the left
// cannot starve the lookups on the right.
//
// Idempotent by construction: over a row with no legacy keys the `-` is a
// no-op, each `coalesce` returns the new key's own value, and the `||` puts it
// back unchanged.
const explorerMetadataRemapSql = (col) =>
  `(${col} - ${EXPLORER_LEGACY_KEYS_SQL}) || jsonb_strip_nulls(jsonb_build_object(${EXPLORER_METADATA_KEY_MAP.map(
    ([oldKey, newKey]) =>
      `'${newKey}', coalesce(${col} -> '${newKey}', ${col} -> '${oldKey}')`,
  ).join(", ")}))`;

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
    // The copy is NOT verbatim: `metadata` is rewritten through
    // `EXPLORER_METADATA_KEY_MAP` above, because the plugin reads the
    // unprefixed key names. `agent_sessions` itself is never rewritten — the
    // source rows keep their legacy keys so the copy stays reversible, and the
    // other four agent kinds still read that bag under the old names.
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
                   steps,
                   ${explorerMetadataRemapSql("metadata")} as metadata,
                   created_at, updated_at, completed_at
              from agent_sessions
             where kind = 'explorer' and team_id is not null`);
          console.log(
            `[migrate] agent_sessions -> explorer_sessions: copied explorer rows with metadata keys remapped (source left in place)`,
          );
        }
      }
    }

    // Repair pass for rows an EARLIER version of this script already copied
    // verbatim, before the mapping above existed. Those rows sit in
    // `explorer_sessions` carrying `explorerTargetUrl`/`quickstartPassword`
    // etc., and the copy block above will never revisit them — it skips a
    // populated destination by design (that skip is what makes the copy safe
    // to re-run). Without this pass such a database stays broken forever: the
    // sessions are unresumable and their password ciphertext is out of reach
    // of the key-rotation script.
    //
    // Guarded so it costs nothing on a database that does not need it: the
    // table may not exist yet (fresh DB — push creates it), and the UPDATE's
    // WHERE matches only rows that still carry at least one legacy key, so an
    // already-mapped or already-repaired DB updates zero rows.
    //
    // `jsonb_exists_any(metadata, keys)` is the function spelling of the `?|`
    // operator — used here so no literal `?` goes through `sql.unsafe()`.
    if (
      (await tableExists("explorer_sessions")) &&
      (await columnExists("explorer_sessions", "metadata"))
    ) {
      const repaired = await sql.unsafe(`
        update explorer_sessions
           set metadata = ${explorerMetadataRemapSql("metadata")}
         where jsonb_exists_any(metadata, ${EXPLORER_LEGACY_KEYS_SQL})`);
      const repairedCount = (repaired && repaired.count) || 0;
      if (repairedCount > 0) {
        console.warn(
          `[migrate] explorer_sessions: remapped legacy metadata keys on ${repairedCount} row(s)` +
            ` previously copied verbatim (explorerTargetUrl -> targetUrl,` +
            ` quickstartEmail -> email, quickstartPassword -> password, …) —` +
            ` their credentials are readable by the plugin and visible to` +
            ` scripts/rotate-encryption-key.ts again`,
        );
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
//
// Their *shape* changed too, so — unlike the renames above — this one also
// backfills: `repository_id` and `team_id` were both nullable in core and are
// `.notNull()` in the plugin schema (with the FKs gone, `team_id` is the only
// tenancy boundary these tables have left). Push cannot bridge that on its
// own: `SET NOT NULL` against a column holding one legacy NULL is an error,
// so a single such row blocks the deploy on every boot. Resolved here first,
// the same add-nullable → backfill → delete-orphans → SET NOT NULL sequence
// `migrateA11yBaselineOwnership` uses.
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
    const columnExists = async (table, column) => {
      const rows = await sql`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name = ${column}
        ) as exists`;
      return rows[0]?.exists ?? false;
    };
    const columnIsNullable = async (table, column) => {
      const rows = await sql`
        select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = ${table}
           and column_name = ${column}`;
      return rows[0]?.is_nullable === "YES";
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

    // Then the NOT NULL tightening, on the NEW table names (so it runs after
    // the renames above, and on a DB where a previous invocation already did
    // the rename). Core declared `repository_id`/`team_id` as plain nullable
    // `.references()` columns on both tables; the plugin schema declares both
    // `.notNull()`.
    //
    // Push issues a bare `ALTER … SET NOT NULL` for that delta, and Postgres
    // refuses it outright if the column holds a single NULL — one legacy row
    // and the whole push aborts, on this boot and every boot after it. So the
    // NULLs are resolved here, before push ever sees the column, and the
    // constraint is applied here too (push then finds it already satisfied).
    for (const table of [
      "data_sources_csv_sources",
      "data_sources_google_sheets",
    ]) {
      // Fresh DB: the table was never created (push makes it NOT NULL from
      // the start), so there is nothing to reconcile.
      if (!(await tableExists(table))) continue;

      // Defensive — a DB old enough to predate either column would otherwise
      // fail the UPDATE below rather than the SET NOT NULL.
      for (const col of ["repository_id", "team_id"]) {
        if (!(await columnExists(table, col))) {
          await sql.unsafe(`alter table "${table}" add column "${col}" text`);
          console.log(`[migrate] ${table}: added ${col}`);
        }
      }

      // Idempotent: a re-run (or a table push already created) finds both
      // columns NOT NULL, which means the backfill is done and no NULL can
      // have appeared since. Skip the scans entirely.
      if (
        !(await columnIsNullable(table, "repository_id")) &&
        !(await columnIsNullable(table, "team_id"))
      ) {
        continue;
      }

      // 1. team_id from the row's own repository. This is the ownership these
      //    rows always had implicitly — a data source is created inside a
      //    repo, and `repositories.team_id` is who that repo belongs to.
      const byRepo = await sql.unsafe(`
        update "${table}" d
           set team_id = r.team_id
          from repositories r
         where d.repository_id = r.id
           and d.team_id is null
           and r.team_id is not null`);
      const byRepoCount = (byRepo && byRepo.count) || 0;
      if (byRepoCount > 0) {
        console.log(
          `[migrate] ${table}: backfilled team_id on ${byRepoCount} row(s) from repositories.team_id`,
        );
      }

      // 2. Sheets only: the second derivation path. A sheet row points at the
      //    `google_sheets_accounts` OAuth row it was linked through, and that
      //    account carries the team — so a sheet whose repo is gone or whose
      //    repo has no team can still be resolved. CSV rows have no such
      //    second reference; the repo is their only link to a team.
      if (
        table === "data_sources_google_sheets" &&
        (await columnExists(table, "google_sheets_account_id")) &&
        (await tableExists("google_sheets_accounts"))
      ) {
        const byAccount = await sql.unsafe(`
          update "${table}" d
             set team_id = a.team_id
            from google_sheets_accounts a
           where d.google_sheets_account_id = a.id
             and d.team_id is null
             and a.team_id is not null`);
        const byAccountCount = (byAccount && byAccount.count) || 0;
        if (byAccountCount > 0) {
          console.log(
            `[migrate] ${table}: backfilled team_id on ${byAccountCount} row(s) from google_sheets_accounts.team_id`,
          );
        }
      }

      // 3. Whatever is still NULL cannot satisfy the new schema. `team_id`
      //    has no third derivation, and `repository_id` has none at all —
      //    nothing anywhere records which repo a repo-less source belonged
      //    to. Deleted rather than migrated, the same call
      //    `migrateA11yBaselineOwnership` makes: a source with no repo is
      //    already unreachable from the UI, which lists them per repo.
      const [{ n: orphaned }] = await sql.unsafe(
        `select count(*)::text as n from "${table}"
          where repository_id is null or team_id is null`,
      );
      if (Number(orphaned) > 0) {
        await sql.unsafe(
          `delete from "${table}" where repository_id is null or team_id is null`,
        );
        console.warn(
          `[migrate] ${table}: deleted ${orphaned} row(s) with an unresolvable` +
            ` repository_id/team_id (no repo to derive a team from, and no repo` +
            ` to attribute the row to) — the plugin schema requires both NOT NULL`,
        );
      }

      await sql.unsafe(
        `alter table "${table}" alter column repository_id set not null`,
      );
      await sql.unsafe(
        `alter table "${table}" alter column team_id set not null`,
      );
      console.log(`[migrate] ${table}: repository_id/team_id set not null`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs both data-source tables, and a
    // skipped backfill means push hits `SET NOT NULL` over a NULL and aborts,
    // blocking the deploy on every boot. Rethrow so main() exits before push
    // (see migrateExplorerTables).
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

// `qa_tasks` and `qa_agent_triggers` became `@lastest/plugin-qa-agent`'s own
// tables (RFC §9 phase 4, the last pseudo-plugin to graduate). Only the first
// needs a rename for the `qa_agent_` prefix `core/data` requires —
// `qa_agent_triggers` was born compliant — same shape as
// `AWARDS_RENAMES`/`SCHEDULING_RENAMES`, and for the same reason
// `drizzle-kit push` cannot see a rename: it would drop `qa_tasks`, create
// `qa_agent_tasks` empty, and take every queued directive, agent reply and
// task→test link with it.
//
// Both tables carry a real FK to a core table
// (`repository_id -> repositories.id ON DELETE CASCADE`), which
// `core-scope.md` §6 forbids a plugin from declaring. Dropped by catalogue
// lookup after the rename — implicitly-created constraint names differ
// between environments, so `pg_constraint` is the only reliable way to find
// them. The plugin's `deletion.ts` (`onTeamDeleted`/`onRepoDeleted`) is what
// replaces the cascades from here on. The `UNIQUE` on
// `qa_agent_triggers.repository_id` is untouched: uniqueness was never the
// foreign key's doing, and the plugin schema re-declares it identically.
const QA_AGENT_RENAMES = [["qa_tasks", "qa_agent_tasks"]];

async function migrateQaAgentTables() {
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

    for (const [from, to] of QA_AGENT_RENAMES) {
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

    // Then the FKs into `repositories`, by catalogue lookup — `ALTER TABLE …
    // RENAME` carries constraints across, so this runs after the rename and
    // looks them up under the new table names.
    const fks = await sql`
      select rel.relname as table_name, ref.relname as points_at,
             con.conname as name
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_class ref on ref.oid = con.confrelid
       where con.contype = 'f'
         and ref.relname = 'repositories'
         and rel.relname in ('qa_agent_tasks', 'qa_agent_triggers')`;
    for (const { table_name: table, points_at: target, name } of fks) {
      await sql.unsafe(`alter table ${table} drop constraint "${name}"`);
      console.log(`[migrate] ${table}: dropped FK ${name} (-> ${target})`);
    }
  } catch (e) {
    // FATAL — a skipped rename means push DROPs `qa_tasks`. Rethrow so
    // main() exits before push (see migrateExplorerTables).
    console.error("[migrate] qa-agent table migration FAILED:", e.message);
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

// Every `alter table … rename to …` above carries the table's constraints
// across UNCHANGED: Postgres renames the relation, not the
// `repo_awards_repository_id_unique` sitting on it. drizzle then diffs the
// plugin schema's `.unique()` against the catalogue, finds no
// `awards_repo_awards_repository_id_unique`, and plans to ADD it — and against
// a table that already holds rows, drizzle-kit 0.31.x raises its "table isn't
// empty — do you want to truncate?" *select* prompt. `--force` does NOT
// suppress that one.
//
// A Job container has no stdin/tty, so the prompt can never be answered:
// `execSync(…, stdio: "inherit")` blocks the whole process until
// activeDeadlineSeconds kills the pod. Observed in production on
// `awards_repo_awards` (1 row): 26s of real work, then 9m43s hung, nothing
// truncated. It only fires on a NON-EMPTY table, which is why every empty-table
// test run and every schema-only dump restore passed.
//
// Renaming the carried constraints to their post-rename names removes the diff,
// so no prompt exists to hang on. This runs over ALL rename pairs and keys off
// the DESTINATION table, independently of whether this boot did the rename —
// databases renamed by an earlier deploy are exactly the ones carrying stale
// names today (`share_public_shares` still has `public_shares_slug_unique`; it
// is empty now, and the first public share arms an identical hang).
const ALL_TABLE_RENAMES = [
  ...EXPLORER_RENAMES,
  ...GAMIFICATION_RENAMES,
  ...CI_RENAMES,
  ...SHARE_RENAMES,
  ...AWARDS_RENAMES,
  ...DATA_SOURCES_RENAMES,
  ...SCHEDULING_RENAMES,
  ...QA_AGENT_RENAMES,
];

async function renameCarriedConstraints() {
  if (!process.env.DATABASE_URL) return;
  let sql;
  try {
    sql = require("postgres")(process.env.DATABASE_URL);
    for (const [from, to] of ALL_TABLE_RENAMES) {
      const rows = await sql`
        select con.conname as name
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_namespace ns on ns.oid = rel.relnamespace
         where ns.nspname = 'public'
           and rel.relname = ${to}`;
      const names = rows.map((r) => r.name);
      // Prefix match only — `repo_awards_repository_id_unique` on
      // `awards_repo_awards` becomes `awards_repo_awards_repository_id_unique`,
      // which is what drizzle derives for `.unique()`. Explicitly-named indexes
      // (`idx_…`) are untouched: a missing index is a plain CREATE INDEX in
      // push, never a prompt.
      for (const name of names.filter((n) => n.startsWith(`${from}_`))) {
        const renamed = `${to}${name.slice(from.length)}`;
        if (names.includes(renamed)) {
          // Both names already present — push sees the one it expects, so
          // there is no diff and no prompt. Leave the stale one alone rather
          // than dropping a constraint we did not create.
          console.warn(
            `[migrate] ${to}: ${renamed} already exists, leaving ${name} in place`,
          );
          continue;
        }
        // Metadata-only; renames the backing index with it.
        await sql.unsafe(
          `alter table "${to}" rename constraint "${name}" to "${renamed}"`,
        );
        console.log(`[migrate] ${to}: constraint ${name} -> ${renamed}`);
      }
    }
  } catch (e) {
    // FATAL. Skipping this is what hangs the deploy for the full
    // activeDeadlineSeconds and then reports a timeout instead of a cause —
    // far worse than exiting now with the reason on stdout. Nothing here is
    // destructive, so a failure means the database is not in the shape push
    // expects and a human should look.
    console.error(
      "[migrate] carried-constraint rename FAILED:",
      e instanceof Error ? e.message : e,
    );
    throw e;
  } finally {
    if (sql) await sql.end();
  }
}

async function main() {
  await preCreate();
  // Before every rename step and before push: see RETIRED_COLUMNS for why an
  // add+drop pair on one table has to be split.
  await dropRetiredColumns();
  await migrateExplorerTables();
  await migrateA11yBaselineOwnership();
  await migrateGamificationTables();
  await migrateCiTables();
  await migrateShareTables();
  await migrateAwardsTables();
  await migrateDataSourcesTables();
  await migrateSchedulingTables();
  await migrateQaAgentTables();
  await renameCarriedConstraints();
  await dropPluginUserForeignKeys();
  await nullOrphans();
  await bumpPoolDefaults();
  await ensureUniqueIndexes();

  console.log("[migrate] Running drizzle-kit push...");
  try {
    execSync("./node_modules/.bin/drizzle-kit push --force 2>&1", {
      // stdin is /dev/null, never the container's. This alone does NOT save us —
      // verified: drizzle-kit's prompt blocks on a closed stdin exactly as it
      // does on an empty one — but it keeps push from ever reading a real tty
      // during an interactive `node scripts/migrate.js`. The timeout is the guard.
      stdio: ["ignore", "inherit", "inherit"],
      // Backstop for the same class of bug. Without it an unanswerable prompt
      // blocks until the Job's activeDeadlineSeconds kills the pod, and the only
      // signal is a deadline: no failing statement, no exit code, no cause.
      // Kept under the 600s activeDeadlineSeconds in k8s/migrate-job.yaml so
      // THIS reports the reason first.
      timeout: PUSH_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    console.log("[migrate] Done");
  } catch (e) {
    // `catch` binds `unknown`; execSync surfaces a timeout kill as `killed` /
    // `signal` on the thrown Error, neither of which is on the Error type.
    const err = /** @type {any} */ (e);
    if (err.killed || err.signal === "SIGKILL") {
      console.error(
        `[migrate] Failed: drizzle-kit push was killed after ${PUSH_TIMEOUT_MS}ms. ` +
          'That is almost always an interactive drizzle-kit prompt ("truncate?", ' +
          '"is this a rename?") — --force does not suppress every one of them, and a ' +
          "container with no tty can never answer. The question is the last thing on " +
          "stdout above; resolve it in a pre-push step here, not by answering it.",
      );
    } else {
      console.error("[migrate] Failed:", err.message);
    }
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
