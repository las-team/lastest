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
  transpilePackages: ["@lastest/shared", "cloud-auth"],
  outputFileTracingIncludes: {
    "/terms": ["./src/content/legal/terms.md"],
    "/privacy": ["./src/content/legal/privacy.md"],
    "/cookies": ["./src/content/legal/cookies.md"],
    "/dpa": ["./src/content/legal/dpa.md"],
  },
  env: {
    NEXT_PUBLIC_GIT_HASH:
      process.env.NEXT_PUBLIC_GIT_HASH || git("rev-parse --short HEAD"),
    NEXT_PUBLIC_GIT_COMMIT_COUNT:
      process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT || git("rev-list --count HEAD"),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
  },
  serverExternalPackages: [
    "tesseract.js",
    "playwright",
    "playwright-core",
    "@anthropic-ai/claude-agent-sdk",
    "ws",
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

    const authZone = process.env.AUTH_ZONE;
    if (authZone) {
      rewrites.push({
        source: "/auth_static/:path+",
        destination: `${process.env.AUTH_ZONE}/auth_static/:path+`,
      });
      rewrites.push({
        source: "/api/auth/:path*",
        destination: `${process.env.AUTH_ZONE}/api/auth/:path*`,
      });
      rewrites.push({
        source: "/forgot-password/:path*",
        destination: `${process.env.AUTH_ZONE}/forgot-password/:path*`,
      });
      rewrites.push({
        source: "/invite/:path*",
        destination: `${process.env.AUTH_ZONE}/invite/:path*`,
      });
      rewrites.push({
        source: "/login/:path*",
        destination: `${process.env.AUTH_ZONE}/login/:path*`,
      });
      rewrites.push({
        source: "/register/:path*",
        destination: `${process.env.AUTH_ZONE}/register/:path*`,
      });
      rewrites.push({
        source: "/reset-password/:path*",
        destination: `${process.env.AUTH_ZONE}/reset-password/:path*`,
      });
    }

    const umamiUrl = process.env.UMAMI_INTERNAL_URL?.replace(/\/$/, "");
    if (umamiUrl) {
      rewrites.push(
        { source: "/_umami/script.js", destination: `${umamiUrl}/script.js` },
        {
          source: "/_umami/recorder.js",
          destination: `${umamiUrl}/recorder.js`,
        },
        { source: "/_umami/api/send", destination: `${umamiUrl}/api/send` },
        { source: "/_umami/api/record", destination: `${umamiUrl}/api/record` },
      );
    }

    return rewrites;
  },
};

export default nextConfig;
