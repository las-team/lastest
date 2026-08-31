/**
 * Triage: the build-scoped classifier's output and the reviewer's decisions.
 *
 * One `triage_runs` row per build (re-triage replaces it), N `triage_groups`
 * root-cause clusters under it, and one `triage_cases` row per failed /
 * review-required case in the build. Reviewer verdicts live in their own table
 * (`triage_case_verdicts`), keyed by (buildId, testId, stepLabel) rather than
 * by a case id — so re-running triage never clobbers human input.
 *
 * See docs/architecture/triage-agent.md. The agent replaces the two AI passes
 * that used to run at build completion (`src/lib/ai/diff-analyzer.ts` per diff,
 * `src/lib/ai/failure-triage.ts` per failed test) with a single build-scoped
 * pass that clusters by root cause.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The model's value types live in `@lastest/triage-model` — the pure half of
// this feature, which must not import the database. They are re-exported here
// so `@lastest/db/schema` (and `@/lib/db/schema`) export the same names,
// exactly as `./coverage` does for `@lastest/coverage-model`.
import type {
  TriageCaseStatus,
  TriageGroupEvidence,
  TriageGroupKind,
  TriageRunStatus,
  TriageVerdict,
} from "@lastest/triage-model";

export type {
  TriageVerdict,
  TriageRunStatus,
  TriageGroupKind,
  TriageCaseStatus,
  TriageGroupEvidence,
  TriageRegion,
} from "@lastest/triage-model";

import { builds } from "./runs";
import type { ChangeRisk } from "./runs";
import { tests, testResults } from "./tests";
import { stepComparisons, visualDiffs } from "./visual";
import type { StepIssueKind, StepIssueState } from "./visual";

// ---------------------------------------------------------------------------
// Triage runs — one current run per build
// ---------------------------------------------------------------------------

export const triageRuns = pgTable(
  "triage_runs",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .references(() => builds.id, { onDelete: "cascade" })
      .notNull(),
    repositoryId: text("repository_id"),
    /** agent_sessions.id — no FK: sessions are reaped independently. */
    agentSessionId: text("agent_session_id"),
    status: text("status")
      .$type<TriageRunStatus>()
      .notNull()
      .default("pending"),
    /** One-sentence run thesis: "One layout change explains most of this run." */
    headline: text("headline"),
    /** The 2-4 sentence narrative paragraph shown above the groups. */
    summary: text("summary"),
    caseCount: integer("case_count").notNull().default(0),
    groupCount: integer("group_count").notNull().default(0),
    modelId: text("model_id"),
    /** Why the agent produced no narrative (AI disabled, gate, no cases). */
    skippedReason: text("skipped_reason"),
    computedAt: timestamp("computed_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    // One current triage run per build — re-triage replaces it.
    uniqueIndex("idx_triage_runs_build").on(table.buildId),
  ],
);

export type TriageRun = typeof triageRuns.$inferSelect;

export type NewTriageRun = typeof triageRuns.$inferInsert;

// ---------------------------------------------------------------------------
// Triage groups — root-cause clusters
// ---------------------------------------------------------------------------

export const triageGroups = pgTable(
  "triage_groups",
  {
    id: text("id").primaryKey(),
    triageRunId: text("triage_run_id")
      .references(() => triageRuns.id, { onDelete: "cascade" })
      .notNull(),
    buildId: text("build_id")
      .references(() => builds.id, { onDelete: "cascade" })
      .notNull(),
    /** Stable anchor within the run, e.g. "completed-row-layout". */
    slug: text("slug").notNull(),
    /** e.g. "Completed-row layout shifted". */
    headline: text("headline").notNull(),
    /** 1-2 sentences explaining the shared cause. */
    note: text("note").notNull(),
    kind: text("kind").$type<TriageGroupKind>().notNull().default("unknown"),
    risk: text("risk").$type<ChangeRisk>().notNull().default("low"),
    suggestedVerdict: text("suggested_verdict").$type<TriageVerdict>(),
    /** 0-100. */
    confidence: integer("confidence").notNull().default(0),
    orderIndex: integer("order_index").notNull().default(0),
    /** The dominant functional area, when the cluster has one. */
    functionalAreaId: text("functional_area_id"),
    evidence: jsonb("evidence")
      .$type<TriageGroupEvidence>()
      .notNull()
      .default({}),
    // GitHub issue link — mirrors the columns on `stepComparisons` exactly, so
    // one issue can cover a whole cluster instead of one case.
    githubIssueUrl: text("github_issue_url"),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueState: text("github_issue_state").$type<StepIssueState>(),
    githubIssueKind: text("github_issue_kind").$type<StepIssueKind>(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_triage_groups_run").on(table.triageRunId),
    index("idx_triage_groups_build").on(table.buildId),
  ],
);

export type TriageGroup = typeof triageGroups.$inferSelect;

export type NewTriageGroup = typeof triageGroups.$inferInsert;

// ---------------------------------------------------------------------------
// Triage cases — one per failed / review-required case in the build
// ---------------------------------------------------------------------------

export const triageCases = pgTable(
  "triage_cases",
  {
    id: text("id").primaryKey(),
    triageRunId: text("triage_run_id")
      .references(() => triageRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** Null when the clustering left this case ungrouped. */
    triageGroupId: text("triage_group_id").references(() => triageGroups.id, {
      onDelete: "set null",
    }),
    buildId: text("build_id")
      .references(() => builds.id, { onDelete: "cascade" })
      .notNull(),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    testResultId: text("test_result_id").references(() => testResults.id, {
      onDelete: "cascade",
    }),
    stepComparisonId: text("step_comparison_id").references(
      () => stepComparisons.id,
      { onDelete: "set null" },
    ),
    visualDiffId: text("visual_diff_id").references(() => visualDiffs.id, {
      onDelete: "set null",
    }),
    stepLabel: text("step_label"),
    status: text("status")
      .$type<TriageCaseStatus>()
      .notNull()
      .default("failed"),
    /** Per-case agent note: "sub-pixel text on WebKit — false-positive pattern". */
    note: text("note"),
    suggestedVerdict: text("suggested_verdict").$type<TriageVerdict>(),
    /** 0-100. */
    confidence: integer("confidence").notNull().default(0),
    /** Earliest build this case was seen in — powers "present since run 2". */
    firstSeenBuildId: text("first_seen_build_id"),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_triage_cases_run").on(table.triageRunId),
    index("idx_triage_cases_group").on(table.triageGroupId),
    index("idx_triage_cases_build").on(table.buildId),
    index("idx_triage_cases_test").on(table.testId),
  ],
);

export type TriageCase = typeof triageCases.$inferSelect;

export type NewTriageCase = typeof triageCases.$inferInsert;

// ---------------------------------------------------------------------------
// Triage case verdicts — the reviewer's decision
// ---------------------------------------------------------------------------
//
// Deliberately NOT a column on `triage_cases`: re-triage replaces every case
// row, and a human decision must survive that. Identity is
// (buildId, testId, stepLabel), which is stable across triage runs.

export const triageCaseVerdicts = pgTable(
  "triage_case_verdicts",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .references(() => builds.id, { onDelete: "cascade" })
      .notNull(),
    testId: text("test_id")
      .references(() => tests.id, { onDelete: "cascade" })
      .notNull(),
    /** NOT NULL with an empty-string default, unlike `triageCases.stepLabel`:
     *  Postgres treats NULLs as distinct in a unique index, so a nullable
     *  column here would let the same run-level case be decided twice and
     *  break the ON CONFLICT upsert. "" is the run-level (no step) verdict,
     *  matching the `${testId}::${stepLabel ?? ""}` map key the UI reads. */
    stepLabel: text("step_label").notNull().default(""),
    /** Best-effort link to the case row that was on screen when decided. */
    triageCaseId: text("triage_case_id").references(() => triageCases.id, {
      onDelete: "set null",
    }),
    verdict: text("verdict").$type<TriageVerdict>().notNull(),
    /** Reviewer free text. */
    note: text("note"),
    snoozedUntil: timestamp("snoozed_until"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_triage_verdicts_case").on(
      table.buildId,
      table.testId,
      table.stepLabel,
    ),
  ],
);

export type TriageCaseVerdict = typeof triageCaseVerdicts.$inferSelect;

export type NewTriageCaseVerdict = typeof triageCaseVerdicts.$inferInsert;
