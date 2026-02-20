import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentSession } from '@/lib/auth';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

function getGoogleSheetsRedirectUri() {
  return process.env.GOOGLE_SHEETS_REDIRECT_URI
    || `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-sheets/callback`;
}

export async function GET() {
  // Require authentication before initiating OAuth flow
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID environment variable.' },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();

  // Store state in HttpOnly cookie for CSRF validation in callback
  const cookieStore = await cookies();
  cookieStore.set('google_sheets_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/api/auth/google-sheets',
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleSheetsRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
