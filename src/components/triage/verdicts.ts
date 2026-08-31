import type { TriageVerdict } from "@/lib/db/schema";

/**
 * The five verdicts a reviewer can apply, in keyboard order (1-5).
 *
 * `improvement` is present even though the design prototype only drew four
 * buttons: the shipped model routes it to `confirmCase('improvement')` and a
 * typed `improvement` GitHub issue, so leaving it out would make that path
 * unreachable from the screen that owns triage.
 */
export const TRIAGE_VERDICTS: Array<{
  verdict: TriageVerdict;
  label: string;
  /** Short label for the dense per-group bulk bar. */
  short: string;
  key: string;
  destructive?: boolean;
}> = [
  {
    verdict: "bug",
    label: "Confirm bug",
    short: "bug",
    key: "1",
    destructive: true,
  },
  {
    verdict: "improvement",
    label: "Improvement",
    short: "improvement",
    key: "2",
  },
  {
    verdict: "false_positive",
    label: "False positive",
    short: "false positive",
    key: "3",
  },
  {
    verdict: "flaky_retry",
    label: "Flaky — retry",
    short: "flaky — retry",
    key: "4",
  },
  {
    verdict: "new_baseline",
    label: "Approve as baseline",
    short: "baseline",
    key: "5",
  },
];

/** Verdict applied by pressing a number key, or null for any other key. */
export function verdictForKey(key: string): TriageVerdict | null {
  return TRIAGE_VERDICTS.find((v) => v.key === key)?.verdict ?? null;
}

const LABELS: Record<TriageVerdict, string> = {
  bug: "bug",
  improvement: "improvement",
  false_positive: "false positive",
  flaky_retry: "flaky — retry",
  new_baseline: "baseline",
  snoozed: "snoozed",
};

export function verdictLabel(verdict: TriageVerdict): string {
  return LABELS[verdict] ?? verdict;
}

/** Days a snooze lasts — matches `triageCaseVerdicts.snoozedUntil`. */
export const SNOOZE_DAYS = 7;
