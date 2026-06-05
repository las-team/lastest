/**
 * Verify-phase feature flag (v1.14+).
 *
 * Two ways to enable:
 *   - Per-team flag: teams.verifyPhaseEnabled = true
 *   - Env override:  VERIFY_PHASE_ENABLED=1 (turns it on for everyone)
 *
 * Off by default during rollout. Phase 6 flips the default and removes the flag.
 */

import type { Team } from "@/lib/db/schema";

export function isVerifyPhaseEnabled(
  team?: Pick<Team, "verifyPhaseEnabled"> | null | undefined,
): boolean {
  if (
    process.env.VERIFY_PHASE_ENABLED === "1" ||
    process.env.VERIFY_PHASE_ENABLED === "true"
  ) {
    return true;
  }
  return team?.verifyPhaseEnabled ?? false;
}
