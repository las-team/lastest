import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, getGitLabUser, getDefaultInstanceUrl } from '@/lib/gitlab/oauth';
import * as queries from '@/lib/db/queries';
import { createSessionToken, setSessionCookie, getCurrentUser } from '@/lib/auth';
import { getPublicUrl } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Check if user is already logged in (linking account vs login)
  const currentUser = await getCurrentUser();
  const instanceUrl = getDefaultInstanceUrl();

  if (error) {
    const redirectPath = currentUser ? '/settings?error=gitlab_auth_denied' : '/login?error=gitlab_auth_denied';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  if (!code) {
    const redirectPath = currentUser ? '/settings?error=no_code' : '/login?error=no_code';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code, instanceUrl);
  if (!tokenResponse) {
    const redirectPath = currentUser ? '/settings?error=token_exchange_failed' : '/login?error=token_exchange_failed';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Get GitLab user info
  const gitlabUser = await getGitLabUser(tokenResponse.access_token, instanceUrl);
  if (!gitlabUser) {
    const redirectPath = currentUser ? '/settings?error=user_fetch_failed' : '/login?error=user_fetch_failed';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Check if OAuth account already exists
  const existingOAuth = await queries.getOAuthAccount('gitlab', gitlabUser.id.toString());

  let userId: string;
  let teamId: string | null = null;

  // Calculate token expiration
  const tokenExpiresAt = tokenResponse.expires_in && tokenResponse.created_at
    ? new Date((tokenResponse.created_at + tokenResponse.expires_in) * 1000)
    : null;

  // If user is already logged in, link the GitLab account to their existing account
  if (currentUser) {
    if (existingOAuth && existingOAuth.userId !== currentUser.id) {
      // GitLab account is linked to a different user
      return NextResponse.redirect(new URL('/settings?error=gitlab_account_linked_to_another_user', getPublicUrl(request)));
    }

    if (existingOAuth) {
      // Update OAuth tokens
      await queries.updateOAuthAccount(existingOAuth.id, {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt,
      });
    } else {
      // Create OAuth account link for current user
      await queries.createOAuthAccount({
        userId: currentUser.id,
        provider: 'gitlab',
        providerAccountId: gitlabUser.id.toString(),
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt,
      });
    }

    userId = currentUser.id;
    teamId = currentUser.teamId;
  } else if (existingOAuth) {
    // Not logged in, but OAuth account exists - this is a login
    await queries.updateOAuthAccount(existingOAuth.id, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt,
    });
    userId = existingOAuth.userId;

    // Get user's team
    const user = await queries.getUserById(userId);
    teamId = user?.teamId ?? null;
  } else {
    // Not logged in and no existing OAuth - this is a new registration
    // Check if user exists with this email
    let user = gitlabUser.email
      ? await queries.getUserByEmail(gitlabUser.email)
      : null;

    if (!user) {
      // Non-invited registration: create new team and make user the owner
      const userName = gitlabUser.name || gitlabUser.username;
      const team = await queries.createTeam({ name: `${userName}'s Team` });
      teamId = team.id;

      // Create new user as team owner
      user = await queries.createUser({
        email: gitlabUser.email || `${gitlabUser.username}@gitlab.local`,
        name: userName,
        avatarUrl: gitlabUser.avatar_url,
        teamId: team.id,
        role: 'owner',
        emailVerified: !!gitlabUser.email,
      });
    } else {
      // Update user avatar if not set
      if (!user.avatarUrl && gitlabUser.avatar_url) {
        await queries.updateUser(user.id, { avatarUrl: gitlabUser.avatar_url });
      }
      teamId = user.teamId;
    }

    // Create OAuth account link
    await queries.createOAuthAccount({
      userId: user.id,
      provider: 'gitlab',
      providerAccountId: gitlabUser.id.toString(),
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt,
    });

    userId = user.id;
  }

  // Also maintain the gitlab_accounts table for API access (team-scoped)
  if (teamId) {
    const existingGitlabAccount = await queries.getGitlabAccountByTeam(teamId);
    if (existingGitlabAccount) {
      await queries.updateGitlabAccount(existingGitlabAccount.id, {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        tokenExpiresAt,
        gitlabUserId: gitlabUser.id.toString(),
        gitlabUsername: gitlabUser.username,
        instanceUrl,
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
      });
    }
  }

  // If user was already logged in (linking account), redirect to settings
  if (currentUser) {
    return NextResponse.redirect(new URL('/settings?success=gitlab_connected', getPublicUrl(request)));
  }

  // Create session for new login/registration
  const sessionToken = await createSessionToken(userId, request);
  await setSessionCookie(sessionToken);

  return NextResponse.redirect(new URL('/', getPublicUrl(request)));
}
