import "server-only";

import type { LaunchActor, LaunchHost } from "@lastest/plugin-launch/host";

import { isAdmin, resolveActor } from "@/lib/auth/board-actor";
import * as queries from "@/lib/db/queries";
import { check as rateLimitCheck } from "@/lib/rate-limit/limiter";
import { extractSourceIp } from "@/lib/security/outbound-url";

/**
 * The app's fill for `LaunchHost`.
 *
 * Four adapters, no new behaviour — each is the call the pre-plugin
 * `src/app/api/v1/launch/[...path]/route.ts` made inline, moved to the one side
 * of the boundary that is allowed to make it.
 *
 * The interesting one is `resolveActor`. `@/lib/auth/board-actor` returns an
 * `Actor` carrying the raw `role` and the raw space-separated `scope` string;
 * what crosses the boundary is neither. The role becomes a boolean
 * (`isAdmin`) and the scope string becomes a parsed array, so the plugin
 * cannot invent a new role check or mis-parse a scope — it can only ask the
 * two questions the board actually asks.
 */
export const appLaunchHost: LaunchHost = {
  async resolveActor(
    authorization: string | null,
  ): Promise<LaunchActor | null> {
    // `resolveActor` reads the header off the request and falls back to the
    // cookie session. The plugin has no `NextRequest` to hand over — and
    // should not: it would carry cookies, which are a credential. A minimal
    // header-only stand-in is enough for the bearer path, and the cookie path
    // reads `headers()` from async storage on its own.
    const actor = await resolveActor({
      headers: new Headers(authorization ? { authorization } : undefined),
    } as Parameters<typeof resolveActor>[0]);
    if (!actor) return null;
    return {
      userId: actor.userId,
      emailVerified: actor.emailVerified,
      isAdmin: isAdmin(actor),
      // `null` scope = unscoped credential (staff cookie session or API token).
      // The plugin treats that as "passes every scope check", same as
      // `hasScope` did.
      scopes: actor.scope === null ? null : actor.scope.split(/\s+/),
    };
  },

  sourceIp(headers: Headers): string | null {
    return extractSourceIp(headers);
  },

  rateLimit(key: string, limit: number, windowMs: number): boolean {
    return rateLimitCheck(key, limit, windowMs).allowed;
  },

  async resolveUserNames(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    // Replaces a `leftJoin(users, …)` that used to live inside
    // `src/lib/db/queries/launch.ts`. A plugin may not read a core table at
    // all (`core-scope.md` §6), not even for a display name — so the join
    // became a batched lookup on this side of the line.
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const rows = await queries.getUsersByIds(unique);
    return new Map(rows.map((u) => [u.id, u.name ?? null]));
  },
};
