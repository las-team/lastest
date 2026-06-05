/**
 * REST API v1 for the launch.lastest.cloud directory.
 *
 * Distinct from the parent `/api/v1/[...slug]` catch-all in one important way:
 * **reads are public** (no 401 for a missing token) so the static frontend and
 * the build-time snapshot script can fetch cohorts/profiles anonymously. A
 * bearer token is optional on reads (only used to populate `hasVoted`) and
 * required on mutations. This nested route wins over the parent catch-all
 * because the literal `launch` segment is more specific than `[...slug]`.
 *
 * Endpoints (base /api/v1/launch):
 *   GET    /cohorts/current                 - live (or upcoming) cohort + ranked featured profiles
 *   GET    /cohorts?state=locked,closed&include=profiles - cohort archive (build snapshot)
 *   GET    /cohorts/:id                      - single cohort (+ profiles)
 *   GET    /profiles/:slug                   - single profile (+ hasVoted if token)
 *   GET    /winners/monthly                  - "Tested Startup of the Month" winners
 *   POST   /submissions                      - submit an app (user token; gated)
 *   POST   /profiles/:slug/upvote            - upvote (user token; gated)
 *   DELETE /profiles/:slug/upvote            - remove an upvote (user token)
 *   PATCH  /profiles/:slug                   - admin: attach report/walkthrough, feature, edit
 *   PATCH  /cohorts/:id                       - admin: state/winner override, set monthly winner
 */

import { NextRequest, NextResponse } from "next/server";
import * as queries from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { extractSourceIp } from "@/lib/url-diff/ssrf";
import { assertCanVote, assertCanSubmit } from "@/lib/launch/gating";
import {
  serializeCohort,
  serializeProfile,
  serializeMonthlyWinner,
} from "@/lib/launch/serialize";
import { rankProfiles } from "@/lib/launch/velocity";
import {
  ensureUpcomingCohort,
  lockCohortNow,
} from "@/lib/launch/cohort-engine";
import { scopeIncludes } from "@/lib/launch/oauth-config";
import { DuplicateVoteError, normalizeDomain } from "@/lib/db/queries/launch";
import type {
  LaunchCohort,
  LaunchCohortState,
  LaunchProfileStatus,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const PROFILE_STATUSES: LaunchProfileStatus[] = [
  "pending_review",
  "featured",
  "rejected",
  "archived",
];
const COHORT_STATES: LaunchCohortState[] = [
  "open",
  "voting",
  "locked",
  "closed",
];

interface Actor {
  userId: string;
  emailVerified: boolean;
  role: string;
  scope: string | null; // null = cookie/api token (staff); set = launch token
}

/**
 * Resolve the caller. Bearer token first (so we can read its scope), then a
 * cookie session (staff using the app directly). Returns null if neither.
 */
async function resolveActor(request: NextRequest): Promise<Actor | null> {
  const authz = request.headers.get("authorization");
  if (authz?.startsWith("Bearer ")) {
    const row = await queries.getSessionWithUser(authz.slice(7));
    if (!row || row.session.expiresAt < new Date()) return null;
    return {
      userId: row.user.id,
      emailVerified: Boolean(row.user.emailVerified),
      role: row.user.role,
      scope: row.session.scope ?? null,
    };
  }
  const session = await getCurrentSession();
  if (session) {
    return {
      userId: session.user.id,
      emailVerified: Boolean(session.user.emailVerified),
      role: session.user.role,
      scope: null,
    };
  }
  return null;
}

// A launch-scoped token must carry the required scope; a null-scope token
// (cookie session or api token used by staff/tests) is allowed through.
function hasScope(actor: Actor, required: string): boolean {
  if (actor.scope === null) return true;
  return scopeIncludes(actor.scope, required);
}

function isAdmin(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "owner";
}

function err(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
) {
  return NextResponse.json({ error, ...extra }, { status, headers });
}

// Machine-readable failure: the frontend switches on `code` (snake_case) and
// falls back to `error` for the message. Keep both in sync.
// Codes the launch frontend understands: already_voted, account_too_new,
// email_unverified, velocity_exceeded, voting_closed (+ dup_domain, insufficient_scope).
function fail(
  status: number,
  code: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
) {
  return NextResponse.json(
    { code, error: code, ...extra },
    { status, headers },
  );
}

// Detail payload: nested { cohort, profiles } — used by /cohorts/current and
// /cohorts/:id, which the live client (fetchCurrentCohort) expects nested.
async function cohortPayload(cohort: LaunchCohort, votedSet: Set<string>) {
  const featured = await queries.listFeaturedProfilesByCohort(cohort.id);
  const ranked = rankProfiles(featured, cohort.weekStartAt ?? new Date());
  return {
    cohort: serializeCohort(cohort),
    profiles: ranked.map((r) =>
      serializeProfile(r.profile, {
        rank: r.rank,
        hasVoted: votedSet.has(r.profile.id),
      }),
    ),
  };
}

// List payload: FLAT cohort with `profiles` inlined — the build-time snapshot
// script (build-launch-data.mjs → mapCohort) reads cohort fields + profiles off
// each array element directly.
async function flatCohortPayload(cohort: LaunchCohort) {
  const featured = await queries.listFeaturedProfilesByCohort(cohort.id);
  const ranked = rankProfiles(featured, cohort.weekStartAt ?? new Date());
  return {
    ...serializeCohort(cohort),
    profiles: ranked.map((r) => serializeProfile(r.profile, { rank: r.rank })),
  };
}

// ============================================
// GET (public; bearer optional → hasVoted)
// ============================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a, b] = path;
  const actor = await resolveActor(request).catch(() => null);

  // GET /winners/monthly → top-level array of { slug, month } (build script reads `.slug`).
  if (resource === "winners" && a === "monthly") {
    const winners = await queries.getMonthlyWinners();
    return NextResponse.json(winners.map(serializeMonthlyWinner));
  }

  // GET /profiles/:slug → bare profile object (frontend fetchProfile reads top-level).
  if (resource === "profiles" && a && !b) {
    const profile = await queries.getProfileBySlug(a);
    if (!profile) return err(404, "Not found");
    const hasVoted = actor
      ? await queries.hasUserVoted(profile.id, actor.userId)
      : false;
    return NextResponse.json(serializeProfile(profile, { hasVoted }));
  }

  if (resource === "cohorts") {
    // GET /cohorts/current
    if (a === "current") {
      const cohort = await queries.getCurrentCohort();
      if (!cohort) return NextResponse.json({ cohort: null, profiles: [] });
      const featured = await queries.listFeaturedProfilesByCohort(cohort.id);
      const votedSet =
        actor && featured.length
          ? await queries.getUserVotedProfileIds(
              actor.userId,
              featured.map((p) => p.id),
            )
          : new Set<string>();
      return NextResponse.json(await cohortPayload(cohort, votedSet));
    }

    // GET /cohorts/:id  (+ optional ?include=profiles)
    if (a) {
      const cohort = await queries.getCohortById(a);
      if (!cohort) return err(404, "Not found");
      const include =
        request.nextUrl.searchParams.get("include") === "profiles";
      if (!include)
        return NextResponse.json({ cohort: serializeCohort(cohort) });
      const featured = await queries.listFeaturedProfilesByCohort(cohort.id);
      const votedSet =
        actor && featured.length
          ? await queries.getUserVotedProfileIds(
              actor.userId,
              featured.map((p) => p.id),
            )
          : new Set<string>();
      return NextResponse.json(await cohortPayload(cohort, votedSet));
    }

    // GET /cohorts?state=locked,closed&include=profiles
    const stateParam = request.nextUrl.searchParams.get("state");
    const include = request.nextUrl.searchParams.get("include") === "profiles";
    const states = (
      stateParam ? stateParam.split(",") : ["voting", "locked", "closed"]
    )
      .map((s) => s.trim())
      .filter((s): s is LaunchCohortState =>
        (COHORT_STATES as string[]).includes(s),
      );
    const cohorts = await queries.getCohortsByState(states);
    if (!include) {
      return NextResponse.json({ cohorts: cohorts.map(serializeCohort) });
    }
    const withProfiles = [];
    for (const cohort of cohorts) {
      withProfiles.push(await flatCohortPayload(cohort));
    }
    return NextResponse.json({ cohorts: withProfiles });
  }

  return err(404, "Not found");
}

// ============================================
// POST (user token required; gated)
// ============================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a, b] = path;
  const actor = await resolveActor(request);
  if (!actor) return err(401, "Unauthorized");

  // POST /submissions
  if (resource === "submissions" && !a) {
    if (!hasScope(actor, "launch:submit"))
      return fail(403, "insufficient_scope");
    const gate = await assertCanSubmit(actor.userId, actor.emailVerified);
    if (gate) {
      return fail(
        gate.status,
        gate.code,
        undefined,
        gate.retryAfterSec
          ? { "Retry-After": String(gate.retryAfterSec) }
          : undefined,
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return err(422, "invalid body");
    const {
      name,
      websiteUrl,
      tagline,
      description,
      category,
      founderName,
      founderHandle,
      contactEmail,
    } = body as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim())
      return err(422, "name required");
    if (typeof websiteUrl !== "string" || !websiteUrl.trim())
      return err(422, "websiteUrl required");

    const domain = normalizeDomain(websiteUrl);
    if (!domain) return err(422, "websiteUrl invalid");
    const dup = await queries.findProfileByDomain(domain);
    if (dup) return fail(409, "dup_domain", { existingSlug: dup.slug });

    // Queue into the upcoming (open) cohort.
    const cohort = await ensureUpcomingCohort();
    const profile = await queries.createProfile({
      cohortId: cohort.id,
      submittedByUserId: actor.userId,
      name: name.trim(),
      websiteUrl: websiteUrl.trim(),
      domain,
      tagline: typeof tagline === "string" ? tagline : null,
      description: typeof description === "string" ? description : null,
      category: typeof category === "string" ? category : null,
      founderName: typeof founderName === "string" ? founderName : null,
      founderHandle: typeof founderHandle === "string" ? founderHandle : null,
      contactEmail: typeof contactEmail === "string" ? contactEmail : null,
      status: "pending_review",
    });
    return NextResponse.json(
      {
        submissionId: profile.id,
        slug: profile.slug,
        status: "pending_review",
        cohortId: cohort.id,
      },
      { status: 201 },
    );
  }

  // POST /profiles/:slug/upvote
  if (resource === "profiles" && a && b === "upvote") {
    if (!hasScope(actor, "launch:vote")) return fail(403, "insufficient_scope");
    const profile = await queries.getProfileBySlug(a);
    if (!profile) return err(404, "Not found");

    // Voting is only open while the profile's cohort is in the voting window.
    const cohort = profile.cohortId
      ? await queries.getCohortById(profile.cohortId)
      : undefined;
    if (!cohort || cohort.state !== "voting") return fail(423, "voting_closed");

    const gate = await assertCanVote(
      actor.userId,
      actor.emailVerified,
      extractSourceIp(request.headers),
    );
    if (gate) {
      return fail(
        gate.status,
        gate.code,
        undefined,
        gate.retryAfterSec
          ? { "Retry-After": String(gate.retryAfterSec) }
          : undefined,
      );
    }

    try {
      await queries.createVote({
        profileId: profile.id,
        voterUserId: actor.userId,
        ipAddress: extractSourceIp(request.headers),
      });
    } catch (e) {
      if (e instanceof DuplicateVoteError) {
        return fail(409, "already_voted", {
          slug: profile.slug,
          upvoteCount: profile.upvoteCount,
          hasVoted: true,
        });
      }
      throw e;
    }
    const upvoteCount = await queries.recomputeUpvoteCount(profile.id);
    return NextResponse.json({
      slug: profile.slug,
      upvoteCount,
      hasVoted: true,
    });
  }

  return err(404, "Not found");
}

// ============================================
// DELETE (user token required) — un-vote
// ============================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a, b] = path;
  const actor = await resolveActor(request);
  if (!actor) return err(401, "Unauthorized");

  if (resource === "profiles" && a && b === "upvote") {
    if (!hasScope(actor, "launch:vote")) return fail(403, "insufficient_scope");
    const profile = await queries.getProfileBySlug(a);
    if (!profile) return err(404, "Not found");
    await queries.deleteVote(profile.id, actor.userId);
    const upvoteCount = await queries.recomputeUpvoteCount(profile.id);
    return NextResponse.json({
      slug: profile.slug,
      upvoteCount,
      hasVoted: false,
    });
  }

  return err(404, "Not found");
}

// ============================================
// PATCH (admin role required)
// ============================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a] = path;
  const actor = await resolveActor(request);
  if (!actor) return err(401, "Unauthorized");
  if (!isAdmin(actor)) return err(403, "Forbidden: Admin access required");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return err(422, "invalid body");
  const patchBody = body as Record<string, unknown>;

  // PATCH /profiles/:slug — attach report/walkthrough, feature, edit
  if (resource === "profiles" && a) {
    const profile = await queries.getProfileBySlug(a);
    if (!profile) return err(404, "Not found");

    const patch: Record<string, unknown> = {};
    // `featured: true|false` is a convenience over setting status.
    if (typeof patchBody.featured === "boolean") {
      patch.status = patchBody.featured ? "featured" : "pending_review";
    }
    if (typeof patchBody.status === "string") {
      if (!(PROFILE_STATUSES as string[]).includes(patchBody.status))
        return err(422, "invalid status");
      patch.status = patchBody.status;
    }
    if (
      typeof patchBody.testReportShareUrl === "string" ||
      patchBody.testReportShareUrl === null
    ) {
      patch.testReportShareUrl = patchBody.testReportShareUrl;
    }
    if (
      patchBody.walkthrough === null ||
      (patchBody.walkthrough && typeof patchBody.walkthrough === "object")
    ) {
      if (
        patchBody.walkthrough &&
        typeof (patchBody.walkthrough as Record<string, unknown>).src !==
          "string"
      ) {
        return err(422, "walkthrough.src required");
      }
      patch.walkthrough = patchBody.walkthrough;
    }
    if (typeof patchBody.cohortId === "string" || patchBody.cohortId === null) {
      if (
        typeof patchBody.cohortId === "string" &&
        !(await queries.getCohortById(patchBody.cohortId))
      ) {
        return err(422, "unknown cohortId");
      }
      patch.cohortId = patchBody.cohortId;
    }
    for (const field of [
      "name",
      "tagline",
      "description",
      "category",
      "logoUrl",
      "founderName",
      "founderHandle",
    ] as const) {
      if (typeof patchBody[field] === "string") patch[field] = patchBody[field];
    }
    if (typeof patchBody.flagged === "boolean")
      patch.flagged = patchBody.flagged;

    if (Object.keys(patch).length === 0) return err(422, "no updatable fields");
    const updated = await queries.updateProfile(a, patch);
    return NextResponse.json({ profile: serializeProfile(updated!) });
  }

  // PATCH /cohorts/:id — state/winner override + monthly winner
  if (resource === "cohorts" && a) {
    const cohort = await queries.getCohortById(a);
    if (!cohort) return err(404, "Not found");

    // Set "Tested Startup of the Month".
    if (
      patchBody.monthlyWinner &&
      typeof patchBody.monthlyWinner === "object"
    ) {
      const mw = patchBody.monthlyWinner as Record<string, unknown>;
      if (typeof mw.month !== "string" || typeof mw.profileSlug !== "string") {
        return err(422, "monthlyWinner requires {month, profileSlug}");
      }
      await queries.setMonthlyWinner(mw.month, mw.profileSlug);
    }
    // Trigger an immediate lock + winner decision.
    if (patchBody.lock === true) {
      const winner = await lockCohortNow(cohort.id);
      const fresh = await queries.getCohortById(cohort.id);
      return NextResponse.json({
        cohort: serializeCohort(fresh!),
        winnerSlug: winner,
      });
    }
    if (typeof patchBody.state === "string") {
      if (!(COHORT_STATES as string[]).includes(patchBody.state))
        return err(422, "invalid state");
      await queries.setCohortState(
        cohort.id,
        patchBody.state as LaunchCohortState,
      );
    }
    if (typeof patchBody.winnerSlug === "string") {
      await queries.lockCohortWinner(cohort.id, patchBody.winnerSlug);
    }
    const fresh = await queries.getCohortById(cohort.id);
    return NextResponse.json({ cohort: serializeCohort(fresh!) });
  }

  return err(404, "Not found");
}
