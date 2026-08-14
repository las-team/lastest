/**
 * App Map "Flows" — named user journeys derived from test URL trajectories.
 *
 * A flow is the latest trajectory-bearing result of one test: its name is the
 * test name and its steps are the trajectory steps (ordered by stepIndex),
 * each with the step's action label and — where resolvable — the screenshot
 * captured at that step. Screenshot↔step matching mirrors `buildAppMap`:
 * label equality first, then a positional zip when counts line up, then a
 * single shot attributed to the final page reached.
 *
 * Pure data — no DB access; callers pass rows from
 * `getLatestTestResultsWithTrajectoryByRepo`.
 */

import type { CapturedScreenshot, UrlTrajectoryStep } from "@/lib/db/schema";
import { canonicalPath } from "./canonical";

export interface AppFlowStep {
  stepIndex: number;
  /** Action that produced this page state (e.g. "Step 3" or a named step). */
  stepLabel?: string;
  /** Final URL the step landed on. */
  url: string;
  /** Canonical path (App Map node id) — links the step to a map node. */
  nodeId: string | null;
  /** Storage path — rendered as `/api/media${path}`. */
  screenshotPath?: string;
}

export interface AppFlow {
  /** Stable id — the source test id. */
  id: string;
  name: string;
  testId: string;
  gitBranch?: string;
  capturedAt: string | null;
  steps: AppFlowStep[];
}

/** Minimal shape of a `getLatestTestResultsWithTrajectoryByRepo` row. */
export interface FlowSourceResult {
  testId: string | null;
  testName: string | null;
  screenshots: unknown;
  urlTrajectory: unknown;
  gitBranch: string | null;
  startedAt: Date | string | null;
}

/**
 * Derive flows from trajectory-bearing test results. Flows with fewer than
 * two steps are dropped (a single page state is not a journey). Sorted with
 * `branch`-matching flows first, then by name.
 */
export function deriveFlows(
  results: FlowSourceResult[],
  branch?: string,
): AppFlow[] {
  const flows: AppFlow[] = [];

  for (const r of results) {
    const traj = ((r.urlTrajectory ?? []) as UrlTrajectoryStep[])
      .slice()
      .sort((a, b) => a.stepIndex - b.stepIndex);
    if (traj.length < 2) continue;

    const shots = (r.screenshots ?? []) as CapturedScreenshot[];
    const shotByLabel = new Map<string, CapturedScreenshot>();
    for (const shot of shots) {
      if (shot.label && !shotByLabel.has(shot.label)) {
        shotByLabel.set(shot.label, shot);
      }
    }

    const steps: AppFlowStep[] = traj.map((step) => ({
      stepIndex: step.stepIndex,
      stepLabel: step.stepLabel,
      url: step.finalUrl,
      nodeId: canonicalPath(step.finalUrl, "", null),
      screenshotPath: step.stepLabel
        ? shotByLabel.get(step.stepLabel)?.path
        : undefined,
    }));

    const matchedAny = steps.some((s) => s.screenshotPath);
    if (!matchedAny && shots.length === traj.length) {
      // positional zip fallback
      for (let i = 0; i < steps.length; i++) {
        steps[i]!.screenshotPath = shots[i]!.path;
      }
    } else if (!matchedAny && shots.length === 1) {
      // single-shot: attribute to the final page reached
      steps[steps.length - 1]!.screenshotPath = shots[0]!.path;
    }

    flows.push({
      id: r.testId ?? "",
      name: r.testName ?? "Untitled flow",
      testId: r.testId ?? "",
      gitBranch: r.gitBranch ?? undefined,
      capturedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
      steps,
    });
  }

  return flows.sort((a, b) => {
    if (branch) {
      const am = a.gitBranch === branch ? 0 : 1;
      const bm = b.gitBranch === branch ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Flows that pass through a given App Map node (by canonical path). */
export function flowsThroughNode(flows: AppFlow[], nodeId: string): AppFlow[] {
  return flows.filter((f) => f.steps.some((s) => s.nodeId === nodeId));
}
