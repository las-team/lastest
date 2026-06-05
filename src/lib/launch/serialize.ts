/**
 * Map DB rows to the exact JSON shapes of the backend API contract
 * (see ok-i-d-like-to-warm-orbit.md → "Backend API contract"). Keeping this in
 * one place means the public reads, the build-time snapshot, and the single
 * profile endpoint all emit identical fields.
 */

import type {
  LaunchCohort,
  LaunchProfile,
  LaunchMonthlyWinner,
} from "@/lib/db/schema";

export interface SerializedCohort {
  id: string;
  weekStartISO: string | null;
  weekEndISO: string | null;
  state: string;
  winnerSlug: string | null;
}

export interface SerializedProfile {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  websiteUrl: string;
  founderName: string | null;
  founderHandle: string | null;
  status: string;
  logoUrl: string | null;
  testReportShareUrl: string | null;
  walkthrough: { src: string; poster?: string; description?: string } | null;
  upvoteCount: number;
  rank: number | null;
  hasVoted: boolean;
  createdAtISO: string | null;
}

export function serializeCohort(cohort: LaunchCohort): SerializedCohort {
  return {
    id: cohort.id,
    weekStartISO: cohort.weekStartAt?.toISOString() ?? null,
    weekEndISO: cohort.weekEndAt?.toISOString() ?? null,
    state: cohort.state,
    winnerSlug: cohort.winnerSlug ?? null,
  };
}

export function serializeProfile(
  profile: LaunchProfile,
  opts: { rank?: number | null; hasVoted?: boolean } = {},
): SerializedProfile {
  return {
    slug: profile.slug,
    name: profile.name,
    tagline: profile.tagline ?? null,
    description: profile.description ?? null,
    category: profile.category ?? null,
    websiteUrl: profile.websiteUrl,
    founderName: profile.founderName ?? null,
    founderHandle: profile.founderHandle ?? null,
    status: profile.status,
    logoUrl: profile.logoUrl ?? null,
    testReportShareUrl: profile.testReportShareUrl ?? null,
    walkthrough: profile.walkthrough ?? null,
    upvoteCount: profile.upvoteCount,
    rank: opts.rank ?? null,
    hasVoted: opts.hasVoted ?? false,
    createdAtISO: profile.createdAt?.toISOString() ?? null,
  };
}

// Top-level array element for GET /winners/monthly. The build script reads
// `.slug` (or a bare string); we expose both `slug` and `month`.
export function serializeMonthlyWinner(w: LaunchMonthlyWinner): {
  slug: string;
  month: string;
} {
  return { slug: w.profileSlug, month: w.month };
}
