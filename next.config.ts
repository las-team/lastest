import type { NextConfig } from "next";
import { execSync } from "child_process";

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // next/image is served as-is (no server-side resize/format conversion) so the
  // production runtime never needs `sharp` + `libvips` (~15MB+). Images still
  // get layout/lazy-loading from next/image, just at their source resolution.
  images: { unoptimized: true },
  transpilePackages: [
    "@lastest/shared",
    "@lastest/eb-protocol",
    "@lastest/db",
    "@lastest/pool-service",
  ],
  outputFileTracingIncludes: {
    "/terms": ["./src/content/legal/terms.md"],
    "/privacy": ["./src/content/legal/privacy.md"],
    "/cookies": ["./src/content/legal/cookies.md"],
    "/dpa": ["./src/content/legal/dpa.md"],
  },
  // Next's file tracer (nft) over-includes build-only packages into the
  // standalone bundle. None of these are needed by the running server, so
  // prune them to keep the production image slim:
  //   - typescript: not a runtime dep (`pnpm why typescript --prod` is empty);
  //     @lastest/db is transpiled at build time, not required as TS at runtime.
  //   - tesseract.js: OCR runs in the separate ocr-service container.
  //   - sharp/@img: unused now that image optimization is off (above).
  //   - source maps / type decls: never loaded by the server.
  // NOTE: @anthropic-ai/claude-agent-sdk can't be pruned here — it's a
  // serverExternalPackage, which forces nft to keep it regardless of this
  // exclude list. Dockerfile.app removes it surgically from the runner stage.
  outputFileTracingExcludes: {
    "*": [
      "**/typescript/**",
      "**/tesseract.js/**",
      "**/@img/**",
      "**/sharp/**",
      "**/*.map",
      "**/*.d.ts",
    ],
  },
  env: {
    NEXT_PUBLIC_GIT_HASH:
      process.env.NEXT_PUBLIC_GIT_HASH || git("rev-parse --short HEAD"),
    NEXT_PUBLIC_GIT_COMMIT_COUNT:
      process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT || git("rev-list --count HEAD"),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
  },
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "@anthropic-ai/claude-agent-sdk",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: ["app.lastest.cloud", "*.olares.local"],
    },
    proxyClientMaxBodySize: "50mb",
    // Barrel imports from these packages are rewritten to deep imports so
    // SWC never has to parse the whole package per route. Without this,
    // any dev-server recompile that touches a file using lucide-react pulls
    // ~1500 icon modules into SWC and OOMs the dev server — the exact
    // napi_create_string_utf8 crash the share flow kept hitting.
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Content-Security-Policy is owned by src/middleware.ts so it can
          // emit a per-request nonce. Setting it here too would compose by
          // intersection with the middleware policy and break inline scripts.
        ],
      },
    ];
  },
  async rewrites() {
    const rewrites = [
      {
        source: "/screenshots/:path*",
        destination: "/api/media/screenshots/:path*",
      },
      { source: "/diffs/:path*", destination: "/api/media/diffs/:path*" },
      {
        source: "/baselines/:path*",
        destination: "/api/media/baselines/:path*",
      },
      { source: "/traces/:path*", destination: "/api/media/traces/:path*" },
      { source: "/videos/:path*", destination: "/api/media/videos/:path*" },
      { source: "/planned/:path*", destination: "/api/media/planned/:path*" },
      {
        source: "/bug-reports/:path*",
        destination: "/api/media/bug-reports/:path*",
      },
    ];

    const umamiUrl = process.env.UMAMI_INTERNAL_URL?.replace(/\/$/, "");
    if (umamiUrl) {
      rewrites.push(
        { source: "/_umami/script.js", destination: `${umamiUrl}/script.js` },
        {
          source: "/_umami/recorder.js",
          destination: `${umamiUrl}/recorder.js`,
        },
        // Ingest beacons go through a resilient route handler that ACKs the
        // browser immediately and forwards to umami in the background, so a slow
        // umami can never stall navigation (e.g. submitting the login form).
        // The handler reads UMAMI_INTERNAL_URL itself at runtime.
        { source: "/_umami/api/send", destination: "/api/umami/send" },
        { source: "/_umami/api/record", destination: "/api/umami/record" },
      );
    }

    return rewrites;
  },
};

export default nextConfig;
