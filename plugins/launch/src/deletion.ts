import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import { deleteUserData } from "./data/queries";

/**
 * The cascade the database will no longer perform.
 *
 * Four of this plugin's tables used to carry `REFERENCES users(id) ON DELETE
 * CASCADE`, and a fifth `ON DELETE SET NULL`. `core-scope.md` §6 removes FKs
 * from plugin tables to core tables, which removed those cascades with them —
 * so account deletion would have quietly left a deleted person's votes,
 * comments and reactions on a public board. This hook is the replacement.
 *
 * ### Why this needed a core change first
 *
 * `DeletionHook` had two members, `onTeamDeleted` and `onRepoDeleted`, because
 * every plugin before this one held tenant-scoped rows. Launch holds
 * *person*-scoped rows: deleting a user does not delete their team, so no team
 * hook would ever fire for them. `onUserDeleted` (and the matching `"user"`
 * `DeletionTarget`, and the `cascadePluginDeletion` call in
 * `queries.deleteUser`) landed as its own core PR ahead of this migration —
 * RFC §7.2's workflow doing exactly what it is for.
 *
 * ### No team or repo hook
 *
 * There is deliberately none. The board is not tenant-scoped at all: a launch
 * profile belongs to a submitter and a weekly cohort, never to a team. A
 * `onTeamDeleted` here would have nothing to delete by, and writing one that
 * silently did nothing would be worse than not declaring it — `runDeletionHooks`
 * reports the plugin as `skipped` for team and repo targets, which is accurate.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onUserDeleted(userId: string): Promise<void> {
      await deleteUserData(db(), userId);
    },
  };
}
