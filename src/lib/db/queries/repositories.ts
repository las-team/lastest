import { db } from "../index";
import {
  repositories,
  pullRequests,
  githubAccounts,
  gitlabAccounts,
  baselines,
  teams,
  users,
  tests,
  testRuns,
  testResults,
  builds,
  visualDiffs,
  ignoreRegions,
  reviewTodos,
  routes,
  plannedScreenshots,
  playwrightSettings,
  scanStatus,
  environmentConfigs,
  diffSensitivitySettings,
  aiSettings,
  aiPromptLogs,
  backgroundJobs,
  notificationSettings,
  specImports,
  setupScripts,
  setupConfigs,
  googleSheetsDataSources,
  csvDataSources,
  functionalAreas,
  activityEvents,
  publicShares,
  remoteDebugSessions,
} from "../schema";
import type {
  NewRepository,
  NewPullRequest,
  NewGithubAccount,
  NewGitlabAccount,
} from "../schema";
import { getGithubAccountByTeam } from "./auth";
import { eq, desc, and, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// Pull Requests
export async function getPullRequest(id: string) {
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.id, id));
  return row;
}

export async function getPullRequestByBranch(headBranch: string) {
  const [row] = await db
    .select()
    .from(pullRequests)
    .where(
      and(
        eq(pullRequests.headBranch, headBranch),
        eq(pullRequests.status, "open"),
      ),
    );
  return row;
}

export async function createPullRequest(data: Omit<NewPullRequest, "id">) {
  const id = uuid();
  await db.insert(pullRequests).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updatePullRequest(
  id: string,
  data: Partial<NewPullRequest>,
) {
  await db
    .update(pullRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pullRequests.id, id));
}

// GitHub Accounts
/** @deprecated Use getGithubAccountByTeam(teamId) instead for proper tenant isolation */
export async function getGithubAccount() {
  const [row] = await db.select().from(githubAccounts);
  return row;
}

export async function createGithubAccount(data: Omit<NewGithubAccount, "id">) {
  const id = uuid();
  await db
    .insert(githubAccounts)
    .values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGithubAccount(
  id: string,
  data: Partial<NewGithubAccount>,
) {
  await db.update(githubAccounts).set(data).where(eq(githubAccounts.id, id));
}

export async function deleteGithubAccount(id: string) {
  await db.delete(githubAccounts).where(eq(githubAccounts.id, id));
}

// GitLab Accounts
/** @deprecated Use getGitlabAccountByTeam(teamId) instead for proper tenant isolation */
export async function getGitlabAccount() {
  const [row] = await db.select().from(gitlabAccounts);
  return row;
}

export async function getGitlabAccountByTeam(teamId: string) {
  const [row] = await db
    .select()
    .from(gitlabAccounts)
    .where(eq(gitlabAccounts.teamId, teamId));
  return row;
}

export async function createGitlabAccount(data: Omit<NewGitlabAccount, "id">) {
  const id = uuid();
  await db
    .insert(gitlabAccounts)
    .values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateGitlabAccount(
  id: string,
  data: Partial<NewGitlabAccount>,
) {
  await db.update(gitlabAccounts).set(data).where(eq(gitlabAccounts.id, id));
}

export async function deleteGitlabAccount(id: string) {
  await db.delete(gitlabAccounts).where(eq(gitlabAccounts.id, id));
}

export async function updateGitlabSelectedRepository(
  accountId: string,
  repositoryId: string | null,
) {
  await db
    .update(gitlabAccounts)
    .set({ selectedRepositoryId: repositoryId })
    .where(eq(gitlabAccounts.id, accountId));
}

// Repositories
export async function getRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt));
}

export async function getRepository(id: string) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, id));
  return row;
}

export async function getRepositoryByGithubId(githubRepoId: number) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.githubRepoId, githubRepoId));
  return row;
}

export async function getRepositoryByGitlabProjectId(gitlabProjectId: number) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.gitlabProjectId, gitlabProjectId));
  return row;
}

export async function createRepository(data: Omit<NewRepository, "id">) {
  const id = uuid();
  await db.insert(repositories).values({ ...data, id, createdAt: new Date() });
  return { id, ...data, createdAt: new Date() };
}

export async function updateRepository(
  id: string,
  data: Partial<NewRepository>,
) {
  await db.update(repositories).set(data).where(eq(repositories.id, id));
}

/**
 * Hard-delete a repository and every row owned by it.
 *
 * The schema's cascade graph is incomplete: `tests.repositoryId`,
 * `testRuns.repositoryId`, `baselines.repositoryId` etc. are plain text
 * columns with no FK constraint, and several FK relationships (e.g.
 * `visualDiffs.buildId`, `baselines.testId`, `routeTestSuggestions.matchedTestId`)
 * default to NO ACTION. So we delete in dependency order inside one
 * transaction; the final `DELETE FROM repositories` only handles the
 * subset of tables that actually declare ON DELETE CASCADE.
 *
 * Disk storage is NOT cleaned up here — call `deleteRepoStorage(id)`
 * from `@/lib/storage/cleanup` after this returns.
 */
export async function deleteRepository(id: string) {
  await db.transaction(async (tx) => {
    // 1. Collect parent IDs upfront so subsequent IN-clauses don't depend
    //    on rows we're about to delete.
    const testIdRows = await tx
      .select({ id: tests.id })
      .from(tests)
      .where(eq(tests.repositoryId, id));
    const testIds = testIdRows.map((r) => r.id);

    const testRunIdRows = await tx
      .select({ id: testRuns.id })
      .from(testRuns)
      .where(eq(testRuns.repositoryId, id));
    const testRunIds = testRunIdRows.map((r) => r.id);

    const buildIdRows = testRunIds.length
      ? await tx
          .select({ id: builds.id })
          .from(builds)
          .where(inArray(builds.testRunId, testRunIds))
      : [];
    const buildIds = buildIdRows.map((r) => r.id);

    // 2. reviewTodos — has FKs to visualDiffs/builds/tests with no cascade.
    //    Easiest to wipe by repo first.
    await tx.delete(reviewTodos).where(eq(reviewTodos.repositoryId, id));

    // 3. baselines — referenced by `approvedFromDiffId → visualDiffs` AND
    //    points at `testId → tests` (both NO ACTION). Delete before its
    //    parents so neither side blocks.
    if (testIds.length) {
      await tx.delete(baselines).where(inArray(baselines.testId, testIds));
    }
    await tx.delete(baselines).where(eq(baselines.repositoryId, id));

    // 4. visualDiffs — references builds/testResults/tests, all NO ACTION.
    if (buildIds.length) {
      await tx
        .delete(visualDiffs)
        .where(inArray(visualDiffs.buildId, buildIds));
    }
    if (testIds.length) {
      await tx.delete(visualDiffs).where(inArray(visualDiffs.testId, testIds));
    }

    // 5. ignoreRegions — testId NO ACTION.
    if (testIds.length) {
      await tx
        .delete(ignoreRegions)
        .where(inArray(ignoreRegions.testId, testIds));
    }

    // 6. testResults — referenced via testRunId/testId (NO ACTION). Wiping
    //    these also cascades stepComparisons.testResultId.
    if (testRunIds.length) {
      await tx
        .delete(testResults)
        .where(inArray(testResults.testRunId, testRunIds));
    }
    if (testIds.length) {
      await tx.delete(testResults).where(inArray(testResults.testId, testIds));
    }

    // 7. builds — by testRunId. Cascades buildChangeMaps, buildDemoNotes,
    //    stepLayerFeedback, and remaining stepComparisons.buildId.
    if (testRunIds.length) {
      await tx.delete(builds).where(inArray(builds.testRunId, testRunIds));
    }

    // 8. testRuns — plain repositoryId column, no FK.
    await tx.delete(testRuns).where(eq(testRuns.repositoryId, id));

    // 9. routes — cascades routeTestSuggestions (which has
    //    matchedTestId → tests NO ACTION, so must clear before step 10)
    //    and plannedScreenshots.routeId.
    await tx.delete(routes).where(eq(routes.repositoryId, id));

    // 10. tests — cascades plannedScreenshots.testId, focusRegions,
    //     testVersions, selectorStats, defaultSetup/TeardownSteps.testId,
    //     testFixtures.testId, stepComparisons.testId, inspectorCache, and
    //     the per-test *Baselines (network/console/a11y/perf/variable/
    //     urlTrajectory/dom). testSpecs.testId SET NULL is harmless since
    //     testSpecs cascades from repositories below.
    await tx.delete(tests).where(eq(tests.repositoryId, id));

    // 11. Non-cascading direct-to-repo tables.
    await tx
      .delete(playwrightSettings)
      .where(eq(playwrightSettings.repositoryId, id));
    await tx.delete(scanStatus).where(eq(scanStatus.repositoryId, id));
    await tx
      .delete(environmentConfigs)
      .where(eq(environmentConfigs.repositoryId, id));
    await tx
      .delete(diffSensitivitySettings)
      .where(eq(diffSensitivitySettings.repositoryId, id));
    await tx.delete(aiSettings).where(eq(aiSettings.repositoryId, id));
    await tx.delete(aiPromptLogs).where(eq(aiPromptLogs.repositoryId, id));
    await tx.delete(backgroundJobs).where(eq(backgroundJobs.repositoryId, id));
    await tx
      .delete(notificationSettings)
      .where(eq(notificationSettings.repositoryId, id));
    await tx.delete(specImports).where(eq(specImports.repositoryId, id));
    await tx.delete(setupScripts).where(eq(setupScripts.repositoryId, id));
    await tx.delete(setupConfigs).where(eq(setupConfigs.repositoryId, id));
    await tx
      .delete(googleSheetsDataSources)
      .where(eq(googleSheetsDataSources.repositoryId, id));
    await tx.delete(csvDataSources).where(eq(csvDataSources.repositoryId, id));
    await tx
      .delete(plannedScreenshots)
      .where(eq(plannedScreenshots.repositoryId, id));
    await tx.delete(activityEvents).where(eq(activityEvents.repositoryId, id));
    await tx.delete(publicShares).where(eq(publicShares.repositoryId, id));
    await tx
      .delete(remoteDebugSessions)
      .where(eq(remoteDebugSessions.repositoryId, id));
    await tx
      .delete(functionalAreas)
      .where(eq(functionalAreas.repositoryId, id));

    // 12. Nullify selectedRepositoryId references that don't have a
    //     SET NULL cascade (users.selectedRepositoryId already does).
    await tx
      .update(teams)
      .set({ selectedRepositoryId: null })
      .where(eq(teams.selectedRepositoryId, id));
    await tx
      .update(githubAccounts)
      .set({ selectedRepositoryId: null })
      .where(eq(githubAccounts.selectedRepositoryId, id));
    await tx
      .update(gitlabAccounts)
      .set({ selectedRepositoryId: null })
      .where(eq(gitlabAccounts.selectedRepositoryId, id));

    // 13. Finally the repo itself. Cascades: agentSessions, buildSchedules,
    //     composeConfigs, defaultSetupSteps, defaultTeardownSteps,
    //     githubIssues, gitlabPipelineConfigs, storageStates, testFixtures,
    //     testSpecs.
    await tx.delete(repositories).where(eq(repositories.id, id));
  });
}

export async function getBaselinesByRepo(repositoryId: string) {
  return db
    .select()
    .from(baselines)
    .where(eq(baselines.repositoryId, repositoryId));
}

// Update selected repo for github account
export async function updateSelectedRepository(
  accountId: string,
  repositoryId: string | null,
) {
  await db
    .update(githubAccounts)
    .set({ selectedRepositoryId: repositoryId })
    .where(eq(githubAccounts.id, accountId));
}

export async function getSelectedRepository(userId?: string, teamId?: string) {
  // 1. Per-user selection
  if (userId) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.selectedRepositoryId) {
      const repo = await getRepository(user.selectedRepositoryId);
      if (repo) return repo;
    }
  }

  // 2. Fallback: team-level selection (lazy migration to user)
  if (teamId) {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (team?.selectedRepositoryId) {
      const repo = await getRepository(team.selectedRepositoryId);
      if (repo) {
        // Migrate to user record (best-effort, don't fail the read)
        if (userId) {
          try {
            await db
              .update(users)
              .set({
                selectedRepositoryId: team.selectedRepositoryId,
                updatedAt: new Date(),
              })
              .where(eq(users.id, userId));
          } catch (e) {
            console.warn(
              "[getSelectedRepository] Failed to migrate team selection to user:",
              e,
            );
          }
        }
        return repo;
      }
    }

    // 3. Fallback: GitHub/GitLab account selection
    const account = await getGithubAccountByTeam(teamId);
    if (account?.selectedRepositoryId) {
      if (userId) {
        try {
          await db
            .update(users)
            .set({
              selectedRepositoryId: account.selectedRepositoryId,
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId));
        } catch (e) {
          console.warn(
            "[getSelectedRepository] Failed to migrate account selection to user:",
            e,
          );
        }
      }
      return (await getRepository(account.selectedRepositoryId)) || null;
    }
  }

  if (!userId && !teamId) {
    // Legacy fallback: read from GitHub account
    const account = await getGithubAccount();
    if (!account?.selectedRepositoryId) return null;
    return (await getRepository(account.selectedRepositoryId)) || null;
  }

  return null;
}
