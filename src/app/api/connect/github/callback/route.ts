import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { exchangeCodeForToken, getGitHubUser, getUserRepos } from '@/lib/github/oauth';
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

  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', getPublicUrl(request)));
  }

  const ghUser = await getGitHubUser(tokenResponse.access_token);
  if (!ghUser) {
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', getPublicUrl(request)));
  }

  // Check if this GitHub account is already linked to a different user
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
      const ghRepos = await getUserRepos(tokenResponse.access_token);
      for (const repo of ghRepos) {
        const existing = await queries.getRepositoryByGithubId(repo.id);
        if (existing && existing.teamId === teamId) {
          await queries.updateRepository(existing.id, {
            owner: repo.owner.login,
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
          });
        } else if (!existing) {
          await queries.createRepository({
            teamId,
            githubRepoId: repo.id,
            owner: repo.owner.login,
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
          });
        }
      }
    } catch {
      // Non-fatal — user can still manually sync later
    }
  }

  return NextResponse.redirect(new URL('/settings?success=github_connected', getPublicUrl(request)));
}
