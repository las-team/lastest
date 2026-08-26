/**
 * Dynamic-data text detection for RCA.
 *
 * When a DOM text node changes between baseline and current, we need to decide
 * whether the change is *volatile data* (a clock, a counter, a "3 minutes ago",
 * a generated id — i.e. TEST noise) or *real content* (copy edited because the
 * code changed). The heuristic: mask every dynamic-looking token in both
 * strings and compare the skeletons. If the masked skeletons are equal but the
 * raw strings differ, the only thing that moved was volatile data.
 *
 * Pure, dependency-free, and unit-tested — no DB or network access.
 */

// Order matters: longer / more specific patterns first so they win the mask.
const DYNAMIC_PATTERNS: RegExp[] = [
  // UUID
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // ISO-ish date/time (2026-06-16, 2026-06-16T12:34:56, with optional Z/offset)
  /\b\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?)?\b/gi,
  // Slash/dot dates (06/16/2026, 16.06.26)
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
  // Month-name dates (Jun 16, 2026 / 16 June 2026 / January 1st)
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?(,?\s*\d{2,4})?\b/gi,
  /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(,?\s*\d{2,4})?\b/gi,
  // Clock times (12:34, 12:34:56, 1:05 pm)
  /\b\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm)?\b/gi,
  // Relative time ("3 minutes ago", "in 2 days", "just now", "yesterday")
  /\b\d+\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s*(ago|from now)?\b/gi,
  /\b(just now|moments ago|yesterday|today|tomorrow|last (week|month|year))\b/gi,
  // Currency (with thousands separators / decimals)
  /[$€£¥₹]\s?\d[\d,.\s]*\d|\b\d[\d,]*\.\d{2}\b/g,
  // Percentages
  /\b\d+(\.\d+)?\s?%/g,
  // Long alphanumeric tokens / hashes (ids, tokens) — 16+ chars
  /\b[0-9a-z]{16,}\b/gi,
  // Bare numbers / counters (with optional thousands separators) — LAST so it
  // doesn't eat the more specific patterns above.
  /\b\d[\d,]*(\.\d+)?\b/g,
];

const MASK = "·"; // single sentinel; collapses runs so "1,234" vs "9" both → ·

/** Replace every dynamic-looking token with a single sentinel and normalize
 *  whitespace/case, yielding the "skeleton" of the string. */
export function maskDynamic(text: string): string {
  let out = text;
  for (const re of DYNAMIC_PATTERNS) out = out.replace(re, MASK);
  // Collapse adjacent sentinels (and the whitespace between them) into one.
  out = out.replace(new RegExp(`(\\s*${MASK}\\s*)+`, "g"), MASK);
  return out.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when baseline→current differs ONLY in dynamic data (dates, counters,
 * ids, currency, …). Returns false when the skeletons are identical (no change)
 * or when non-dynamic words changed (real content edit).
 */
export function isDynamicTextChange(
  baseline: string | undefined,
  current: string | undefined,
): boolean {
  const b = (baseline ?? "").trim();
  const c = (current ?? "").trim();
  if (b === c) return false; // nothing changed
  const mb = maskDynamic(b);
  const mc = maskDynamic(c);
  if (mb !== mc) return false; // skeletons differ → real content change
  // Skeletons match but raw differs → the delta was purely dynamic data.
  // Require that masking actually removed something (otherwise mb===mc===raw
  // would imply b===c, already handled).
  return mb !== b.toLowerCase().replace(/\s+/g, " ").trim() || mc !== c;
}

/** True when the whole string is (almost) nothing but dynamic tokens — e.g. a
 *  standalone clock or counter. Useful when only one side's text is known. */
export function isPurelyDynamic(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const masked = maskDynamic(t);
  // Strip sentinels + punctuation/whitespace; if nothing meaningful remains,
  // the string was essentially all dynamic data.
  const residue = masked
    .replace(new RegExp(MASK, "g"), "")
    .replace(/[\s\p{P}]/gu, "");
  return residue.length === 0;
}
