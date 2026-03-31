import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { exchangeCodeForToken, getGitLabUser, getDefaultInstanceUrl, getUserProjects } from '@/lib/gitlab/oauth';
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
  const instanceUrl = getDefaultInstanceUrl();

  if (error) {
    return NextResponse.redirect(new URL('/settings?error=gitlab_auth_denied', getPublicUrl(request)));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', getPublicUrl(request)));
  }

  const tokenResponse = await exchangeCodeForToken(code, instanceUrl);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', getPublicUrl(request)));
  }

  const gitlabUser = await getGitLabUser(tokenResponse.access_token, instanceUrl);
  if (!gitlabUser) {
    return NextResponse.redirect(new URL('/settings?error=user_fetch_failed', getPublicUrl(request)));
  }

  const tokenExpiresAt = tokenResponse.expires_in && tokenResponse.created_at
    ? new Date((tokenResponse.created_at + tokenResponse.expires_in) * 1000)
    : null;

  const teamId = session.user.teamId;
  if (!teamId) {
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

  // Auto-sync repos so the sidebar is populated immediately
  try {
    const glProjects = await getUserProjects(tokenResponse.access_token, instanceUrl);
    for (const project of glProjects) {
      const existing = await queries.getRepositoryByGitlabProjectId(project.id);
      const [namespace, ...nameParts] = project.path_with_namespace.split('/');
      const projectName = nameParts.join('/');

      if (existing && existing.teamId === teamId) {
        await queries.updateRepository(existing.id, {
          owner: namespace,
          name: projectName,
          fullName: project.path_with_namespace,
          defaultBranch: project.default_branch,
        });
      } else if (!existing) {
        await queries.createRepository({
          teamId,
          provider: 'gitlab',
          gitlabProjectId: project.id,
          owner: namespace,
          name: projectName,
          fullName: project.path_with_namespace,
          defaultBranch: project.default_branch,
        });
      }
    }
  } catch {
    // Non-fatal — user can still manually sync later
  }

  return NextResponse.redirect(new URL('/settings?success=gitlab_connected', getPublicUrl(request)));
}
