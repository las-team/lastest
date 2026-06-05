/**
 * Network diff engine — compares two `NetworkRequest[]` lists and produces
 * a structured diff with high-signal classifications (new 4xx/5xx, status
 * flips) versus low-signal noise (latency, response-size delta).
 *
 * Matching strategy: normalized URL + method. URLs have query-string nonces,
 * timestamps, and digit-only path segments stripped to keep keys stable
 * across runs. Multiple requests with the same key are paired by request
 * order (baseline[i] ↔ current[i]).
 *
 * High-signal classifications (Sentry/HAR-diff convention):
 *  - new 4xx/5xx response on a URL that returned ok last run
 *  - request that disappeared (potentially blocked or refactored)
 *  - status code flip (3xx → 200 is fine; 200 → 5xx is a regression)
 *
 * Low-signal (reported but not gated): latency change, response-size delta,
 * header-only diffs.
 */

import type { NetworkRequest, NetworkDiffSummary } from "@/lib/db/schema";

/** Strip nonces and IDs from URLs so the same logical request keys match
 *  across runs. Conservative — leaves real path segments alone. */
export function normalizeRequestUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop noisy query params
    const noisy = /^(_|t|ts|cb|nonce|csrf|xsrf|token|sid|sessionid)$/i;
    const keep: string[] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (noisy.test(k)) continue;
      keep.push(`${k}=${v}`);
    }
    keep.sort();
    // Replace digit-only path segments with `:id` so /users/123 == /users/456.
    // Same for hash-like segments (32+ hex chars).
    const path = u.pathname
      .split("/")
      .map((seg) => {
        if (/^\d+$/.test(seg)) return ":id";
        if (/^[a-f0-9]{24,}$/i.test(seg)) return ":hash";
        return seg;
      })
      .join("/");
    return `${u.origin}${path}${keep.length ? "?" + keep.join("&") : ""}`;
  } catch {
    return url;
  }
}

function statusClass(status: number): "ok" | "3xx" | "4xx" | "5xx" | "other" {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

interface NetworkDiffOptions {
  /** Override the default ignore list for query-param keys. */
  ignoreQueryParams?: RegExp;
}

export function computeNetworkDiff(
  baseline: NetworkRequest[],
  current: NetworkRequest[],
  _options: NetworkDiffOptions = {},
): NetworkDiffSummary {
  // Bucket by (method, normalized URL). Within each bucket we pair by order.
  const bucket = (list: NetworkRequest[]) => {
    const map = new Map<string, NetworkRequest[]>();
    for (const r of list) {
      const key = `${r.method.toUpperCase()} ${normalizeRequestUrl(r.url)}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  };

  const baseMap = bucket(baseline);
  const currMap = bucket(current);

  const summary: NetworkDiffSummary = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    addedEndpoints: 0,
    removedEndpoints: 0,
    changedEndpoints: 0,
    newErrorCount: 0,
    newClientErrors: [],
    newServerErrors: [],
    statusFlips: [],
  };

  const allKeys = new Set([...baseMap.keys(), ...currMap.keys()]);

  for (const key of allKeys) {
    const b = baseMap.get(key) ?? [];
    const c = currMap.get(key) ?? [];
    const pairCount = Math.min(b.length, c.length);
    let bucketAdded = 0;
    let bucketRemoved = 0;
    let bucketChanged = 0;

    // Paired: detect status flips, count unchanged vs changed
    for (let i = 0; i < pairCount; i++) {
      const baseReq = b[i];
      const currReq = c[i];
      if (baseReq.status === currReq.status) {
        summary.unchanged++;
      } else {
        summary.changed++;
        bucketChanged++;
        const baseClass = statusClass(baseReq.status);
        const currClass = statusClass(currReq.status);
        // High-signal: anything → 4xx/5xx, or 4xx/5xx → recovery still flagged
        if (baseClass !== currClass) {
          summary.statusFlips.push({
            url: currReq.url,
            method: currReq.method,
            from: baseReq.status,
            to: currReq.status,
          });
          if (currClass === "4xx" && baseClass !== "4xx") {
            summary.newClientErrors.push({
              url: currReq.url,
              method: currReq.method,
              status: currReq.status,
            });
            summary.newErrorCount++;
          }
          if (currClass === "5xx" && baseClass !== "5xx") {
            summary.newServerErrors.push({
              url: currReq.url,
              method: currReq.method,
              status: currReq.status,
            });
            summary.newErrorCount++;
          }
        }
      }
    }

    // Excess on current side = added requests
    for (let i = pairCount; i < c.length; i++) {
      summary.added++;
      bucketAdded++;
      const cls = statusClass(c[i].status);
      if (cls === "4xx") {
        summary.newClientErrors.push({
          url: c[i].url,
          method: c[i].method,
          status: c[i].status,
        });
        summary.newErrorCount++;
      } else if (cls === "5xx") {
        summary.newServerErrors.push({
          url: c[i].url,
          method: c[i].method,
          status: c[i].status,
        });
        summary.newErrorCount++;
      }
    }

    // Excess on baseline side = removed requests
    for (let i = pairCount; i < b.length; i++) {
      summary.removed++;
      bucketRemoved++;
    }

    // Promote per-bucket totals to endpoint-level counts so a single endpoint
    // firing N times (cache warmup, retries) reports as 1, not N. (Field is
    // typed optional for read-back of legacy rows; here we always populate it.)
    if (bucketAdded > 0)
      summary.addedEndpoints = (summary.addedEndpoints ?? 0) + 1;
    if (bucketRemoved > 0)
      summary.removedEndpoints = (summary.removedEndpoints ?? 0) + 1;
    if (bucketChanged > 0)
      summary.changedEndpoints = (summary.changedEndpoints ?? 0) + 1;
  }

  return summary;
}

export function summarizeNetworkDiff(d: NetworkDiffSummary): string {
  const parts: string[] = [];
  if (d.newServerErrors.length)
    parts.push(`${d.newServerErrors.length} new 5xx`);
  if (d.newClientErrors.length)
    parts.push(`${d.newClientErrors.length} new 4xx`);
  // Endpoint-level counts: a single endpoint firing N extra times reports as 1,
  // not N. Avoids inflated "84 added" lines when an auth retry loop fires.
  if (d.addedEndpoints) parts.push(`${d.addedEndpoints} endpoint(s) added`);
  if (d.removedEndpoints)
    parts.push(`${d.removedEndpoints} endpoint(s) removed`);
  if (d.changedEndpoints && !d.newErrorCount)
    parts.push(`${d.changedEndpoints} endpoint(s) changed`);
  if (parts.length === 0) return "No network changes";
  return parts.join(", ");
}
