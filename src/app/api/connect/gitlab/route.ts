import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';
import { getGitLabAuthUrl, getDefaultInstanceUrl } from '@/lib/gitlab/oauth';
import { getPublicUrl } from '@/lib/utils';

const GITLAB_OAUTH_STATE_COOKIE = 'gitlab_oauth_state';

/**
 * Initiate GitLab OAuth flow.
 *
 * For gitlab.com SaaS: GET /api/connect/gitlab (no params) — uses env vars,
 * server-side redirects to the GitLab authorize URL.
 * For self-hosted with per-account OAuth: POST /api/connect/gitlab with JSON
 * { instanceUrl, clientId, clientSecret }. Returns JSON { authorizeUrl } so
 * the client can top-level navigate without tripping `form-action` CSP for
 * arbitrary self-hosted GitLab origins.
 */
async function buildAuthUrl(opts: {
  instanceUrl?: string;
  clientId?: string;
  clientSecret?: string;
}) {
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

  return getGitLabAuthUrl(state, {
    instanceUrl,
    clientId: opts.clientId?.trim() || undefined,
  });
}

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }
  const authUrl = await buildAuthUrl({});
  return NextResponse.redirect(authUrl);
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const json = formData ? null : await request.json().catch(() => null);
  const body = formData
    ? {
        instanceUrl: formData.get('instanceUrl')?.toString(),
        clientId: formData.get('clientId')?.toString(),
        clientSecret: formData.get('clientSecret')?.toString(),
      }
    : (json as { instanceUrl?: string; clientId?: string; clientSecret?: string } | null) || {};

  if (!body.instanceUrl || !body.clientId || !body.clientSecret) {
    return NextResponse.json({ error: 'instanceUrl, clientId, and clientSecret are required' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(body.instanceUrl)) {
    return NextResponse.json({ error: 'instanceUrl must include http(s)://' }, { status: 400 });
  }

  const authorizeUrl = await buildAuthUrl(body);
  return NextResponse.json({ authorizeUrl });
}
