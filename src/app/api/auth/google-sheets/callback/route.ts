import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { getPublicUrl } from '@/lib/utils';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

function getGoogleSheetsRedirectUri() {
  return process.env.GOOGLE_SHEETS_REDIRECT_URI
    || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-sheets/callback`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleSheetsRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      console.error('Google Sheets token exchange failed:', response.status, await response.text());
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('Google Sheets token exchange error:', error);
    return null;
  }
}

async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?error=google_sheets_denied', getPublicUrl(request)));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?error=no_code', getPublicUrl(request)));
  }

  // Validate OAuth state parameter to prevent CSRF
  const stateParam = searchParams.get('state');
  const cookieStore = await cookies();
  const storedState = cookieStore.get('google_sheets_oauth_state')?.value;
  cookieStore.delete('google_sheets_oauth_state');

  if (!stateParam || !storedState || stateParam !== storedState) {
    return NextResponse.redirect(new URL('/settings?error=google_sheets_csrf', getPublicUrl(request)));
  }

  // Get current user via BetterAuth session
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  const currentUser = session.user;
  if (!currentUser.teamId) {
    return NextResponse.redirect(new URL('/login', getPublicUrl(request)));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/settings?error=google_sheets_token_failed', getPublicUrl(request)));
  }

  // Get Google user info
  const googleUser = await getGoogleUserInfo(tokenResponse.access_token);
  if (!googleUser) {
    return NextResponse.redirect(new URL('/settings?error=google_sheets_user_failed', getPublicUrl(request)));
  }

  // Upsert Google Sheets account for this team
  await queries.upsertGoogleSheetsAccount({
    teamId: currentUser.teamId,
    googleUserId: googleUser.sub,
    googleEmail: googleUser.email,
    googleName: googleUser.name,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || null,
    tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
  });

  return NextResponse.redirect(new URL('/settings?success=google_sheets_connected', getPublicUrl(request)));
}
