import type { DeletionHook } from "@lastest/contracts";
import { eq } from "drizzle-orm";

import { orm } from "./data/db";
import { a11yBaselines } from "./schema";
import { a11yWiring } from "./wiring";

/**
 * The cascade the database will no longer perform.
 *
 * `a11y_baselines` used to carry `test_id REFERENCES tests(id) ON DELETE
 * CASCADE`. That FK is gone (see `schema.ts`), so nothing reaps these rows
 * automatically any more — this hook is the replacement, and
 * `resolveRegistry()` refuses to boot a plugin that declares `schema` without
 * one.
 *
 * Deleting by `repository_id`/`team_id` rather than by test is what the
 * added columns are for: core hands a deletion hook a team id or a repo id,
 * never a test id, and this plugin cannot join back to `tests` to work one
 * out.
 */
export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const db = orm(a11yWiring().data);
      await db.delete(a11yBaselines).where(eq(a11yBaselines.teamId, teamId));
    },

    async onRepoDeleted(repoId: string): Promise<void> {
      const db = orm(a11yWiring().data);
      await db
        .delete(a11yBaselines)
        .where(eq(a11yBaselines.repositoryId, repoId));
    },
  };
}
