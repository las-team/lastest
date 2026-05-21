import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/invite',
  '/awards',     // "Prove your app is not AI slop" campaign landing
  '/r/',         // Public share pages
  '/share/',     // Static share media (public/share/<slug>/...)
  '/api/og/', // Public OG/Twitter card images for shared builds
  '/api/badge/', // Public embeddable badge SVGs
  '/api/auth/',
  '/api/health',
  '/api/webhooks/',
  '/api/builds/',
  '/api/runners/',
  '/api/ws/runner',
  '/api/embedded/register',
  '/api/embedded/auto-register',
  '/api/embedded/stream/ws',
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
  '/_umami/',
];

const isDev = process.env.NODE_ENV !== 'production';

// Per-request CSP nonce. Set on the response Content-Security-Policy header
// and on the modified request headers (x-nonce) so server components can read
// it via headers() and thread it onto next/script tags. Next.js applies the
// same nonce to its own framework-emitted inline scripts.
//
// Edge runtime: Web Crypto only — Node's crypto.randomBytes is not available.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildCsp(nonce: string): string {
  // 'unsafe-eval' is required in dev for HMR + source maps; never in prod.
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc}`,
    // style-src keeps 'unsafe-inline' — Next/RSC emit inline <style> tags
    // and Tailwind v4 uses inline runtime styles. CSS-based XSS is theoretical.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.googleusercontent.com https://*.gravatar.com https://www.google.com https://*.gstatic.com",
    // worker-src: umami's recorder.js spawns a Blob-URL Web Worker for replay compression.
    "worker-src 'self' blob:",
    "connect-src 'self' ws: wss: https://github.com https://api.github.com https://gitlab.com",
    "font-src 'self' data:",
    "frame-src 'self' https://trace.playwright.dev",
    "frame-ancestors 'none'",
    "form-action 'self' https://github.com https://gitlab.com",
  ].join('; ');
}

// CSP belongs on HTML responses, not API or rewritten-media responses. Same
// path-prefix list we use for the auth bypass works as a CSP bypass too — the
// API + static-asset surfaces don't serve scripts.
const NON_HTML_PREFIXES = [
  '/api/',
  '/_umami/',
  '/screenshots/',
  '/diffs/',
  '/baselines/',
  '/traces/',
  '/videos/',
  '/planned/',
  '/bug-reports/',
];

function shouldApplyCsp(pathname: string, request: NextRequest): boolean {
  if (NON_HTML_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  // Skip prefetch responses — they carry RSC payloads, not full HTML, and
  // recycling a fresh nonce on every prefetch invalidates cached layouts.
  if (request.headers.get('next-router-prefetch') !== null) return false;
  if (request.headers.get('purpose') === 'prefetch') return false;
  return true;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const applyCsp = shouldApplyCsp(pathname, request);
  const nonce = applyCsp ? generateNonce() : null;
  const csp = nonce ? buildCsp(nonce) : null;

  // Auth check first — redirects skip CSP wiring entirely.
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (!isPublic) {
    const session = getSessionCookie(request);
    if (!session) {
      const forwardedHost = request.headers.get('x-forwarded-host');
      const forwardedProto = request.headers.get('x-forwarded-proto');
      const base = forwardedHost
        ? `${forwardedProto ?? 'https'}://${forwardedHost}`
        : request.url;
      return NextResponse.redirect(new URL('/login', base));
    }
  }

  if (!applyCsp || !nonce || !csp) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Mirror the policy onto request headers so Next.js can apply the nonce to
  // its own framework-emitted inline scripts during rendering.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', csp);
  return response;
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
