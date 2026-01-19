import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github/oauth';
import * as queries from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?error=github_auth_denied', request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', request.url));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', request.url));
  }

  // Get GitHub user info
  const user = await getGitHubUser(tokenResponse.access_token);
  if (!user) {
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', request.url));
  }

  // Check if account already exists
  const existingAccount = await queries.getGithubAccount();

  if (existingAccount) {
    // Update existing account
    await queries.updateGithubAccount(existingAccount.id, {
      accessToken: tokenResponse.access_token,
      githubUserId: user.id.toString(),
      githubUsername: user.login,
    });
  } else {
    // Create new account
    await queries.createGithubAccount({
      githubUserId: user.id.toString(),
      githubUsername: user.login,
      accessToken: tokenResponse.access_token,
    });
  }

  return NextResponse.redirect(new URL('/settings?success=github_connected', request.url));
}
