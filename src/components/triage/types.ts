/**
 * View-model types for the Run Results screen.
 *
 * Everything here is derived server-side in `derive.ts` from real rows
 * (`triage_*`, `builds`, `test_results`, `visual_diffs`, `tests`,
 * `functional_areas`) and handed to the client component as plain data. No
 * field is optional-for-convenience: when a datum does not exist in the
 * database the field is `null` and the UI omits the element rather than
 * inventing a value.
 */

import type {
  TriageCaseStatus,
  TriageGroup,
  TriageRegion,
  TriageRun,
  TriageVerdict,
} from "@/lib/db/schema";

/** One line of the step log panel. */
export type TriageStepMark = "pass" | "fail" | "skip";

export interface TriageStepLine {
  text: string;
  mark: TriageStepMark;
}

/** A screenshot plus the changed-region boxes drawn over it. */
export interface TriageShot {
  /** Storage URL (e.g. `/screenshots/…`), served through `/api/media`. */
  src: string;
  regions: TriageRegion[];
}

/** Prior outcomes of the same test, most recent run last. */
export type TriageHistoryMark = "passed" | "failed" | "other";

export interface TriageRecording {
  src: string;
  durationMs: number | null;
  posterSrc: string | null;
}

/** One reviewable case — a failed or review-required (test, step) pair. */
export interface TriageCaseVM {
  /** `triage_cases.id`. */
  id: string;
  testId: string;
  stepLabel: string | null;
  /** `${testId}::${stepLabel ?? ""}` — the verdict map key. */
  verdictKey: string;
  status: TriageCaseStatus;
  title: string;
  areaId: string | null;
  areaName: string | null;
  /** The agent's per-case note (`triage_cases.note`). */
  note: string | null;
  suggestedVerdict: TriageVerdict | null;
  groupId: string | null;
  browsers: string[];
  history: TriageHistoryMark[];
  /** `visual_diffs.percentageDifference`, parsed. */
  diffPct: number | null;
  regionCount: number;
  baseline: TriageShot | null;
  current: TriageShot | null;
  recording: TriageRecording | null;
  steps: TriageStepLine[];
  /** Index into `steps` of the first failing line, for auto-scroll. */
  failingStepIndex: number | null;
  errorMessage: string | null;
}

export interface TriageGroupVM extends Pick<
  TriageGroup,
  | "id"
  | "slug"
  | "headline"
  | "note"
  | "kind"
  | "risk"
  | "suggestedVerdict"
  | "confidence"
  | "orderIndex"
  | "functionalAreaId"
  | "evidence"
  | "githubIssueUrl"
  | "githubIssueNumber"
  | "githubIssueState"
  | "githubIssueKind"
> {
  cases: TriageCaseVM[];
  /** Representative baseline/current pair for the card thumbnails. */
  baseline: TriageShot | null;
  current: TriageShot | null;
}

/** A passing test, for the lazily-rendered section at the bottom. */
export interface TriagePassingVM {
  /** `test_results.id`. */
  id: string;
  testId: string;
  title: string;
  areaId: string | null;
  areaName: string | null;
  browsers: string[];
  durationMs: number | null;
  history: TriageHistoryMark[];
  screenshotSrc: string | null;
  recording: TriageRecording | null;
  steps: TriageStepLine[];
}

/** One row of the expanded health strip. */
export interface TriageAreaHealthVM {
  id: string | null;
  name: string;
  tests: number;
  passed: number;
  failed: number;
  review: number;
}

/** Header chrome — all of it from `test_runs` / `repositories` / `builds`. */
export interface TriageHeaderVM {
  repoName: string;
  branch: string | null;
  commit: string | null;
  /** 1-based position of this run among the branch's runs, when derivable. */
  runPosition: number | null;
  runTotal: number | null;
  finishedAt: string | null;
}

export interface TriageHeroVM {
  totalTests: number | null;
  browsers: string[];
  elapsedMs: number | null;
  headline: string | null;
  summary: string | null;
  /** `triage_runs.status` — drives the empty / CTA state. */
  runStatus: TriageRun["status"] | null;
  skippedReason: string | null;
  computedAt: string | null;
}

export interface TriageCountsVM {
  passed: number | null;
  failed: number | null;
  review: number | null;
}

/** The whole screen, in one object. */
export interface TriageScreenVM {
  buildId: string;
  repositoryId: string | null;
  header: TriageHeaderVM;
  hero: TriageHeroVM;
  counts: TriageCountsVM;
  areas: TriageAreaHealthVM[];
  groups: TriageGroupVM[];
  /** Cases the clustering left ungrouped, rendered as their own card. */
  ungrouped: TriageCaseVM[];
  passing: TriagePassingVM[];
  /** Reviewer verdicts already recorded, keyed by `verdictKey`. */
  verdicts: Record<
    string,
    { verdict: TriageVerdict; note: string | null; snoozedUntil: string | null }
  >;
  /** Test ids that failed in this build — the "Re-run failed" payload. */
  failedTestIds: string[];
}
