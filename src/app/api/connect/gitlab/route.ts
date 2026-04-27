import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';
import { getGitLabAuthUrl, getDefaultInstanceUrl } from '@/lib/gitlab/oauth';
import { getPublicUrl } from '@/lib/utils';

const GITLAB_OAUTH_STATE_COOKIE = 'gitlab_oauth_state';

/**
 * Initiate GitLab OAuth flow.
 *
 * For gitlab.com SaaS: GET /api/connect/gitlab (no params) — uses env vars.
 * For self-hosted with per-account OAuth: POST /api/connect/gitlab with
 * { instanceUrl, clientId, clientSecret } so the secret never lives in a URL,
 * then the route 303-redirects to the GitLab authorize URL.
 */
async function startOAuth(request: NextRequest, opts: {
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
}) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  const state = crypto.randomUUID();
  const instanceUrl = opts.instanceUrl?.trim() || getDefaultInstanceUrl();

  // Persist state + per-instance creds via HttpOnly cookie so the callback can
  // recover them. No DB row exists for the account yet.
  const cookieStore = await cookies();
  const payload = JSON.stringify({
    state,
    instanceUrl,
    clientId: opts.clientId?.trim() || undefined,
    clientSecret: opts.clientSecret?.trim() || undefined,
  });
  cookieStore.set(GITLAB_OAUTH_STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/connect/gitlab',
  });

  const authUrl = getGitLabAuthUrl(state, {
    instanceUrl,
    clientId: opts.clientId?.trim() || undefined,
  });
  return NextResponse.redirect(authUrl);
}

export async function GET(request: NextRequest) {
  return startOAuth(request, {});
}

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const json = formData ? null : await request.json().catch(() => null);
  const body = formData
    ? {
        instanceUrl: formData.get('instanceUrl')?.toString(),
        clientId: formData.get('clientId')?.toString(),
        clientSecret: formData.get('clientSecret')?.toString(),
      }
    : (json as { instanceUrl?: string; clientId?: string; clientSecret?: string } | null) || {};
  return startOAuth(request, body);
}
