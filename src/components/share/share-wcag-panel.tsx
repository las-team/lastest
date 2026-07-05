// Server-rendered, share-safe WCAG analysis panel (spec §5). A slim port of the
// internal A11yComplianceCard + A11yViolationsCard: score ring, "N/M rules
// passed", severity chips, and up to 3 named rules with a deque "Learn more"
// link — the payoff-preview pattern applied to accessibility.
//
// Deliberately NOT a client component: no app-internal CSS tokens (uses the same
// emerald/amber/rose/muted palette the rest of the share page uses, so it renders
// correctly on the public page in both themes), no hover/collapse interactivity.
//
// Self-demonstrating accessibility (non-negotiable — this panel is judged by what
// it measures): semantic <ul>/<li>, severity conveyed by badge TEXT not color
// alone, AA-contrast palette pairs in both themes, focus-visible styles on links,
// and the score ring is announced via role="img" + aria-label.
import type { ShareA11ySummary } from "@/lib/share/a11y-projection";
import { publicShareGrade } from "@/lib/share/grade";

const IMPACT_LABEL: Record<string, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

// AA-contrast pairs in light + dark (text-*-800/900 on bg-*-100, mirrored in dark).
const IMPACT_BADGE: Record<string, string> = {
  critical:
    "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900",
  serious:
    "bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900",
  moderate:
    "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-900",
  minor: "bg-muted text-muted-foreground border",
};

const TOP_RULES = 3;

function ringClasses(tone: "ok" | "warn" | "danger" | "neutral"): {
  ring: string;
  text: string;
} {
  switch (tone) {
    case "ok":
      return {
        ring: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800",
        text: "text-emerald-700 dark:text-emerald-300",
      };
    case "warn":
      return {
        ring: "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800",
        text: "text-amber-800 dark:text-amber-200",
      };
    default:
      return {
        ring: "border bg-muted/40",
        text: "text-muted-foreground",
      };
  }
}

export function ShareWcagPanel({
  summary,
  score,
  totalRulesChecked,
  violationCount,
  claimLink,
  gradeMode,
  id = "wcag",
}: {
  summary: ShareA11ySummary;
  score: number | null;
  totalRulesChecked: number | null;
  violationCount: number | null;
  claimLink: string;
  // "floored": show the score ring with the public grade floor (regression, or
  // demo once a11y scoring is calibrated). "hidden": neutral header, no numeric
  // grade — the number arrives WITHOUT enough calibration to trust it, so we
  // name the violations but withhold the score (spec §3.5 / §5).
  gradeMode: "hidden" | "floored";
  id?: string;
}) {
  // Evidence gate (§3.2): the panel only renders when there are named rules to
  // show. An empty panel is worse than no panel.
  if (summary.ruleCount === 0) return null;

  const grade =
    gradeMode === "floored" && score != null ? publicShareGrade(score) : null;
  const ring = ringClasses(grade ? grade.tone : "neutral");
  const passed =
    totalRulesChecked != null && violationCount != null
      ? Math.max(0, totalRulesChecked - violationCount)
      : null;

  const sev = summary.bySeverity;
  const sevChips: Array<{ label: string; count: number; impact: string }> = [
    { label: "critical", count: sev.critical, impact: "critical" },
    { label: "serious", count: sev.serious, impact: "serious" },
    { label: "moderate", count: sev.moderate, impact: "moderate" },
    { label: "minor", count: sev.minor, impact: "minor" },
  ].filter((c) => c.count > 0);

  const topRules = summary.rules.slice(0, TOP_RULES);
  const moreRules = Math.max(0, summary.ruleCount - topRules.length);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border bg-card p-5 sm:p-6 space-y-4 scroll-mt-20"
    >
      <div className="flex items-start gap-4">
        {grade ? (
          <div
            role="img"
            aria-label={
              grade.floored
                ? "Accessibility needs review"
                : `Accessibility grade ${grade.display}${score != null ? `, ${score} out of 100` : ""}`
            }
            className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 ${ring.ring}`}
          >
            <span className={`text-xl font-bold leading-none ${ring.text}`}>
              {grade.floored ? "!" : grade.display}
            </span>
            {grade.showScore && score != null && (
              <span className={`text-[10px] font-medium ${ring.text}`}>
                {score}
              </span>
            )}
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={`${id}-heading`} className="text-sm font-semibold">
            {grade
              ? grade.floored
                ? "Accessibility — needs review"
                : "WCAG 2.2 AA compliance"
              : `Accessibility checks — ${summary.ruleCount} rule${summary.ruleCount === 1 ? "" : "s"} evaluated`}
          </h2>
          {passed != null && totalRulesChecked ? (
            <p className="text-sm text-muted-foreground">
              WCAG 2.2 AA · {passed}/{totalRulesChecked} rules passed
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {summary.ruleCount} rule{summary.ruleCount === 1 ? "" : "s"}{" "}
              flagged across the walkthrough
            </p>
          )}
          {sevChips.length > 0 && (
            <ul
              className="flex flex-wrap gap-1.5 pt-1"
              aria-label="Severity breakdown"
            >
              {sevChips.map((c) => (
                <li
                  key={c.impact}
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${IMPACT_BADGE[c.impact]}`}
                >
                  {c.count} {c.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ul className="space-y-3" aria-label="Top accessibility issues">
        {topRules.map((r) => (
          <li
            key={r.id}
            className="rounded-md border bg-background/50 p-3 space-y-1.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${IMPACT_BADGE[r.impact]}`}
              >
                {IMPACT_LABEL[r.impact] ?? r.impact}
              </span>
              {r.wcagLevel && (
                <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  WCAG {r.wcagLevel}
                </span>
              )}
              <span className="font-mono text-xs font-medium text-foreground truncate">
                {r.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.occurrenceCount} occurrence
                {r.occurrenceCount === 1 ? "" : "s"} · {r.totalNodes} node
                {r.totalNodes === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm text-foreground">{r.description}</p>
            {r.sampleSelector && (
              <p className="font-mono text-[11px] text-muted-foreground break-all">
                <span className="not-italic">selector:</span> {r.sampleSelector}
              </p>
            )}
            {r.sampleSummary && (
              <p className="text-[11px] text-muted-foreground whitespace-pre-line">
                {r.sampleSummary}
              </p>
            )}
            <a
              href={r.helpUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
            >
              Learn more on Deque University
              <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>

      {moreRules > 0 && (
        <p className="text-xs text-muted-foreground">
          {moreRules} more rule{moreRules === 1 ? "" : "s"} checked.{" "}
          <a
            href={claimLink}
            className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 rounded"
          >
            Claim the test for the full report
          </a>
          .
        </p>
      )}
    </section>
  );
}
