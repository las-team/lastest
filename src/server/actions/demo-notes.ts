"use server";

import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  generateDemoNotes,
  type QuickstartRunFacts,
} from "@/lib/quickstart/quickstart-notes";
import type { DemoNotes } from "@/lib/db/schema";

/**
 * Standalone demo-notes generation for ANY build — no QuickStart session
 * required. `generateDemoNotes` normally feeds on scout outputs, so ordinary
 * published shares fell back to the generic pull-quote; this runs it in
 * reduced-facts mode instead: build results + steps actually visited
 * (recovered from screenshot labels) + console errors. Every outreach share
 * gets at least a real uxSummary + highlights.
 */
export async function generateNotesForBuild(
  buildId: string,
): Promise<{ ok: boolean; notes?: DemoNotes; error?: string }> {
  const build = await queries.getBuild(buildId);
  if (!build?.testRunId) {
    return { ok: false, error: "Build not found or has no test run" };
  }
  const testRun = await queries.getTestRun(build.testRunId);
  const repositoryId = testRun?.repositoryId;
  if (!repositoryId) {
    return { ok: false, error: "Build has no repository" };
  }
  const session = await requireRepoAccess(repositoryId);
  const productName =
    session.repo.name || session.repo.fullName || "this product";

  const results = await queries.getTestResultsByRun(build.testRunId);
  if (results.length === 0) {
    return { ok: false, error: "Build has no test results" };
  }

  // Steps the run actually walked, recovered from the per-step screenshot
  // labels ("Scenario 3: pricing" → chapter-rail titles) — the scout-less
  // stand-in for publicNavRoutes.
  const routesVisited = Array.from(
    new Set(
      results
        .flatMap((r) => (r.screenshots ?? []).map((s) => s.title || s.label))
        .filter((l): l is string => !!l),
    ),
  ).slice(0, 30);
  const consoleErrors = Array.from(
    new Set(results.flatMap((r) => r.consoleErrors ?? [])),
  ).slice(0, 10);

  const testNames: string[] = [];
  for (const testId of new Set(
    results.map((r) => r.testId).filter((t): t is string => !!t),
  )) {
    const test = await queries.getTest(testId);
    if (test?.name) testNames.push(test.name);
  }

  const runFacts: QuickstartRunFacts = {
    passedCount:
      build.passedCount ?? results.filter((r) => r.status === "passed").length,
    failedCount:
      build.failedCount ?? results.filter((r) => r.status === "failed").length,
    changesDetected: build.changesDetected ?? 0,
    testNames,
    consoleErrors,
    failedSteps: results
      .filter((r) => r.status === "failed" || r.status === "setup_failed")
      .slice(0, 5)
      .map((r) => ({
        test: r.testId ?? "test",
        step: "unknown",
        error: r.errorMessage ?? "unknown",
      })),
  };

  try {
    const notes = await generateDemoNotes({
      repositoryId,
      productName,
      runFacts,
      routesVisited,
    });
    await queries.upsertBuildDemoNotes(buildId, notes);
    revalidatePath(`/builds/${buildId}`);
    return { ok: true, notes };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
