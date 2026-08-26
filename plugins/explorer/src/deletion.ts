import type { DeletionHook } from "@lastest/contracts";
import { eq } from "drizzle-orm";

import { orm } from "./data/db";
import {
  explorerExperience,
  explorerFindings,
  explorerKnowledge,
  explorerSessions,
  explorerTriggers,
} from "./schema";
import { explorerWiring } from "./wiring";

/**
 * The cascade the database will no longer perform.
 *
 * This is the bill for `core-scope.md` §6. Explorer's tables carry
 * `repository_id` and `team_id` as plain text with no foreign key, so
 * `ON DELETE CASCADE` does not exist for them: delete a team and, without this
 * file, five tables' worth of rows survive it — including
 * `explorer_knowledge.cred_password`, which is an encrypted credential for
 * somebody's application. That is a GDPR problem, and an invisible one.
 *
 * `resolveRegistry()` refuses to boot a plugin that declares `schema` without a
 * hook, so this cannot be forgotten; `runDeletionHooks()` in `core/data` is
 * what drives it. Both halves are required and neither is sufficient alone.
 *
 * Deletion order is deliberate: **findings before sessions**. Findings
 * reference a session id, so removing sessions first would leave rows nothing
 * points at if the process dies mid-hook. Hooks are documented as idempotent
 * and a retry is safe, but the intermediate states should still be the
 * survivable ones. `TABLES_IN_DELETION_ORDER` is that order — adding a table
 * to this plugin means adding one line here, not four.
 */
const TABLES_IN_DELETION_ORDER = [
  explorerFindings,
  explorerSessions,
  explorerExperience,
  explorerKnowledge,
  explorerTriggers,
] as const;

export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const db = orm(explorerWiring().data);
      for (const table of TABLES_IN_DELETION_ORDER) {
        await db.delete(table).where(eq(table.teamId, teamId));
      }
    },

    async onRepoDeleted(repoId: string): Promise<void> {
      const db = orm(explorerWiring().data);
      for (const table of TABLES_IN_DELETION_ORDER) {
        await db.delete(table).where(eq(table.repositoryId, repoId));
      }
    },
  };
}
