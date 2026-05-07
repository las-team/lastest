/**
 * Accessibility diff — Chromatic-style "new violations only".
 *
 * Keys each violation by `(ruleId, primary-target-or-role, impact)` so the
 * same rule firing on the same node across runs is the same violation. The
 * diff returns:
 *   - newViolations: present in current, absent in baseline (HIGH SIGNAL,
 *     especially critical/serious)
 *   - disappeared: fixes (informational)
 *   - newBySeverity: counts for verdict scoring
 *
 * The host's `a11yViolations` is the axe-core output already aggregated
 * per result. We don't have per-node fingerprints there (just a `nodes`
 * count), so the key is `(id, impact)` plus a hash-bucket on tags. Good
 * enough to distinguish the same rule on different pages from the same
 * rule on the same page across runs.
 */

import type { A11yViolation, A11yDiffSummary } from '@/lib/db/schema';

function violationKey(v: A11yViolation): string {
  // Tags act as a coarse selector — rules fired with `wcag2aa` differ from
  // the same id fired with `best-practice`.
  const tagKey = (v.tags ?? []).slice().sort().join(',');
  return `${v.id}::${v.impact}::${tagKey}`;
}

export function computeA11yDiff(
  baseline: A11yViolation[],
  current: A11yViolation[],
): A11yDiffSummary {
  const baseMap = new Map(baseline.map(v => [violationKey(v), v]));
  const currMap = new Map(current.map(v => [violationKey(v), v]));

  const newViolations: A11yViolation[] = [];
  const disappeared: A11yViolation[] = [];
  const newBySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  for (const [key, v] of currMap) {
    if (!baseMap.has(key)) {
      newViolations.push(v);
      newBySeverity[v.impact]++;
    }
  }
  for (const [key, v] of baseMap) {
    if (!currMap.has(key)) disappeared.push(v);
  }

  return { newViolations, disappeared, newBySeverity };
}

export function summarizeA11yDiff(d: A11yDiffSummary): string {
  if (d.newViolations.length === 0 && d.disappeared.length === 0) return 'No a11y changes';
  const parts: string[] = [];
  if (d.newBySeverity.critical) parts.push(`${d.newBySeverity.critical} new critical`);
  if (d.newBySeverity.serious) parts.push(`${d.newBySeverity.serious} new serious`);
  if (d.newBySeverity.moderate) parts.push(`${d.newBySeverity.moderate} new moderate`);
  if (d.newBySeverity.minor) parts.push(`${d.newBySeverity.minor} new minor`);
  if (d.disappeared.length) parts.push(`${d.disappeared.length} resolved`);
  return parts.join(', ') || 'No a11y changes';
}
