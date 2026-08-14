import type { DeletionHook } from "@lastest/contracts";
import { eq } from "drizzle-orm";

import { orm } from "./data/db";
import { rangerSessions } from "./schema";
import { rangerWiring } from "./wiring";

/**
 * The cascade the database will no longer perform.
 *
 * `ranger_sessions` carries `repository_id`/`team_id` as plain text with no
 * foreign key (`core-scope.md` §6), so deleting a team or a repo needs this
 * hook to reach the rows at all. `resolveRegistry()` refuses to boot a plugin
 * that declares `schema` without one. One table, so there is no ordering to
 * get wrong — see `plugins/explorer/src/deletion.ts` for the case where that
 * matters.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const db = orm(rangerWiring().data);
      await db.delete(rangerSessions).where(eq(rangerSessions.teamId, teamId));
    },

    async onRepoDeleted(repoId: string): Promise<void> {
      const db = orm(rangerWiring().data);
      await db
        .delete(rangerSessions)
        .where(eq(rangerSessions.repositoryId, repoId));
    },
  };
}
