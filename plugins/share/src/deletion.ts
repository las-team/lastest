import type { DeletionHook } from "@lastest/contracts";
import { eq, or } from "drizzle-orm";

import { orm } from "./data/db";
import { sharePublicShares } from "./schema";
import { shareWiring } from "./wiring";

/**
 * The cascade the database never actually performed.
 *
 * Unlike `launch`/`playground`, this is not replacing a dropped `ON DELETE
 * CASCADE` — `ownerTeamId`, `repositoryId`, `claimedByTeamId` were always
 * convention-only references (`schema.ts`'s header), the same finding
 * `gamification` made. So this hook is a genuine fix, not a preservation:
 * before this migration, deleting a team or repo left every share it
 * published (or claimed) behind. `resolveRegistry` requires it anyway
 * whenever `schema` is declared.
 *
 * A repo can be both the *owner* (`repositoryId`) and, independently, a
 * share can be *claimed by* a different team (`claimedByTeamId`). Team
 * deletion clears both directions; repo deletion only clears `repositoryId`
 * — a claimed-into repo being deleted should not un-claim the original
 * share, it should just stop being resolvable as a repo (core's own
 * problem, not this plugin's).
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const db = orm(shareWiring().data);
      await db
        .delete(sharePublicShares)
        .where(
          or(
            eq(sharePublicShares.ownerTeamId, teamId),
            eq(sharePublicShares.claimedByTeamId, teamId),
          ),
        );
    },

    async onRepoDeleted(repoId: string): Promise<void> {
      const db = orm(shareWiring().data);
      await db
        .delete(sharePublicShares)
        .where(eq(sharePublicShares.repositoryId, repoId));
    },
  };
}
