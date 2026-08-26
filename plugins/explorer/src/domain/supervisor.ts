/**
 * Explorer supervisor: cheap deterministic heuristics that keep the loop from
 * running in circles or burning budget (explorbot's Pilot, heuristic-first —
 * no AI call needed for the common stuck patterns).
 */

/** A state repeating this many times within the recent window = stuck. */
const STUCK_REPEATS = 3;
/** How much history the stuck check considers. */
const STUCK_WINDOW = 6;

/** Hard cap on tester actions per scenario (the per-scenario step budget). */
export const MAX_ACTIONS_PER_SCENARIO = 14;

/** Hard cap on scenarios executed per iteration. */
export const MAX_SCENARIOS_PER_ITERATION = 5;

/** True when the recent state history shows the loop revisiting the same page
 *  state over and over — research keeps landing on a state we've already
 *  explored, so more iterations won't find new ground. */
export function isStuck(stateHistory: string[]): boolean {
  if (stateHistory.length < STUCK_REPEATS) return false;
  const recent = stateHistory.slice(-STUCK_WINDOW);
  const counts = new Map<string, number>();
  for (const hash of recent) {
    const n = (counts.get(hash) ?? 0) + 1;
    if (n >= STUCK_REPEATS) return true;
    counts.set(hash, n);
  }
  return false;
}

/** True when the same (action, selector) pair keeps repeating at the tail of
 *  an action log — the tester is hammering one control without progress. */
export function isActionLooping(
  steps: Array<{ action: string; selector?: string }>,
  repeats = 3,
): boolean {
  if (steps.length < repeats) return false;
  const tail = steps.slice(-repeats);
  const key = (s: { action: string; selector?: string }) =>
    `${s.action}|${s.selector ?? ""}`;
  return tail.every((s) => key(s) === key(tail[0]));
}
