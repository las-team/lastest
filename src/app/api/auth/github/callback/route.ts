import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github/oauth';
import * as queries from '@/lib/db/queries';
import { createSessionToken, setSessionCookie, getCurrentUser } from '@/lib/auth';
import { getPublicUrl } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Check if user is already logged in (linking account vs login)
  const currentUser = await getCurrentUser();

  if (error) {
    const redirectPath = currentUser ? '/settings?error=github_auth_denied' : '/login?error=github_auth_denied';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  if (!code) {
    const redirectPath = currentUser ? '/settings?error=no_code' : '/login?error=no_code';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    const redirectPath = currentUser ? '/settings?error=token_exchange_failed' : '/login?error=token_exchange_failed';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Get GitHub user info
  const githubUser = await getGitHubUser(tokenResponse.access_token);
  if (!githubUser) {
    const redirectPath = currentUser ? '/settings?error=user_fetch_failed' : '/login?error=user_fetch_failed';
    return NextResponse.redirect(new URL(redirectPath, getPublicUrl(request)));
  }

  // Check if OAuth account already exists
  const existingOAuth = await queries.getOAuthAccount('github', githubUser.id.toString());

  let userId: string;
  let teamId: string | null = null;

  // If user is already logged in, link the GitHub account to their existing account
  if (currentUser) {
    if (existingOAuth && existingOAuth.userId !== currentUser.id) {
      // GitHub account is linked to a different user
      return NextResponse.redirect(new URL('/settings?error=github_account_linked_to_another_user', getPublicUrl(request)));
    }

    if (existingOAuth) {
      // Update OAuth tokens
      await queries.updateOAuthAccount(existingOAuth.id, {
        accessToken: tokenResponse.access_token,
      });
    } else {
      // Create OAuth account link for current user
      await queries.createOAuthAccount({
        userId: currentUser.id,
        provider: 'github',
        providerAccountId: githubUser.id.toString(),
        accessToken: tokenResponse.access_token,
      });
    }

    userId = currentUser.id;
    teamId = currentUser.teamId;
  } else if (existingOAuth) {
    // Not logged in, but OAuth account exists - this is a login
    await queries.updateOAuthAccount(existingOAuth.id, {
      accessToken: tokenResponse.access_token,
    });
    userId = existingOAuth.userId;

    // Get user's team
    const user = await queries.getUserById(userId);
    teamId = user?.teamId ?? null;
  } else {
    // Not logged in and no existing OAuth - this is a new registration
    // Check if user exists with this email
    let user = githubUser.email
      ? await queries.getUserByEmail(githubUser.email)
      : null;

    if (!user) {
      // Non-invited registration: create new team and make user the owner
      const userName = githubUser.name || githubUser.login;
      const team = await queries.createTeam({ name: `${userName}'s Team` });
      teamId = team.id;

      // Create new user as team owner
      user = await queries.createUser({
        email: githubUser.email || `${githubUser.login}@github.local`,
        name: userName,
        avatarUrl: githubUser.avatar_url,
        teamId: team.id,
        role: 'owner',
        emailVerified: !!githubUser.email,
      });
    } else {
      // Update user avatar if not set
      if (!user.avatarUrl && githubUser.avatar_url) {
        await queries.updateUser(user.id, { avatarUrl: githubUser.avatar_url });
      }
      teamId = user.teamId;
    }

    // Create OAuth account link
    await queries.createOAuthAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: githubUser.id.toString(),
      accessToken: tokenResponse.access_token,
    });

    userId = user.id;
  }

  // Also maintain the github_accounts table for API access (team-scoped)
  if (teamId) {
    const existingGithubAccount = await queries.getGithubAccountByTeam(teamId);
    if (existingGithubAccount) {
      await queries.updateGithubAccount(existingGithubAccount.id, {
        accessToken: tokenResponse.access_token,
        githubUserId: githubUser.id.toString(),
        githubUsername: githubUser.login,
      });
    } else {
      await queries.createGithubAccount({
        teamId,
        githubUserId: githubUser.id.toString(),
        githubUsername: githubUser.login,
        accessToken: tokenResponse.access_token,
      });
    }
  }

  // If user was already logged in (linking account), redirect to settings
  if (currentUser) {
    return NextResponse.redirect(new URL('/settings?success=github_connected', getPublicUrl(request)));
  }

  // Create session for new login/registration
  const sessionToken = await createSessionToken(userId, request);
  await setSessionCookie(sessionToken);

  return NextResponse.redirect(new URL('/', getPublicUrl(request)));
}
