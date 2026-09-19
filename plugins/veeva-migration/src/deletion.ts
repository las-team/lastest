import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import {
  anonymiseUser,
  deleteProjectsForRepo,
  deleteProjectsForTeam,
  listProjectsForRepo,
} from "./data/queries";
import { veevaMigrationWiring } from "./wiring";

/**
 * The cascades the database no longer performs.
 *
 * This is the half of the fix that the review's "no deletion path" finding was
 * about, and it is worth being precise about what it replaces, because the
 * answer differs per table:
 *
 *  - `migration_projects.repository_id` had `ON DELETE CASCADE`, so deleting a
 *    repo really did delete its migrations. `onRepoDeleted` keeps that.
 *  - There was **no cascade at all for a team**, because there was no
 *    `team_id`: the FK went to `repositories`, so deleting a team only reached
 *    these rows if every repo was deleted first. `onTeamDeleted` is new
 *    behaviour and the honest reading of "delete everything this plugin holds
 *    for the team".
 *  - The four `users` FKs were `ON DELETE SET NULL`, which was right: a
 *    signed-off wave must not become unsigned because the person who signed it
 *    closed their account. `onUserDeleted` keeps exactly that.
 *  - **The thirteen engine tables cascaded from nothing.** They were in a
 *    separate Postgres schema with no FK to anything, so the id map, the row
 *    results, the findings and the audit log — actors and per-record ids —
 *    outlived the project, the repository and the team, permanently. They now
 *    hang off `veeva_migration_projects` by a plugin-internal FK that still
 *    cascades, so deleting the project rows below reaps all of them in one
 *    statement. FKs *between* a plugin's own tables break no rule
 *    (`core-scope.md` §6 is about FKs to *core*), and this is what they buy.
 *
 * ### Run artifacts on disk are removed by the host
 *
 * The engine's extract pages (customer HCP and account data, in gigabytes)
 * live under `VeevaMigrationHost.runArtifactRoot`, outside the database and
 * outside anything a cascade reaches. Each hook below asks the host to remove
 * them after the rows are gone — the plugin cannot touch the filesystem, and
 * the host that derived the path is the one that knows where it is.
 *
 * ### One deliberate exception: `veeva_migration_audit_log.actor`
 *
 * `onUserDeleted` nulls this plugin's four *reference* columns but does not
 * touch the engine's audit log, which stores the acting user's id in `actor`.
 * In a regulated cutover that log is the record of who did what, and a trail
 * that forgets its actors is not a trail. That is a retention decision, not an
 * oversight — flagged in the migration result doc so it can be overruled with
 * intent rather than discovered later. Deleting the user's *team* still reaps
 * it, because the audit rows cascade from the project.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      await deleteProjectsForTeam(db(), teamId);
      await veevaMigrationWiring().host.removeArtifacts(teamId);
    },

    async onRepoDeleted(repositoryId: string): Promise<void> {
      const projects = await listProjectsForRepo(db(), repositoryId);
      await deleteProjectsForRepo(db(), repositoryId);
      const { host } = veevaMigrationWiring();
      for (const project of projects) {
        await host.removeArtifacts(project.teamId, project.id);
      }
    },

    async onUserDeleted(userId: string): Promise<void> {
      await anonymiseUser(db(), userId);
    },
  };
}
