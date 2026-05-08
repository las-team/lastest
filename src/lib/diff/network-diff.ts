/**
 * Network-diff engine — sibling to visual-diff and dom-diff.
 *
 * Compares two arrays of EmbeddedNetworkRequest (one from each captured URL)
 * and produces an actionable summary of added, removed, status-changed,
 * size-changed, slow-down and failed requests, plus per-side aggregates.
 */

export interface NetworkRequestLike {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  failed?: boolean;
  responseSize?: number;
}

export interface NetworkDiffEntry {
  url: string;
  method: string;
  resourceType: string;
  baseline?: { status: number; bytes: number; durationMs: number };
  current?: { status: number; bytes: number; durationMs: number };
}

export interface NetworkDiffSummary {
  countA: number;
  countB: number;
  bytesA: number;
  bytesB: number;
  byTypeA: Record<string, number>;
  byTypeB: Record<string, number>;
  thirdPartyDomainsA: string[];
  thirdPartyDomainsB: string[];
  failedCountA: number;
  failedCountB: number;
}

export interface NetworkDiffResult {
  added: NetworkDiffEntry[];
  removed: NetworkDiffEntry[];
  changedStatus: NetworkDiffEntry[];
  changedSize: NetworkDiffEntry[];
  slowdowns: NetworkDiffEntry[];
  failedA: NetworkDiffEntry[];
  failedB: NetworkDiffEntry[];
  summary: NetworkDiffSummary;
}

const NONCE_PARAMS = new Set(['_t', 'cb', '_', 'v', 'ts', 'nocache', 'rand', 'r']);
const HEX_NONCE = /^[a-f0-9]{12,}$/i;
const SIZE_DELTA_THRESHOLD = 0.10; // 10%
const SLOWDOWN_ABSOLUTE_MS = 200;
const SLOWDOWN_RATIO = 1.5;

/**
 * Strip cache-busting query nonces and sort remaining params for stable matching.
 * Returns a normalised URL or the input on parse failure.
 */
export function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const keep: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    if (NONCE_PARAMS.has(key)) return;
    if (HEX_NONCE.test(value)) return;
    keep.push([key, value]);
  });
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  parsed.search = '';
  for (const [k, v] of keep) parsed.searchParams.append(k, v);
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Suffix-after-dot match. `cdn.example.com` is first-party for `example.com`.
 * `foo-example.com` is NOT first-party for `example.com` (no dot before).
 */
export function isThirdParty(reqHost: string, primaryHost: string): boolean {
  if (!reqHost || !primaryHost) return true;
  const r = reqHost.toLowerCase();
  const p = primaryHost.toLowerCase();
  if (r === p) return false;
  if (r.endsWith('.' + p)) return false;
  return true;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function entryFrom(req: NetworkRequestLike): NetworkDiffEntry {
  return {
    url: req.url,
    method: req.method,
    resourceType: req.resourceType,
    baseline: undefined,
    current: undefined,
  };
}

function snap(req: NetworkRequestLike) {
  return {
    status: req.status,
    bytes: req.responseSize ?? 0,
    durationMs: req.duration ?? 0,
  };
}

function summariseSide(reqs: NetworkRequestLike[], primaryHost: string): {
  count: number;
  bytes: number;
  byType: Record<string, number>;
  thirdParty: string[];
  failed: number;
} {
  let bytes = 0;
  let failed = 0;
  const byType: Record<string, number> = {};
  const thirdParty = new Set<string>();
  for (const r of reqs) {
    bytes += r.responseSize ?? 0;
    if (r.failed) failed++;
    byType[r.resourceType] = (byType[r.resourceType] ?? 0) + 1;
    const host = hostOf(r.url);
    if (host && isThirdParty(host, primaryHost)) thirdParty.add(host);
  }
  return {
    count: reqs.length,
    bytes,
    byType,
    thirdParty: [...thirdParty].sort(),
    failed,
  };
}

export function computeNetworkDiff(
  reqsA: NetworkRequestLike[],
  reqsB: NetworkRequestLike[],
  primaryHostA: string,
  primaryHostB: string,
): NetworkDiffResult {
  const mapA = new Map<string, NetworkRequestLike>();
  const mapB = new Map<string, NetworkRequestLike>();

  for (const r of reqsA) {
    const key = `${r.method.toUpperCase()} ${normalizeUrl(r.url)}`;
    if (!mapA.has(key)) mapA.set(key, r);
  }
  for (const r of reqsB) {
    const key = `${r.method.toUpperCase()} ${normalizeUrl(r.url)}`;
    if (!mapB.has(key)) mapB.set(key, r);
  }

  const added: NetworkDiffEntry[] = [];
  const removed: NetworkDiffEntry[] = [];
  const changedStatus: NetworkDiffEntry[] = [];
  const changedSize: NetworkDiffEntry[] = [];
  const slowdowns: NetworkDiffEntry[] = [];

  for (const [key, b] of mapB) {
    const a = mapA.get(key);
    if (!a) {
      added.push({ ...entryFrom(b), current: snap(b) });
      continue;
    }
    const aSnap = snap(a);
    const bSnap = snap(b);
    if (aSnap.status !== bSnap.status) {
      changedStatus.push({ ...entryFrom(b), baseline: aSnap, current: bSnap });
    }
    const max = Math.max(aSnap.bytes, bSnap.bytes);
    if (max > 0 && Math.abs(bSnap.bytes - aSnap.bytes) / max > SIZE_DELTA_THRESHOLD) {
      changedSize.push({ ...entryFrom(b), baseline: aSnap, current: bSnap });
    }
    if (
      bSnap.durationMs - aSnap.durationMs > SLOWDOWN_ABSOLUTE_MS &&
      aSnap.durationMs > 0 &&
      bSnap.durationMs > aSnap.durationMs * SLOWDOWN_RATIO
    ) {
      slowdowns.push({ ...entryFrom(b), baseline: aSnap, current: bSnap });
    }
  }
  for (const [key, a] of mapA) {
    if (!mapB.has(key)) removed.push({ ...entryFrom(a), baseline: snap(a) });
  }

  const sumA = summariseSide(reqsA, primaryHostA);
  const sumB = summariseSide(reqsB, primaryHostB);

  return {
    added,
    removed,
    changedStatus,
    changedSize,
    slowdowns,
    failedA: reqsA.filter((r) => r.failed).map((r) => ({ ...entryFrom(r), baseline: snap(r) })),
    failedB: reqsB.filter((r) => r.failed).map((r) => ({ ...entryFrom(r), current: snap(r) })),
    summary: {
      countA: sumA.count,
      countB: sumB.count,
      bytesA: sumA.bytes,
      bytesB: sumB.bytes,
      byTypeA: sumA.byType,
      byTypeB: sumB.byType,
      thirdPartyDomainsA: sumA.thirdParty,
      thirdPartyDomainsB: sumB.thirdParty,
      failedCountA: sumA.failed,
      failedCountB: sumB.failed,
    },
  };
}
