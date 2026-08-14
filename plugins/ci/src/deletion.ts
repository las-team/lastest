import type { DeletionHook } from "@lastest/contracts";

import { db } from "./data/db";
import { deleteRepoConfigs, deleteTeamConfigs } from "./data/queries";

/**
 * The cascades the database will no longer perform.
 *
 * These two tables carried **three** real foreign keys into core before the
 * move — more than any plugin migrated so far — so unlike `gamification` (whose
 * `team_id` was already convention-only and whose hook was therefore a bug fix)
 * this hook is replacing behaviour that genuinely existed.
 *
 * | Dropped FK | What it did | Restored by |
 * | --- | --- | --- |
 * | `team_id -> teams.id` | *restrict*: refused to delete a team that still had configs | `onTeamDeleted` |
 * | `repository_id -> repositories.id` | *cascade*: dropped the config with the repo | `onRepoDeleted` |
 * | `runner_id -> runners.id` | *set null*: un-linked a deleted runner | **nothing — see below** |
 *
 * The first row is worth pausing on, because a `restrict` FK is not a cascade
 * and swapping it for one is a behaviour change, not a preservation. Before
 * this, `deleteTeam` on a team with a deployed GitHub Actions config would
 * *fail* on the constraint. Now it succeeds and this hook removes the rows.
 * That is the intended direction — `core-scope.md` §6 is explicit that a plugin
 * must not be able to veto a tenant deletion, and a failed account deletion is
 * a GDPR problem in its own right — but it is a change, and pretending
 * otherwise would be the kind of claim recipe §9 warns about.
 *
 * ### The gap this hook cannot close: a runner is not a `DeletionTarget`
 *
 * `runner_id` was `ON DELETE SET NULL`, and `DeletionTarget` has exactly three
 * cases — team, repo, user. Deleting a runner therefore now leaves a config
 * pointing at a runner id that no longer resolves.
 *
 * This is contained rather than dangerous, and it is contained by accident of
 * how the feature already reads: `host.getRunner()` returns null for a missing
 * runner and the validation panel already renders that as
 * *"Linked runner not found in database"*, which is exactly the state. A
 * redeploy fails cleanly on `regenerateRunnerToken` returning `{ error }`. No
 * credential is exposed and no build silently runs against the wrong runner.
 *
 * It is still a real hole, and the honest fix is a fourth `DeletionTarget` —
 * a core change with its own review, not something to bolt onto a migration
 * PR. Recorded in `host.ts` and in the result doc rather than quietly absorbed.
 *
 * ### No `onUserDeleted`
 *
 * Nothing here is user-scoped. A config belongs to a team; the person who
 * created it is not recorded on the row at all (only on the runner it may have
 * minted, which is core's). Deleting the last member of a team deletes the
 * team, and `onTeamDeleted` reaches these rows that way.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      await deleteTeamConfigs(db(), teamId);
    },

    async onRepoDeleted(repositoryId: string): Promise<void> {
      // GitLab configs only: a GitHub Actions config names its repository by
      // `owner`/`name` strings pointing at GitHub, and never carried a FK to
      // `repositories`. Nothing to reap on that side, which is why this is not
      // symmetric.
      await deleteRepoConfigs(db(), repositoryId);
    },
  };
}
