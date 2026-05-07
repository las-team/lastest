/**
 * URL-trajectory diff — pairs baseline and current step lists by stepIndex
 * and flags steps where the page ended up at a different URL.
 *
 * High-signal cases:
 *   - finalUrl differs after normalization (auth/SSO/routing regression)
 *   - redirect-chain length changed (silent extra hop, often security)
 *
 * Normalization: strip session/auth query params, collapse digit-only path
 * segments to `:id` so /orders/123 == /orders/456 (we want to flag *route*
 * divergence, not parameter changes).
 */

import type { UrlTrajectoryStep, UrlTrajectoryDiffSummary } from '@/lib/db/schema';

export function normalizeTrajectoryUrl(url: string): string {
  // Short-circuit non-navigable schemes — `new URL('about:blank')` parses but
  // produces a meaningless `origin: 'null'` that breaks reconstruction.
  if (!/^https?:/i.test(url)) return url;
  try {
    const u = new URL(url);
    const noisy = /^(_|t|ts|cb|nonce|csrf|xsrf|token|sid|sessionid|state|code)$/i;
    const keep: string[] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (noisy.test(k)) continue;
      keep.push(`${k}=${v}`);
    }
    keep.sort();
    const path = u.pathname.split('/').map(seg => {
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[a-f0-9]{24,}$/i.test(seg)) return ':hash';
      return seg;
    }).join('/');
    return `${u.origin}${path}${keep.length ? '?' + keep.join('&') : ''}`;
  } catch {
    return url;
  }
}

export function computeUrlTrajectoryDiff(
  baseline: UrlTrajectoryStep[],
  current: UrlTrajectoryStep[],
): UrlTrajectoryDiffSummary {
  const baseByIndex = new Map(baseline.map(s => [s.stepIndex, s]));
  const currByIndex = new Map(current.map(s => [s.stepIndex, s]));
  const allIndexes = new Set([...baseByIndex.keys(), ...currByIndex.keys()]);

  const divergedSteps: UrlTrajectoryDiffSummary['divergedSteps'] = [];
  let totalCompared = 0;

  for (const idx of [...allIndexes].sort((a, b) => a - b)) {
    const b = baseByIndex.get(idx);
    const c = currByIndex.get(idx);
    if (!b || !c) continue;
    totalCompared++;

    const baseUrl = normalizeTrajectoryUrl(b.finalUrl);
    const currUrl = normalizeTrajectoryUrl(c.finalUrl);
    const urlChanged = baseUrl !== currUrl;
    const redirectChanged = b.redirectChain.length !== c.redirectChain.length;

    if (urlChanged || redirectChanged) {
      divergedSteps.push({
        stepIndex: idx,
        stepLabel: c.stepLabel ?? b.stepLabel,
        baselineUrl: b.finalUrl,
        currentUrl: c.finalUrl,
        redirectChainChanged: redirectChanged,
      });
    }
  }

  return { divergedSteps, totalStepsCompared: totalCompared };
}

export function summarizeUrlTrajectoryDiff(d: UrlTrajectoryDiffSummary): string {
  if (d.divergedSteps.length === 0) return 'No URL trajectory changes';
  const redirects = d.divergedSteps.filter(s => s.redirectChainChanged).length;
  const parts = [`${d.divergedSteps.length} step(s) diverged`];
  if (redirects) parts.push(`${redirects} with redirect-chain change`);
  return parts.join(', ');
}
