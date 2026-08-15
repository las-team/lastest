import type { DeletionHook } from "@lastest/contracts";
import { createStorageCapability } from "@lastest/core-storage";

import { db } from "./data/db";
import {
  deleteRepoRows,
  deleteTeamRows,
  listCsvDataSourceIdsForTeam,
  listCsvDataSourcesForRepo,
} from "./data/queries";
import { dataSourcesWiring } from "./wiring";

/**
 * The cascades the database no longer performs.
 *
 * Both tables carried `team_id -> teams.id` and `repository_id ->
 * repositories.id`, neither `.notNull()` and neither an `onDelete` cascade
 * (a plain Postgres FK, restrict by default) — so unlike `ci` this hook is
 * not replacing behaviour that ever fired; nothing before this migration
 * blocked or cascaded on either delete. `core-scope.md` §6 removes the FKs
 * regardless (a plugin table must not reach a core table, in either
 * direction), and this hook is what keeps "delete my account"/"delete this
 * repo" complete without them.
 *
 * ### The blob half `DeletionHook` was never built for
 *
 * CSV file bytes live in `ctx.storage`, namespaced by `(teamId, pluginId)` —
 * this is the first plugin to own both a table and a blob. Nothing in
 * `core/storage` reaps a team's prefix on team deletion (there is no
 * `onTeamDeleted` inside the storage host itself, only this contract), and a
 * deletion hook has no `ctx` to pull a scoped `StorageCapability` from. The
 * fix is the same shape `data/db.ts` already uses for the table half: build
 * the capability from the raw `StorageHost` the wiring slot carries, scoped
 * to the team id the hook was called with. Delete is driven by the row ids
 * (`csv/<id>`) rather than `storage.list("")`, so a future feature inside
 * this plugin that stores something else under the same namespace cannot be
 * swept by an unrelated wildcard.
 */
export function createDeletionHook(): DeletionHook {
  function storageFor(teamId: string) {
    return createStorageCapability(dataSourcesWiring().storageHost, {
      pluginId: "data-sources",
      teamId,
    });
  }

  async function deleteCsvBlobs(ids: string[], teamId: string): Promise<void> {
    if (ids.length === 0) return;
    const storage = storageFor(teamId);
    await Promise.all(ids.map((id) => storage.delete(`csv/${id}`)));
  }

  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const csvIds = await listCsvDataSourceIdsForTeam(db(), teamId);
      await deleteCsvBlobs(csvIds, teamId);
      await deleteTeamRows(db(), teamId);
    },

    async onRepoDeleted(repositoryId: string): Promise<void> {
      const database = db();
      const rows = await listCsvDataSourcesForRepo(database, repositoryId);
      if (rows.length > 0) {
        const byTeam = new Map<string, string[]>();
        for (const row of rows) {
          const list = byTeam.get(row.teamId) ?? [];
          list.push(row.id);
          byTeam.set(row.teamId, list);
        }
        await Promise.all(
          Array.from(byTeam.entries()).map(([teamId, ids]) =>
            deleteCsvBlobs(ids, teamId),
          ),
        );
      }
      await deleteRepoRows(database, repositoryId);
    },
  };
}
