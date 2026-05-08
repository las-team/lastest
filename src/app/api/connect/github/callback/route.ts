import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getCurrentSession } from '@/lib/auth';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github/oauth';
import * as queries from '@/lib/db/queries';
import { getPublicUrl } from '@/lib/utils';

const GITHUB_OAUTH_STATE_COOKIE = 'github_oauth_state';

interface OAuthStatePayload {
  state: string;
  userId: string;
}

async function consumeStateCookie(): Promise<OAuthStatePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GITHUB_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GITHUB_OAUTH_STATE_COOKIE);
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

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    await consumeStateCookie();
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const stateParam = searchParams.get('state');

  // Always consume the cookie up front so a failed callback can't leave
  // a stale state lying around for a later replay attempt.
  const stateRecord = await consumeStateCookie();

  if (error) {
    return NextResponse.redirect(new URL('/settings?error=github_auth_denied', getPublicUrl(request)));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', getPublicUrl(request)));
  }

  // Strict state validation — required to prevent OAuth CSRF.
  if (!stateRecord || !stateParam || !timingSafeStringEq(stateRecord.state, stateParam)) {
    return NextResponse.redirect(new URL('/settings?error=state_mismatch', getPublicUrl(request)));
  }

  // Bind the cookie to the user it was issued for. If the session changed
  // between initiation and callback (e.g. logout/login as another user),
  // refuse the link instead of writing a token to the wrong account.
  if (stateRecord.userId !== session.user.id) {
    return NextResponse.redirect(new URL('/settings?error=session_mismatch', getPublicUrl(request)));
  }

  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', getPublicUrl(request)));
  }

  const ghUser = await getGitHubUser(tokenResponse.access_token);
  if (!ghUser) {
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', getPublicUrl(request)));
  }

  // Refuse to re-link a GitHub account that already maps to a different user.
  // Even with state validation passing, never allow an attacker-supplied code
  // (whose access token belongs to ghUser) to be silently re-bound onto the
  // current session if that ghUser is already connected elsewhere.
  const existingOAuth = await queries.getOAuthAccount('github', ghUser.id.toString());
  if (existingOAuth && existingOAuth.userId !== session.user.id) {
    const conflictUser = await queries.getUserById(existingOAuth.userId);
    const masked = conflictUser?.name
      ? conflictUser.name.slice(0, 2) + '***'
      : 'another user';
    return NextResponse.redirect(
      new URL(`/settings?error=this_GitHub_account_is_already_connected_to_${encodeURIComponent(masked)}`, getPublicUrl(request))
    );
  }

  // Upsert OAuth account for current user
  if (existingOAuth) {
    await queries.updateOAuthAccount(existingOAuth.id, {
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    });
  } else {
    await queries.createOAuthAccount({
      userId: session.user.id,
      provider: 'github',
      providerAccountId: ghUser.id.toString(),
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    });
  }

  // Populate missing user profile fields from GitHub (e.g. avatar)
  const updates: Record<string, string> = {};
  if (!session.user.avatarUrl && ghUser.avatar_url) {
    updates.avatarUrl = ghUser.avatar_url;
  }
  if (Object.keys(updates).length > 0) {
    await queries.updateUser(session.user.id, updates);
  }

  // Sync to team-scoped githubAccounts table
  const teamId = session.user.teamId;
  if (teamId) {
    const existingGhAccount = await queries.getGithubAccountByTeam(teamId);
    if (existingGhAccount) {
      await queries.updateGithubAccount(existingGhAccount.id, {
        accessToken: tokenResponse.access_token,
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
      });
    } else {
      await queries.createGithubAccount({
        teamId,
        githubUserId: ghUser.id.toString(),
        githubUsername: ghUser.login,
        accessToken: tokenResponse.access_token,
      });
    }
  }

  // Auto-sync repos so the sidebar is populated immediately
  if (teamId) {
    try {
      const { syncGithubReposForTeam } = await import('@/server/actions/repos');
      await syncGithubReposForTeam(teamId, tokenResponse.access_token);
      const ghAccount = await queries.getGithubAccountByTeam(teamId);
      if (ghAccount) {
        await queries.updateGithubAccount(ghAccount.id, { reposSyncedAt: new Date() });
      }
    } catch {
      // Non-fatal — repos will auto-sync on next page load
    }
  }

  return NextResponse.redirect(new URL('/settings?success=github_connected', getPublicUrl(request)));
}
