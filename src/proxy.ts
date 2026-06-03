import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/invite",
  "/awards", // "Prove your app is not AI slop" campaign landing
  "/terms", // Public legal pages (Google OAuth verification requires
  "/privacy", // these to be directly reachable as plain HTML, no auth)
  "/cookies",
  "/dpa",
  "/r/", // Public share pages
  "/share/", // Static share media (public/share/<slug>/...)
  "/sitemap.xml", // Crawler discovery of /r/<slug> share pages
  "/robots.txt", // Crawler directives
  "/oauth/", // Launch OAuth authorize endpoint — the handler itself does
  // the auth check + /login?returnTo bounce (needs to run for
  // both authed token-mint and unauth redirect cases).
  "/api/og/", // Public OG/Twitter card images for shared builds
  "/api/badge/", // Public embeddable badge SVGs
  "/api/auth/",
  "/api/health",
  "/api/webhooks/",
  "/api/builds/",
  "/api/runners/",
  "/api/ws/runner",
  "/api/embedded/register",
  "/api/embedded/auto-register",
  "/api/embedded/stream/ws",
  "/api/config",
  "/api/v1/",
  "/api/media/",
  "/screenshots/",
  "/diffs/",
  "/baselines/",
  "/traces/",
  "/videos/",
  "/planned/",
  "/bug-reports/",
  "/_umami/",
];

const CSPOptions: CPSOptions = {
  styleSrc: ["'unsafe-inline'"],
  imgSrc: [
    "data:", // TODO: Potentially making image CSP pointless
    "blob:", // TODO: Potentially making image CSP pointless
    "https://avatars.githubusercontent.com",
    "https://*.googleusercontent.com",
    "https://*.gravatar.com",
    "https://www.google.com",
    "https://*.gstatic.com",
  ],
  formAction: ["https://github.com", "https://gitlab.com"], // Integration with GitHub/GitLab requires form POSTs to their domains for SSO and webhooks
  workerSrc: ["blob:"], // umami's recorder.js spawns a Blob-URL Web Worker for replay compression
  connectSrc: [
    "ws:",
    "wss:",
    "https://github.com",
    "https://api.github.com",
    "https://gitlab.com",
  ],
  fontSrc: ["data:"], // Tailwind's font utilities emit data-URL fonts, do we need this in production?
  frameSrc: ["https://trace.playwright.dev"], // Playwright Trace Viewer is embedded in an iframe for build trace viewing
};

const ASSET_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".webmanifest",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPath =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    ASSET_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  const isLoggedIn = await isAuthenticated();

  // Handle authentication
  if (!isPublicPath && !isLoggedIn) {
    const loginUrl = new URL("/login", request.url);
    const returnToURL = new URL(request.url);
    loginUrl.searchParams.set(
      "returnTo",
      returnToURL.pathname + returnToURL.search,
    );

    return NextResponse.redirect(loginUrl);
  }

  return nextResponseWithCSP(request, CSPOptions);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - rewritten media paths
     * - sub-zone asset urls (auth_static)
     */
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|auth_static|screenshots|diffs|baselines|traces|videos|planned|bug-reports).*)", // TODO: Handle rewritten media paths separately for easier review
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

type CPSOptions = {
  styleSrc?: string[];
  imgSrc?: string[];
  formAction?: string[];
  workerSrc?: string[];
  connectSrc?: string[];
  fontSrc?: string[];
  frameSrc?: string[];
  scriptSrc?: string[];
};

function nextResponseWithCSP(request: NextRequest, options?: CPSOptions) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    ["default-src", ["'self'"].join(" ")].join(" "),
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'", // TODO: Consider 'strict' once we can ensure all scripts are properly nonce'd.
        ...(isDev ? ["'unsafe-eval'"] : []), // 'unsafe-eval' is required in dev for HMR, source map and React eval
        ...(options?.scriptSrc || []),
      ]
        .filter(Boolean)
        .join(" "),
    ].join(" "),
    [
      "style-src",
      [
        "'self'",
        //`'nonce-${nonce}'`,  // TODO: This doesn't work with inline styles, purge inline styles if possible or hash them
        ...(options?.styleSrc || []),
      ].join(" "),
    ].join(" "),
    ["img-src", ["'self'", ...(options?.imgSrc || [])].join(" ")].join(" "),
    ["font-src", ["'self'"].join(" ")].join(" "),
    ["object-src", ["'none'"].join(" ")].join(" "),
    ["base-uri", ["'self'"].join(" ")].join(" "),
    ["form-action", ["'self'", ...(options?.formAction || [])].join(" ")].join(
      " ",
    ),
    ["frame-ancestors", ["'none'"].join(" ")].join(" "),
    ["frame-src", ["'self'", ...(options?.frameSrc || [])].join(" ")].join(" "),
    ["worker-src", ["'self'", ...(options?.workerSrc || [])].join(" ")].join(
      " ",
    ),
    ["connect-src", ["'self'", ...(options?.connectSrc || [])].join(" ")].join(
      " ",
    ),
    isDev ? [] : ["upgrade-insecure-requests"],
  ]
    .join("; ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}
