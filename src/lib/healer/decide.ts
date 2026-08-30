/**
 * The Healer's decision rules — pure, so they are unit-testable without a
 * database or a browser.
 *
 * The rules encode what the self-healing literature agrees on: heal only the
 * failure classes healing can fix (broken locators, timing, test data), never
 * a genuine regression; give every test a small declared budget; and escalate
 * with evidence instead of looping. Anything not positively classified as a
 * test problem is left alone — "unknown" is not evidence.
 */

import type { HealerOutcomeKind, TriageClassification } from "@/lib/db/schema";

/** The classifications the healer is allowed to act on. */
export const HEALABLE_CLASSIFICATIONS: ReadonlySet<TriageClassification> =
  new Set<TriageClassification>(["test_maintenance", "flaky_test"]);

export type HealDecision =
  | { heal: true }
  | { heal: false; outcome: HealerOutcomeKind; detail: string };

export function decideHeal(input: {
  classification: TriageClassification | null | undefined;
  /** A reviewer already recorded a verdict on this test in this build. */
  hasHumanVerdict: boolean;
  /** Heal attempts already spent since the test last passed / was hand-edited. */
  attempts: number;
  maxAttempts: number;
}): HealDecision {
  if (input.hasHumanVerdict) {
    return {
      heal: false,
      outcome: "skipped_human_verdict",
      detail: "A reviewer already decided this case — their verdict stands.",
    };
  }
  const c = input.classification ?? null;
  if (c === "real_regression") {
    return {
      heal: false,
      outcome: "skipped_real_bug",
      detail:
        "Triage classified this as a real regression — a product bug is a valid test result, not something to heal away.",
    };
  }
  if (c === "environment_issue") {
    return {
      heal: false,
      outcome: "skipped_environment",
      detail:
        "Triage classified this as an environment issue — patching the test would not fix it.",
    };
  }
  if (c === null || !HEALABLE_CLASSIFICATIONS.has(c)) {
    return {
      heal: false,
      outcome: "skipped_unclassified",
      detail:
        c === null
          ? "Triage has not classified this failure yet — unknown is not evidence of a test problem."
          : `Triage classified this as "${c}" — not a test problem the healer can act on.`,
    };
  }
  if (input.attempts >= input.maxAttempts) {
    return {
      heal: false,
      outcome: "skipped_budget",
      detail: `Heal budget exhausted (${input.attempts}/${input.maxAttempts} attempts since it last passed) — needs a human.`,
    };
  }
  return { heal: true };
}

export interface VersionLike {
  changeReason: string | null;
  createdAt: Date | null;
}

/**
 * How many heal attempts a test has already consumed.
 *
 * Counts `ai_fix` versions newer than BOTH the test's last passing result and
 * its last non-AI edit: a pass proves the test was healthy, a hand edit means
 * a human took over, and either resets the budget. Versions with no timestamp
 * count — a missing stamp must not silently widen the budget.
 */
export function countHealAttempts(
  versions: VersionLike[],
  lastPassedAt: Date | null,
): number {
  let floor = lastPassedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  for (const v of versions) {
    if (v.changeReason !== "ai_fix" && v.createdAt) {
      floor = Math.max(floor, v.createdAt.getTime());
    }
  }
  return versions.filter(
    (v) =>
      v.changeReason === "ai_fix" &&
      (v.createdAt === null || v.createdAt.getTime() > floor),
  ).length;
}

/**
 * The no-progress guard between rounds: a heal that reproduces the identical
 * error is not converging, so the campaign stops rather than spending the rest
 * of the budget on the same wall. Compares normalized text — timestamps, ids
 * and whitespace stripped — so a cosmetic difference does not count as
 * progress.
 */
export function sameFailure(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .replace(/\d+(\.\d+)?\s*(ms|s)\b/g, "")
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "",
      )
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
  const a = norm(previous);
  const b = norm(next);
  return a.length > 0 && a === b;
}

/** Apply the per-campaign cap, keeping the first `cap` candidates. */
export function capCandidates<T>(
  candidates: T[],
  cap: number,
): { selected: T[]; overflow: T[] } {
  const n = Math.max(0, Math.floor(cap));
  return { selected: candidates.slice(0, n), overflow: candidates.slice(n) };
}
