import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/invite',
  '/api/auth/',
  '/api/health',
  '/api/webhooks/',
  '/api/builds/',
  '/api/runners/',
  '/api/ws/runner',
  '/api/embedded/register',
  '/api/embedded/auto-register',
  '/api/config',
  '/api/v1/',
  '/api/media/',
  '/screenshots/',
  '/diffs/',
  '/baselines/',
  '/traces/',
  '/videos/',
  '/planned/',
  '/bug-reports/',
];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const session = getSessionCookie(request);
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Media assets (rewritten to /api/media/*)
    '/screenshots/:path*',
    '/diffs/:path*',
    '/baselines/:path*',
    '/traces/:path*',
    '/videos/:path*',
    '/planned/:path*',
    '/bug-reports/:path*',
  ],
};
