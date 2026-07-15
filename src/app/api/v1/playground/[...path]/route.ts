/**
 * REST API v1 for the /playground score & leaderboard.
 *
 * Sibling of /api/v1/launch: serves the static lastest-www playground pages,
 * which persist nothing themselves. Reads are public (the leaderboard renders
 * anonymously); mutations require a `playground:score` handoff token minted by
 * /oauth/authorize for client `playground-www`. The achievement registry is
 * vendored server-side (src/lib/playground/registry.ts) — points always come
 * from it, never from the request body.
 *
 * Endpoints (base /api/v1/playground):
 *   GET  /leaderboard?limit=50  - ranked board (bearer optional → isMe/me)
 *   GET  /me                    - caller's points, rank, achievements
 *   POST /progress              - idempotent upsert of locally-earned achievements
 */

import { NextRequest, NextResponse } from "next/server";
import * as queries from "@/lib/db/queries";
import { resolveActor, hasScope, err, fail } from "@/lib/launch/api-shared";
import { PLAYGROUND_SCOPE } from "@/lib/launch/oauth-config";
import { ACHIEVEMENT_POINTS, scoreFor } from "@/lib/playground/registry";
import { getBoard, invalidateBoardCache } from "@/lib/playground/leaderboard";
import { DEFAULT_PLAYGROUND } from "@/lib/db/schema";
import { check as rateLimitCheck } from "@/lib/rate-limit/limiter";

export const dynamic = "force-dynamic";

const ONE_HOUR_MS = 3_600_000;
// Sanity cap on a single push — the whole registry is 75 ids; anything past
// this is abuse or a broken client, not a legitimate sync.
const MAX_ITEMS_PER_PUSH = 500;

function earnedAtISO(row: { earnedAt: Date | null; createdAt: Date | null }) {
  return (row.earnedAt ?? row.createdAt ?? new Date()).toISOString();
}

// ============================================
// GET (public; bearer optional → isMe/me)
// ============================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a] = path;
  const actor = await resolveActor(request).catch(() => null);

  // GET /leaderboard?limit=50
  if (resource === "leaderboard" && !a) {
    const rawLimit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") ?? "",
      10,
    );
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), DEFAULT_PLAYGROUND.leaderboardMaxLimit)
      : DEFAULT_PLAYGROUND.leaderboardDefaultLimit;

    const board = await getBoard();
    const entries = board.slice(0, limit).map((u) => ({
      rank: u.rank,
      // Never expose emails — display name only (users table has no handle).
      name: u.name ?? "Anonymous",
      points: u.points,
      completedExercises: u.completedExercises,
      ...(actor && u.userId === actor.userId ? { isMe: true } : {}),
    }));

    // `me` rides along whenever the caller is authed; the frontend only
    // renders it when the caller fell outside the returned window.
    const mine = actor ? board.find((u) => u.userId === actor.userId) : null;
    return NextResponse.json({
      entries,
      total: board.length,
      updatedAtISO: new Date().toISOString(),
      ...(actor
        ? { me: mine ? { rank: mine.rank, points: mine.points } : null }
        : {}),
    });
  }

  // GET /me
  if (resource === "me" && !a) {
    if (!actor) return err(401, "Unauthorized");
    if (!hasScope(actor, PLAYGROUND_SCOPE))
      return fail(403, "insufficient_scope");

    const rows = await queries.getPlaygroundAchievementsByUser(actor.userId);
    const { points } = scoreFor(new Set(rows.map((r) => r.achievementId)));
    const board = await getBoard();
    const rank =
      points > 0
        ? (board.find((u) => u.userId === actor.userId)?.rank ?? null)
        : null;
    const user = await queries.getUserById(actor.userId);
    return NextResponse.json({
      points,
      rank,
      ...(user?.name ? { displayName: user.name } : {}),
      achievements: rows.map((r) => ({
        id: r.achievementId,
        earnedAtISO: earnedAtISO(r),
      })),
    });
  }

  return err(404, "Not found");
}

// ============================================
// POST /progress (playground:score; gated)
// ============================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path ?? [];
  const [resource, a] = path;
  if (resource !== "progress" || a) return err(404, "Not found");

  const actor = await resolveActor(request);
  if (!actor) return err(401, "Unauthorized");
  if (!hasScope(actor, PLAYGROUND_SCOPE))
    return fail(403, "insufficient_scope");
  if (!actor.emailVerified) return fail(403, "email_unverified");

  const rl = rateLimitCheck(
    `playground-progress:${actor.userId}`,
    DEFAULT_PLAYGROUND.progressPostsPerAccountPerMinute,
    60_000,
  );
  if (!rl.allowed) {
    return fail(429, "velocity_exceeded", undefined, {
      "Retry-After": String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
    });
  }

  const body = await request.json().catch(() => null);
  const items = (body as { achievements?: unknown } | null)?.achievements;
  if (!body || typeof body !== "object" || !Array.isArray(items)) {
    return err(422, "achievements array required");
  }
  if (items.length > MAX_ITEMS_PER_PUSH) {
    return err(422, `at most ${MAX_ITEMS_PER_PUSH} achievements per push`);
  }

  // Unknown/retired ids are ignored (never a 422) — the frontend registry may
  // be newer or older than the vendored copy. Points come from the registry.
  const seen = new Set<string>();
  const candidates: { id: string; earnedAtEpochMs: number }[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return err(422, "invalid item");
    const { id, earnedAtEpochMs } = item as Record<string, unknown>;
    if (typeof id !== "string") return err(422, "item id required");
    if (!(id in ACHIEVEMENT_POINTS) || seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      earnedAtEpochMs:
        typeof earnedAtEpochMs === "number" && Number.isFinite(earnedAtEpochMs)
          ? earnedAtEpochMs
          : Date.now(),
    });
  }

  const user = await queries.getUserById(actor.userId);
  if (!user) return err(401, "Unauthorized");

  const held = new Set(
    (await queries.getPlaygroundAchievementsByUser(actor.userId)).map(
      (r) => r.achievementId,
    ),
  );
  const fresh = candidates.filter((c) => !held.has(c.id));

  let accepted = 0;
  if (fresh.length > 0) {
    const recent = await queries.countPlaygroundAchievementsSince(
      actor.userId,
      new Date(Date.now() - ONE_HOUR_MS),
    );
    if (
      recent + fresh.length >
      DEFAULT_PLAYGROUND.achievementsPerAccountPerHour
    ) {
      return fail(429, "velocity_exceeded", undefined, {
        "Retry-After": "3600",
      });
    }

    // earnedAtEpochMs is client-reported and untrusted — clamp to
    // [account creation, now]; created_at (server time) breaks ties.
    const now = Date.now();
    const minMs = user.createdAt?.getTime() ?? 0;
    accepted = await queries.insertPlaygroundAchievements(
      actor.userId,
      fresh.map((c) => ({
        achievementId: c.id,
        points: ACHIEVEMENT_POINTS[c.id],
        earnedAt: new Date(Math.min(Math.max(c.earnedAtEpochMs, minMs), now)),
      })),
    );
    if (accepted > 0) invalidateBoardCache();
  }

  const rows = await queries.getPlaygroundAchievementsByUser(actor.userId);
  const { points } = scoreFor(new Set(rows.map((r) => r.achievementId)));
  const board = await getBoard();
  const rank =
    points > 0
      ? (board.find((u) => u.userId === actor.userId)?.rank ?? null)
      : null;
  return NextResponse.json({ accepted, points, rank });
}
