#!/usr/bin/env tsx

/**
 * Delete rows whose `team_id` points at a team that no longer exists.
 *
 * `repositories`, `github_accounts` and `gitlab_accounts` carried a comment
 * claiming a FK to `teams` had been added after the teams table was defined. It
 * never was, so every team deletion since then leaked its repositories (and the
 * ~30 tables scoped by them) plus the team's encrypted OAuth tokens.
 *
 * The FK now exists in the schema, which means `pnpm db:push` will REFUSE to add
 * the constraint while any pre-existing orphan is still in the table. Run this
 * first:
 *
 *     pnpm tsx scripts/cleanup-orphaned-team-rows.ts --dry-run   # report only
 *     pnpm tsx scripts/cleanup-orphaned-team-rows.ts             # delete
 *     pnpm db:push
 *
 * Repositories go through `deleteRepository()` so their whole subtree is unwound
 * in FK order (a bare DELETE would be blocked by the ~20 repo-scoped tables that
 * still reference `repositories` with NO ACTION). Idempotent — safe to re-run.
 */

import { db } from "@/lib/db";
import { repositories, githubAccounts, gitlabAccounts } from "@/lib/db/schema";
import { deleteRepository } from "@/lib/db/queries";
import { sql } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function orphanIds(
  table: "repositories" | "github_accounts" | "gitlab_accounts",
) {
  const rows = await db.execute<{ id: string; team_id: string }>(
    sql`SELECT c.id, c.team_id
        FROM ${sql.identifier(table)} c
        LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.team_id IS NOT NULL AND t.id IS NULL`,
  );
  // node-postgres returns { rows }; drizzle's http drivers return the array.
  return (Array.isArray(rows) ? rows : rows.rows) as Array<{
    id: string;
    team_id: string;
  }>;
}

async function main() {
  const repos = await orphanIds("repositories");
  const ghAccounts = await orphanIds("github_accounts");
  const glAccounts = await orphanIds("gitlab_accounts");

  console.log(
    `Orphans found — repositories: ${repos.length}, github_accounts: ${ghAccounts.length}, gitlab_accounts: ${glAccounts.length}`,
  );

  if (dryRun) {
    for (const r of repos)
      console.log(`  repository ${r.id} (team ${r.team_id})`);
    for (const a of ghAccounts)
      console.log(`  github_account ${a.id} (team ${a.team_id})`);
    for (const a of glAccounts)
      console.log(`  gitlab_account ${a.id} (team ${a.team_id})`);
    console.log("\nDry run — nothing deleted.");
    return;
  }

  for (const repo of repos) {
    // Whole subtree, in FK order, plus the per-repo plugin deletion hooks.
    await deleteRepository(repo.id);
    console.log(`  deleted repository ${repo.id}`);
  }

  for (const table of [githubAccounts, gitlabAccounts]) {
    const deleted = await db
      .delete(table)
      .where(
        sql`${table.teamId} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = ${table.teamId})`,
      )
      .returning({ id: table.id });
    for (const row of deleted) console.log(`  deleted account row ${row.id}`);
  }

  console.log("\n✅ Done. Now run `pnpm db:push` to add the FK constraints.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  });
