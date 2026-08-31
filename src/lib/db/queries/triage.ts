/**
 * Triage agent queries (v1.15).
 *
 * One current triage run per build, its root-cause groups and its cases, plus
 * the reviewer verdicts recorded against them.
 *
 * Two invariants shape this module:
 *
 *  1. **Re-triage is idempotent.** `replaceTriageGroups` / `replaceTriageCases`
 *     delete-then-insert the whole set for a run, so running the agent twice
 *     over a build leaves exactly one set of rows.
 *  2. **Re-triage never clobbers a human.** Verdicts live in their own table
 *     keyed by (buildId, testId, stepLabel) — an identity that survives the
 *     case rows being thrown away and rebuilt.
 */

import { db } from "../index";
import {
  triageRuns,
  triageGroups,
  triageCases,
  triageCaseVerdicts,
} from "../schema";
import type {
  NewTriageRun,
  NewTriageGroup,
  NewTriageCase,
  TriageRun,
  TriageGroup,
  TriageCase,
  TriageCaseVerdict,
  TriageVerdict,
  StepIssueKind,
  StepIssueState,
} from "../schema";
import { and, desc, eq, asc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// ---------------------------------------------------------------------------
// View types — what the Run Results screen consumes
// ---------------------------------------------------------------------------

/** A group with its cases attached, in `orderIndex` order. */
export interface TriageGroupView extends TriageGroup {
  cases: TriageCase[];
}

/** Verdict map key: `${testId}::${stepLabel ?? ""}`. */
export type TriageVerdictMap = Record<string, TriageCaseVerdict>;

/**
 * Everything the Run Results screen needs for one build, in one read.
 * `cases` is the flat list (every case, grouped or not) in `orderIndex` order;
 * `groups[].cases` and `ungrouped` partition it.
 */
export interface TriageRunView {
  run: TriageRun;
  groups: TriageGroupView[];
  ungrouped: TriageCase[];
  cases: TriageCase[];
  verdicts: TriageVerdictMap;
}

/** Lightweight counts for the roster / build list — no group or case rows. */
export interface TriageRunSummary {
  triageRunId: string;
  buildId: string;
  status: TriageRun["status"];
  headline: string | null;
  caseCount: number;
  groupCount: number;
  /** How many cases in this build carry a reviewer verdict. */
  decidedCount: number;
  computedAt: Date | null;
}

/** Stable identity of a case across triage runs. */
export function triageVerdictKey(
  testId: string,
  stepLabel: string | null | undefined,
): string {
  return `${testId}::${stepLabel ?? ""}`;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function createTriageRun(
  input: Omit<NewTriageRun, "id"> & { id?: string },
): Promise<TriageRun> {
  const id = input.id ?? uuid();
  const [row] = await db
    .insert(triageRuns)
    .values({ ...input, id })
    .onConflictDoUpdate({
      // One current run per build: re-triage takes over the existing row.
      target: triageRuns.buildId,
      set: {
        status: input.status ?? "pending",
        agentSessionId: input.agentSessionId ?? null,
        repositoryId: input.repositoryId ?? null,
        headline: input.headline ?? null,
        summary: input.summary ?? null,
        caseCount: input.caseCount ?? 0,
        groupCount: input.groupCount ?? 0,
        modelId: input.modelId ?? null,
        skippedReason: input.skippedReason ?? null,
        computedAt: input.computedAt ?? null,
      },
    })
    .returning();
  return row;
}

export async function updateTriageRun(
  id: string,
  patch: Partial<Omit<NewTriageRun, "id">>,
): Promise<TriageRun | null> {
  const [row] = await db
    .update(triageRuns)
    .set(patch)
    .where(eq(triageRuns.id, id))
    .returning();
  return row ?? null;
}

export async function getTriageRun(id: string): Promise<TriageRun | null> {
  const [row] = await db.select().from(triageRuns).where(eq(triageRuns.id, id));
  return row ?? null;
}

export async function getTriageRunByBuild(
  buildId: string,
): Promise<TriageRun | null> {
  const [row] = await db
    .select()
    .from(triageRuns)
    .where(eq(triageRuns.buildId, buildId));
  return row ?? null;
}

export async function deleteTriageRun(id: string): Promise<void> {
  await db.delete(triageRuns).where(eq(triageRuns.id, id));
}

export async function listRecentTriageRuns(
  repositoryId: string,
  limit = 20,
): Promise<TriageRun[]> {
  return await db
    .select()
    .from(triageRuns)
    .where(eq(triageRuns.repositoryId, repositoryId))
    .orderBy(desc(triageRuns.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Groups + cases — full replace, so re-triage is idempotent
// ---------------------------------------------------------------------------

/**
 * Replace every group of a run. Call this BEFORE `replaceTriageCases`: the
 * delete here nulls `triage_cases.triage_group_id` (ON DELETE SET NULL), so
 * doing it the other way round would orphan the freshly-written cases.
 */
export async function replaceTriageGroups(
  triageRunId: string,
  groups: (Omit<NewTriageGroup, "id" | "triageRunId"> & { id?: string })[],
): Promise<TriageGroup[]> {
  return await db.transaction(async (tx) => {
    await tx
      .delete(triageGroups)
      .where(eq(triageGroups.triageRunId, triageRunId));
    if (!groups.length) return [];
    return await tx
      .insert(triageGroups)
      .values(
        groups.map((g, i) => ({
          ...g,
          id: g.id ?? uuid(),
          triageRunId,
          orderIndex: g.orderIndex ?? i,
        })),
      )
      .returning();
  });
}

/** Replace every case of a run. */
export async function replaceTriageCases(
  triageRunId: string,
  cases: (Omit<NewTriageCase, "id" | "triageRunId"> & { id?: string })[],
): Promise<TriageCase[]> {
  return await db.transaction(async (tx) => {
    await tx
      .delete(triageCases)
      .where(eq(triageCases.triageRunId, triageRunId));
    if (!cases.length) return [];
    return await tx
      .insert(triageCases)
      .values(
        cases.map((c, i) => ({
          ...c,
          id: c.id ?? uuid(),
          triageRunId,
          orderIndex: c.orderIndex ?? i,
        })),
      )
      .returning();
  });
}

export async function getTriageGroup(id: string): Promise<TriageGroup | null> {
  const [row] = await db
    .select()
    .from(triageGroups)
    .where(eq(triageGroups.id, id));
  return row ?? null;
}

export async function getTriageCase(id: string): Promise<TriageCase | null> {
  const [row] = await db
    .select()
    .from(triageCases)
    .where(eq(triageCases.id, id));
  return row ?? null;
}

export async function getTriageCasesForGroup(
  triageGroupId: string,
): Promise<TriageCase[]> {
  return await db
    .select()
    .from(triageCases)
    .where(eq(triageCases.triageGroupId, triageGroupId))
    .orderBy(asc(triageCases.orderIndex));
}

/** Link (or clear) the GitHub issue that covers a whole cluster. */
export async function setTriageGroupIssue(
  groupId: string,
  issue: {
    url?: string | null;
    number?: number | null;
    state?: StepIssueState | null;
    kind?: StepIssueKind | null;
  },
): Promise<TriageGroup | null> {
  const [row] = await db
    .update(triageGroups)
    .set({
      githubIssueUrl: issue.url ?? null,
      githubIssueNumber: issue.number ?? null,
      githubIssueState: issue.state ?? null,
      githubIssueKind: issue.kind ?? null,
    })
    .where(eq(triageGroups.id, groupId))
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Reviewer verdicts
// ---------------------------------------------------------------------------

/** Every verdict recorded on a build, keyed by `triageVerdictKey()`. */
export async function getTriageVerdicts(
  buildId: string,
): Promise<TriageVerdictMap> {
  const rows = await db
    .select()
    .from(triageCaseVerdicts)
    .where(eq(triageCaseVerdicts.buildId, buildId));
  const map: TriageVerdictMap = {};
  for (const row of rows) {
    map[triageVerdictKey(row.testId, row.stepLabel)] = row;
  }
  return map;
}

export async function setTriageVerdict(input: {
  buildId: string;
  testId: string;
  stepLabel?: string | null;
  triageCaseId?: string | null;
  verdict: TriageVerdict;
  note?: string | null;
  snoozedUntil?: Date | null;
  decidedBy?: string | null;
}): Promise<TriageCaseVerdict> {
  const stepLabel = input.stepLabel ?? "";
  const [row] = await db
    .insert(triageCaseVerdicts)
    .values({
      id: uuid(),
      buildId: input.buildId,
      testId: input.testId,
      stepLabel,
      triageCaseId: input.triageCaseId ?? null,
      verdict: input.verdict,
      note: input.note ?? null,
      snoozedUntil: input.snoozedUntil ?? null,
      decidedBy: input.decidedBy ?? null,
      decidedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        triageCaseVerdicts.buildId,
        triageCaseVerdicts.testId,
        triageCaseVerdicts.stepLabel,
      ],
      set: {
        triageCaseId: input.triageCaseId ?? null,
        verdict: input.verdict,
        note: input.note ?? null,
        snoozedUntil: input.snoozedUntil ?? null,
        decidedBy: input.decidedBy ?? null,
        decidedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function clearTriageVerdict(input: {
  buildId: string;
  testId: string;
  stepLabel?: string | null;
}): Promise<void> {
  await db
    .delete(triageCaseVerdicts)
    .where(
      and(
        eq(triageCaseVerdicts.buildId, input.buildId),
        eq(triageCaseVerdicts.testId, input.testId),
        eq(triageCaseVerdicts.stepLabel, input.stepLabel ?? ""),
      ),
    );
}

// ---------------------------------------------------------------------------
// Composed reads
// ---------------------------------------------------------------------------

/**
 * The whole triage picture for a build: run, groups (each with its cases),
 * the ungrouped cases, the flat case list and the verdict map. Returns null
 * when the build has never been triaged.
 */
export async function getTriageRunForBuild(
  buildId: string,
): Promise<TriageRunView | null> {
  const run = await getTriageRunByBuild(buildId);
  if (!run) return null;

  const [groupRows, caseRows, verdicts] = await Promise.all([
    db
      .select()
      .from(triageGroups)
      .where(eq(triageGroups.triageRunId, run.id))
      .orderBy(asc(triageGroups.orderIndex)),
    db
      .select()
      .from(triageCases)
      .where(eq(triageCases.triageRunId, run.id))
      .orderBy(asc(triageCases.orderIndex)),
    getTriageVerdicts(buildId),
  ]);

  const byGroup = new Map<string, TriageCase[]>();
  const ungrouped: TriageCase[] = [];
  for (const c of caseRows) {
    if (!c.triageGroupId) {
      ungrouped.push(c);
      continue;
    }
    const bucket = byGroup.get(c.triageGroupId);
    if (bucket) bucket.push(c);
    else byGroup.set(c.triageGroupId, [c]);
  }

  return {
    run,
    groups: groupRows.map((g) => ({ ...g, cases: byGroup.get(g.id) ?? [] })),
    ungrouped,
    cases: caseRows,
    verdicts,
  };
}

/** Counts only — for the agent roster and the build list. */
export async function getTriageRunSummary(
  buildId: string,
): Promise<TriageRunSummary | null> {
  const run = await getTriageRunByBuild(buildId);
  if (!run) return null;
  const verdictRows = await db
    .select({ id: triageCaseVerdicts.id })
    .from(triageCaseVerdicts)
    .where(eq(triageCaseVerdicts.buildId, buildId));
  return {
    triageRunId: run.id,
    buildId: run.buildId,
    status: run.status,
    headline: run.headline,
    caseCount: run.caseCount,
    groupCount: run.groupCount,
    decidedCount: verdictRows.length,
    computedAt: run.computedAt,
  };
}
