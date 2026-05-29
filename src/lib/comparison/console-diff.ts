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

import type { ConsoleDiffSummary, ConsoleFingerprintCategory } from '@/lib/db/schema';

interface Fingerprint {
  fingerprint: string;
  sample: string;
  count: number;
  category: ConsoleFingerprintCategory;
}

/** Hostname / path fragments that indicate a third-party SDK / analytics tag.
 *  Matched against the stack-frame URL — kept conservative; only well-known
 *  vendors so genuine app errors emitted from a CDN-hosted bundle aren't
 *  silenced. */
const THIRD_PARTY_HOSTS = [
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
  'facebook.net', 'fbcdn.net', 'connect.facebook.net',
  'segment.io', 'segment.com',
  'mixpanel.com', 'amplitude.com',
  'hotjar.com', 'fullstory.com', 'logrocket.com',
  'intercom.io', 'intercomcdn.com',
  'stripe.com', 'stripe.network',
  'sentry-cdn.com', 'sentry.io',
  'cdnjs.cloudflare.com',
  // Cloudflare email-decode injects a script that fires "Failed to decode
  // address" warnings on every page with an obfuscated mailto:
  'email-decode.min.js',
];

/** Classify a console message by its likely owner so the verdict scorer can
 *  weight new app errors above transient network or third-party noise.
 *
 *  Inputs are the raw message + the (optional) top-of-stack frame string the
 *  fingerprinter already extracted. We pattern-match on the stack URL first
 *  (most reliable), then fall back to message-shape heuristics. */
export function classifyConsoleFingerprint(
  rawMessage: string,
  stackFrame: string,
): ConsoleFingerprintCategory {
  // 1. Stack-frame URL match — most reliable signal.
  const urlInStack = stackFrame.match(/https?:\/\/[^\s)]+/)?.[0] ?? '';
  if (urlInStack) {
    if (THIRD_PARTY_HOSTS.some(host => urlInStack.includes(host))) return 'thirdParty';
  }
  // 2. CSP violation reports.
  if (/Content Security Policy|Refused to (execute|load|connect|frame|apply)/i.test(rawMessage)) {
    return 'csp';
  }
  // 3. "Failed to load resource" lines — these are network failures emitted
  //    by the browser itself, not the app. The fingerprint surfaces them
  //    (useful for "is this a regression?"), but they shouldn't read as an
  //    app exception when scoring.
  if (/^Failed to load resource:|net::ERR_/i.test(rawMessage)) {
    return 'network';
  }
  // 4. App vs unknown — if we have a stack URL that wasn't third-party, treat
  //    as app. Otherwise we don't know enough to claim ownership.
  if (urlInStack) return 'app';
  return 'unknown';
}

/** Reduce a console message to a stable fingerprint key.
 *
 * Strips numbers (likely IDs), URLs (likely paths), and quoted values from
 * the message body — keeping the structural shape of the error. The
 * top-of-stack line is preserved so we can distinguish errors that share a
 * message but originate in different code. */
export function fingerprintConsoleMessage(raw: string): { fingerprint: string; sample: string; category: ConsoleFingerprintCategory } {
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
  const category = classifyConsoleFingerprint(head, stack);
  return { fingerprint, sample: head.slice(0, 200), category };
}

function fingerprintCounts(messages: string[]): Map<string, Fingerprint> {
  const map = new Map<string, Fingerprint>();
  for (const m of messages) {
    const { fingerprint, sample, category } = fingerprintConsoleMessage(m);
    const existing = map.get(fingerprint);
    if (existing) {
      existing.count++;
    } else {
      map.set(fingerprint, { fingerprint, sample, count: 1, category });
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
