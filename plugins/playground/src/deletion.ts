import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import { deleteUserData } from "./data/queries";

/**
 * The cascade the database will no longer perform.
 *
 * `playground_achievements.user_id` used to carry `REFERENCES users(id) ON
 * DELETE CASCADE`, and that FK was the only thing reaping a deleted person's
 * scores. `core-scope.md` §6 removes FKs from plugin tables to core tables,
 * which removes the cascade with it — so without this hook, deleting an
 * account would leave its rows behind *and* leave the person on a public
 * leaderboard.
 *
 * ### This one needed no core change, and that is the point
 *
 * `launch` hit this first and had to land `onUserDeleted`, a `"user"`
 * `DeletionTarget` and a `cascadePluginDeletion` call in `queries.deleteUser`
 * as their own core PR before it could migrate at all
 * (`plugin-migration-recipe.md` §2.1). The playground is the second plugin
 * with person-scoped rows and pays none of that: the target already exists.
 * The core PR ahead of *this* migration was about something else entirely
 * (`tenancy` in the manifest), and it was optional in a way this would not
 * have been — a missing deletion target is a GDPR regression, a missing
 * `tenancy` field is only a missing guard rail.
 *
 * ### No team or repo hook
 *
 * Deliberately none. Nothing here is tenant-scoped — see `index.ts` — so
 * `runDeletionHooks` reports this plugin as `skipped` for team and repo
 * targets, which is accurate. A hook that silently did nothing would be worse.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onUserDeleted(userId: string): Promise<void> {
      await deleteUserData(db(), userId);
    },
  };
}
