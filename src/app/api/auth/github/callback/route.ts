import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github/oauth';
import * as queries from '@/lib/db/queries';
import { getPublicUrl } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?error=github_auth_denied', getPublicUrl(request)));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', getPublicUrl(request)));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', getPublicUrl(request)));
  }

  // Get GitHub user info
  const user = await getGitHubUser(tokenResponse.access_token);
  if (!user) {
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', getPublicUrl(request)));
  }

  // Check if account already exists
  const existingAccount = await queries.getGithubAccount();

  if (existingAccount) {
    await queries.updateGithubAccount(existingAccount.id, {
      accessToken: tokenResponse.access_token,
      githubUserId: user.id.toString(),
      githubUsername: user.login,
    });
  } else {
    await queries.createGithubAccount({
      githubUserId: user.id.toString(),
      githubUsername: user.login,
      accessToken: tokenResponse.access_token,
    });
  }

  return NextResponse.redirect(new URL('/settings?success=github_connected', getPublicUrl(request)));
}
