/**
 * Actor resolution for the **public board APIs** — `/api/v1/launch` and
 * `/api/v1/playground`, which serve the static lastest-www frontends.
 *
 * These routes are unlike every other API surface in the app: reads are public
 * (no 401 for a missing token), and mutations authenticate with a short-lived
 * scoped handoff token minted by `/oauth/authorize` (`sessions.kind =
 * 'launch'`) rather than with a team-scoped API key or a repo. There is no
 * tenant anywhere in the flow — the unit of authorization is a *person* and a
 * *scope*.
 *
 * Core rather than a feature module, for the same reason as
 * `@/lib/auth/oauth-clients`: this is the code that turns a bearer token into
 * an identity and decides whether it is allowed to act. It was
 * `src/lib/launch/api-shared.ts` — named for the first feature that needed it,
 * already shared with playground, and moved here by the `launch` plugin
 * migration (RFC §9 phase 4).
 */

import type { NextRequest } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";

import { scopeIncludes } from "./oauth-clients";

export interface Actor {
  userId: string;
  emailVerified: boolean;
  role: string;
  scope: string | null; // null = cookie/api token (staff); set = launch token
}

/**
 * Resolve the caller. Bearer token first (so we can read its scope), then a
 * cookie session (staff using the app directly). Returns null if neither.
 */
export async function resolveActor(
  request: NextRequest,
): Promise<Actor | null> {
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

// A scoped token must carry the required scope; a null-scope token
// (cookie session or api token used by staff/tests) is allowed through.
export function hasScope(actor: Actor, required: string): boolean {
  if (actor.scope === null) return true;
  return scopeIncludes(actor.scope, required);
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === "admin" || actor.role === "owner";
}
