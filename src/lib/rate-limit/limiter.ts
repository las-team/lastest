/**
 * Lightweight in-process sliding-window rate limiter.
 *
 * Used to gate a small number of high-cost endpoints (login POSTs primarily)
 * without depending on Cloudflare or an external Redis. Single-process semantics
 * are good enough for our deployment shape (one Next server per pod): if the
 * server is replicated, each replica enforces independently — the resulting
 * effective limit is `replicas * limit` per minute, which is fine for our use
 * case (the goal is to keep brute-force users out, not perfect distributed
 * fairness).
 *
 * Bearer-token traffic is bypassed entirely upstream — see `isRunnerRequest()`.
 * Programmatic clients should use a Bearer token, not password POSTs.
 */

interface Bucket {
  /** Timestamps (ms) of recent hits, oldest first. Pruned each call. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Periodic cleanup so an inactive key doesn't keep its bucket forever.
 * Runs lazily on `check()` calls — no setInterval, no leak on serverless.
 */
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;
function maybeSweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    while (b.hits.length > 0 && b.hits[0] < now - windowMs) b.hits.shift();
    if (b.hits.length === 0) buckets.delete(k);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** ms until the next slot opens. 0 if `allowed`. */
  retryAfterMs: number;
  limit: number;
}

/**
 * Check a sliding window. Increments the bucket on `allowed === true` only.
 * @param key       caller-defined dedupe key (typically `ip` for login).
 * @param limit     max requests per window.
 * @param windowMs  window length.
 */
export function check(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  maybeSweep(now, windowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  // Drop entries outside the window
  const cutoff = now - windowMs;
  while (bucket.hits.length > 0 && bucket.hits[0] < cutoff) bucket.hits.shift();

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(1, oldest + windowMs - now),
      limit,
    };
  }

  bucket.hits.push(now);
  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    retryAfterMs: 0,
    limit,
  };
}

/**
 * Test-only utility — drops the in-memory state so unit tests start clean.
 * Don't call from production code.
 */
export function _resetForTests() {
  buckets.clear();
  lastSweep = 0;
}
