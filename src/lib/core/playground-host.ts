import "server-only";

import type {
  PlaygroundActor,
  PlaygroundHost,
  PlaygroundRateLimit,
  PlaygroundUser,
} from "@lastest/plugin-playground/host";

import { resolveActor } from "@/lib/auth/board-actor";
import * as queries from "@/lib/db/queries";
import { check as rateLimitCheck } from "@/lib/rate-limit/limiter";

/**
 * The app's fill for `PlaygroundHost`.
 *
 * Three adapters, no new behaviour — each is the call the pre-plugin
 * `src/app/api/v1/playground/[...path]/route.ts` made inline, moved to the one
 * side of the boundary that is allowed to make it.
 *
 * All three have a near-twin in `src/lib/core/launch-host.ts`, which is the
 * observation `plugins/playground/src/host.ts` is written around: two
 * untenanted plugins have now independently asked core for the same three
 * things, and a `core/identity` capability plus a rate-limit capability would
 * retire both files. Until then, keeping them as two explicit adapters is
 * better than a shared "board host" — the shared thing would be a boundary
 * whose reason for existing is that two callers happen to look alike, which is
 * the argument `core-scope.md` §1 rejects.
 */
export const appPlaygroundHost: PlaygroundHost = {
  async resolveActor(
    authorization: string | null,
  ): Promise<PlaygroundActor | null> {
    // Same stand-in request as `launch-host.ts`: `resolveActor` reads the
    // header and falls back to the cookie session (which it reads from async
    // storage itself). The plugin has no `NextRequest` to hand over — and
    // should not, because that would carry cookies, which are a credential.
    const actor = await resolveActor({
      headers: new Headers(authorization ? { authorization } : undefined),
    } as Parameters<typeof resolveActor>[0]);
    if (!actor) return null;
    return {
      userId: actor.userId,
      emailVerified: actor.emailVerified,
      // `null` scope = unscoped credential (staff cookie session or API
      // token), which passes every scope check — same rule as `hasScope`.
      scopes: actor.scope === null ? null : actor.scope.split(/\s+/),
    };
    // Note what is *not* here: `role`. The launch board needs `isAdmin` for
    // its staff endpoints; this one has none, so the role never crosses.
  },

  rateLimit(key: string, limit: number, windowMs: number): PlaygroundRateLimit {
    const { allowed, retryAfterMs } = rateLimitCheck(key, limit, windowMs);
    return { allowed, retryAfterMs };
  },

  async resolveUsers(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PlaygroundUser>> {
    // Replaces both an `innerJoin(users, …)` that used to live inside
    // `src/lib/db/queries/playground.ts` and a `getUserById` in the route. A
    // plugin may not read a core table at all (`core-scope.md` §6), not even
    // for a display name, so both became one batched lookup here.
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const rows = await queries.getUsersByIds(unique);
    return new Map(
      rows.map((u) => [
        u.id,
        { name: u.name ?? null, createdAtMs: u.createdAt?.getTime() ?? null },
      ]),
    );
  },
};
