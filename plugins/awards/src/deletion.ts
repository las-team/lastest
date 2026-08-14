import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import { deleteRepoAward } from "./data/queries";

/**
 * The cascade the database will no longer perform.
 *
 * `awards_repo_awards.repository_id` carried `references(() =>
 * repositories.id, { onDelete: "cascade" })` before the move — a real FK to a
 * core table, which `core-scope.md` §6 forbids a plugin from declaring.
 * `scripts/migrate.js` drops it after the rename; this hook is what makes
 * deleting a repository still delete its award row. The ordinary case per
 * recipe §2.1: one table, one FK, `cascade` behaviour — nothing to reproduce
 * beyond a delete, unlike `ci`'s `restrict` or `launch`'s user-scoped rows.
 *
 * `onRepoDeleted`, not `onTeamDeleted`: the table carries no `team_id` at
 * all, only `repository_id`. Deleting a team deletes its repositories first
 * (core's own cascade), and each repo delete drives this hook — so team
 * deletion is still covered, just one level removed.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onRepoDeleted(repositoryId: string): Promise<void> {
      await deleteRepoAward(db(), repositoryId);
    },
  };
}
