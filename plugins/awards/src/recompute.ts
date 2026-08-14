import { v4 as uuid } from "uuid";

import {
  applyDowngradeRule,
  computeCategories,
  computeTier,
  detectConfirmedRegression,
  maxTier,
  type BuildSnapshot,
  type RecomputeInput,
} from "./domain/criteria";
import { db } from "./data/db";
import { getRepoAward, upsertRepoAward } from "./data/queries";
import type { AwardTier, NewRepoAward, RepoAward } from "./schema";
import { awardsWiring } from "./wiring";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function toSnapshot(row: {
  id: string;
  totalTests: number | null;
  passedCount: number | null;
  failedCount: number | null;
  changesDetected: number | null;
  flakyCount: number | null;
  a11yScore: number | null;
  a11yCriticalCount: number | null;
}): BuildSnapshot {
  const totalTests = row.totalTests ?? 0;
  const passedCount = row.passedCount ?? 0;
  const failedCount = row.failedCount ?? 0;
  const changesDetected = row.changesDetected ?? 0;
  const flakyCount = row.flakyCount ?? 0;
  const a11yScore = row.a11yScore ?? 0;
  const a11yCriticalCount = row.a11yCriticalCount ?? 0;
  // "clean pass": every test passed (no real failures), no unresolved visual changes,
  // and no flakes either. Flakes alone don't downgrade the tier but they DO
  // disqualify the build from counting toward gold's 5-clean streak.
  const cleanPass =
    totalTests > 0 &&
    failedCount === 0 &&
    changesDetected === 0 &&
    flakyCount === 0 &&
    passedCount === totalTests;
  return {
    buildId: row.id,
    totalTests,
    passedCount,
    failedCount,
    changesDetected,
    flakyCount,
    a11yScore,
    a11yCriticalCount,
    cleanPass,
  };
}

function countConsecutiveNonFlakyFailures(snaps: BuildSnapshot[]): number {
  // Walk from the newest build backward. A "non-flaky failure" means the build
  // had real failures with no flakes credited. Stop counting at first clean build.
  let n = 0;
  for (const s of snaps) {
    const realFail = s.failedCount > 0 && s.flakyCount === 0;
    if (realFail) n++;
    else break;
  }
  return n;
}

const TIER_RANK: Record<AwardTier, number> = {
  none: 0,
  starter: 1,
  bronze: 2,
  silver: 3,
  gold: 4,
};
function rank(t: AwardTier): number {
  return TIER_RANK[t];
}

/**
 * Recompute the award row for a repo from current DB state. Idempotent.
 * Returns the resulting row, or null if no completed build exists yet (no row
 * written).
 *
 * Safe to fire-and-forget from the executor; DB errors thrown by callers
 * should be logged, not propagated. Called from `builds.ts` with a
 * `repositoryId` it has already resolved — see `wiring.ts` for why this
 * plugin does not build a `PluginContext` for that call.
 */
export async function recomputeRepoAward(
  repositoryId: string,
): Promise<RepoAward | null> {
  const { host } = awardsWiring();

  const [
    testCount,
    recentRows,
    rejectedAll,
    rejectedRecent,
    prior,
    shareSlugs,
  ] = await Promise.all([
    host.getTestCount(repositoryId),
    host.getRecentCompletedBuilds(repositoryId, 5),
    host.getRejectedDiffCount(repositoryId),
    host.getRejectedDiffCount(repositoryId, Date.now() - THIRTY_DAYS_MS),
    getRepoAward(db(), repositoryId),
    host.resolveLatestShareSlugs([repositoryId]),
  ]);
  const proofSlug = shareSlugs.get(repositoryId) ?? null;

  if (recentRows.length === 0) {
    // No completed builds yet, nothing to award.
    return prior ?? null;
  }

  const recentSnaps = recentRows.map(toSnapshot);
  const latest = recentSnaps[0];
  const consecutiveNonFlakyFailures = countConsecutiveNonFlakyFailures(
    recentSnaps.slice(0, 2),
  );

  const input: RecomputeInput = {
    testCount,
    latestBuild: latest,
    recentBuilds: recentSnaps,
    rejectedDiffCount: rejectedAll,
    rejectedDiffsLast30Days: rejectedRecent,
    consecutiveNonFlakyFailures,
  };

  const latestComputed = computeTier(input);
  const hasConfirmedRegression = detectConfirmedRegression(input);
  const priorCurrent: AwardTier = prior?.currentTier ?? "none";

  const currentTier = applyDowngradeRule({
    priorCurrent,
    latestComputed,
    hasConfirmedRegression,
  });
  const priorHighest: AwardTier = prior?.highestTier ?? "none";
  const highestTier = maxTier(priorHighest, currentTier);
  const categories = computeCategories(input);

  const isDowngrade =
    priorCurrent !== currentTier && rank(currentTier) < rank(priorCurrent);
  const downgradeReason = !isDowngrade
    ? (prior?.lastDowngradeReason ?? null)
    : rejectedAll > 0
      ? `confirmed regression: ${rejectedAll} rejected visual diff(s)`
      : consecutiveNonFlakyFailures >= 2
        ? `confirmed regression: ${consecutiveNonFlakyFailures} consecutive non-flaky failures`
        : "recomputed";

  const data: NewRepoAward = {
    id: prior?.id ?? uuid(),
    repositoryId,
    currentTier,
    highestTier,
    categories,
    proofShareSlug: proofSlug,
    lastBuildId: latest.buildId,
    earnedAt: prior?.earnedAt ?? new Date(),
    lastRecomputedAt: new Date(),
    lastDowngradeAt: isDowngrade
      ? new Date()
      : (prior?.lastDowngradeAt ?? null),
    lastDowngradeReason: downgradeReason,
  };

  return upsertRepoAward(db(), data);
}
