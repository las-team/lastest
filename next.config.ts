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
  async headers() {
    return [
      {
        source: "/traces/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://trace.playwright.dev" },
          { key: "Access-Control-Allow-Methods", value: "GET" },
        ],
      },
    ];
  },
};

export default nextConfig;
