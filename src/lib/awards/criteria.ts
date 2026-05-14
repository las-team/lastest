import type { AwardCategories, AwardTier } from '@/lib/db/schema';

export const TIER_ORDER: AwardTier[] = ['none', 'bronze', 'silver', 'gold'];

export function tierRank(t: AwardTier): number {
  return TIER_ORDER.indexOf(t);
}

export function maxTier(a: AwardTier, b: AwardTier): AwardTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * Snapshot metrics for a single completed build. All fields are required , 
 * null fields from the DB should be coerced to 0 by the caller.
 */
export interface BuildMetrics {
  totalTests: number;
  passedCount: number;
  failedCount: number;
  changesDetected: number;
  flakyCount: number;
  a11yScore: number;
  a11yCriticalCount: number;
}

export interface BuildSnapshot extends BuildMetrics {
  buildId: string;
  /** all tests in this build had status 'passed', no flaky, no open visual diffs */
  cleanPass: boolean;
}

export interface RecomputeInput {
  /** total test count owned by the repo (not just this build's totalTests) */
  testCount: number;
  /** most recent completed build, or null if no build has finished yet */
  latestBuild: BuildSnapshot | null;
  /** last 5 completed builds, newest first (latestBuild duplicated as first entry) */
  recentBuilds: BuildSnapshot[];
  /** count of visualDiffs.status === 'rejected' on builds for this repo, ever */
  rejectedDiffCount: number;
  /** count of rejected diffs in the last 30 days */
  rejectedDiffsLast30Days: number;
  /** count of consecutive non-flaky failures across last 2 builds (0 if none) */
  consecutiveNonFlakyFailures: number;
}

/**
 * Compute the tier from current state. Pure; no ratcheting here, see
 * applyDowngradeRule for the "only downgrades on confirmed regression" logic.
 */
export function computeTier(input: RecomputeInput): AwardTier {
  const { testCount, latestBuild, recentBuilds } = input;
  if (!latestBuild || testCount < 5) return 'none';

  const passRate = latestBuild.totalTests > 0
    ? latestBuild.passedCount / latestBuild.totalTests
    : 0;

  // Gold: ≥20 tests, last 5 builds all clean-pass, a11yScore ≥90, 0 critical a11y.
  const last5Clean = recentBuilds.length >= 5 && recentBuilds.slice(0, 5).every(b => b.cleanPass);
  if (
    testCount >= 20 &&
    last5Clean &&
    latestBuild.a11yScore >= 90 &&
    latestBuild.a11yCriticalCount === 0
  ) {
    return 'gold';
  }

  // Silver: ≥10 tests, last build pass rate ≥95%, a11yScore ≥80, 0 critical.
  if (
    testCount >= 10 &&
    passRate >= 0.95 &&
    latestBuild.a11yScore >= 80 &&
    latestBuild.a11yCriticalCount === 0
  ) {
    return 'silver';
  }

  // Bronze: ≥5 tests, pass rate ≥80%, a11yScore ≥60.
  if (testCount >= 5 && passRate >= 0.8 && latestBuild.a11yScore >= 60) {
    return 'bronze';
  }

  return 'none';
}

export function computeCategories(input: RecomputeInput): AwardCategories {
  const { latestBuild, rejectedDiffsLast30Days } = input;
  if (!latestBuild) {
    return { a11y: false, allPassing: false, zeroDrift: false };
  }
  return {
    a11y: latestBuild.a11yScore >= 90 && latestBuild.a11yCriticalCount === 0,
    allPassing: latestBuild.failedCount === 0 && latestBuild.changesDetected === 0 && latestBuild.totalTests > 0,
    zeroDrift: rejectedDiffsLast30Days === 0,
  };
}

/**
 * A confirmed regression has landed if either:
 *   - the user has explicitly rejected ≥1 visual diff for this repo, OR
 *   - the last 2 completed builds both had non-flaky failures.
 *
 * Flakes alone never trigger this. Open/pending diffs never trigger this.
 */
export function detectConfirmedRegression(input: RecomputeInput): boolean {
  if (input.rejectedDiffCount > 0) return true;
  if (input.consecutiveNonFlakyFailures >= 2) return true;
  return false;
}

/**
 * The full ratchet rule. Returns the new currentTier given prior state +
 * freshly-computed tier from this build's metrics.
 *
 * Without a confirmed regression: tier can only go up. (latestComputed wins
 * if higher than priorCurrent; otherwise priorCurrent stays.)
 * With a confirmed regression: tier resets to whatever the metrics support
 * now (full recompute, no protection).
 */
export function applyDowngradeRule(args: {
  priorCurrent: AwardTier;
  latestComputed: AwardTier;
  hasConfirmedRegression: boolean;
}): AwardTier {
  if (args.hasConfirmedRegression) return args.latestComputed;
  return maxTier(args.priorCurrent, args.latestComputed);
}
