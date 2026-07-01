/**
 * Step-comparison queries (v1.13). One row per `(buildId, testId, stepLabel)`
 * carrying the unified multi-layer verdict and evidence chain.
 */

import { db } from "../index";
import { stepComparisons, builds, testRuns } from "../schema";
import type { NewStepComparison, StepComparison } from "../schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";

export async function createStepComparison(
  data: Omit<NewStepComparison, "id">,
): Promise<StepComparison> {
  const id = uuid();
  await db.insert(stepComparisons).values({ ...data, id });
  const [row] = await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.id, id));
  return row;
}

export async function getStepComparisonsByBuild(
  buildId: string,
): Promise<StepComparison[]> {
  return await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.buildId, buildId));
}

export async function getStepComparisonsByTestResult(
  testResultId: string,
): Promise<StepComparison[]> {
  return await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.testResultId, testResultId));
}

export async function getStepComparisonByVisualDiff(
  visualDiffId: string,
): Promise<StepComparison | undefined> {
  const [row] = await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.visualDiffId, visualDiffId));
  return row;
}

export async function countStepComparisonVerdicts(
  buildId: string,
): Promise<{ green: number; yellow: number; red: number }> {
  const rows = await db
    .select()
    .from(stepComparisons)
    .where(eq(stepComparisons.buildId, buildId));
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  return counts;
}

export async function deleteStepComparisonsByBuild(
  buildId: string,
): Promise<void> {
  await db.delete(stepComparisons).where(eq(stepComparisons.buildId, buildId));
}

/**
 * Delete every step comparison for a test, across all builds. Used when a
 * test's steps change (Record-from-here): the old comparisons reference the
 * previous steps' screenshots/evidence, so the test should leave the Verify
 * board entirely (back to "untested") until it is re-run. Cascades remove the
 * attached step_layer_feedback rows. Returns the number of rows removed.
 */
export async function deleteStepComparisonsForTest(
  testId: string,
): Promise<number> {
  const result = await db
    .delete(stepComparisons)
    .where(eq(stepComparisons.testId, testId))
    .returning({ id: stepComparisons.id });
  return result.length;
}

export async function getStepComparisonForStep(
  buildId: string,
  testId: string,
  stepLabel: string | null,
): Promise<StepComparison | undefined> {
  const conds = [
    eq(stepComparisons.buildId, buildId),
    eq(stepComparisons.testId, testId),
  ];
  if (stepLabel != null) conds.push(eq(stepComparisons.stepLabel, stepLabel));
  const [row] = await db
    .select()
    .from(stepComparisons)
    .where(and(...conds));
  return row;
}

export async function updateStepComparisonIssueState(
  id: string,
  state: StepComparison["githubIssueState"],
): Promise<void> {
  await db
    .update(stepComparisons)
    .set({ githubIssueState: state })
    .where(eq(stepComparisons.id, id));
}

/** Link a GitHub issue to a step comparison (url + number + state + kind). */
export async function setStepComparisonIssue(
  id: string,
  issue: {
    githubIssueUrl: string;
    githubIssueNumber: number;
    githubIssueState: StepComparison["githubIssueState"];
    githubIssueKind: StepComparison["githubIssueKind"];
  },
): Promise<void> {
  await db.update(stepComparisons).set(issue).where(eq(stepComparisons.id, id));
}

/**
 * Confirm-on-green lookup: step comparisons in this repo for the given tests
 * that still carry an open Lastest-filed issue ('auto'/'open' — deliberately
 * NOT 'linked', which is someone else's issue we must not auto-close).
 * Scoped through builds → test_runs because step_comparisons has no repo
 * column; issue numbers are only unique per repo.
 */
export async function getOpenIssueStepsForTests(
  repositoryId: string,
  testIds: string[],
): Promise<StepComparison[]> {
  if (testIds.length === 0) return [];
  const rows = await db
    .select({ step: stepComparisons })
    .from(stepComparisons)
    .innerJoin(builds, eq(stepComparisons.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        inArray(stepComparisons.testId, testIds),
        isNotNull(stepComparisons.githubIssueNumber),
        inArray(stepComparisons.githubIssueState, ["auto", "open"]),
      ),
    );
  return rows.map((r) => r.step);
}

/**
 * Repo-scoped variant of the webhook reverse lookup. Issue numbers repeat
 * across repos, so the webhook must never match by number alone.
 */
export async function getStepComparisonsByGithubIssueInRepo(
  repositoryId: string,
  issueNumber: number,
): Promise<StepComparison[]> {
  const rows = await db
    .select({ step: stepComparisons })
    .from(stepComparisons)
    .innerJoin(builds, eq(stepComparisons.buildId, builds.id))
    .innerJoin(testRuns, eq(builds.testRunId, testRuns.id))
    .where(
      and(
        eq(testRuns.repositoryId, repositoryId),
        eq(stepComparisons.githubIssueNumber, issueNumber),
      ),
    );
  return rows.map((r) => r.step);
}
