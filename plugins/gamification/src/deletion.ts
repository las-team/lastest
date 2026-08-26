import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import { deleteTeamData } from "./data/queries";

/**
 * The cascade the database will no longer perform.
 *
 * ### The honest version: there was never a cascade to lose
 *
 * Unlike `launch` and `playground`, these six tables carried **no FK to
 * `users` or `teams` before the move** — `team_id` was already a
 * convention-only reference, one of the 104 the schema graph counted
 * (`core-scope.md` §7). So deleting a team already left every score event,
 * every achievement and every bot row behind, and had done since the feature
 * shipped.
 *
 * That makes this hook a **bug fix that the migration surfaced**, not a
 * regression it prevented. Worth stating plainly, because the framing in every
 * previous result doc ("the hook replaces the cascade") does not apply here and
 * would be flattering: `core-scope.md` §6 says convention-only references are
 * "the existing norm here, not a novelty", and the price of that norm is
 * exactly this — nobody notices until something forces an inventory.
 *
 * ### Team, not user
 *
 * Every table here is team-scoped, so this is `onTeamDeleted` (recipe §2.1).
 * A user leaving a team keeps their score rows, which is the pre-existing
 * behaviour: a season leaderboard is a record of what happened, and the
 * `actor_id` of a departed member simply stops resolving to a profile.
 *
 * No `onRepoDeleted`: nothing here is repo-scoped, and a hook that silently did
 * nothing would be worse than the `skipped` that `runDeletionHooks` reports.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      await deleteTeamData(db(), teamId);
    },
  };
}
