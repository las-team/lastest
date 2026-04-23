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
  transpilePackages: ["@lastest/shared"],
  env: {
    NEXT_PUBLIC_GIT_HASH: process.env.NEXT_PUBLIC_GIT_HASH || git("rev-parse --short HEAD"),
    NEXT_PUBLIC_GIT_COMMIT_COUNT: process.env.NEXT_PUBLIC_GIT_COMMIT_COUNT || git("rev-list --count HEAD"),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
  },
  serverExternalPackages: ["tesseract.js", "playwright", "playwright-core", "@anthropic-ai/claude-agent-sdk", "ws"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: ["app.lastest.cloud", "*.olares.local"],
    },
    proxyClientMaxBodySize: "50mb",
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com https://*.googleusercontent.com https://img.clerk.com https://*.gravatar.com https://www.google.com https://*.gstatic.com; connect-src 'self' ws: wss: https://github.com https://api.github.com; font-src 'self' data:; frame-src 'self' https://trace.playwright.dev; form-action 'self' https://github.com;" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/screenshots/:path*", destination: "/api/media/screenshots/:path*" },
      { source: "/diffs/:path*", destination: "/api/media/diffs/:path*" },
      { source: "/baselines/:path*", destination: "/api/media/baselines/:path*" },
      { source: "/traces/:path*", destination: "/api/media/traces/:path*" },
      { source: "/videos/:path*", destination: "/api/media/videos/:path*" },
      { source: "/planned/:path*", destination: "/api/media/planned/:path*" },
      { source: "/bug-reports/:path*", destination: "/api/media/bug-reports/:path*" },
    ];
  },
};

export default nextConfig;
