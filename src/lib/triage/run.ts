/**
 * `runTriage` — the Triage agent's orchestration.
 *
 * Collect every failed / review-required case in a build, cluster them
 * deterministically, let one LLM pass name and refine those clusters, then
 * persist groups + cases and repopulate the classification columns the two
 * retired passes used to own.
 *
 * Two invariants:
 *
 *  - **Idempotent.** Re-running replaces the run's groups and cases wholesale
 *    (`replaceTriageGroups` / `replaceTriageCases`) and never touches
 *    `triage_case_verdicts` — a human decision outlives any number of
 *    re-triages.
 *  - **The deterministic clusters are the floor.** If the AI pass is skipped,
 *    unavailable or returns garbage, the run still publishes groups built from
 *    `clusterDeterministically` with generic headlines. The Run Results screen
 *    is never empty just because AI is off.
 */

import {
  clusterDeterministically,
  describeAge,
  groupRisk,
  rankGroups,
  suggestVerdict,
  type AssessCase,
  type ClusterGroup,
  type TriageCandidate,
  type TriageCandidateHistory,
  type TriageGroupEvidence,
  type TriageGroupKind,
  type TriageRegion,
  type TriageRunStatus,
} from "@lastest/triage-model";

import { runTriageAnalysis } from "@/lib/ai/triage-agent/analyze";
import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type {
  NewTriageCase,
  NewTriageGroup,
  StepComparison,
} from "@/lib/db/schema";

import { canRunTriage } from "./gate";
import {
  markClassificationFailed,
  writeCompatibilityColumns,
  type CompatCase,
} from "./classify";
import {
  closeTriageSession,
  createTriageSession,
  failTriageStep,
  finishTriageStep,
  startTriageStep,
} from "./session";

const log = getLogger("Triage");

export interface RunTriageOptions {
  /** Re-triage a build that already has a completed run. */
  force?: boolean;
  /** The caller already evaluated `canRunTriage` — don't pay for it twice. */
  skipGate?: boolean;
}

export interface RunTriageResult {
  ok: boolean;
  triageRunId?: string;
  status?: TriageRunStatus;
  /** Why the run produced no narrative, when it produced none. */
  skippedReason?: string;
  error?: string;
}

/** How many recent results per test feed the history signals. */
const HISTORY_WINDOW = 10;
/** How far back the "present since run N" window reaches. */
const BUILD_WINDOW = 10;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

interface CandidateLinks {
  testResultId?: string | null;
  stepComparisonId?: string | null;
  visualDiffId?: string | null;
  functionalAreaId?: string | null;
}

function stepKey(testId: string, stepLabel: string | null | undefined): string {
  return `${testId}::${stepLabel ?? ""}`;
}

function layersFromStep(step: StepComparison | undefined): string[] {
  if (!step) return [];
  return [...new Set(step.evidence.map((e) => e.layer))].sort();
}

function historyFrom(
  results: Array<{
    id: string;
    status: string | null;
    testRunId: string | null;
  }>,
): TriageCandidateHistory {
  const window = results.slice(0, HISTORY_WINDOW);
  let consecutiveFailures = 0;
  for (const r of window) {
    if (r.status === "failed" || r.status === "setup_failed")
      consecutiveFailures++;
    else break;
  }
  let flips = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].status !== window[i - 1].status) flips++;
  }
  return {
    buildsSeen: window.length,
    consecutiveFailures,
    flakyRate: window.length > 1 ? flips / (window.length - 1) : 0,
  };
}

// ---------------------------------------------------------------------------
// Generic (AI-free) group naming
// ---------------------------------------------------------------------------

function genericHeadline(cluster: ClusterGroup): string {
  const n = cluster.candidateIds.length;
  switch (cluster.reason) {
    case "error_signature":
      return `${n} cases failing with the same error`;
    case "shared_regions":
      return `${n} screenshots changed in the same region`;
    case "spec_and_browsers":
      return `${n} cases in the same spec and browser set`;
    default:
      return `${n} related cases`;
  }
}

function genericNote(cluster: ClusterGroup): string {
  switch (cluster.reason) {
    case "error_signature":
      return `Grouped by an identical error signature${
        cluster.errorSignature ? `: "${cluster.errorSignature}"` : ""
      }.`;
    case "shared_regions":
      return "Grouped because their changed screen regions overlap, which usually means one layout or style change is behind all of them.";
    case "spec_and_browsers":
      return `Grouped because they live in the same spec and fail on the same browsers (${
        cluster.browsers.join(", ") || "unknown"
      }).`;
    default:
      return "Grouped by the deterministic pre-pass.";
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runTriage(
  buildId: string,
  opts: RunTriageOptions = {},
): Promise<RunTriageResult> {
  const build = await queries.getBuild(buildId);
  if (!build) return { ok: false, error: "Build not found" };

  const testRun = build.testRunId
    ? await queries.getTestRun(build.testRunId)
    : null;
  const repositoryId = testRun?.repositoryId ?? null;
  if (!repositoryId) return { ok: false, error: "Build has no repository" };

  if (!opts.skipGate) {
    const gate = await canRunTriage({ repositoryId });
    if (!gate.allowed) {
      log.debug({ buildId, reason: gate.reason }, "triage gate closed");
      return { ok: false, error: gate.reason };
    }
  }

  const existing = await queries.getTriageRunByBuild(buildId);
  if (existing && existing.status === "completed" && !opts.force) {
    return {
      ok: true,
      triageRunId: existing.id,
      status: existing.status,
    };
  }

  const repo = await queries.getRepository(repositoryId);
  const run = await queries.createTriageRun({
    buildId,
    repositoryId,
    status: "pending",
  });

  const session = await createTriageSession({
    repositoryId,
    teamId: repo?.teamId ?? null,
    buildId,
  });
  await queries.updateTriageRun(run.id, {
    status: "running",
    agentSessionId: session?.id ?? null,
  });

  try {
    // ── 1. Collect ────────────────────────────────────────────────────────
    await startTriageStep(session?.id ?? null, "triage_collect");

    const [results, diffs, steps, changeMap, recentBuilds] = await Promise.all([
      queries.getTestResultsByRun(build.testRunId!),
      queries.getVisualDiffsByBuild(buildId),
      queries.getStepComparisonsByBuild(buildId),
      queries.getBuildChangeMap(buildId).catch(() => null),
      queries.getBuildsByRepo(repositoryId, BUILD_WINDOW).catch(() => []),
    ]);

    // Oldest-first, with the build being triaged guaranteed last — the shape
    // `describeAge` documents.
    const buildOrder = [
      ...recentBuilds
        .map((b) => b.id)
        .filter((id) => id !== buildId)
        .reverse(),
      buildId,
    ];

    const stepsByKey = new Map<string, StepComparison>();
    const stepsByDiff = new Map<string, StepComparison>();
    for (const s of steps) {
      stepsByKey.set(stepKey(s.testId, s.stepLabel), s);
      if (s.visualDiffId) stepsByDiff.set(s.visualDiffId, s);
    }

    const testIds = [
      ...new Set(
        [...results.map((r) => r.testId), ...diffs.map((d) => d.testId)].filter(
          (id): id is string => !!id,
        ),
      ),
    ];
    const tests = new Map(
      (await Promise.all(testIds.map((id) => queries.getTest(id))))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t) => [t.id, t]),
    );

    // Per-test history, and the build a failing streak started in.
    const buildByRun = new Map<string, string | null>();
    const resolveBuild = async (
      testRunId: string | null,
    ): Promise<string | null> => {
      if (!testRunId) return null;
      if (buildByRun.has(testRunId)) return buildByRun.get(testRunId)!;
      const b = await queries.getBuildByTestRun(testRunId).catch(() => null);
      const id = b?.id ?? null;
      buildByRun.set(testRunId, id);
      return id;
    };

    const historyByTest = new Map<
      string,
      { history: TriageCandidateHistory; firstSeenBuildId: string | null }
    >();
    for (const testId of testIds) {
      const rows = await queries.getTestResultsByTest(testId).catch(
        () =>
          [] as Array<{
            id: string;
            status: string | null;
            testRunId: string | null;
          }>,
      );
      const history = historyFrom(rows);
      // The oldest result in the current failing streak tells us how long the
      // case has been broken.
      const streak = rows.slice(
        0,
        Math.max(history.consecutiveFailures ?? 0, 1),
      );
      const firstSeenBuildId = await resolveBuild(
        streak[streak.length - 1]?.testRunId ?? null,
      );
      historyByTest.set(testId, { history, firstSeenBuildId });
    }

    const candidates: TriageCandidate[] = [];
    const links = new Map<string, CandidateLinks>();
    const failedTestIds = new Set<string>();

    for (const result of results) {
      if (result.status !== "failed" && result.status !== "setup_failed")
        continue;
      if (!result.testId) continue;
      failedTestIds.add(result.testId);
      const test = tests.get(result.testId);
      const step = stepsByKey.get(stepKey(result.testId, null));
      const hist = historyByTest.get(result.testId);
      candidates.push({
        id: `result:${result.id}`,
        testId: result.testId,
        testName: test?.name ?? null,
        // Lastest has no spec files — tests live in specs/areas. The spec id
        // (falling back to the functional area) is the equivalent "which file
        // is this in" key the third clustering pass wants.
        specFile: test?.specId ?? test?.functionalAreaId ?? null,
        stepLabel: null,
        status: "failed",
        browser: result.browser ?? null,
        errorMessage:
          result.errorMessage ??
          (result.consoleErrors?.length ? result.consoleErrors[0] : null),
        layers: layersFromStep(step),
        history: hist?.history ?? null,
      });
      links.set(`result:${result.id}`, {
        testResultId: result.id,
        stepComparisonId: step?.id ?? null,
        visualDiffId: step?.visualDiffId ?? null,
        functionalAreaId: test?.functionalAreaId ?? null,
      });
    }

    for (const diff of diffs) {
      // A failed test is already represented by its result case; its diffs are
      // symptoms of the same failure, not separate cases to review.
      if (failedTestIds.has(diff.testId)) continue;
      if (diff.classification !== "changed") continue;
      if (diff.status !== "pending") continue;
      const test = tests.get(diff.testId);
      const step =
        stepsByDiff.get(diff.id) ??
        stepsByKey.get(stepKey(diff.testId, diff.stepLabel));
      const hist = historyByTest.get(diff.testId);
      const regions = (diff.metadata?.changedRegions ?? []) as TriageRegion[];
      candidates.push({
        id: `diff:${diff.id}`,
        testId: diff.testId,
        testName: test?.name ?? null,
        specFile: test?.specId ?? test?.functionalAreaId ?? null,
        stepLabel: diff.stepLabel ?? null,
        status: "review",
        browser: null,
        errorMessage: null,
        diffPercentage: diff.percentageDifference
          ? Number(diff.percentageDifference)
          : null,
        changedRegions: regions,
        layers: layersFromStep(step),
        history: hist?.history ?? null,
      });
      links.set(`diff:${diff.id}`, {
        testResultId: diff.testResultId,
        stepComparisonId: step?.id ?? null,
        visualDiffId: diff.id,
        functionalAreaId: test?.functionalAreaId ?? null,
      });
    }

    await finishTriageStep(session?.id ?? null, "triage_collect", {
      cases: candidates.length,
    });

    if (candidates.length === 0) {
      await queries.replaceTriageGroups(run.id, []);
      await queries.replaceTriageCases(run.id, []);
      await queries.updateTriageRun(run.id, {
        status: "skipped",
        skippedReason: "No failed or review-required cases in this build.",
        caseCount: 0,
        groupCount: 0,
        computedAt: new Date(),
      });
      await finishTriageStep(
        session?.id ?? null,
        "triage_cluster",
        {},
        "skipped",
      );
      await finishTriageStep(
        session?.id ?? null,
        "triage_assess",
        {},
        "skipped",
      );
      await finishTriageStep(
        session?.id ?? null,
        "triage_publish",
        {},
        "skipped",
      );
      await closeTriageSession(session?.id ?? null, "completed");
      return {
        ok: true,
        triageRunId: run.id,
        status: "skipped",
        skippedReason: "No failed or review-required cases in this build.",
      };
    }

    // ── 2. Cluster ────────────────────────────────────────────────────────
    await startTriageStep(session?.id ?? null, "triage_cluster");
    const clusters = clusterDeterministically(candidates);
    await finishTriageStep(session?.id ?? null, "triage_cluster", {
      clusters: clusters.groups.length,
      ungrouped: clusters.ungrouped.length,
    });

    // ── 3. Assess ─────────────────────────────────────────────────────────
    await startTriageStep(session?.id ?? null, "triage_assess");
    const analysis = await runTriageAnalysis({
      repositoryId,
      branch: testRun?.gitBranch ?? null,
      candidates,
      clusters,
      changeMap,
    });
    await finishTriageStep(session?.id ?? null, "triage_assess", {
      status: analysis.status,
      ...(analysis.skippedReason ? { reason: analysis.skippedReason } : {}),
    });

    // ── 4. Assemble ───────────────────────────────────────────────────────
    await startTriageStep(session?.id ?? null, "triage_publish");

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const clusterOf = new Map<string, ClusterGroup>();
    for (const cluster of clusters.groups) {
      for (const id of cluster.candidateIds) clusterOf.set(id, cluster);
    }

    interface DraftGroup {
      key: string;
      headline: string;
      note: string;
      kind: TriageGroupKind;
      confidence: number;
      ids: string[];
    }

    const drafts: DraftGroup[] = [];
    const draftByKey = new Map<string, DraftGroup>();
    const placed = new Set<string>();

    const pushDraft = (draft: DraftGroup) => {
      drafts.push(draft);
      draftByKey.set(draft.key, draft);
      for (const id of draft.ids) placed.add(id);
    };

    for (const g of analysis.groups) {
      const ids = g.caseIds.filter((id) => byId.has(id) && !placed.has(id));
      if (!ids.length) continue;
      pushDraft({
        key: g.key,
        headline: g.headline,
        note: g.note,
        kind: g.kind,
        confidence: g.confidence,
        ids,
      });
    }

    // The deterministic floor: everything the AI didn't place goes back onto
    // its own cluster (generic headline), so the screen is populated even when
    // the AI pass was skipped entirely.
    for (const candidate of candidates) {
      if (placed.has(candidate.id)) continue;
      const cluster = clusterOf.get(candidate.id);
      if (!cluster) continue; // genuinely ungrouped — left without a group
      const existingDraft = draftByKey.get(cluster.key);
      if (existingDraft) {
        existingDraft.ids.push(candidate.id);
        placed.add(candidate.id);
        continue;
      }
      pushDraft({
        key: cluster.key,
        headline: genericHeadline(cluster),
        note: genericNote(cluster),
        kind: "unknown",
        confidence: 0,
        ids: [...cluster.candidateIds].filter((id) => !placed.has(id)),
      });
    }

    const caseNotes = new Map(analysis.cases.map((c) => [c.id, c]));

    const assessCasesFor = (ids: string[]): AssessCase[] =>
      ids.map((id) => {
        const c = byId.get(id)!;
        return {
          testId: c.testId,
          stepLabel: c.stepLabel ?? null,
          status: c.status,
          browser: c.browser ?? null,
          layers: c.layers ?? null,
          diffPercentage: c.diffPercentage ?? null,
          history: c.history ?? null,
        };
      });

    const changedFiles = (changeMap?.files ?? [])
      .slice(0, 10)
      .map((f) => f.path);

    const assessed = drafts.map((d) => {
      const cases = assessCasesFor(d.ids);
      const group = {
        key: d.key,
        kind: d.kind,
        confidence: d.confidence,
        cases,
      };
      const risk = groupRisk(group);
      const oldest = d.ids
        .map((id) => historyByTest.get(byId.get(id)!.testId)?.firstSeenBuildId)
        .filter((v): v is string => !!v)
        .sort((a, b) => buildOrder.indexOf(a) - buildOrder.indexOf(b))[0];
      const evidence: TriageGroupEvidence = {
        sharedRegions: clusterOf.get(d.ids[0])?.sharedRegions ?? [],
        browsers: [
          ...new Set(
            cases.map((c) => c.browser).filter((b): b is string => !!b),
          ),
        ].sort(),
        layers: [
          ...new Set(cases.flatMap((c) => [...(c.layers ?? [])])),
        ].sort(),
        age: describeAge(oldest ?? null, buildOrder),
        ...(changedFiles.length &&
        (d.kind === "regression" || d.kind === "maintenance")
          ? { changedFiles }
          : {}),
      };
      // Dominant functional area, when the cluster has one.
      const areaCounts = new Map<string, number>();
      for (const id of d.ids) {
        const areaId = links.get(id)?.functionalAreaId;
        if (areaId) areaCounts.set(areaId, (areaCounts.get(areaId) ?? 0) + 1);
      }
      const functionalAreaId =
        [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        ...d,
        risk,
        evidence,
        functionalAreaId,
        suggestedVerdict: suggestVerdict(group),
        cases,
      };
    });

    const ordered = rankGroups(
      assessed.map((a) => ({
        key: a.key,
        kind: a.kind,
        confidence: a.confidence,
        cases: a.cases,
        risk: a.risk,
      })),
    );
    const orderByKey = new Map(ordered.map((g, i) => [g.key, i]));
    assessed.sort(
      (a, b) => (orderByKey.get(a.key) ?? 0) - (orderByKey.get(b.key) ?? 0),
    );

    // ── 5. Persist ────────────────────────────────────────────────────────
    const groupRows: (Omit<NewTriageGroup, "id" | "triageRunId"> & {
      id?: string;
    })[] = assessed.map((a, i) => ({
      buildId,
      slug: a.key,
      headline: a.headline,
      note: a.note,
      kind: a.kind,
      risk: a.risk,
      suggestedVerdict: a.suggestedVerdict,
      confidence: a.confidence,
      orderIndex: i,
      functionalAreaId: a.functionalAreaId,
      evidence: a.evidence,
    }));

    const written = await queries.replaceTriageGroups(run.id, groupRows);
    const groupIdBySlug = new Map(written.map((g) => [g.slug, g.id]));

    const caseRows: (Omit<NewTriageCase, "id" | "triageRunId"> & {
      id?: string;
    })[] = [];
    const compat: CompatCase[] = [];
    let orderIndex = 0;
    for (const a of assessed) {
      for (const id of a.ids) {
        const candidate = byId.get(id)!;
        const link = links.get(id) ?? {};
        const aiCase = caseNotes.get(id);
        const note = aiCase?.note || a.note;
        const confidence = aiCase?.confidence ?? a.confidence;
        caseRows.push({
          triageGroupId: groupIdBySlug.get(a.key) ?? null,
          buildId,
          testId: candidate.testId,
          testResultId: link.testResultId ?? null,
          stepComparisonId: link.stepComparisonId ?? null,
          visualDiffId: link.visualDiffId ?? null,
          stepLabel: candidate.stepLabel ?? null,
          status: candidate.status,
          note,
          suggestedVerdict: a.suggestedVerdict,
          confidence,
          firstSeenBuildId:
            historyByTest.get(candidate.testId)?.firstSeenBuildId ?? null,
          orderIndex: orderIndex++,
        });
        compat.push({
          testResultId: link.testResultId ?? null,
          visualDiffId: link.visualDiffId ?? null,
          kind: a.kind,
          confidence,
          reasoning: [a.headline, note].filter(Boolean).join(" — "),
          categories: candidate.layers ?? [],
        });
      }
    }

    // Cases the clustering left entirely alone still belong in the run.
    for (const candidate of candidates) {
      if (placed.has(candidate.id)) continue;
      const link = links.get(candidate.id) ?? {};
      const aiCase = caseNotes.get(candidate.id);
      caseRows.push({
        triageGroupId: null,
        buildId,
        testId: candidate.testId,
        testResultId: link.testResultId ?? null,
        stepComparisonId: link.stepComparisonId ?? null,
        visualDiffId: link.visualDiffId ?? null,
        stepLabel: candidate.stepLabel ?? null,
        status: candidate.status,
        note: aiCase?.note ?? null,
        suggestedVerdict: null,
        confidence: aiCase?.confidence ?? 0,
        firstSeenBuildId:
          historyByTest.get(candidate.testId)?.firstSeenBuildId ?? null,
        orderIndex: orderIndex++,
      });
      compat.push({
        testResultId: link.testResultId ?? null,
        visualDiffId: link.visualDiffId ?? null,
        kind: "unknown",
        confidence: aiCase?.confidence ?? 0,
        reasoning: aiCase?.note ?? "Not clustered with any other case.",
        categories: candidate.layers ?? [],
      });
    }

    await queries.replaceTriageCases(run.id, caseRows);

    // ── 6. Compatibility columns ──────────────────────────────────────────
    const compatResult = await writeCompatibilityColumns(compat);

    const headline =
      analysis.headline ??
      `${caseRows.length} case${caseRows.length === 1 ? "" : "s"} across ${
        written.length
      } root cause${written.length === 1 ? "" : "s"}`;
    const summary =
      analysis.summary ??
      "Grouped by the deterministic pre-pass (error signature, overlapping changed regions, spec and browser set). No AI narrative was produced for this run.";

    await queries.updateTriageRun(run.id, {
      status: "completed",
      headline,
      summary,
      caseCount: caseRows.length,
      groupCount: written.length,
      modelId: analysis.modelId ?? null,
      skippedReason: analysis.skippedReason ?? null,
      computedAt: new Date(),
    });

    await finishTriageStep(session?.id ?? null, "triage_publish", {
      groups: written.length,
      cases: caseRows.length,
      testResultsClassified: compatResult.testResults,
      diffsClassified: compatResult.diffs,
    });
    await closeTriageSession(session?.id ?? null, "completed");

    log.info(
      {
        buildId,
        groups: written.length,
        cases: caseRows.length,
        ai: analysis.status,
      },
      "triage completed",
    );

    return {
      ok: true,
      triageRunId: run.id,
      status: "completed",
      skippedReason: analysis.skippedReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error, buildId }, "triage run failed");
    await queries
      .updateTriageRun(run.id, {
        status: "failed",
        skippedReason: message.slice(0, 500),
        computedAt: new Date(),
      })
      .catch(() => {});
    // The retired per-diff pass wrote aiAnalysisStatus:"failed" here; the
    // build screen still reads it. Keep that signal alive.
    await markClassificationFailed(buildId);
    await failTriageStep(session?.id ?? null, "triage_publish", message);
    await closeTriageSession(session?.id ?? null, "failed");
    return { ok: false, triageRunId: run.id, status: "failed", error: message };
  }
}
