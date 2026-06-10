'use server';

import * as queries from '@/lib/db/queries';
import { requireRepoAccess, getCurrentSession } from '@/lib/auth';
import { approveDiffCore } from '@/lib/diff/core';
import { awardScore } from '@/server/actions/gamification';
import { revalidatePath } from 'next/cache';
import type {
  EvidenceLayer,
  LayerFeedbackStatus,
  StepLayerFeedback,
  LayerBaselineKind,
  StepComparisonEvidence,
  StepComparison,
} from '@/lib/db/schema';

/**
 * Recompute the build's overallStatus and re-render the build pages. Shared by
 * decideLayer's single-card path and the bulk approvers below. Mirrors the
 * tail of approveDiffCore — without this, layer-only approvals leave the
 * build pinned in `review_required` even when every layer has been verified.
 */
async function recomputeBuildStatus(buildId: string): Promise<void> {
  const newStatus = await queries.computeBuildStatus(buildId);
  await queries.updateBuild(buildId, { overallStatus: newStatus });
  revalidatePath('/builds');
  revalidatePath(`/builds/${buildId}`);
}

/**
 * Maps each non-visual layer to its baseline kind. Visual stays in the
 * existing visualDiffs/baselines table; here we cover the seven other layers.
 *
 * `api` is intentionally absent: api-test evidence asserts ABSOLUTE
 * expectations the user authored (status/schema/body), not drift vs a
 * baseline — there is nothing to baseline-suppress. Approve/snooze on an api
 * layer records the feedback row (suppressing it for this build's review);
 * the durable fix is editing the test's apiDefinition.
 */
const LAYER_TO_BASELINE_KIND: Partial<Record<EvidenceLayer, LayerBaselineKind>> = {
  network: 'network',
  console: 'console',
  a11y: 'a11y',
  perf: 'perf',
  variable: 'variable',
  url: 'url_trajectory',
  dom: 'dom',
};

interface DecideInput {
  stepComparisonId: string;
  buildId: string;
  layer: EvidenceLayer;
  status: LayerFeedbackStatus;
  note?: string | null;
  /** Bulk callers set this to skip the per-call build status recompute and
   *  run a single recompute at the end of their loop. */
  skipBuildRecompute?: boolean;
}

/**
 * Per-layer 3-state feedback verb — Verify Phase 4.
 *  - approved → write per-layer baseline + suppress in subsequent builds
 *  - rejected → create reviewTodo + block build
 *  - snoozed  → suppress for THIS build only (no baseline write)
 */
export async function decideLayer(input: DecideInput): Promise<StepLayerFeedback> {
  const session = await getCurrentSession();
  const userId = session?.user?.id ?? null;

  // Authorize via the build's repo.
  const build = await queries.getBuild(input.buildId);
  if (!build) throw new Error('Build not found');
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);

  // Fetch the step + (when needed) repo branch context.
  const stepRows = await queries.getStepComparisonsByBuild(input.buildId);
  const step = stepRows.find((s) => s.id === input.stepComparisonId);
  if (!step) throw new Error('Step comparison not found');

  const branch = testRun?.gitBranch || 'main';

  let baselineKind: LayerBaselineKind | null = null;
  let reviewTodoId: string | null = null;

  if (input.status === 'approved') {
    if (input.layer === 'visual') {
      // Visual lives in visualDiffs/baselines — not in the per-layer baseline
      // tables this file handles. Without this branch the step_layer_feedback
      // row gets written (so the verify card moves to Verified) but the diff
      // stays pending and no new baseline is created, so the next run re-flags
      // the same change.
      if (step.visualDiffId) {
        // Snapshot pre-approval status so we can mirror approveDiff's
        // gamification awards (the action wrapper, not approveDiffCore,
        // owns awardScore on the build-detail path).
        const diffBefore = await queries.getVisualDiff(step.visualDiffId);
        await approveDiffCore(step.visualDiffId, userId ?? 'verify-user');
        if (session?.team && userId && diffBefore && diffBefore.status === 'pending') {
          awardScore({
            teamId: session.team.id,
            kind: 'diff_approved_as_change',
            actor: { kind: 'user', id: userId },
            sourceType: 'diff',
            sourceId: step.visualDiffId,
            detail: { testId: diffBefore.testId },
          }).catch((err) => console.error('[gamification] diff_approved_as_change failed', err));
          const teamId = session.team.id;
          queries
            .getTestCreator(diffBefore.testId)
            .then((creator) => {
              if (!creator) return;
              awardScore({
                teamId,
                kind: 'regression_caught',
                actor: creator,
                sourceType: 'diff',
                sourceId: step.visualDiffId!,
                detail: { testId: diffBefore.testId },
              }).catch((err) => console.error('[gamification] regression_caught failed', err));
            })
            .catch(() => {});
        }
      }
    } else {
      baselineKind = LAYER_TO_BASELINE_KIND[input.layer] ?? null;
      if (baselineKind && repoId) {
        await writeLayerBaseline({
          layer: input.layer,
          kind: baselineKind,
          testId: step.testId,
          stepLabel: step.stepLabel ?? null,
          branch,
          approvedFromComparisonId: input.stepComparisonId,
          approvedBy: userId,
          layers: step.layers,
        });
      }
    }
  } else if (input.status === 'rejected') {
    if (repoId) {
      const desc = `[${input.layer}] ${step.stepLabel ?? 'step'} — Needs fix${input.note ? `: ${input.note}` : ''}`;
      const todo = await queries.createReviewTodo({
        repositoryId: repoId,
        buildId: input.buildId,
        testId: step.testId,
        branch,
        description: desc,
        status: 'open',
        createdBy: userId,
        diffId: null,
        resolvedAt: null,
        resolvedBy: null,
      });
      reviewTodoId = todo.id;
    }
  }

  const result = await queries.upsertLayerFeedback({
    stepComparisonId: input.stepComparisonId,
    buildId: input.buildId,
    layer: input.layer,
    status: input.status,
    baselineKind,
    reviewTodoId,
    note: input.note ?? null,
    decidedBy: userId,
  });

  // Note: no activity-event emission here. Activity events are reserved for
  // agent-sourced actions (play_agent / mcp_server / generate_agent / heal_agent).
  // User-driven UI clicks intentionally don't write to the feed — same convention
  // as approveDiffCore on the build-detail path.

  revalidatePath(`/verify/${input.buildId}`);
  if (!input.skipBuildRecompute) {
    await recomputeBuildStatus(input.buildId);
  }
  return result;
}

/**
 * Bulk-approve every case on a build that doesn't already carry a `rejected`
 * decision. Used by the Verify header's "Mark all verified" button. Matches
 * the per-card decideAllForStep semantics: for each step we approve every
 * evidence-bearing layer (falling back to `visual` when nothing is scored)
 * and any layer that already has feedback, so a stale `snoozed`/`pending`
 * row can't pin the case in a non-approved column afterwards.
 *
 * Returns the number of step_comparisons that received at least one new
 * approval — useful for the caller's toast.
 */
export async function approveAllVerifyCases(buildId: string): Promise<{ approved: number }> {
  const build = await queries.getBuild(buildId);
  if (!build) throw new Error('Build not found');
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);

  const stepRows = await queries.getStepComparisonsByBuild(buildId);
  if (stepRows.length === 0) return { approved: 0 };

  const existingFeedback = await queries.getLayerFeedbackByBuild(buildId);
  const fbByStep = new Map<string, StepLayerFeedback[]>();
  for (const f of existingFeedback) {
    if (!fbByStep.has(f.stepComparisonId)) fbByStep.set(f.stepComparisonId, []);
    fbByStep.get(f.stepComparisonId)!.push(f);
  }

  let approved = 0;
  for (const step of stepRows) {
    const stepFb = fbByStep.get(step.id) ?? [];

    // Skip rejected cases — the reviewer marked them as Broken; the bulk
    // approve shouldn't silently flip those.
    if (stepFb.some((f) => f.status === 'rejected')) continue;

    // Skip already-fully-approved cases to keep the operation idempotent and
    // avoid double-writing per-layer baselines.
    const evidenceLayers = Array.from(new Set(step.evidence.map((e) => e.layer)));
    const approvedSet = new Set(
      stepFb.filter((f) => f.status === 'approved' || f.status === 'auto_approved').map((f) => f.layer),
    );
    const fullyApproved = evidenceLayers.length > 0
      ? evidenceLayers.every((l) => approvedSet.has(l))
      : approvedSet.size > 0;
    if (fullyApproved) continue;

    // Same layer set decideAllForStep computes client-side: every evidence
    // layer + any layer that already has stored feedback (so we override it),
    // with `visual` as the fallback when neither is present.
    const existingLayers = stepFb.map((f) => f.layer);
    const layerSet = new Set<EvidenceLayer>([...evidenceLayers, ...existingLayers]);
    if (layerSet.size === 0) layerSet.add('visual');

    for (const layer of layerSet) {
      await decideLayer({
        stepComparisonId: step.id,
        buildId,
        layer,
        status: 'approved',
        skipBuildRecompute: true,
      });
    }
    approved++;
  }

  revalidatePath(`/verify/${buildId}`);
  await recomputeBuildStatus(buildId);
  return { approved };
}

/**
 * Bulk-approve every layer where the AI recommended `approve` and the
 * verdict was not red. Mirrors the existing "Accept AI Approvals" flow on
 * visual diffs but covers all layers at once.
 */
export async function approveAIRecommendedLayers(buildId: string): Promise<{ approved: number }> {
  const build = await queries.getBuild(buildId);
  if (!build) throw new Error('Build not found');
  const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
  const repoId = testRun?.repositoryId ?? null;
  if (repoId) await requireRepoAccess(repoId);

  const stepRows = await queries.getStepComparisonsByBuild(buildId);
  let approved = 0;
  for (const step of stepRows) {
    if (step.verdict === 'red') continue;
    for (const ev of step.evidence) {
      // Only approve when the evidence's signal is at most medium and the
      // layer is one we know how to baseline. Visual goes through
      // approveDiffCore (visualDiffs + baselines table); the other seven
      // layers go through writeLayerBaseline.
      if (ev.signal === 'high') continue;
      if (ev.layer !== 'visual' && !LAYER_TO_BASELINE_KIND[ev.layer]) continue;
      await decideLayer({
        stepComparisonId: step.id,
        buildId,
        layer: ev.layer,
        status: 'approved',
        skipBuildRecompute: true,
      });
      approved++;
    }
  }
  await recomputeBuildStatus(buildId);
  return { approved };
}

interface BaselineWriteInput {
  layer: EvidenceLayer;
  kind: LayerBaselineKind;
  testId: string;
  stepLabel: string | null;
  branch: string;
  approvedFromComparisonId: string;
  approvedBy: string | null;
  layers: StepComparisonEvidence | null;
}

async function writeLayerBaseline(input: BaselineWriteInput): Promise<void> {
  const layerData = input.layers ?? ({} as StepComparisonEvidence);

  switch (input.kind) {
    case 'network': {
      // Roll up new errors/flips into one baseline payload per (test, step).
      // First-pass behavior: snapshot the current run's error endpoints as
      // expected. Future runs with the same fingerprint suppress.
      const net = layerData.network;
      if (!net) return;
      // Combine first new error + first status flip as the canonical entry.
      const first = net.newClientErrors[0] ?? net.newServerErrors[0] ?? net.statusFlips[0];
      if (!first) return;
      const status = 'status' in first ? first.status : (first as { to: number }).to;
      await queries.createNetworkBaseline({
        testId: input.testId,
        stepLabel: input.stepLabel,
        branch: input.branch,
        approvedFromComparisonId: input.approvedFromComparisonId,
        approvedBy: input.approvedBy,
        payload: {
          normalizedUrl: first.url,
          method: first.method,
          statusRange: [status, status] as [number, number],
          p95DurationMs: null,
        },
      });
      return;
    }
    case 'console': {
      const con = layerData.consoleDiff;
      if (!con) return;
      for (const fp of con.newFingerprints.slice(0, 5)) {
        await queries.createConsoleBaseline({
          testId: input.testId,
          stepLabel: input.stepLabel,
          branch: input.branch,
          approvedFromComparisonId: input.approvedFromComparisonId,
          approvedBy: input.approvedBy,
          payload: {
            fingerprint: fp.fingerprint,
            level: 'error',
            expectedCount: fp.count,
            lastSeenBuildId: input.approvedFromComparisonId,
            sample: fp.sample,
          },
        });
      }
      return;
    }
    case 'a11y': {
      const a = layerData.a11y;
      if (!a) return;
      for (const v of a.newViolations.slice(0, 10)) {
        await queries.createA11yBaseline({
          testId: input.testId,
          stepLabel: input.stepLabel,
          branch: input.branch,
          approvedFromComparisonId: input.approvedFromComparisonId,
          approvedBy: input.approvedBy,
          payload: {
            ruleId: v.id ?? '',
            selector: v.description ?? '',
            impact: v.impact ?? '',
            acknowledgedAt: new Date().toISOString(),
          },
        });
      }
      return;
    }
    case 'perf': {
      const p = layerData.perf;
      if (!p) return;
      const metrics: Record<string, { p50: number; p95: number }> = {};
      for (const d of p.deltas) {
        metrics[d.metric] = { p50: d.current, p95: d.current };
      }
      await queries.createPerfBaseline({
        testId: input.testId,
        stepLabel: input.stepLabel,
        branch: input.branch,
        approvedFromComparisonId: input.approvedFromComparisonId,
        approvedBy: input.approvedBy,
        payload: { metrics },
      });
      return;
    }
    case 'variable': {
      const v = layerData.variable;
      if (!v) return;
      for (const c of v.changes.slice(0, 10)) {
        await queries.createVariableBaseline({
          testId: input.testId,
          stepLabel: input.stepLabel,
          branch: input.branch,
          approvedFromComparisonId: input.approvedFromComparisonId,
          approvedBy: input.approvedBy,
          payload: { key: c.path, value: c.current == null ? null : String(c.current) },
        });
      }
      return;
    }
    case 'url_trajectory': {
      const u = layerData.url;
      if (!u) return;
      const sequence = u.divergedSteps.map((d) => d.currentUrl);
      await queries.createUrlTrajectoryBaseline({
        testId: input.testId,
        branch: input.branch,
        approvedFromComparisonId: input.approvedFromComparisonId,
        approvedBy: input.approvedBy,
        payload: { sequence },
      });
      return;
    }
    case 'dom': {
      const d = layerData.dom;
      if (!d) return;
      // First-pass: blanket-accept attribute-only diffs surfaced by domDiff.
      // Future runs consult domBaselines.acceptedAttributes to suppress.
      const selector = '/* root */';
      await queries.createDomBaseline({
        testId: input.testId,
        stepLabel: input.stepLabel,
        branch: input.branch,
        approvedFromComparisonId: input.approvedFromComparisonId,
        approvedBy: input.approvedBy,
        payload: { selector, acceptedAttributes: {} },
      });
      return;
    }
  }
}

/**
 * Read the current step's reviewTodo links + per-layer feedback for display.
 * Convenience for the verify screen that spares one round-trip.
 */
export async function getStepFeedbackContext(stepComparisonId: string): Promise<{
  feedback: StepLayerFeedback[];
  step: StepComparison | null;
}> {
  const fb = await queries.getLayerFeedbackByStep(stepComparisonId);
  return { feedback: fb, step: null };
}
