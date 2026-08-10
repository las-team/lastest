/**
 * Real GDPR-deletion cascade, through the *actual* entry points the product
 * calls — `queries.deleteTeam` (used by `deleteMyAccount`,
 * src/server/actions/account.ts) and `queries.deleteRepository` (used by
 * `deleteRepo`, src/server/actions/repos.ts) — against a live database.
 *
 * This is deliberately one level above `src/lib/db/plugin-deletion.test.ts`
 * (which mocks `@/lib/core/runtime` entirely) and above the §2.8 runtime
 * check in the test plan (which called `runPluginDeletion`/`runDeletionHooks`
 * directly with a synthetic `DeletionTarget`). Here nothing is mocked: the
 * dynamic `import("@/lib/core/runtime")` in `cascadePluginDeletion` really
 * resolves the plugin registry, and Postgres's own FK cascade on
 * `plugin_jobs.team_id` / `plugin_jobs.repository_id`
 * (packages/db/src/schema/runs.ts) really fires.
 *
 * Both cascades are exercised together because that's what production does:
 * `deleteTeam`/`deleteRepository` issue a plain `DELETE FROM teams|repositories
 * WHERE id = ...` (Postgres FK cascade handles `plugin_jobs`), then call
 * `cascadePluginDeletion` for the plugin-owned tables that carry no FK by
 * design (`core-scope.md` §6) — explorer's `explorer_knowledge`,
 * `explorer_experience`, `explorer_findings`, `explorer_sessions`,
 * `explorer_triggers`.
 *
 * The literal "use server" wrappers (`deleteMyAccount`, `deleteRepo`)
 * themselves are not invoked here: both start with `requireAuth()` →
 * `next/headers().headers()`, which throws outside a real Next request scope
 * (no browser, no cookie jar, available in this environment — see the test
 * plan's §3 assignment). What's exercised is everything downstream of that
 * auth check, which is the part this refactor actually touched.
 *
 * Run with `pnpm test:integration`.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import * as queries from "@/lib/db/queries";
import { pluginJobs, repositories, teams } from "@/lib/db/schema";
import {
  explorerExperience,
  explorerFindings,
  explorerKnowledge,
  explorerSessions,
  explorerTriggers,
} from "@lastest/plugin-explorer/schema";

/** Every row this suite might leave behind if an assertion fails mid-test —
 *  swept unconditionally in `afterAll` so a failed run doesn't poison a
 *  re-run. */
const cleanupTeamIds = new Set<string>();
const cleanupRepoIds = new Set<string>();

afterAll(async () => {
  for (const repositoryId of cleanupRepoIds) {
    await db
      .delete(explorerFindings)
      .where(eq(explorerFindings.repositoryId, repositoryId));
    await db
      .delete(explorerSessions)
      .where(eq(explorerSessions.repositoryId, repositoryId));
    await db
      .delete(explorerExperience)
      .where(eq(explorerExperience.repositoryId, repositoryId));
    await db
      .delete(explorerKnowledge)
      .where(eq(explorerKnowledge.repositoryId, repositoryId));
    await db
      .delete(explorerTriggers)
      .where(eq(explorerTriggers.repositoryId, repositoryId));
    await db
      .delete(pluginJobs)
      .where(eq(pluginJobs.repositoryId, repositoryId));
    await db.delete(repositories).where(eq(repositories.id, repositoryId));
  }
  for (const teamId of cleanupTeamIds) {
    await db
      .delete(explorerFindings)
      .where(eq(explorerFindings.teamId, teamId));
    await db
      .delete(explorerSessions)
      .where(eq(explorerSessions.teamId, teamId));
    await db
      .delete(explorerExperience)
      .where(eq(explorerExperience.teamId, teamId));
    await db
      .delete(explorerKnowledge)
      .where(eq(explorerKnowledge.teamId, teamId));
    await db
      .delete(explorerTriggers)
      .where(eq(explorerTriggers.teamId, teamId));
    await db.delete(pluginJobs).where(eq(pluginJobs.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }
});

/** Seed one of every explorer plugin table for `repositoryId`/`teamId`. */
async function seedExplorerRows(repositoryId: string, teamId: string) {
  const sessionId = randomUUID();
  await db.insert(explorerSessions).values({
    id: sessionId,
    repositoryId,
    teamId,
    status: "completed",
    steps: [],
    metadata: { targetUrl: "https://example.test" } as never,
  });
  await db.insert(explorerKnowledge).values({
    id: randomUUID(),
    repositoryId,
    teamId,
    title: "gdpr-test knowledge",
    urlPattern: "*",
    body: "seeded by gdpr-deletion.integration.test.ts",
    // Stands in for an encrypted credential — the specific GDPR-sensitive
    // value the whole cascade exists to not leak.
    credEmail: "seed@example.test",
    credPassword: "enc:fake-ciphertext",
  });
  await db.insert(explorerExperience).values({
    id: randomUUID(),
    repositoryId,
    teamId,
    stateHash: randomUUID(),
    normalizedUrl: "/gdpr-test",
    notes: [],
  });
  await db.insert(explorerFindings).values({
    id: randomUUID(),
    repositoryId,
    teamId,
    sessionId,
    title: "gdpr-test finding",
    description: "seeded by gdpr-deletion.integration.test.ts",
  });
  await db.insert(explorerTriggers).values({
    id: randomUUID(),
    repositoryId,
    teamId,
  });
}

async function seedPluginJob(teamId: string, repositoryId: string) {
  await db.insert(pluginJobs).values({
    id: randomUUID(),
    pluginId: "explorer",
    type: "explorer.gdpr-test-job",
    teamId,
    repositoryId,
    runAfter: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function explorerRowCount(
  column: "repositoryId" | "teamId",
  value: string,
): Promise<number> {
  const [k, e, f, s, t] = await Promise.all([
    db
      .select()
      .from(explorerKnowledge)
      .where(eq(explorerKnowledge[column], value)),
    db
      .select()
      .from(explorerExperience)
      .where(eq(explorerExperience[column], value)),
    db
      .select()
      .from(explorerFindings)
      .where(eq(explorerFindings[column], value)),
    db
      .select()
      .from(explorerSessions)
      .where(eq(explorerSessions[column], value)),
    db
      .select()
      .from(explorerTriggers)
      .where(eq(explorerTriggers[column], value)),
  ]);
  return k.length + e.length + f.length + s.length + t.length;
}

describe("queries.deleteTeam — full team delete", () => {
  it("removes plugin_jobs (FK cascade) and every explorer row (plugin hook), for real", async () => {
    const team = await queries.createTeam({
      name: `gdpr-test-team-${randomUUID()}`,
    });
    cleanupTeamIds.add(team.id);
    const repo = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "local",
      name: "gdpr-test-repo",
      fullName: "local/gdpr-test-repo",
    });
    cleanupRepoIds.add(repo.id);

    await seedExplorerRows(repo.id, team.id);
    await seedPluginJob(team.id, repo.id);

    expect(await explorerRowCount("teamId", team.id)).toBe(5);
    const [jobBefore] = await db
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.teamId, team.id));
    expect(jobBefore).toBeDefined();

    // The actual production call — same function `deleteMyAccount` calls.
    await queries.deleteTeam(team.id);

    const [teamRow] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, team.id));
    expect(teamRow).toBeUndefined();

    // FK cascade (packages/db/src/schema/runs.ts — the confirmed-and-fixed
    // regression from §2.8): plugin_jobs must be gone, not orphaned.
    const jobsAfter = await db
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.teamId, team.id));
    expect(jobsAfter).toHaveLength(0);

    // Plugin-hook cascade (no FK by design): every explorer table for this
    // team must be gone too.
    expect(await explorerRowCount("teamId", team.id)).toBe(0);

    cleanupTeamIds.delete(team.id);
    cleanupRepoIds.delete(repo.id);
  });
});

describe("queries.deleteRepository — single-repo delete", () => {
  it("removes only the deleted repo's plugin data, leaving a sibling repo under the same team untouched", async () => {
    const team = await queries.createTeam({
      name: `gdpr-test-team-repo-${randomUUID()}`,
    });
    cleanupTeamIds.add(team.id);
    const repoA = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "local",
      name: "gdpr-test-repo-a",
      fullName: "local/gdpr-test-repo-a",
    });
    const repoB = await queries.createRepository({
      teamId: team.id,
      provider: "local",
      owner: "local",
      name: "gdpr-test-repo-b",
      fullName: "local/gdpr-test-repo-b",
    });
    cleanupRepoIds.add(repoA.id);
    cleanupRepoIds.add(repoB.id);

    await seedExplorerRows(repoA.id, team.id);
    await seedExplorerRows(repoB.id, team.id);
    await seedPluginJob(team.id, repoA.id);

    expect(await explorerRowCount("repositoryId", repoA.id)).toBe(5);
    expect(await explorerRowCount("repositoryId", repoB.id)).toBe(5);

    // The actual production call — same function `deleteRepo` calls.
    await queries.deleteRepository(repoA.id);

    const [repoRow] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoA.id));
    expect(repoRow).toBeUndefined();

    // repoA's plugin_jobs row cascades via the repository_id FK.
    const jobsAfter = await db
      .select()
      .from(pluginJobs)
      .where(eq(pluginJobs.repositoryId, repoA.id));
    expect(jobsAfter).toHaveLength(0);

    // repoA's explorer rows are gone...
    expect(await explorerRowCount("repositoryId", repoA.id)).toBe(0);
    // ...but repoB's — same team, sibling repo — are untouched. This is the
    // cross-tenant-style leak this test exists to rule out at the repo
    // granularity (§2.8's "not a sibling repo's" requirement).
    expect(await explorerRowCount("repositoryId", repoB.id)).toBe(5);

    cleanupRepoIds.delete(repoA.id);

    // Clean up what deleteRepository deliberately didn't touch.
    await queries.deleteRepository(repoB.id);
    cleanupRepoIds.delete(repoB.id);
    await queries.deleteTeam(team.id);
    cleanupTeamIds.delete(team.id);
  });
});
