import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { createSessionToken, setSessionCookie } from '@/lib/auth';
import { getPublicUrl } from '@/lib/utils';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

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
  email_verified: boolean;
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
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google token exchange failed:', response.status, errorText);
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('Google token exchange error:', error);
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
    return NextResponse.redirect(new URL('/login?error=google_auth_denied', getPublicUrl(request)));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', getPublicUrl(request)));
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse) {
    return NextResponse.redirect(new URL('/login?error=token_exchange_failed', getPublicUrl(request)));
  }

  // Get Google user info
  const googleUser = await getGoogleUserInfo(tokenResponse.access_token);
  if (!googleUser) {
    return NextResponse.redirect(new URL('/login?error=user_fetch_failed', getPublicUrl(request)));
  }

  // Check if OAuth account already exists
  const existingOAuth = await queries.getOAuthAccount('google', googleUser.sub);

  let userId: string;

  if (existingOAuth) {
    // Update OAuth tokens
    await queries.updateOAuthAccount(existingOAuth.id, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    });
    userId = existingOAuth.userId;
  } else {
    // Check if user exists with this email
    let user = await queries.getUserByEmail(googleUser.email);

    if (!user) {
      // Non-invited registration: create new team and make user the owner
      const team = await queries.createTeam({ name: `${googleUser.name}'s Team` });

      // Create new user as team owner
      user = await queries.createUser({
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        teamId: team.id,
        role: 'owner',
        emailVerified: googleUser.email_verified,
      });
    } else {
      // Update user avatar if not set
      if (!user.avatarUrl && googleUser.picture) {
        await queries.updateUser(user.id, { avatarUrl: googleUser.picture });
      }
    }

    // Create OAuth account link
    await queries.createOAuthAccount({
      userId: user.id,
      provider: 'google',
      providerAccountId: googleUser.sub,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    });

    userId = user.id;
  }

  // Create session
  const sessionToken = await createSessionToken(userId, request);
  await setSessionCookie(sessionToken);

  return NextResponse.redirect(new URL('/', getPublicUrl(request)));
}
