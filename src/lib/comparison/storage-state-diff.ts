/**
 * Storage-state diff engine (spec 27 — the State layer). Compares the
 * current run's end-of-run cookies + localStorage snapshot against the
 * baseline run's, keyed structurally:
 *
 *   cookies       → (domain, path, name), compared by valueHash
 *   localStorage  → (origin, name), compared by value (when parseable JSON
 *                   was stored) or valueHash
 *
 * Values are hashed at capture time (see StorageStateSnapshot), so the diff
 * can say "changed" but never leak what changed to. Purely informational —
 * evidence is emitted at 'low' signal and never gates a verdict.
 */

import type {
  StorageStateSnapshot,
  StorageStateDiffEntry,
  StorageStateDiffSummary,
} from "@/lib/db/schema";

function cookieKey(c: StorageStateSnapshot["cookies"][number]): string {
  return `${c.domain} ${c.path} ${c.name}`;
}

function localKey(l: StorageStateSnapshot["localStorage"][number]): string {
  return `${l.origin} ${l.name}`;
}

function localFingerprint(
  l: StorageStateSnapshot["localStorage"][number],
): string {
  if (l.valueHash) return `h:${l.valueHash}`;
  try {
    return `v:${JSON.stringify(l.value)}`;
  } catch {
    return "v:?";
  }
}

export function computeStorageStateDiff(
  baseline: StorageStateSnapshot | null | undefined,
  current: StorageStateSnapshot | null | undefined,
): StorageStateDiffSummary | null {
  // Both sides must exist — diffing against a missing baseline snapshot
  // would report every entry as "added" and drown the signal.
  if (!baseline || !current) return null;

  const cookies: StorageStateDiffEntry[] = [];
  const localStorageEntries: StorageStateDiffEntry[] = [];

  const baseCookies = new Map(
    (baseline.cookies ?? []).map((c) => [cookieKey(c), c]),
  );
  const curCookies = new Map(
    (current.cookies ?? []).map((c) => [cookieKey(c), c]),
  );
  for (const [key, cur] of curCookies) {
    const base = baseCookies.get(key);
    if (!base) {
      cookies.push({ key, change: "added" });
    } else if (
      base.valueHash &&
      cur.valueHash &&
      base.valueHash !== cur.valueHash
    ) {
      cookies.push({ key, change: "changed", detail: "value changed" });
    }
  }
  for (const key of baseCookies.keys()) {
    if (!curCookies.has(key)) cookies.push({ key, change: "removed" });
  }

  const baseLocal = new Map(
    (baseline.localStorage ?? []).map((l) => [localKey(l), l]),
  );
  const curLocal = new Map(
    (current.localStorage ?? []).map((l) => [localKey(l), l]),
  );
  for (const [key, cur] of curLocal) {
    const base = baseLocal.get(key);
    if (!base) {
      localStorageEntries.push({ key, change: "added" });
    } else if (localFingerprint(base) !== localFingerprint(cur)) {
      localStorageEntries.push({
        key,
        change: "changed",
        detail: "value changed",
      });
    }
  }
  for (const key of baseLocal.keys()) {
    if (!curLocal.has(key))
      localStorageEntries.push({ key, change: "removed" });
  }

  const all = [...cookies, ...localStorageEntries];
  if (all.length === 0) return null;

  return {
    cookies,
    localStorage: localStorageEntries,
    addedCount: all.filter((e) => e.change === "added").length,
    removedCount: all.filter((e) => e.change === "removed").length,
    changedCount: all.filter((e) => e.change === "changed").length,
  };
}

export function summarizeStorageStateDiff(
  diff: StorageStateDiffSummary,
): string {
  const parts: string[] = [];
  if (diff.addedCount) parts.push(`+${diff.addedCount}`);
  if (diff.removedCount) parts.push(`−${diff.removedCount}`);
  if (diff.changedCount) parts.push(`~${diff.changedCount}`);
  return `storage state: ${parts.join(" ")} (cookies ${diff.cookies.length}, localStorage ${diff.localStorage.length})`;
}
