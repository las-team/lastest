import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getCurrentSession } from "@/lib/auth";
import { exchangeCodeForToken } from "@/lib/vercel/oauth";
import * as queries from "@/lib/db/queries";
import { getPublicUrl } from "@/lib/utils";

const VERCEL_OAUTH_STATE_COOKIE = "vercel_oauth_state";

interface OAuthStatePayload {
  state: string;
  userId: string;
}

async function consumeStateCookie(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(VERCEL_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(VERCEL_OAUTH_STATE_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthStatePayload;
    if (!parsed.state || !parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Only honor Vercel's `next` redirect if it points back at vercel.com — the
 * install flow always does. Anything else would be an open-redirect vector.
 */
function safeNext(next: string | null): string | null {
  if (!next) return null;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:") return null;
    if (u.hostname === "vercel.com" || u.hostname.endsWith(".vercel.com")) {
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    await consumeStateCookie();
    return NextResponse.redirect(new URL("/login", getPublicUrl(request)));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const stateParam = searchParams.get("state");
  const configurationId = searchParams.get("configurationId");
  const vercelTeamId = searchParams.get("teamId");
  const next = safeNext(searchParams.get("next"));

  // Consume the state cookie up front so a failed callback can't leave a stale
  // state for replay.
  const stateRecord = await consumeStateCookie();

  const settingsError = (reason: string) =>
    NextResponse.redirect(
      new URL(
        `/settings?tab=integrations&error=${reason}`,
        getPublicUrl(request),
      ),
    );

  if (error) return settingsError("vercel_auth_denied");
  if (!code) return settingsError("no_code");
  if (!configurationId) return settingsError("no_configuration");

  // Strict CSRF state validation.
  if (
    !stateRecord ||
    !stateParam ||
    !timingSafeStringEq(stateRecord.state, stateParam)
  ) {
    return settingsError("state_mismatch");
  }
  if (stateRecord.userId !== session.user.id) {
    return settingsError("session_mismatch");
  }

  const teamId = session.user.teamId;
  if (!teamId) return settingsError("no_team");

  const token = await exchangeCodeForToken(code);
  if (!token) return settingsError("token_exchange_failed");

  await queries.upsertVercelAccount({
    teamId,
    vercelConfigurationId: configurationId,
    vercelTeamId: vercelTeamId ?? token.team_id ?? null,
    vercelUserId: token.user_id ?? null,
    accessToken: token.access_token,
    installedByUserId: session.user.id,
  });

  // Vercel's install flow expects a 302 back to `next`. Fall back to settings.
  if (next) return NextResponse.redirect(next);
  return NextResponse.redirect(
    new URL(
      "/settings?tab=integrations&success=vercel_connected",
      getPublicUrl(request),
    ),
  );
}
