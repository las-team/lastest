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
  env: {
    NEXT_PUBLIC_GIT_HASH: git("rev-parse --short HEAD"),
    NEXT_PUBLIC_GIT_COMMIT_COUNT: git("rev-list --count HEAD"),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split("T")[0],
  },
  serverExternalPackages: ["tesseract.js", "playwright", "playwright-core"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
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
