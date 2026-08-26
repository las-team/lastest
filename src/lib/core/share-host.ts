import "server-only";

import type {
  BuildA11yViolationRow,
  ClaimSourceTest,
  RepoAward,
  ShareBuildRenderContext,
  ShareHost,
  ShareNotificationPayload,
  SharePublishInfo,
  ShareRepoActor,
  ShareTeamActor,
} from "@lastest/plugin-share/host";
import type { DemoNotes, VideoCaption } from "@lastest/plugin-share";
import { getRepoAward as awardsGetRepoAward } from "@lastest/plugin-awards";

import type { Build } from "@/lib/db/schema";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import { sendDiscordShareNotification } from "@/lib/integrations/discord";

/**
 * The app's fill for `ShareHost`. See `plugins/share/src/host.ts` for why
 * this port is the largest of any phase-4 plugin (15 methods) and what was
 * deliberately kept out of it.
 */

function deriveTargetDomain(
  targetUrl: string | null | undefined,
): string | null {
  if (!targetUrl) return null;
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return null;
  }
}

async function toRepoActor(repositoryId: string): Promise<ShareRepoActor> {
  const session = await requireRepoAccess(repositoryId);
  return {
    userId: session.user.id,
    userEmail: session.user.email,
    teamId: session.team.id,
    teamName: session.team.name,
    repoName: session.repo.name || session.repo.fullName,
  };
}

async function toTeamActor(): Promise<ShareTeamActor> {
  const session = await requireTeamAccess();
  return {
    userId: session.user.id,
    teamId: session.team.id,
    teamSlug: session.team.slug,
  };
}

/**
 * Resolve which build a share renders. Test-scoped shares auto-follow the
 * latest completed build that actually ran the test, so re-running the test
 * surfaces on the existing /r/<slug> without a manual republish —
 * share.buildId is just the initial anchor. Build-wide shares (testId null)
 * stay pinned to their immutable snapshot.
 *
 * Exported (not just used internally by `getBuildRenderContext`) because
 * three OTHER app routes need the exact same resolution and are not part of
 * this plugin migration: the `/share/<slug>/...` media allow-list route, the
 * `/share/<slug>/captions.vtt` route, and `/api/og/share/<slug>`. All are
 * core app code, so calling into `src/lib/core/` is normal composition, not
 * a boundary crossing — see `plugin-migration-recipe.md` §1.6's "reclassify"
 * outcome: these routes were never part of the `share` PSEUDO_PLUGINS entry,
 * they just happen to need the same build resolution the plugin's render
 * path does.
 */
export async function resolveShareRenderBuild(target: {
  buildId: string;
  testId: string | null;
}): Promise<Build | null> {
  if (target.testId) {
    const latest = await queries.getLatestCompletedBuildForTest(target.testId);
    if (latest) return latest;
  }
  return (await queries.getBuild(target.buildId)) ?? null;
}

/**
 * The active baselines for a test — a plain core read, exported for the
 * `/share/<slug>/...` media route's allow-list (the same one
 * `cloneShareIntoRepo` copies from during a claim). Not part of `ShareHost`:
 * that interface is what the *plugin* needs from core; this is core app code
 * calling core app code.
 */
export async function getActiveBaselinesForTest(testId: string) {
  return queries.getActiveBaselinesForTest(testId);
}

/**
 * Batched build/test/video enrichment for `src/app/sitemap.ts`. Not a
 * `ShareHost` method — the plugin never needs this, only the app's sitemap
 * route does, and it is core app code composing two reads itself
 * (`plugin-migration-recipe.md` §6.2: "the plugin answers its own
 * questions, the app composes" — here the plugin's only question is "which
 * shares are indexable" via `listIndexablePublicShares`).
 *
 * One query for up to 5000 shares rather than one round trip each — this
 * ported the exact join `listPublicSharesForSitemap` used to run inside
 * `src/lib/db/queries/public-shares.ts`.
 */
export async function getSitemapEnrichment(
  shares: ReadonlyArray<{
    slug: string;
    testId: string | null;
    buildId: string;
  }>,
): Promise<
  Map<
    string,
    {
      buildCompletedAt: Date | null;
      buildCreatedAt: Date | null;
      testName: string | null;
      changesDetected: number;
      videoPath: string | null;
      videoDurationMs: number | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      buildCompletedAt: Date | null;
      buildCreatedAt: Date | null;
      testName: string | null;
      changesDetected: number;
      videoPath: string | null;
      videoDurationMs: number | null;
    }
  >();
  if (shares.length === 0) return out;

  const buildIds = [...new Set(shares.map((s) => s.buildId))];
  const rows = await queries.getBuildSitemapRowsByIds(buildIds);
  const buildById = new Map(rows.map((r) => [r.buildId, r]));

  const testIds = [
    ...new Set(shares.map((s) => s.testId).filter((v): v is string => !!v)),
  ];
  const testRows = await queries.getTestNamesByIds(testIds);
  const testNameById = new Map(testRows.map((t) => [t.id, t.name]));

  const testRunIds = [
    ...new Set(rows.map((r) => r.testRunId).filter((v): v is string => !!v)),
  ];
  const resultRows = await queries.getTestResultVideosByRuns(testRunIds);

  for (const s of shares) {
    const build = buildById.get(s.buildId);
    const result = s.testId
      ? resultRows.find(
          (r) => r.testRunId === build?.testRunId && r.testId === s.testId,
        )
      : undefined;
    out.set(s.slug, {
      buildCompletedAt: build?.buildCompletedAt ?? null,
      buildCreatedAt: build?.buildCreatedAt ?? null,
      testName: s.testId ? (testNameById.get(s.testId) ?? null) : null,
      changesDetected: build?.changesDetected ?? 0,
      videoPath: result?.videoPath ?? null,
      videoDurationMs: result?.durationMs ?? null,
    });
  }
  return out;
}

export const appShareHost: ShareHost = {
  // ── Identity ──────────────────────────────────────────────────────────
  async requireRepoAccess(repositoryId: string): Promise<ShareRepoActor> {
    return toRepoActor(repositoryId);
  },

  async requireTeamAccess(): Promise<ShareTeamActor> {
    return toTeamActor();
  },

  async requireTestAccess(testId: string): Promise<ShareRepoActor | null> {
    const test = await queries.getTest(testId);
    if (!test?.repositoryId) return null;
    return toRepoActor(test.repositoryId);
  },

  // ── Publish flow ──────────────────────────────────────────────────────
  async getBuildPublishInfo(
    buildId: string,
    scopedTestId?: string | null,
  ): Promise<SharePublishInfo | null> {
    const build = await queries.getBuild(buildId);
    if (!build) return null;
    const testRun = build.testRunId
      ? await queries.getTestRun(build.testRunId)
      : null;
    const repositoryId = testRun?.repositoryId ?? null;
    if (!repositoryId) return null;

    const scopedTest = scopedTestId
      ? await queries.getTest(scopedTestId)
      : null;

    // targetDomain still needs a representative URL for build-wide shares.
    let domainTest = scopedTest;
    if (!domainTest && build.testRunId) {
      const results = await queries.getTestResultsByRun(build.testRunId);
      const firstResult = results[0];
      domainTest = firstResult?.testId
        ? ((await queries.getTest(firstResult.testId)) ?? null)
        : null;
    }

    return {
      repositoryId,
      testRunId: build.testRunId,
      targetDomain: deriveTargetDomain(domainTest?.targetUrl),
      scopedTestName: scopedTest?.name ?? null,
    };
  },

  async resolveOrCreateBuildForTest(
    testId: string,
  ): Promise<{ repositoryId: string; buildId: string } | null> {
    const test = await queries.getTest(testId);
    if (!test?.repositoryId) return null;

    const results = await queries.getTestResultsByTest(testId);
    const mostRecent = results.find((r) => r.testRunId);
    if (!mostRecent?.testRunId) return null;

    // Per-test runs started from the test detail page go through runTests()
    // which creates a testRun without a build. Full-repo runs already have
    // one. Synthesize a minimal one now when missing, so the share system
    // always has a build to anchor the snapshot.
    let build = await queries.getBuildByTestRun(mostRecent.testRunId);
    if (!build) {
      const runResults = await queries.getTestResultsByRun(
        mostRecent.testRunId,
      );
      const passed = runResults.filter((r) => r.status === "passed").length;
      const failed = runResults.filter((r) => r.status === "failed").length;
      build = await queries.createBuild({
        testRunId: mostRecent.testRunId,
        triggerType: "manual",
        overallStatus: failed > 0 ? "blocked" : "review_required",
        totalTests: runResults.length,
        passedCount: passed,
        failedCount: failed,
        changesDetected: 0,
        flakyCount: 0,
        comparisonMode: "vs_both",
        completedAt: new Date(),
      });
    }

    return { repositoryId: test.repositoryId, buildId: build.id };
  },

  // ── Render flow ───────────────────────────────────────────────────────
  async getBuildRenderContext(target: {
    buildId: string;
    testId: string | null;
  }): Promise<ShareBuildRenderContext | null> {
    const build = await resolveShareRenderBuild(target);
    if (!build) return null;

    const test = target.testId
      ? ((await queries.getTest(target.testId)) ?? null)
      : null;

    const testRun = build.testRunId
      ? ((await queries.getTestRun(build.testRunId)) ?? null)
      : null;

    const testRunId = build.testRunId;
    const [diffs, results, stepCmps] = await Promise.all([
      queries.getVisualDiffsWithDomDiff(build.id, target.testId),
      testRunId
        ? queries.getTestResultSummariesByRun(testRunId, target.testId)
        : Promise.resolve([]),
      queries.getStepComparisonVerdictsByBuild(build.id, target.testId),
    ]);

    return {
      build: {
        id: build.id,
        testRunId: build.testRunId,
        baseUrl: build.baseUrl,
        changesDetected: build.changesDetected,
        totalTests: build.totalTests,
        passedCount: build.passedCount,
        failedCount: build.failedCount,
        overallStatus: build.overallStatus,
        completedAt: build.completedAt,
        createdAt: build.createdAt,
        elapsedMs: build.elapsedMs,
        triggerType: build.triggerType,
        a11yScore: build.a11yScore,
        a11yViolationCount: build.a11yViolationCount,
        a11yTotalRulesChecked: build.a11yTotalRulesChecked,
        designSystemScore: build.designSystemScore,
        buildSetupTestId: build.buildSetupTestId,
      },
      test: test
        ? {
            name: test.name,
            code: test.code,
            targetUrl: test.targetUrl,
            setupTestId: test.setupTestId,
          }
        : null,
      testRun: testRun
        ? {
            repositoryId: testRun.repositoryId,
            gitBranch: testRun.gitBranch,
            gitCommit: testRun.gitCommit,
          }
        : null,
      diffs: diffs as ShareBuildRenderContext["diffs"],
      results: results as ShareBuildRenderContext["results"],
      stepComparisons: stepCmps as ShareBuildRenderContext["stepComparisons"],
    };
  },

  async getOwnerTeamFlags(
    repositoryId: string | null,
  ): Promise<{ earlyAdopterMode: boolean } | null> {
    if (!repositoryId) return null;
    const row = await queries.getRepositoryOwnerTeamFlags(repositoryId);
    return row ? { earlyAdopterMode: row.earlyAdopterMode ?? false } : null;
  },

  async getPlatformStats(): Promise<{ testRunsCompleted: number }> {
    return { testRunsCompleted: await queries.countAllTestResults() };
  },

  async getBuildA11yViolations(
    buildId: string,
  ): Promise<BuildA11yViolationRow[]> {
    return queries.getBuildA11yViolations(buildId) as Promise<
      BuildA11yViolationRow[]
    >;
  },

  async getRepoAward(repositoryId: string): Promise<RepoAward | null> {
    // Cross-feature read into `@lastest/plugin-awards`'s own table — the
    // mirror image of `resolveShareSlug`/`resolveLatestShareSlugs` on
    // `AwardsHost`, which read share's table the same way. Both directions
    // go through `src/lib/core/` rather than importing one plugin from the
    // other. Boot order: `getRepoAward` never runs before `getPluginRuntime()`
    // has configured both plugins, the same guarantee every other host relies
    // on.
    const award = await awardsGetRepoAward(repositoryId);
    return (award as RepoAward | undefined) ?? null;
  },

  async getDemoNotes(
    buildId: string,
    repositoryId: string | null,
  ): Promise<{ notes: DemoNotes | null; buildCaptions: VideoCaption[] }> {
    const notes = repositoryId
      ? ((await queries.getLatestDemoNotesForRepo(repositoryId)) ??
        (await queries.getBuildDemoNotes(buildId)))
      : await queries.getBuildDemoNotes(buildId);
    const buildOwn = await queries.getBuildDemoNotes(buildId);
    return {
      notes: (notes as DemoNotes | null) ?? null,
      buildCaptions: (buildOwn?.captions as VideoCaption[] | undefined) ?? [],
    };
  },

  // ── Claim flow ────────────────────────────────────────────────────────
  async findOrCreateClaimRepo(
    teamId: string,
    teamSlug: string,
    repoName: string,
  ): Promise<{ repositoryId: string }> {
    const existingRepos = await queries.getRepositoriesByTeam(teamId);
    const existing = existingRepos.find(
      (r) => r.name === repoName && r.provider === "local",
    );
    if (existing) return { repositoryId: existing.id };

    const repo = await queries.createRepository({
      teamId,
      provider: "local",
      owner: teamSlug,
      name: repoName,
      fullName: `${teamSlug}/${repoName}`,
      defaultBranch: "main",
    });
    return { repositoryId: repo.id };
  },

  async cloneShareIntoRepo(input: {
    shareTestId: string | null;
    shareBuildId: string;
    sourceRepositoryId: string | null;
    targetRepositoryId: string;
    createdByUserId: string;
  }): Promise<{ testIds: string[] }> {
    const sourceTests = await resolveSourceTests(
      input.shareTestId,
      input.shareBuildId,
    );
    if (sourceTests.length === 0) return { testIds: [] };

    const priorTests = await queries.getTestsByRepo(input.targetRepositoryId);
    const clonedTestIds: string[] = [];

    for (const sourceTest of sourceTests) {
      const prior = priorTests.find(
        (t) => t.name === sourceTest.name && t.code === sourceTest.code,
      );
      if (prior) {
        clonedTestIds.push(prior.id);
        continue;
      }

      const newTest = await queries.createTest({
        repositoryId: input.targetRepositoryId,
        functionalAreaId: null,
        name: sourceTest.name,
        code: sourceTest.code,
        targetUrl: sourceTest.targetUrl,
        executionMode: sourceTest.executionMode ?? "procedural",
        createdByUserId: input.createdByUserId,
        createdByBotId: null,
      });
      clonedTestIds.push(newTest.id);

      if (input.sourceRepositoryId) {
        await copyActiveBaselines(
          sourceTest.id,
          newTest.id,
          input.sourceRepositoryId,
          input.targetRepositoryId,
        );
      }
    }

    return { testIds: clonedTestIds };
  },

  async setSelectedRepository(
    userId: string,
    repositoryId: string,
  ): Promise<void> {
    await queries.updateUser(userId, { selectedRepositoryId: repositoryId });
  },

  // ── Notification ──────────────────────────────────────────────────────
  async sendShareNotification(
    webhookUrl: string,
    payload: ShareNotificationPayload,
  ): Promise<{ success: boolean; error?: string }> {
    return sendDiscordShareNotification(webhookUrl, payload);
  },
};

async function resolveSourceTests(
  shareTestId: string | null,
  shareBuildId: string,
): Promise<ClaimSourceTest[]> {
  if (shareTestId) {
    const test = await queries.getTest(shareTestId);
    return test
      ? [
          {
            id: test.id,
            name: test.name,
            code: test.code,
            targetUrl: test.targetUrl,
            executionMode: test.executionMode ?? null,
          },
        ]
      : [];
  }

  const build = await queries.getBuild(shareBuildId);
  if (!build?.testRunId) return [];
  const results = await queries.getTestResultsByRun(build.testRunId);
  const seen = new Set<string>();
  const out: ClaimSourceTest[] = [];
  for (const r of results) {
    if (!r.testId || seen.has(r.testId)) continue;
    seen.add(r.testId);
    const t = await queries.getTest(r.testId);
    if (t) {
      out.push({
        id: t.id,
        name: t.name,
        code: t.code,
        targetUrl: t.targetUrl,
        executionMode: t.executionMode ?? null,
      });
    }
  }
  return out;
}

/**
 * Best-effort copy of a source test's active baseline images into the
 * claimer's repo, under the new repository id's screenshot directory.
 * Mirrors the pre-plugin `copyBaselineFiles` helper in
 * `src/server/actions/public-shares.ts`.
 */
async function copyActiveBaselines(
  sourceTestId: string,
  targetTestId: string,
  sourceRepoId: string,
  targetRepoId: string,
): Promise<void> {
  const { STORAGE_DIRS, toRelativePath } = await import("@/lib/storage/paths");
  const path = await import("path");
  const fs = await import("fs/promises");

  const activeBaselines = await queries.getActiveBaselinesForTest(sourceTestId);

  for (const b of activeBaselines) {
    if (!b.imagePath) continue;
    const relative = b.imagePath.replace(/^\/+/, "");
    const segments = relative.split("/");
    if (segments[0] !== "screenshots") continue;
    const sourceAbs = path.join(
      STORAGE_DIRS.screenshots,
      segments.slice(1).join("/"),
    );
    const newRelativeUnder = segments
      .slice(1)
      .join("/")
      .replace(sourceRepoId, targetRepoId);
    const targetAbs = path.join(STORAGE_DIRS.screenshots, newRelativeUnder);
    let newPath: string;
    try {
      await fs.mkdir(path.dirname(targetAbs), { recursive: true });
      await fs.copyFile(sourceAbs, targetAbs);
      newPath = toRelativePath(targetAbs);
    } catch {
      // Best-effort — first run will create a fresh baseline if this fails.
      continue;
    }
    await queries.createBaseline({
      repositoryId: targetRepoId,
      testId: targetTestId,
      stepLabel: b.stepLabel,
      imagePath: newPath,
      imageHash: b.imageHash,
      branch: b.branch,
      isActive: true,
      browser: b.browser ?? "chromium",
    });
  }
}
