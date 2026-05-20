/**
 * Webhook replay protection.
 *
 * GitHub and GitLab send a unique delivery ID with every webhook. Without
 * a dedupe window, captured webhook payloads can be replayed indefinitely.
 * This module records seen IDs in a small in-memory TTL cache and reports
 * duplicates back to the caller so they can short-circuit the handler.
 *
 * The cache is process-local — across replicas it provides best-effort
 * protection, not strict idempotency. That's the right trade-off for an
 * anti-replay window: a 5-minute miss between replicas is fine, but a DB
 * write on every webhook would amplify load for a marginal gain.
 */

interface SeenEntry {
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 5_000;

const seen = new Map<string, SeenEntry>();

function evictIfNeeded(now: number): void {
  if (seen.size < MAX_ENTRIES) return;
  // Drop everything expired in a single pass, then if still over budget
  // drop the oldest insertions (Map iteration order = insertion order).
  for (const [k, v] of seen) {
    if (v.expiresAt <= now) seen.delete(k);
  }
  if (seen.size < MAX_ENTRIES) return;
  const overflow = seen.size - MAX_ENTRIES;
  let i = 0;
  for (const k of seen.keys()) {
    if (i >= overflow) break;
    seen.delete(k);
    i += 1;
  }
}

/**
 * Returns `true` the first time `key` is seen within the TTL window, and
 * `false` for any subsequent call within the same window. Pass a namespaced
 * key (e.g. `github:${deliveryId}`) so different webhook sources don't
 * collide.
 */
export function markWebhookSeen(key: string): boolean {
  const now = Date.now();
  const existing = seen.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }
  evictIfNeeded(now);
  seen.set(key, { expiresAt: now + TTL_MS });
  return true;
}

/**
 * Test-only: clear the dedupe cache.
 */
export function _resetWebhookSeen(): void {
  seen.clear();
}
