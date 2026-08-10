/**
 * Explorer plugin table migration — run this BEFORE `drizzle-kit push`.
 *
 * **Docker deploys no longer need this run manually** — `scripts/migrate.js`
 * (what `docker-entrypoint.sh` and `Dockerfile.migrate` actually execute)
 * carries a plain-JS port of the same rename logic ahead of its own
 * `drizzle-kit push --force` call. This TypeScript version stays as the tool
 * for local development, where `pnpm db:push` calls `drizzle-kit push`
 * directly and skips `migrate.js` entirely — run this first in that case.
 *
 * ## Why this script has to exist
 *
 * The explorer migration (`docs/architecture/explorer-migration-result.md`)
 * moved the feature's tables out of core and renamed them:
 *
 *     agent_knowledge    → explorer_knowledge
 *     agent_experience   → explorer_experience
 *     agent_findings     → explorer_findings
 *     agent_sessions     → explorer_sessions   (only rows with kind='explorer')
 *
 * `drizzle-kit push` cannot see a rename. It sees four tables that vanished
 * from the schema and four that appeared, and it resolves that as DROP + CREATE
 * — in one operation, so there is no moment "after push" at which the old rows
 * still exist to be copied. **The Docker entrypoint runs `drizzle-kit push
 * --force` on startup**, which means deploying without running this first
 * destroys every explorer row, including `agent_knowledge.cred_password`:
 * encrypted credentials a user typed in and cannot re-derive.
 *
 * ## Why rename rather than copy
 *
 * A rename preserves the rows, the types and the ciphertext byte-for-byte, and
 * leaves `push` with nothing to do but reconcile constraints (drop the FK to
 * `repositories`, add `target_url`, fix index names). A copy would re-encode
 * every jsonb value and give `push` a table it still wants to drop.
 *
 * `agent_sessions` is the exception: it holds rows for five agent kinds
 * (play, quickstart, ranger, qa, explorer) and only explorer's slice moves, so
 * that one is a filtered copy. The source rows are deliberately LEFT IN PLACE —
 * this script is then re-runnable and reversible, and `push` will not touch
 * them because `agent_sessions` still exists in the core schema.
 *
 * ## Order of operations
 *
 *     1. pnpm tsx scripts/migrate-explorer-plugin-tables.ts
 *     2. pnpm db:push
 *
 * Idempotent: re-running finds the destinations already populated and reports
 * "already migrated" without touching anything.
 *
 * ## What this cannot preserve
 *
 * - `agent_sessions.kind` is dropped — it is the discriminator itself, and
 *   every migrated row has the same value.
 * - `explorer_sessions.team_id` is NOT NULL, while `agent_sessions.team_id` is
 *   nullable. Nulls are backfilled from `repositories.team_id`; rows where that
 *   is also null cannot be migrated and are reported rather than guessed.
 */

import { sql } from "../src/lib/db";

/** `agent_*` → `explorer_*` pairs that migrate by rename. */
const RENAMES = [
  ["agent_knowledge", "explorer_knowledge"],
  ["agent_experience", "explorer_experience"],
  ["agent_findings", "explorer_findings"],
] as const;

async function tableExists(name: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${name}
    ) as exists`;
  return rows[0]?.exists ?? false;
}

async function rowCount(name: string): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from ${sql(name)}`;
  return Number(rows[0]?.n ?? 0);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = ${table}
        and column_name = ${column}
    ) as exists`;
  return rows[0]?.exists ?? false;
}

async function migrateByRename(from: string, to: string) {
  if (!(await tableExists(from))) {
    console.log(`  ${from} → ${to}: source absent, nothing to migrate`);
    return;
  }

  const sourceRows = await rowCount(from);

  if (await tableExists(to)) {
    const destRows = await rowCount(to);
    if (destRows > 0) {
      console.log(
        `  ${from} → ${to}: destination already holds ${destRows} row(s) — already migrated, skipping`,
      );
      return;
    }
    // An empty destination is what `db:push` leaves behind when someone pushed
    // before migrating. Dropping it is safe precisely because it is empty, and
    // it is the only way the rename can proceed.
    console.log(
      `  ${from} → ${to}: dropping empty destination created by push`,
    );
    await sql`drop table ${sql(to)}`;
  }

  await sql`alter table ${sql(from)} rename to ${sql(to)}`;
  console.log(`  ${from} → ${to}: renamed, ${sourceRows} row(s) preserved`);
}

async function migrateSessions() {
  if (!(await tableExists("agent_sessions"))) {
    console.log(
      "  agent_sessions → explorer_sessions: source absent, nothing to migrate",
    );
    return;
  }
  if (!(await columnExists("agent_sessions", "kind"))) {
    console.log(
      "  agent_sessions → explorer_sessions: no `kind` column — this database predates the" +
        " discriminator, so there is no explorer slice to extract",
    );
    return;
  }

  const destExists = await tableExists("explorer_sessions");
  if (destExists && (await rowCount("explorer_sessions")) > 0) {
    console.log(
      "  agent_sessions → explorer_sessions: destination already populated — already migrated, skipping",
    );
    return;
  }

  const [{ n: total }] = await sql<{ n: string }[]>`
    select count(*)::text as n from agent_sessions where kind = 'explorer'`;
  if (Number(total) === 0) {
    console.log(
      "  agent_sessions → explorer_sessions: no rows with kind='explorer'",
    );
    return;
  }

  // Backfill the nullable team_id from the owning repository before the copy,
  // because the destination declares it NOT NULL and `push` would fail to add
  // that constraint afterwards.
  const backfilled = await sql`
    update agent_sessions s
       set team_id = r.team_id
      from repositories r
     where s.repository_id = r.id
       and s.kind = 'explorer'
       and s.team_id is null
       and r.team_id is not null`;
  if (backfilled.count > 0) {
    console.log(
      `  agent_sessions: backfilled team_id on ${backfilled.count} explorer row(s) from repositories`,
    );
  }

  const [{ n: orphaned }] = await sql<{ n: string }[]>`
    select count(*)::text as n from agent_sessions
     where kind = 'explorer' and team_id is null`;
  if (Number(orphaned) > 0) {
    console.warn(
      `  WARNING: ${orphaned} explorer session(s) have no resolvable team_id and will NOT be migrated.` +
        ` They stay in agent_sessions; inspect them before dropping that table.`,
    );
  }

  if (destExists) {
    console.log(
      "  agent_sessions → explorer_sessions: dropping empty destination created by push",
    );
    await sql`drop table explorer_sessions`;
  }

  // `create table as` carries the source column types over verbatim, so the
  // jsonb payloads are moved rather than re-encoded. `push` then adds the
  // primary key, the NOT NULL constraints and the two indexes.
  await sql`
    create table explorer_sessions as
    select id, repository_id, team_id, status, current_step_id,
           steps, metadata, created_at, updated_at, completed_at
      from agent_sessions
     where kind = 'explorer' and team_id is not null`;

  const copied = await rowCount("explorer_sessions");
  console.log(
    `  agent_sessions → explorer_sessions: copied ${copied} of ${total} row(s)` +
      ` (source rows left in place — safe to re-run)`,
  );
}

async function main() {
  console.log("Explorer plugin table migration");
  console.log("Run `pnpm db:push` AFTER this completes.\n");

  for (const [from, to] of RENAMES) {
    await migrateByRename(from, to);
  }
  await migrateSessions();

  // explorer_triggers keeps its name across the move, so push sees a shape
  // change (FK dropped, target_url added) rather than a drop-and-create and the
  // rows survive on their own. Stated here so its absence is not read as an
  // oversight.
  console.log("\n  explorer_triggers: unchanged name — push preserves it\n");
  console.log("Done. Now run: pnpm db:push");
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Migration failed:", err);
    await sql.end().catch(() => {});
    process.exit(1);
  });
