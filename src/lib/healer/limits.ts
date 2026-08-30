/** Bounds for the Healer's two budgets. Wide enough to tune, tight enough
 *  that a typo cannot turn the agent into an unbounded loop. Lives outside
 *  the `"use server"` action module because that may only export async
 *  functions. */
export const HEALER_LIMITS = {
  attempts: { min: 1, max: 5 },
  tests: { min: 1, max: 25 },
} as const;
