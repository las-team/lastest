/**
 * Velocity-weighted ranking for the launch leaderboard.
 *
 * Per the competitive research, rank on upvote *velocity* (avg upvotes/hour
 * since the cohort went live), not raw lifetime count — this stops a slow
 * early lead from being unbeatable and rewards sustained momentum.
 */

import type { LaunchProfile } from '@/lib/db/schema';

/** Avg upvotes/hour since `weekStartAt`, floored at a 1h denominator. */
export function velocityScore(upvoteCount: number, weekStartAt: Date, now: Date = new Date()): number {
  const elapsedMs = now.getTime() - weekStartAt.getTime();
  const hours = Math.max(1, elapsedMs / 3_600_000);
  return upvoteCount / hours;
}

export interface RankedProfile {
  profile: LaunchProfile;
  score: number;
  rank: number;
}

/**
 * Sort profiles by velocity desc and assign 1-based ranks. Ties break on raw
 * upvoteCount desc, then earliest createdAt (first-to-submit wins).
 */
export function rankProfiles(
  profiles: LaunchProfile[],
  weekStartAt: Date,
  now: Date = new Date(),
): RankedProfile[] {
  return profiles
    .map((profile) => ({ profile, score: velocityScore(profile.upvoteCount, weekStartAt, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.profile.upvoteCount !== a.profile.upvoteCount) {
        return b.profile.upvoteCount - a.profile.upvoteCount;
      }
      const at = a.profile.createdAt?.getTime() ?? 0;
      const bt = b.profile.createdAt?.getTime() ?? 0;
      return at - bt;
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/** Slug of the highest-velocity profile, or null if there are none. */
export function pickWinnerSlug(
  profiles: LaunchProfile[],
  weekStartAt: Date,
  now: Date = new Date(),
): string | null {
  const ranked = rankProfiles(profiles, weekStartAt, now);
  return ranked[0]?.profile.slug ?? null;
}
