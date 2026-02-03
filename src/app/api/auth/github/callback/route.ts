import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github/oauth';
import * as queries from '@/lib/db/queries';
import { createSessionToken, setSessionCookie } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/login?error=github_auth_denied', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/login?error=token_exchange_failed', request.url));
  }

  // Get GitHub user info
  const githubUser = await getGitHubUser(tokenResponse.access_token);
  if (!githubUser) {
    return NextResponse.redirect(new URL('/login?error=user_fetch_failed', request.url));
  }

  // Check if OAuth account already exists
  const existingOAuth = await queries.getOAuthAccount('github', githubUser.id.toString());

  let userId: string;
  let teamId: string | null = null;

  if (existingOAuth) {
    // Update OAuth tokens
    await queries.updateOAuthAccount(existingOAuth.id, {
      accessToken: tokenResponse.access_token,
    });
    userId = existingOAuth.userId;

    // Get user's team
    const user = await queries.getUserById(userId);
    teamId = user?.teamId ?? null;
  } else {
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

  // Create session
  const sessionToken = await createSessionToken(userId, request);
  await setSessionCookie(sessionToken);

  return NextResponse.redirect(new URL('/', request.url));
}
