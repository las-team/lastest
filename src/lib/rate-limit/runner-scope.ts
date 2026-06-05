/**
 * Detect whether a request is "runner traffic" — i.e. originates from a
 * programmatic client (remote runner, MCP, VS Code extension, CI). Runner
 * traffic is exempt from per-IP rate limits because it legitimately makes
 * dozens of API calls per second during a build.
 *
 * Source-of-truth: the `sessions.kind` column. Browser sessions are 'browser';
 * programmatic API tokens are 'api' (see schema.ts).
 *
 * Bearer tokens are verified against the DB before granting runner status —
 * trusting the header alone would let any anonymous client bypass throttling
 * by attaching a junk `Authorization: Bearer x`.
 *
 * Special case: the platform's own EB pods inject `Authorization: Bearer
 * <SYSTEM_EB_TOKEN>` on Playwright traffic when the test target origin equals
 * `LASTEST_URL`. That token already gates `/api/embedded/*` so it's a
 * reasonable signal that the request is internal infra, not an end user.
 */

import { timingSafeEqual } from "node:crypto";
import * as queries from "@/lib/db/queries";

export interface RunnerCheck {
  isRunner: boolean;
  /** Coarse reason for telemetry; never branched on. */
  reason:
    | "bearer-token"
    | "api-session"
    | "system-eb-token"
    | "cookie-browser"
    | "unauth";
}

function matchesSystemToken(token: string): boolean {
  const env = process.env.SYSTEM_EB_TOKEN;
  if (!env || !token) return false;
  const candidateBuf = Buffer.from(token);
  for (const raw of env.split(",")) {
    const expected = raw.trim();
    if (!expected) continue;
    if (expected.length !== candidateBuf.length) continue;
    const expectedBuf = Buffer.from(expected);
    if (timingSafeEqual(candidateBuf, expectedBuf)) return true;
  }
  return false;
}

export async function classifyRequest(request: Request): Promise<RunnerCheck> {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token && matchesSystemToken(token)) {
      return { isRunner: true, reason: "system-eb-token" };
    }
    if (token && (await isApiSessionToken(token))) {
      return { isRunner: true, reason: "api-session" };
    }
  }

  // For cookie sessions we'd need to parse the better-auth cookie and look up
  // its kind. Doing that synchronously inside a hot middleware would require
  // pulling in the whole better-auth chain; we avoid it. Cookie sessions are
  // assumed to be browser users.
  return { isRunner: false, reason: "cookie-browser" };
}

/**
 * Off the hot path — used by the diagnostics surface to *confirm* a session
 * token's kind by hitting the DB. Use sparingly.
 */
export async function isApiSessionToken(token: string): Promise<boolean> {
  const result = await queries.getSessionWithUser(token);
  return result?.session.kind === "api";
}

/**
 * Best-effort client IP. Honors X-Forwarded-For first hop (Cloudflare,
 * reverse proxies); falls back to a constant so an unknown caller still
 * lands in *some* bucket. Never returns empty.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cfip = request.headers.get("cf-connecting-ip");
  if (cfip) return cfip.trim();
  const xreal = request.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return "unknown";
}
