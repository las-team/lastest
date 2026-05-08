import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';
import { getGitHubAuthUrl } from '@/lib/github/oauth';

const GITHUB_OAUTH_STATE_COOKIE = 'github_oauth_state';

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  }

  // Generate a fresh state, persist it as an HttpOnly cookie scoped to the
  // callback path. The callback verifies it via crypto.timingSafeEqual to
  // prevent OAuth-flow CSRF (attacker linking their GitHub account into the
  // victim's session by tricking them into loading the callback URL).
  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, userId: session.user.id });
  const cookieStore = await cookies();
  cookieStore.set(GITHUB_OAUTH_STATE_COOKIE, payload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/connect/github',
  });

  const authUrl = getGitHubAuthUrl(state);
  return NextResponse.redirect(authUrl);
}
