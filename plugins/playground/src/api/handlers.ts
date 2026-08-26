/**
 * REST API v1 for the /playground score & leaderboard.
 *
 * Sibling of `@lastest/plugin-launch`'s: serves the static lastest-www
 * playground pages, which persist nothing themselves. Reads are public (the
 * leaderboard renders anonymously); mutations require a `playground:score`
 * handoff token minted by /oauth/authorize for client `playground-www`. The
 * achievement registry is vendored server-side (`../registry.ts`) — points
 * always come from it, never from the request body.
 *
 * Endpoints (base /api/v1/playground):
 *   GET  /leaderboard?limit=50  - ranked board (bearer optional → isMe/me)
 *   GET  /me                    - caller's points, rank, achievements
 *   POST /progress              - idempotent upsert of locally-earned achievements
 *
 * Ported from `src/app/api/v1/playground/[...path]/route.ts`, which now
 * re-exports these by name. Three call shapes changed and nothing else did:
 * `queries.*` became this plugin's own `../data/queries` bound to the scoped
 * handle, `resolveActor`/`rateLimitCheck`/`getUserById` became host methods,
 * and `DEFAULT_PLAYGROUND` became `PLAYGROUND_CONFIG`.
 */

import { NextRequest, NextResponse } from "next/server";

import { PLAYGROUND_CONFIG, PLAYGROUND_SCOPES } from "../config";
import { db } from "../data/db";
import {
  countAchievementsSince,
  insertAchievements,
  listAchievementsByUser,
} from "../data/queries";
import { getBoard, invalidateBoardCache } from "../domain/leaderboard";
import type { PlaygroundActor } from "../host";
import { ACHIEVEMENT_POINTS, scoreFor } from "../registry";
import { playgroundWiring } from "../wiring";
import { err, fail } from "./responses";

const ONE_HOUR_MS = 3_600_000;

function earnedAtISO(row: { earnedAt: Date | null; createdAt: Date | null }) {
  return (row.earnedAt ?? row.createdAt ?? new Date()).toISOString();
}

/**
 * Scope enforcement stays in the plugin: the host hands over `scopes` already
 * parsed, and whether `playground:score` has to be among them is this
 * feature's policy, not the app's. `scopes === null` means an unscoped
 * credential (staff cookie session or API token), which passes — same rule as
 * the `hasScope` in `@/lib/auth/board-actor` that this replaces.
 */
function hasScope(actor: PlaygroundActor, required: string): boolean {
  return actor.scopes === null || actor.scopes.includes(required);
}

function actorFrom(request: NextRequest): Promise<PlaygroundActor | null> {
  return playgroundWiring().host.resolveActor(
    request.headers.get("authorization"),
  );
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
  const actor = await actorFrom(request).catch(() => null);

  // GET /leaderboard?limit=50
  if (resource === "leaderboard" && !a) {
    const rawLimit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") ?? "",
      10,
    );
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), PLAYGROUND_CONFIG.leaderboardMaxLimit)
      : PLAYGROUND_CONFIG.leaderboardDefaultLimit;

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
    if (!hasScope(actor, PLAYGROUND_SCOPES.score))
      return fail(403, "insufficient_scope");

    const rows = await listAchievementsByUser(db(), actor.userId);
    const { points } = scoreFor(new Set(rows.map((r) => r.achievementId)));
    const board = await getBoard();
    const rank =
      points > 0
        ? (board.find((u) => u.userId === actor.userId)?.rank ?? null)
        : null;
    const user = (
      await playgroundWiring().host.resolveUsers([actor.userId])
    ).get(actor.userId);
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

  const { host } = playgroundWiring();

  const actor = await actorFrom(request);
  if (!actor) return err(401, "Unauthorized");
  if (!hasScope(actor, PLAYGROUND_SCOPES.score))
    return fail(403, "insufficient_scope");
  if (!actor.emailVerified) return fail(403, "email_unverified");

  const rl = host.rateLimit(
    `playground-progress:${actor.userId}`,
    PLAYGROUND_CONFIG.progressPostsPerAccountPerMinute,
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
  if (items.length > PLAYGROUND_CONFIG.maxItemsPerPush) {
    return err(
      422,
      `at most ${PLAYGROUND_CONFIG.maxItemsPerPush} achievements per push`,
    );
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

  const user = (await host.resolveUsers([actor.userId])).get(actor.userId);
  if (!user) return err(401, "Unauthorized");

  const orm = db();
  const held = new Set(
    (await listAchievementsByUser(orm, actor.userId)).map(
      (r) => r.achievementId,
    ),
  );
  const fresh = candidates.filter((c) => !held.has(c.id));

  let accepted = 0;
  if (fresh.length > 0) {
    const recent = await countAchievementsSince(
      orm,
      actor.userId,
      new Date(Date.now() - ONE_HOUR_MS),
    );
    if (
      recent + fresh.length >
      PLAYGROUND_CONFIG.achievementsPerAccountPerHour
    ) {
      return fail(429, "velocity_exceeded", undefined, {
        "Retry-After": "3600",
      });
    }

    // earnedAtEpochMs is client-reported and untrusted — clamp to
    // [account creation, now]; created_at (server time) breaks ties.
    const now = Date.now();
    const minMs = user.createdAtMs ?? 0;
    accepted = await insertAchievements(
      orm,
      actor.userId,
      fresh.map((c) => ({
        achievementId: c.id,
        points: ACHIEVEMENT_POINTS[c.id],
        earnedAt: new Date(Math.min(Math.max(c.earnedAtEpochMs, minMs), now)),
      })),
    );
    if (accepted > 0) invalidateBoardCache();
  }

  const rows = await listAchievementsByUser(orm, actor.userId);
  const { points } = scoreFor(new Set(rows.map((r) => r.achievementId)));
  const board = await getBoard();
  const rank =
    points > 0
      ? (board.find((u) => u.userId === actor.userId)?.rank ?? null)
      : null;
  return NextResponse.json({ accepted, points, rank });
}
