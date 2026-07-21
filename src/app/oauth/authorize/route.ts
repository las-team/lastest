/**
 * Implicit OAuth authorize endpoint for the launch.lastest.cloud frontend.
 *
 * The static board can't hold a server session and the server API key must
 * never reach the browser, so we mint a short-lived, narrowly-scoped token
 * tied to the user's existing Lastest account and hand it back in the URL
 * fragment (kept out of logs vs. a query param). Flow:
 *   1. validate client_id + redirect_uri (allowlist) + response_type=token
 *   2. if unauthenticated → bounce through /login?returnTo=<this URL>
 *   3. mint a `launch`-kind session token (scope-limited, ~1h TTL)
 *   4. redirect to <redirect_uri>#token=…&expires_in=…&scope=…&state=…
 *
 * A PKCE code-exchange variant can layer on later (the frontend code is nearly
 * identical) — v1 ships implicit per product decision.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getCurrentSession } from "@/lib/auth";
import * as queries from "@/lib/db/queries";
import {
  isValidClientId,
  isAllowedRedirectUri,
  scopeForClient,
} from "@/lib/launch/oauth-config";
import { DEFAULT_LAUNCH } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const clientId = sp.get("client_id");
  const redirectUri = sp.get("redirect_uri");
  const responseType = sp.get("response_type") ?? "token";
  const state = sp.get("state") ?? "";

  // Hard failures (never redirect to an un-allowed URI — that's the token-leak guard).
  if (!isValidClientId(clientId)) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  const clientScope = scopeForClient(clientId)!;
  const requestedScope = sp.get("scope") ?? clientScope;
  if (!isAllowedRedirectUri(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_redirect_uri" },
      { status: 400 },
    );
  }

  // Beyond this point redirectUri is validated/allowlisted.
  if (responseType !== "token") {
    const u = new URL(redirectUri!);
    u.hash = `error=unsupported_response_type&state=${encodeURIComponent(state)}`;
    return NextResponse.redirect(u);
  }

  const session = await getCurrentSession();
  if (!session) {
    // Bounce through login, then return to this exact authorize URL. Use a
    // relative Location: behind the reverse proxy nextUrl.origin resolves to
    // the pod bind address (0.0.0.0:3000), not the public host.
    const returnTo = request.nextUrl.pathname + request.nextUrl.search;
    const location = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    return new NextResponse(null, {
      status: 307,
      headers: { Location: location },
    });
  }

  // Grant only scopes the client is registered for (intersect requested).
  const supported = clientScope.split(" ");
  const granted =
    requestedScope
      .split(/\s+/)
      .filter((s) => supported.includes(s))
      .join(" ") || clientScope;

  const token = randomBytes(32).toString("base64url");
  const ttl = DEFAULT_LAUNCH.tokenTtlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await queries.createLaunchToken({
    userId: session.user.id,
    token,
    scope: granted,
    expiresAt,
  });

  const u = new URL(redirectUri!);
  u.hash =
    `token=${encodeURIComponent(token)}` +
    `&token_type=Bearer` +
    `&expires_in=${ttl}` +
    `&scope=${encodeURIComponent(granted)}` +
    `&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(u);
}
