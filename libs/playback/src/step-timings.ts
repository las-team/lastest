import type { StepTiming } from "@lastest/eb-protocol";

/**
 * The slice of `CapturedScreenshot` this module reads. Declared locally
 * rather than imported — `CapturedScreenshot` is a core (`tests`-domain) type
 * with many fields this module does not touch; core-scope.md §6.1 says narrow
 * rather than pull the whole type across a boundary that does not need it.
 */
export interface StepScreenshotTiming {
  atMs?: number | null;
  label?: string | null;
}

/**
 * Resolve per-step video-clock segments for a test result, degrading through
 * the same ladder the share page's chapter rail uses:
 *
 *   1. persisted `test_results.step_timings` (EB runs, spec 28) — exact;
 *   2. `screenshots[].atMs` anchors — each step spans from its screenshot's
 *      offset to the next one's (the last extends to the recording end);
 *   3. even split of the recording duration across the steps.
 *
 * Returns [] when there's nothing to place steps with (no timings, no
 * screenshots, no duration). All values are ms on the video clock.
 */
export function resolveStepSegments(input: {
  stepTimings?: StepTiming[] | null;
  screenshots?: StepScreenshotTiming[] | null;
  durationMs?: number | null;
}): StepTiming[] {
  const { stepTimings, screenshots, durationMs } = input;

  if (stepTimings && stepTimings.length > 0) {
    return [...stepTimings].sort((a, b) => a.startMs - b.startMs);
  }

  const shots = screenshots ?? [];
  const total = durationMs && durationMs > 0 ? durationMs : null;

  const anchored = shots
    .map((s, i) => ({ shot: s, index: i }))
    .filter((e) => typeof e.shot.atMs === "number");
  if (anchored.length > 0) {
    return anchored.map((e, i) => {
      const startMs = Math.max(0, e.shot.atMs as number);
      const next = anchored[i + 1];
      const endMs = next
        ? Math.max(startMs, next.shot.atMs as number)
        : Math.max(startMs, total ?? startMs + 3000);
      return {
        stepIndex: e.index,
        label: e.shot.label ?? `Step ${e.index + 1}`,
        stepType: "shot",
        status: "passed" as const,
        startMs,
        endMs,
      };
    });
  }

  if (shots.length > 0 && total) {
    const per = total / shots.length;
    return shots.map((s, i) => ({
      stepIndex: i,
      label: s.label ?? `Step ${i + 1}`,
      stepType: "shot",
      status: "passed" as const,
      startMs: Math.round(i * per),
      endMs: Math.round((i + 1) * per),
    }));
  }

  return [];
}
