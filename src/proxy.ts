import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/login(.*)',
  '/register(.*)',
  '/invite(.*)',
  '/api/auth/(.*)',
  '/api/health',
  '/api/webhooks/(.*)',
  '/api/ws/(.*)',
  '/api/v1/(.*)',
  '/api/builds/(.*)',
  '/api/clerk/webhook',
  '/api/media/(.*)',
  '/screenshots/(.*)',
  '/diffs/(.*)',
  '/baselines/(.*)',
  '/traces/(.*)',
  '/videos/(.*)',
  '/planned/(.*)',
  '/bug-reports/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Media assets (rewritten to /api/media/* but need middleware to set up Clerk auth context)
    '/screenshots/:path*',
    '/diffs/:path*',
    '/baselines/:path*',
    '/traces/:path*',
    '/videos/:path*',
    '/planned/:path*',
    '/bug-reports/:path*',
  ],
};
