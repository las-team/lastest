/**
 * Detect whether a request is "runner traffic" — i.e. originates from a
 * programmatic client (remote runner, MCP, VS Code extension, CI). Runner
 * traffic is exempt from per-IP rate limits because it legitimately makes
 * dozens of API calls per second during a build.
 *
 * Source-of-truth: the `sessions.kind` column. Browser sessions are 'browser';
 * programmatic API tokens are 'api' (see schema.ts).
 *
 * Cheap fast-path: if the request carries a `Bearer` token at all, treat it
 * as runner-class without a DB roundtrip. Cookie-only requests must verify.
 */

import * as queries from '@/lib/db/queries';

export interface RunnerCheck {
  isRunner: boolean;
  /** Coarse reason for telemetry; never branched on. */
  reason: 'bearer-token' | 'api-session' | 'cookie-browser' | 'unauth';
}

export async function classifyRequest(request: Request): Promise<RunnerCheck> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return { isRunner: true, reason: 'bearer-token' };
  }

  // For cookie sessions we'd need to parse the better-auth cookie and look up
  // its kind. Doing that synchronously inside a hot middleware would require
  // pulling in the whole better-auth chain; we avoid it. Cookie sessions are
  // assumed to be browser users.
  return { isRunner: false, reason: 'cookie-browser' };
}

/**
 * Off the hot path — used by the diagnostics surface to *confirm* a session
 * token's kind by hitting the DB. Use sparingly.
 */
export async function isApiSessionToken(token: string): Promise<boolean> {
  const result = await queries.getSessionWithUser(token);
  return result?.session.kind === 'api';
}

/**
 * Best-effort client IP. Honors X-Forwarded-For first hop (Cloudflare,
 * reverse proxies); falls back to a constant so an unknown caller still
 * lands in *some* bucket. Never returns empty.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const cfip = request.headers.get('cf-connecting-ip');
  if (cfip) return cfip.trim();
  const xreal = request.headers.get('x-real-ip');
  if (xreal) return xreal.trim();
  return 'unknown';
}
