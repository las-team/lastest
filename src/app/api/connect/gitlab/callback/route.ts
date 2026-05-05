import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getCurrentSession } from '@/lib/auth';
import { exchangeCodeForToken, getGitLabUser, getDefaultInstanceUrl } from '@/lib/gitlab/oauth';
import * as queries from '@/lib/db/queries';
import { getPublicUrl } from '@/lib/utils';

const GITLAB_OAUTH_STATE_COOKIE = 'gitlab_oauth_state';

interface OAuthStatePayload {
  state: string;
  instanceUrl: string;
  clientId?: string;
  clientSecret?: string;
}

async function readStateCookie(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GITLAB_OAUTH_STATE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthStatePayload;
    if (!parsed.state || !parsed.instanceUrl) return null;
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

async function clearStateCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(GITLAB_OAUTH_STATE_COOKIE);
}

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const stateParam = searchParams.get('state');

  if (error) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=gitlab_auth_denied', getPublicUrl(request)));
  }

  if (!code) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=no_code', getPublicUrl(request)));
  }

  // Recover per-instance creds. Fall back to env defaults for the gitlab.com flow.
  const stateRecord = await readStateCookie();
  // Strict state validation — the cookie AND the query param both must be
  // present and equal. The previous lenient form bypassed validation when
  // the cookie was missing, allowing OAuth CSRF.
  if (!stateRecord || !stateParam || !timingSafeStringEq(stateRecord.state, stateParam)) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=state_mismatch', getPublicUrl(request)));
  }
  const instanceUrl = stateRecord.instanceUrl || getDefaultInstanceUrl();

  const tokenResponse = await exchangeCodeForToken(code, {
    instanceUrl,
    clientId: stateRecord?.clientId,
    clientSecret: stateRecord?.clientSecret,
  });
  if (!tokenResponse) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', getPublicUrl(request)));
  }

  const gitlabUser = await getGitLabUser(tokenResponse.access_token, instanceUrl);
  if (!gitlabUser) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', getPublicUrl(request)));
  }

  const tokenExpiresAt = tokenResponse.expires_in && tokenResponse.created_at
    ? new Date((tokenResponse.created_at + tokenResponse.expires_in) * 1000)
    : null;

  const teamId = session.user.teamId;
  if (!teamId) {
    await clearStateCookie();
    return NextResponse.redirect(new URL('/settings?error=no_team', getPublicUrl(request)));
  }

  const existingGitlabAccount = await queries.getGitlabAccountByTeam(teamId);
  if (existingGitlabAccount) {
    await queries.updateGitlabAccount(existingGitlabAccount.id, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt,
      gitlabUserId: gitlabUser.id.toString(),
      gitlabUsername: gitlabUser.username,
      instanceUrl,
      authMethod: 'oauth',
      oauthClientId: stateRecord?.clientId ?? null,
      oauthClientSecret: stateRecord?.clientSecret ?? null,
    });
  } else {
    await queries.createGitlabAccount({
      teamId,
      gitlabUserId: gitlabUser.id.toString(),
      gitlabUsername: gitlabUser.username,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt,
      instanceUrl,
      authMethod: 'oauth',
      oauthClientId: stateRecord?.clientId ?? null,
      oauthClientSecret: stateRecord?.clientSecret ?? null,
    });
  }

  await clearStateCookie();

  // Auto-sync repos so the sidebar is populated immediately
  try {
    const { syncGitlabReposForTeam } = await import('@/server/actions/repos');
    await syncGitlabReposForTeam(teamId, tokenResponse.access_token, instanceUrl);
    const glAccount = await queries.getGitlabAccountByTeam(teamId);
    if (glAccount) {
      await queries.updateGitlabAccount(glAccount.id, { reposSyncedAt: new Date() });
    }
  } catch {
    // Non-fatal — repos will auto-sync on next page load
  }

  return NextResponse.redirect(new URL('/settings?success=gitlab_connected', getPublicUrl(request)));
}
