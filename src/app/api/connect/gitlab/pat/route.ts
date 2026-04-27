import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { validatePatToken } from '@/lib/gitlab/oauth';
import * as queries from '@/lib/db/queries';

/**
 * Connect a self-hosted GitLab via Personal Access Token.
 * Bypasses the OAuth dance — useful for self-hosted instances where the user
 * cannot register an OAuth application.
 *
 * Body: { instanceUrl: string, pat: string }
 */
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const teamId = session.user.teamId;
  if (!teamId) {
    return NextResponse.json({ error: 'No team' }, { status: 400 });
  }

  let body: { instanceUrl?: string; pat?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  const instanceUrl = (body.instanceUrl || '').trim().replace(/\/+$/, '');
  const pat = (body.pat || '').trim();
  if (!instanceUrl || !pat) {
    return NextResponse.json({ error: 'instanceUrl and pat are required' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(instanceUrl)) {
    return NextResponse.json({ error: 'instanceUrl must include http(s)://' }, { status: 400 });
  }

  const user = await validatePatToken(pat, instanceUrl);
  if (!user) {
    return NextResponse.json({ error: 'Invalid PAT or unreachable instance' }, { status: 400 });
  }

  const existing = await queries.getGitlabAccountByTeam(teamId);
  if (existing) {
    await queries.updateGitlabAccount(existing.id, {
      gitlabUserId: user.id.toString(),
      gitlabUsername: user.username,
      accessToken: pat,
      refreshToken: null,
      tokenExpiresAt: null,
      instanceUrl,
      authMethod: 'pat',
      oauthClientId: null,
      oauthClientSecret: null,
    });
  } else {
    await queries.createGitlabAccount({
      teamId,
      gitlabUserId: user.id.toString(),
      gitlabUsername: user.username,
      accessToken: pat,
      refreshToken: null,
      tokenExpiresAt: null,
      instanceUrl,
      authMethod: 'pat',
    });
  }

  // Auto-sync repos so the sidebar populates immediately
  try {
    const { syncGitlabReposForTeam } = await import('@/server/actions/repos');
    await syncGitlabReposForTeam(teamId, pat, instanceUrl);
    const account = await queries.getGitlabAccountByTeam(teamId);
    if (account) {
      await queries.updateGitlabAccount(account.id, { reposSyncedAt: new Date() });
    }
  } catch {
    // Non-fatal
  }

  return NextResponse.json({ success: true, username: user.username, instanceUrl });
}
