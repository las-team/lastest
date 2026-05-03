import { auth } from "@/lib/auth/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { check as rateLimitCheck } from "@/lib/rate-limit/limiter";
import { classifyRequest, clientIp } from "@/lib/rate-limit/runner-scope";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

/**
 * POST gates all login / signup / password-reset traffic. We rate-limit per IP
 * to make brute-force impractical, but bypass for runner-class requests (any
 * Bearer-token caller — programmatic clients should never POST credentials
 * here in the first place, but the bypass keeps tests resilient).
 *
 * 429 here is preferable to letting Cloudflare's edge rule fire, because we
 * know which user/key class was hit and can return clean JSON instead of the
 * CF interstitial that confused the Mass-EB self-test.
 */
const LOGIN_LIMIT = Number(process.env.RATE_LIMIT_LOGIN_PER_MIN || 30);
const LOGIN_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  const classification = await classifyRequest(request);
  if (!classification.isRunner) {
    const ip = clientIp(request);
    const url = new URL(request.url);
    const key = `auth:${url.pathname}:${ip}`;
    const result = rateLimitCheck(key, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!result.allowed) {
      const retrySec = Math.ceil(result.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({
          error: 'rate_limit_exceeded',
          retryAfterMs: result.retryAfterMs,
          limit: result.limit,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retrySec),
            'X-RateLimit-Limit': String(result.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
    }
  }
  return handler.POST(request);
}
