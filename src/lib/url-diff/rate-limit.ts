/**
 * Tiny in-memory token-bucket rate limiter for URL Diff endpoints.
 * Keyed by `${ip}:${userId}` with a 1-minute window. Survives Next dev
 * hot-reloads via globalThis (mirroring `__remoteRecordingSessions`).
 */

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 5;

type Slot = { count: number; resetAt: number };

const KEY = '__urlDiffRateBucket' as const;
type Bucket = Map<string, Slot>;

function bucket(): Bucket {
  const g = globalThis as unknown as Record<string, Bucket | undefined>;
  if (!g[KEY]) g[KEY] = new Map<string, Slot>();
  return g[KEY]!;
}

export interface RateLimitOptions {
  ip: string;
  userId: string;
  limit?: number;
}

export interface RateLimitOutcome {
  ok: boolean;
  remaining: number;
  resetAt: number;
  headers: Record<string, string>;
}

export function checkRateLimit({ ip, userId, limit = DEFAULT_LIMIT }: RateLimitOptions): RateLimitOutcome {
  const now = Date.now();
  const key = `${ip}:${userId}`;
  const b = bucket();
  const slot = b.get(key);
  if (!slot || slot.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    b.set(key, { count: 1, resetAt });
    return {
      ok: true,
      remaining: limit - 1,
      resetAt,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(limit - 1),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    };
  }
  if (slot.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: slot.resetAt,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(slot.resetAt / 1000)),
        'Retry-After': String(Math.max(1, Math.ceil((slot.resetAt - now) / 1000))),
      },
    };
  }
  slot.count++;
  return {
    ok: true,
    remaining: limit - slot.count,
    resetAt: slot.resetAt,
    headers: {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(limit - slot.count),
      'X-RateLimit-Reset': String(Math.ceil(slot.resetAt / 1000)),
    },
  };
}
