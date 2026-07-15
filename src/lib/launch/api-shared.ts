/**
 * Shared actor-resolution + response helpers for the public board APIs
 * (/api/v1/launch, /api/v1/playground). Both routes serve the static
 * lastest-www frontends: reads are public, mutations require a scoped
 * handoff token minted by /oauth/authorize (sessions.kind = 'launch').
 */

import { NextRequest, NextResponse } from "next/server";
import * as queries from "@/lib/db/queries";
import { getCurrentSession } from "@/lib/auth";
import { scopeIncludes } from "./oauth-config";

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

export function err(
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
// The playground frontend additionally uses: insufficient_scope,
// email_unverified, velocity_exceeded.
export function fail(
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
