/**
 * REST API v1 for the launch.lastest.cloud directory.
 *
 * The whole route body lives in the plugin; `src/app/api/v1/launch/[...path]/
 * route.ts` is a five-line re-export. That is the `plugin-migration-recipe.md`
 * §6 pattern applied to an API route rather than a page: the app owns the URL,
 * the plugin owns the behaviour. There is nothing for the app to *compose*
 * here — no selected repository, no plan gate, no app UI to hand down — so the
 * app side keeps only the file-system routing.
 *
 * Distinct from the parent `/api/v1/[...slug]` catch-all in one important way:
 * **reads are public** (no 401 for a missing token) so the static frontend and
 * the build-time snapshot script can fetch cohorts/profiles anonymously. A
 * bearer token is optional on reads (only used to populate `hasVoted`) and
 * required on mutations. That nested route wins over the parent catch-all
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

import { LAUNCH_CONFIG, LAUNCH_SCOPES } from "../config";
import { db as pluginDb } from "../data/db";
import type { LaunchDb } from "../data/db";
import {
  DuplicateVoteError,
  addReaction,
  createComment,
  createProfile,
  createVote,
  deleteVote,
  findProfileByDomain,
  getCohortById,
  getCohortsByState,
  getCommentById,
  getCommentsForProfile,
  getCurrentCohort,
  getMonthlyWinners,
  getProfileBySlug,
  getProfileEventStats,
  getReactionsForProfile,
  getUserVotedProfileIds,
  hasRecentEvent,
  hasUserVoted,
  listFeaturedProfilesByCohort,
  lockCohortWinner,
  normalizeDomain,
  recomputeUpvoteCount,
  recordEvent,
  removeReaction,
  setCohortState,
  setMonthlyWinner,
  softDeleteComment,
  updateProfile,
  type CommentRow,
} from "../data/queries";
import { hashIp, hashUa, isBot } from "../domain/analytics";
import { ensureUpcomingCohort, lockCohortNow } from "../domain/cohort-engine";
import {
  assertCanComment,
  assertCanSubmit,
  assertCanVote,
} from "../domain/gating";
import {
  serializeCohort,
  serializeComment,
  serializeMonthlyWinner,
  serializeProfile,
  serializeReactions,
} from "../domain/serialize";
import { rankProfiles } from "../domain/velocity";
import type { LaunchActor } from "../host";
import type {
  LaunchCohort,
  LaunchCohortState,
  LaunchProfileStatus,
} from "../schema";
import { launchWiring } from "../wiring";
import { err, fail } from "./responses";

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

/**
 * Scope enforcement, kept in the plugin rather than on the host port.
 *
 * The host hands back `scopes` already parsed; deciding that an upvote needs
 * `launch:vote` is this feature's policy, not the app's. `scopes === null`
 * means an unscoped credential (staff cookie session or API token), which
 * passes — same rule as the `hasScope` this replaces.
 */
function hasScope(actor: LaunchActor, required: string): boolean {
  return actor.scopes === null || actor.scopes.includes(required);
}

function actorFrom(request: NextRequest): Promise<LaunchActor | null> {
  return launchWiring().host.resolveActor(request.headers.get("authorization"));
}

/**
 * Fill in comment author display names.
 *
 * This is the one thing the migration could not carry over untouched: the
 * query used to `leftJoin(users)`, and `users` is a core table no plugin may
 * read (`core-scope.md` §6). One batched host call per response replaces one
 * join — a second round trip, not an N+1.
 */
async function serializeComments(
  rows: CommentRow[],
  viewerUserId?: string,
): Promise<ReturnType<typeof serializeComment>[]> {
  if (rows.length === 0) return [];
  const names = await launchWiring().host.resolveUserNames(
    rows.map((r) => r.authorUserId),
  );
  return rows.map((r) =>
    serializeComment(r, names.get(r.authorUserId) ?? null, viewerUserId),
  );
}

// Detail payload: nested { cohort, profiles } — used by /cohorts/current and
// /cohorts/:id, which the live client (fetchCurrentCohort) expects nested.
async function cohortPayload(
  db: LaunchDb,
  cohort: LaunchCohort,
  votedSet: Set<string>,
) {
  const featured = await listFeaturedProfilesByCohort(db, cohort.id);
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
async function flatCohortPayload(db: LaunchDb, cohort: LaunchCohort) {
  const featured = await listFeaturedProfilesByCohort(db, cohort.id);
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
  const db = pluginDb();
  const path = (await params).path ?? [];
  const [resource, a, b] = path;
  const actor = await actorFrom(request).catch(() => null);

  // GET /winners/monthly → top-level array of { slug, month } (build script reads `.slug`).
  if (resource === "winners" && a === "monthly") {
    const winners = await getMonthlyWinners(db);
    return NextResponse.json(winners.map(serializeMonthlyWinner));
  }

  // GET /profiles/:slug → bare profile object (frontend fetchProfile reads top-level).
  if (resource === "profiles" && a && !b) {
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");
    const hasVoted = actor
      ? await hasUserVoted(db, profile.id, actor.userId)
      : false;
    return NextResponse.json(serializeProfile(profile, { hasVoted }));
  }

  // GET /profiles/:slug/comments
  if (resource === "profiles" && a && b === "comments") {
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");
    const rows = await getCommentsForProfile(db, profile.id);
    const comments = await serializeComments(rows, actor?.userId);
    return NextResponse.json({ comments, total: comments.length });
  }

  // GET /profiles/:slug/reactions
  if (resource === "profiles" && a && b === "reactions") {
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");
    const summary = await getReactionsForProfile(db, profile.id, actor?.userId);
    return NextResponse.json(serializeReactions(summary));
  }

  // GET /profiles/:slug/stats — owner or admin only
  if (resource === "profiles" && a && b === "stats") {
    if (!actor) return err(401, "Unauthorized");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");
    if (profile.submittedByUserId !== actor.userId && !actor.isAdmin) {
      return err(403, "Forbidden");
    }
    const stats = await getProfileEventStats(db, profile.id);
    return NextResponse.json({ slug: profile.slug, ...stats });
  }

  if (resource === "cohorts") {
    // GET /cohorts/current
    if (a === "current") {
      const cohort = await getCurrentCohort(db);
      if (!cohort) return NextResponse.json({ cohort: null, profiles: [] });
      const featured = await listFeaturedProfilesByCohort(db, cohort.id);
      const votedSet =
        actor && featured.length
          ? await getUserVotedProfileIds(
              db,
              actor.userId,
              featured.map((p) => p.id),
            )
          : new Set<string>();
      return NextResponse.json(await cohortPayload(db, cohort, votedSet));
    }

    // GET /cohorts/:id  (+ optional ?include=profiles)
    if (a) {
      const cohort = await getCohortById(db, a);
      if (!cohort) return err(404, "Not found");
      const include =
        request.nextUrl.searchParams.get("include") === "profiles";
      if (!include)
        return NextResponse.json({ cohort: serializeCohort(cohort) });
      const featured = await listFeaturedProfilesByCohort(db, cohort.id);
      const votedSet =
        actor && featured.length
          ? await getUserVotedProfileIds(
              db,
              actor.userId,
              featured.map((p) => p.id),
            )
          : new Set<string>();
      return NextResponse.json(await cohortPayload(db, cohort, votedSet));
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
    const cohorts = await getCohortsByState(db, states);
    if (!include) {
      return NextResponse.json({ cohorts: cohorts.map(serializeCohort) });
    }
    const withProfiles = [];
    for (const cohort of cohorts) {
      withProfiles.push(await flatCohortPayload(db, cohort));
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
  const { host } = launchWiring();
  const db = pluginDb();
  const path = (await params).path ?? [];
  const [resource, a, b] = path;

  // POST /profiles/:slug/events — unauthenticated; must be handled before actor check.
  if (resource === "profiles" && a && b === "events") {
    try {
      const body: Record<string, unknown> | null = await request
        .json()
        .catch(() => null);
      const type = body?.type as string | undefined;
      if (type !== "view" && type !== "visit")
        return new NextResponse(null, { status: 204 });

      const ip = host.sourceIp(request.headers) ?? "unknown";
      const ua = request.headers.get("user-agent");

      if (isBot(ua)) return new NextResponse(null, { status: 204 });

      const ipHash = hashIp(ip);
      const allowed = host.rateLimit(
        `launch-event:${ipHash}`,
        LAUNCH_CONFIG.eventsPerIpPerMinute,
        60_000,
      );
      if (!allowed) return new NextResponse(null, { status: 204 });

      const profile = await getProfileBySlug(db, a);
      if (!profile) return new NextResponse(null, { status: 204 });

      // Skip self-views: resolve actor but don't require it
      const actor = await actorFrom(request).catch(() => null);
      if (actor && profile.submittedByUserId === actor.userId) {
        return new NextResponse(null, { status: 204 });
      }

      const alreadySeen = await hasRecentEvent(db, {
        profileId: profile.id,
        type,
        ipHash,
        windowSec: LAUNCH_CONFIG.eventDedupeWindowSec,
      });
      if (alreadySeen) return new NextResponse(null, { status: 204 });

      await recordEvent(db, {
        profileId: profile.id,
        type,
        ipHash,
        uaHash: ua ? hashUa(ua) : undefined,
      });
    } catch {
      // fail-soft: always 204
    }
    return new NextResponse(null, { status: 204 });
  }

  const actor = await actorFrom(request);
  if (!actor) return err(401, "Unauthorized");

  // POST /submissions
  if (resource === "submissions" && !a) {
    if (!hasScope(actor, LAUNCH_SCOPES.submit))
      return fail(403, "insufficient_scope");
    const gate = await assertCanSubmit(db, actor.userId, actor.emailVerified);
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
    const dup = await findProfileByDomain(db, domain);
    if (dup) return fail(409, "dup_domain", { existingSlug: dup.slug });

    // Queue into the upcoming (open) cohort.
    const cohort = await ensureUpcomingCohort(db);
    const profile = await createProfile(db, {
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

  // POST /profiles/:slug/comments
  if (resource === "profiles" && a && b === "comments") {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");

    const gate = await assertCanComment(db, actor.userId, actor.emailVerified);
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
    const text = (body as Record<string, unknown>).body;
    if (typeof text !== "string" || !text.trim())
      return err(422, "body required");
    if (text.trim().length > LAUNCH_CONFIG.commentMaxLength) {
      return err(
        422,
        `body must be ${LAUNCH_CONFIG.commentMaxLength} chars or fewer`,
      );
    }

    const row = await createComment(db, {
      profileId: profile.id,
      authorUserId: actor.userId,
      body: text,
      ipAddress: host.sourceIp(request.headers),
    });
    const rows = await getCommentsForProfile(db, profile.id);
    const [comment] = await serializeComments([row], actor.userId);
    return NextResponse.json({ comment, total: rows.length }, { status: 201 });
  }

  // POST /profiles/:slug/reactions
  if (resource === "profiles" && a && b === "reactions") {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    if (!actor.emailVerified) return fail(403, "email_unverified");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return err(422, "invalid body");
    const emoji = (body as Record<string, unknown>).emoji;
    if (typeof emoji !== "string") return err(422, "emoji required");
    if (
      !(LAUNCH_CONFIG.allowedReactions as readonly string[]).includes(emoji)
    ) {
      return err(422, "emoji not allowed");
    }

    await addReaction(db, {
      profileId: profile.id,
      reactorUserId: actor.userId,
      emoji,
    });
    const summary = await getReactionsForProfile(db, profile.id, actor.userId);
    return NextResponse.json({
      emoji,
      counts: summary.counts,
      hasReacted: true,
      mine: summary.mine,
    });
  }

  // POST /profiles/:slug/upvote
  if (resource === "profiles" && a && b === "upvote") {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");

    // Voting is only open while the profile's cohort is in the voting window.
    const cohort = profile.cohortId
      ? await getCohortById(db, profile.cohortId)
      : undefined;
    if (!cohort || cohort.state !== "voting") return fail(423, "voting_closed");

    const gate = await assertCanVote(
      db,
      actor.userId,
      actor.emailVerified,
      host.sourceIp(request.headers),
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
      await createVote(db, {
        profileId: profile.id,
        voterUserId: actor.userId,
        ipAddress: host.sourceIp(request.headers),
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
    const upvoteCount = await recomputeUpvoteCount(db, profile.id);
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
  const db = pluginDb();
  const path = (await params).path ?? [];
  const [resource, a, b] = path;
  const actor = await actorFrom(request);
  if (!actor) return err(401, "Unauthorized");

  if (resource === "profiles" && a && b === "upvote") {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");
    await deleteVote(db, profile.id, actor.userId);
    const upvoteCount = await recomputeUpvoteCount(db, profile.id);
    return NextResponse.json({
      slug: profile.slug,
      upvoteCount,
      hasVoted: false,
    });
  }

  // DELETE /comments/:id — soft-delete; author or admin only
  if (resource === "comments" && a && !b) {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    const comment = await getCommentById(db, a);
    if (!comment || comment.deletedAt) return err(404, "Not found");
    if (comment.authorUserId !== actor.userId && !actor.isAdmin) {
      return err(403, "Forbidden");
    }
    await softDeleteComment(db, a);
    return NextResponse.json({ ok: true });
  }

  // DELETE /profiles/:slug/reactions
  if (resource === "profiles" && a && b === "reactions") {
    if (!hasScope(actor, LAUNCH_SCOPES.vote))
      return fail(403, "insufficient_scope");
    if (!actor.emailVerified) return fail(403, "email_unverified");
    const profile = await getProfileBySlug(db, a);
    if (!profile) return err(404, "Not found");

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return err(422, "invalid body");
    const emoji = (body as Record<string, unknown>).emoji;
    if (typeof emoji !== "string") return err(422, "emoji required");

    await removeReaction(db, {
      profileId: profile.id,
      reactorUserId: actor.userId,
      emoji,
    });
    const summary = await getReactionsForProfile(db, profile.id, actor.userId);
    return NextResponse.json({
      emoji,
      counts: summary.counts,
      hasReacted: false,
      mine: summary.mine,
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
  const db = pluginDb();
  const path = (await params).path ?? [];
  const [resource, a] = path;
  const actor = await actorFrom(request);
  if (!actor) return err(401, "Unauthorized");
  if (!actor.isAdmin) return err(403, "Forbidden: Admin access required");

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return err(422, "invalid body");
  const patchBody = body as Record<string, unknown>;

  // PATCH /profiles/:slug — attach report/walkthrough, feature, edit
  if (resource === "profiles" && a) {
    const profile = await getProfileBySlug(db, a);
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
        !(await getCohortById(db, patchBody.cohortId))
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
    const updated = await updateProfile(db, a, patch);
    return NextResponse.json({ profile: serializeProfile(updated!) });
  }

  // PATCH /cohorts/:id — state/winner override + monthly winner
  if (resource === "cohorts" && a) {
    const cohort = await getCohortById(db, a);
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
      await setMonthlyWinner(db, mw.month, mw.profileSlug);
    }
    // Trigger an immediate lock + winner decision.
    if (patchBody.lock === true) {
      const winner = await lockCohortNow(db, cohort.id);
      const fresh = await getCohortById(db, cohort.id);
      return NextResponse.json({
        cohort: serializeCohort(fresh!),
        winnerSlug: winner,
      });
    }
    if (typeof patchBody.state === "string") {
      if (!(COHORT_STATES as string[]).includes(patchBody.state))
        return err(422, "invalid state");
      await setCohortState(db, cohort.id, patchBody.state as LaunchCohortState);
    }
    if (typeof patchBody.winnerSlug === "string") {
      await lockCohortWinner(db, cohort.id, patchBody.winnerSlug);
    }
    const fresh = await getCohortById(db, cohort.id);
    return NextResponse.json({ cohort: serializeCohort(fresh!) });
  }

  return err(404, "Not found");
}
