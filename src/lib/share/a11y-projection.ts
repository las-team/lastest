/**
 * Slim, share-safe projection of a build's a11y violations for the public
 * WCAG panel (spec §5). We deliberately do NOT ship the full `a11yViolations`
 * JSONB (sample `html`, every node) to a public page — only the rule id, human
 * text, impact, counts, deque help URL, and ONE truncated sample per rule.
 */
import type { BuildA11yViolationRow } from "@/lib/db/queries/builds";

export interface ShareA11yRule {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  wcagLevel?: "A" | "AA" | "AAA";
  occurrenceCount: number;
  totalNodes: number;
  /** Single representative selector, e.g. `nav > a.link`. */
  sampleSelector: string | null;
  /** Truncated axe failureSummary for the one sample. */
  sampleSummary: string | null;
}

export interface ShareA11ySummary {
  rules: ShareA11yRule[];
  /** Distinct violated rules (== rules.length before truncation). */
  ruleCount: number;
  bySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

const MAX_SUMMARY_CHARS = 160;

function truncate(s: string | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Deque University rule page, matching the internal A11yViolationsCard: use the
// axe helpUrl verbatim when present, else synthesize the canonical rule URL.
export function dequeUniversityUrl(ruleId: string, helpUrl: string): string {
  if (helpUrl) return helpUrl;
  return `https://dequeuniversity.com/rules/axe/latest/${encodeURIComponent(ruleId)}`;
}

export function projectShareA11y(
  rows: BuildA11yViolationRow[],
): ShareA11ySummary {
  const rules: ShareA11yRule[] = rows.map((r) => {
    const sample = r.samples.find((s) => s.sampleNode?.target?.length);
    return {
      id: r.id,
      impact: r.impact,
      description: r.description || r.help || r.id,
      help: r.help || "",
      helpUrl: dequeUniversityUrl(r.id, r.helpUrl),
      wcagLevel: r.wcagLevel,
      occurrenceCount: r.occurrenceCount,
      totalNodes: r.totalNodes,
      sampleSelector: sample?.sampleNode?.target?.join(" ") ?? null,
      sampleSummary: truncate(
        sample?.sampleNode?.failureSummary,
        MAX_SUMMARY_CHARS,
      ),
    };
  });

  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const r of rules) bySeverity[r.impact] += 1;

  return { rules, ruleCount: rules.length, bySeverity };
}
