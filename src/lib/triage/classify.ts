/**
 * The compatibility writer — "replace, not break".
 *
 * The Triage agent took over the two classification columns the retired passes
 * owned. Everything downstream of those columns (the healer's `real_regression`
 * gate, the GitHub issue body renderer, the build detail screen's
 * approve/review/flag tallies, the MCP server's diff payloads, `acceptAI
 * Approvals`) keeps reading exactly what it read before — it is now written
 * once per build by the agent instead of once per item by two LLM passes.
 *
 *   `test_results.triage`        ← the case's group kind, as `TriageResult`
 *   `visual_diffs.aiAnalysis`    ← the case's group, as `AIDiffAnalysis`
 *   `visual_diffs.aiRecommendation` / `.aiAnalysisStatus`
 *
 * Nothing here is allowed to fail a triage run: writes are per-row and
 * individually caught.
 */

import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type {
  AIDiffAnalysis,
  AIDiffRecommendation,
  TriageClassification,
  TriageResult,
} from "@/lib/db/schema";
import type { TriageGroupKind } from "@lastest/triage-model";

const log = getLogger("Triage");

/**
 * Group kind → the vocabulary `test_results.triage` has always spoken.
 *
 * `noise` has no counterpart in the old five-way enum — a diff that changed
 * but means nothing is, from the failed-test point of view, the same
 * non-event as a flaky test, so it maps to `flaky_test` rather than inventing
 * a value readers do not switch on.
 */
export const KIND_TO_CLASSIFICATION: Record<
  TriageGroupKind,
  TriageClassification
> = {
  regression: "real_regression",
  flake: "flaky_test",
  noise: "flaky_test",
  maintenance: "test_maintenance",
  environment: "environment_issue",
  unknown: "unknown",
};

/**
 * Group kind → the diff analyzer's verdict pair.
 *
 * Only `noise` earns `approve` (the recommendation `acceptAIApprovals` acts
 * on), matching the retired analyzer, which reserved it for `insignificant`
 * changes. Everything a reviewer should actually look at stays `review`, and a
 * genuine regression is escalated to `flag`.
 */
export const KIND_TO_DIFF_VERDICT: Record<
  TriageGroupKind,
  {
    classification: AIDiffAnalysis["classification"];
    recommendation: AIDiffRecommendation;
  }
> = {
  regression: { classification: "meaningful", recommendation: "flag" },
  flake: { classification: "noise", recommendation: "review" },
  noise: { classification: "noise", recommendation: "approve" },
  maintenance: { classification: "meaningful", recommendation: "review" },
  environment: { classification: "meaningful", recommendation: "review" },
  unknown: { classification: "meaningful", recommendation: "review" },
};

/** Which kind wins when one test result carries several cases. */
const KIND_PRIORITY: Record<TriageGroupKind, number> = {
  regression: 0,
  maintenance: 1,
  environment: 2,
  flake: 3,
  noise: 4,
  unknown: 5,
};

/** One triaged case, narrowed to what the compatibility columns need. */
export interface CompatCase {
  testResultId?: string | null;
  visualDiffId?: string | null;
  kind: TriageGroupKind;
  /** 0-100 (the persisted triage scale). Converted to 0-1 on write. */
  confidence: number;
  /** Group note + case note, already composed by the caller. */
  reasoning: string;
  /** Categories to carry onto `aiAnalysis` (the layers that flagged). */
  categories?: string[];
}

export interface CompatWriteResult {
  testResults: number;
  diffs: number;
}

/**
 * Populate the retired passes' columns from a completed triage run.
 * Idempotent: re-triage simply overwrites with the newer classification.
 */
export async function writeCompatibilityColumns(
  cases: readonly CompatCase[],
): Promise<CompatWriteResult> {
  const analyzedAt = new Date().toISOString();

  // One triage row per test result — the most serious kind among its cases.
  const byResult = new Map<string, CompatCase>();
  for (const c of cases) {
    if (!c.testResultId) continue;
    const existing = byResult.get(c.testResultId);
    if (!existing || KIND_PRIORITY[c.kind] < KIND_PRIORITY[existing.kind]) {
      byResult.set(c.testResultId, c);
    }
  }

  let testResults = 0;
  for (const [testResultId, c] of byResult) {
    const triage: TriageResult = {
      classification: KIND_TO_CLASSIFICATION[c.kind],
      confidence: Math.max(0, Math.min(1, c.confidence / 100)),
      reasoning:
        c.reasoning.slice(0, 1000) || "Classified by the Triage agent.",
    };
    try {
      await queries.updateTestResult(testResultId, { triage });
      testResults++;
    } catch (err) {
      log.warn({ err, testResultId }, "could not write test_results.triage");
    }
  }

  let diffs = 0;
  for (const c of cases) {
    if (!c.visualDiffId) continue;
    const verdict = KIND_TO_DIFF_VERDICT[c.kind];
    const analysis: AIDiffAnalysis = {
      classification: verdict.classification,
      recommendation: verdict.recommendation,
      summary: c.reasoning.slice(0, 1000) || "Classified by the Triage agent.",
      confidence: Math.max(0, Math.min(1, c.confidence / 100)),
      categories: c.categories ?? [],
      analyzedAt,
    };
    try {
      await queries.updateVisualDiff(c.visualDiffId, {
        aiAnalysis: analysis,
        aiRecommendation: verdict.recommendation,
        aiAnalysisStatus: "completed",
      });
      diffs++;
    } catch (err) {
      log.warn(
        { err, visualDiffId: c.visualDiffId },
        "could not write visual_diffs.aiAnalysis",
      );
    }
  }

  return { testResults, diffs };
}

/**
 * Mark a build's unclassified diffs as failed classification.
 *
 * The retired per-diff pass wrote `aiAnalysisStatus: "failed"` when its LLM
 * call blew up, and the build screen still reads it (`failedAnalysisCount`,
 * `isAIFailed` on the retired build page) to tell the user classification
 * did not happen. Without this the agent's failure path leaves the column
 * null, that affordance never renders again, and a failed triage is
 * indistinguishable from one that was never asked to run.
 *
 * Only touches diffs that carry no analysis yet, so a build that is re-triaged
 * after a successful run keeps the verdicts it already earned.
 */
export async function markClassificationFailed(
  buildId: string,
): Promise<number> {
  let marked = 0;
  try {
    const diffs = await queries.getVisualDiffsByBuild(buildId);
    for (const d of diffs) {
      if (d.aiAnalysis) continue;
      try {
        await queries.updateVisualDiff(d.id, { aiAnalysisStatus: "failed" });
        marked++;
      } catch (err) {
        log.warn({ err, visualDiffId: d.id }, "could not mark diff failed");
      }
    }
  } catch (err) {
    log.warn({ err, buildId }, "could not list diffs to mark failed");
  }
  return marked;
}
