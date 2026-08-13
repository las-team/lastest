/**
 * §2.8's GDPR deletion cascade, at the layer *above* the plugin boundary.
 *
 * `repositories.team_id` (and the two SCM account tables) carried a comment
 * claiming a FK to `teams` had been added "after the teams table definition".
 * It never was, so every team deletion silently leaked its repositories — and
 * with them the ~30 tables scoped by `repository_id`, plus the team's encrypted
 * OAuth tokens. Same class as the `plugin_jobs` regression, but wider and above
 * the plugin layer, so no plugin deletion hook could ever have covered it.
 *
 * Two guards here, because the fix has two halves:
 *   1. `deleteTeam()` unwinds repositories through `deleteRepository()` — it has
 *      to, since ~20 repo-scoped tables still reference `repositories` with NO
 *      ACTION and would abort a bare DB-level cascade.
 *   2. The FK itself, exercised by deleting a team row directly. That is the
 *      backstop for any code path that bypasses `deleteTeam()`.
 *
 * Run with `pnpm test:integration` (needs postgres).
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import {
  githubAccounts,
  playwrightSettings,
  repositories,
  teams,
  tests,
} from "@/lib/db/schema";

async function seedTeamWithRepo(label: string) {
  const team = await queries.createTeam({ name: `${label}-${randomUUID()}` });
  const repositoryId = randomUUID();
  await db.insert(repositories).values({
    id: repositoryId,
    teamId: team.id,
    provider: "local",
    owner: "local",
    name: label,
    fullName: `local/${label}`,
    createdAt: new Date(),
  });
  return { team, repositoryId };
}

/**
 * The `ON DELETE` action Postgres actually has for `<table>.team_id → teams.id`,
 * or null when no such constraint exists. Asserted directly because counting
 * orphans is vacuous once the FK is in place — it is the constraint's presence
 * that has to be guarded, and the schema comment claiming one existed is exactly
 * what went unchecked for so long.
 */
async function teamFkDeleteAction(tableName: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT c.confdeltype::text AS action
        FROM pg_constraint c
        WHERE c.conrelid = ${tableName}::regclass
          AND c.confrelid = 'teams'::regclass
          AND c.contype = 'f'
          AND c.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
              WHERE attrelid = ${tableName}::regclass AND attname = 'team_id')
          ]::smallint[]`,
  )) as unknown as Array<{ action: string }>;
  return rows[0]?.action ?? null;
}

describe("team deletion cascade", () => {
  it("deleteTeam removes the team's repositories and repo-scoped rows", async () => {
    const { team, repositoryId } = await seedTeamWithRepo("gdpr-cascade");

    // A repo-scoped child on a NO ACTION FK — the exact shape that makes a bare
    // DB cascade from `teams` fail, so this also proves the ordering in
    // `deleteTeam` is doing real work.
    await db.insert(playwrightSettings).values({
      id: randomUUID(),
      repositoryId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(tests).values({
      id: randomUUID(),
      repositoryId,
      name: "gdpr cascade probe",
      code: "export async function test() {}",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(githubAccounts).values({
      id: randomUUID(),
      teamId: team.id,
      githubUserId: randomUUID(),
      githubUsername: "gdpr-cascade-probe",
      accessToken: "encrypted-placeholder",
      createdAt: new Date(),
    });

    await queries.deleteTeam(team.id);

    const repoRows = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repositoryId));
    expect(repoRows).toHaveLength(0);

    const settingRows = await db
      .select({ id: playwrightSettings.id })
      .from(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, repositoryId));
    expect(settingRows).toHaveLength(0);

    const testRows = await db
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, repositoryId));
    expect(testRows).toHaveLength(0);

    const accountRows = await db
      .select({ id: githubAccounts.id })
      .from(githubAccounts)
      .where(eq(githubAccounts.teamId, team.id));
    expect(accountRows).toHaveLength(0);
  });

  it("a direct team-row delete cannot leave an orphaned repository", async () => {
    const { team, repositoryId } = await seedTeamWithRepo("gdpr-fk-backstop");

    // Bypasses deleteTeam() entirely — several test suites and any future
    // caller can do this. Before the FK existed, the repository simply survived
    // with a dangling team_id.
    await db.delete(teams).where(eq(teams.id, team.id));

    const repoRows = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repositoryId));
    expect(repoRows).toHaveLength(0);
  });

  it("has a real cascading team FK on every team-owned SCM table", async () => {
    // 'c' = ON DELETE CASCADE. A null here is the original bug: a column comment
    // promising a constraint that was never actually created.
    expect(await teamFkDeleteAction("repositories")).toBe("c");
    expect(await teamFkDeleteAction("github_accounts")).toBe("c");
    expect(await teamFkDeleteAction("gitlab_accounts")).toBe("c");
  });
});
