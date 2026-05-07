/**
 * Pairwise diff over two `NetworkRequest[]` captures from prior test runs.
 *
 * Order is unstable across runs (parallel fetches), so we match by
 * (method, normalized URL, occurrence index within that key). Bodies and
 * headers are diffed shallowly — full body inspection is the UI's job.
 */

import type {
  NetworkRequest,
  NetworkInspectionPayload,
  NetworkInspectionRow,
} from '../db/schema';

export interface NetworkDiffOptions {
  // Substrings stripped from URL query strings before matching.
  ignoreUrlParams?: string[];
  // Hosts to drop from comparison entirely (e.g. analytics).
  ignoreHosts?: string[];
}

const DEFAULT_IGNORE_PARAMS = ['t', 'cb', '_', 'v', 'ts', 'timestamp', 'rand', 'nonce'];

function normalizeUrl(raw: string, ignoreParams: string[]): string {
  try {
    const u = new URL(raw);
    for (const p of ignoreParams) u.searchParams.delete(p);
    // Strip hash; usually irrelevant for network correlation.
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function buildKey(req: NetworkRequest, ignoreParams: string[]): string {
  return `${req.method.toUpperCase()}::${normalizeUrl(req.url, ignoreParams)}`;
}

function shallowEqualHeaders(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function classifyRow(
  baseline: NetworkRequest | undefined,
  current: NetworkRequest | undefined,
): { kind: NetworkInspectionRow['kind']; changes: NetworkInspectionRow['changes'] } {
  if (!baseline && current) return { kind: 'added', changes: [] };
  if (baseline && !current) return { kind: 'removed', changes: [] };
  if (!baseline || !current) return { kind: 'unchanged', changes: [] };

  const changes: NetworkInspectionRow['changes'] = [];
  if (baseline.status !== current.status) changes.push('status');
  // Duration delta only "interesting" if > 50ms AND > 25% relative.
  if (
    Math.abs(baseline.duration - current.duration) > 50 &&
    Math.abs(baseline.duration - current.duration) / Math.max(baseline.duration, 1) > 0.25
  ) {
    changes.push('duration');
  }
  const baseSize = baseline.responseSize ?? 0;
  const currSize = current.responseSize ?? 0;
  if (Math.abs(baseSize - currSize) > 16) changes.push('size');
  if (
    !shallowEqualHeaders(baseline.responseHeaders, current.responseHeaders) ||
    !shallowEqualHeaders(baseline.requestHeaders, current.requestHeaders)
  ) {
    changes.push('headers');
  }
  if ((baseline.responseBody ?? '') !== (current.responseBody ?? '')) {
    changes.push('body');
  }

  return changes.length === 0
    ? { kind: 'unchanged', changes: [] }
    : { kind: 'changed', changes };
}

export function diffNetworkRequests(
  baseline: NetworkRequest[],
  current: NetworkRequest[],
  options: NetworkDiffOptions = {},
): NetworkInspectionPayload {
  const ignoreParams = [...DEFAULT_IGNORE_PARAMS, ...(options.ignoreUrlParams ?? [])];
  const ignoreHosts = new Set(options.ignoreHosts ?? []);

  const filterFn = (r: NetworkRequest) => {
    const host = hostOf(r.url);
    return !host || !ignoreHosts.has(host);
  };
  const base = baseline.filter(filterFn);
  const curr = current.filter(filterFn);

  // Bucket by key, preserving order for occurrence-index matching.
  const baseBuckets = new Map<string, NetworkRequest[]>();
  for (const r of base) {
    const k = buildKey(r, ignoreParams);
    const arr = baseBuckets.get(k) ?? [];
    arr.push(r);
    baseBuckets.set(k, arr);
  }
  const currBuckets = new Map<string, NetworkRequest[]>();
  for (const r of curr) {
    const k = buildKey(r, ignoreParams);
    const arr = currBuckets.get(k) ?? [];
    arr.push(r);
    currBuckets.set(k, arr);
  }

  const rows: NetworkInspectionRow[] = [];
  const seenKeys = new Set<string>();

  const pushRow = (
    key: string,
    occ: number,
    baselineReq: NetworkRequest | undefined,
    currentReq: NetworkRequest | undefined,
  ) => {
    const { kind, changes } = classifyRow(baselineReq, currentReq);
    const ref = currentReq ?? baselineReq!;
    rows.push({
      key: `${key}#${occ}`,
      method: ref.method,
      url: ref.url,
      baseline: baselineReq,
      current: currentReq,
      kind,
      changes,
      durationDeltaMs:
        baselineReq && currentReq ? currentReq.duration - baselineReq.duration : undefined,
      sizeDelta:
        baselineReq && currentReq
          ? (currentReq.responseSize ?? 0) - (baselineReq.responseSize ?? 0)
          : undefined,
    });
  };

  for (const [key, baseList] of baseBuckets) {
    seenKeys.add(key);
    const currList = currBuckets.get(key) ?? [];
    const max = Math.max(baseList.length, currList.length);
    for (let i = 0; i < max; i++) pushRow(key, i, baseList[i], currList[i]);
  }
  for (const [key, currList] of currBuckets) {
    if (seenKeys.has(key)) continue;
    for (let i = 0; i < currList.length; i++) pushRow(key, i, undefined, currList[i]);
  }

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  let failedDelta = 0;
  for (const row of rows) {
    if (row.kind === 'added') added++;
    else if (row.kind === 'removed') removed++;
    else if (row.kind === 'changed') changed++;
    else unchanged++;
    const baseFailed = row.baseline?.failed ? 1 : 0;
    const currFailed = row.current?.failed ? 1 : 0;
    failedDelta += currFailed - baseFailed;
  }

  return {
    rows,
    summary: { added, removed, changed, unchanged, failedDelta },
  };
}
