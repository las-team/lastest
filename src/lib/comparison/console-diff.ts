/**
 * Console-error diff engine — Sentry-style fingerprinting + set diff.
 *
 * Each console message is fingerprinted by `(level, normalized-message,
 * top-stack-frame)` so a flood of "Cannot read property X of undefined" all
 * collapses to one fingerprint. The diff returns:
 *   - newFingerprints: present in current, absent in baseline (HIGH SIGNAL)
 *   - disappeared: present in baseline, absent in current (low signal)
 *   - countDelta: per-fingerprint count change (medium signal)
 *
 * Inputs are the raw `consoleErrors: string[]` from a TestResult — already
 * pre-filtered to errors-only by the EB executor's console event handler.
 */

import type { ConsoleDiffSummary } from '@/lib/db/schema';

interface Fingerprint {
  fingerprint: string;
  sample: string;
  count: number;
}

/** Reduce a console message to a stable fingerprint key.
 *
 * Strips numbers (likely IDs), URLs (likely paths), and quoted values from
 * the message body — keeping the structural shape of the error. The
 * top-of-stack line is preserved so we can distinguish errors that share a
 * message but originate in different code. */
export function fingerprintConsoleMessage(raw: string): { fingerprint: string; sample: string } {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const head = lines[0] ?? '';
  // Find the first stack frame line (heuristic: starts with "at " or contains a colon-line-col pattern)
  const stack = lines.slice(1).find(l => /^at\s|:\d+:\d+/.test(l)) ?? '';

  // Normalize the message body: strip URLs, quoted strings, numbers, hashes
  const normalize = (s: string) => s
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '<hex>')
    .replace(/\b\d+(\.\d+)?\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();

  const headNorm = normalize(head);
  const stackNorm = stack
    .replace(/\(.+:\d+:\d+\)/g, '(<loc>)') // collapse line:col anchors
    .replace(/https?:\/\/\S+/g, '<url>')
    .trim();

  const fingerprint = `${headNorm} :: ${stackNorm}`;
  return { fingerprint, sample: head.slice(0, 200) };
}

function fingerprintCounts(messages: string[]): Map<string, Fingerprint> {
  const map = new Map<string, Fingerprint>();
  for (const m of messages) {
    const { fingerprint, sample } = fingerprintConsoleMessage(m);
    const existing = map.get(fingerprint);
    if (existing) {
      existing.count++;
    } else {
      map.set(fingerprint, { fingerprint, sample, count: 1 });
    }
  }
  return map;
}

export function computeConsoleDiff(
  baseline: string[],
  current: string[],
): ConsoleDiffSummary {
  const baseMap = fingerprintCounts(baseline);
  const currMap = fingerprintCounts(current);

  const newFingerprints: Fingerprint[] = [];
  const disappeared: Fingerprint[] = [];
  const countDelta: Record<string, number> = {};

  for (const [fp, item] of currMap) {
    if (!baseMap.has(fp)) {
      newFingerprints.push(item);
    } else {
      const delta = item.count - (baseMap.get(fp)?.count ?? 0);
      if (delta !== 0) countDelta[fp] = delta;
    }
  }
  for (const [fp, item] of baseMap) {
    if (!currMap.has(fp)) disappeared.push(item);
  }

  return { newFingerprints, disappeared, countDelta };
}

export function summarizeConsoleDiff(d: ConsoleDiffSummary): string {
  if (d.newFingerprints.length === 0 && d.disappeared.length === 0 && Object.keys(d.countDelta).length === 0) {
    return 'No console changes';
  }
  const parts: string[] = [];
  if (d.newFingerprints.length) parts.push(`${d.newFingerprints.length} new console error(s)`);
  if (d.disappeared.length) parts.push(`${d.disappeared.length} resolved`);
  const deltaCount = Object.keys(d.countDelta).length;
  if (deltaCount) parts.push(`${deltaCount} count delta(s)`);
  return parts.join(', ');
}
