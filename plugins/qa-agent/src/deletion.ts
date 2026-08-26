import type { DeletionHook } from "@lastest/contracts";
import { eq } from "drizzle-orm";

import { orm } from "./data/db";
import { qaAgentTasks, qaAgentTriggers } from "./schema";
import { qaAgentWiring } from "./wiring";

/**
 * The cascade the database will no longer perform.
 *
 * Both tables used to carry `repository_id REFERENCES repositories(id)
 * ON DELETE CASCADE` (`confdeltype = 'c'` — the ordinary recipe §2.1 case);
 * those FKs are dropped by `migrateQaAgentTables()` in `scripts/migrate.js`
 * because a plugin table may not reference a core one (`core-scope.md` §6).
 * Without this hook, deleting a repo or team would orphan every queued
 * directive and automation config forever — including `qa_agent_tasks`
 * rows whose `created_by_name`/`agent_reply` carry personal data.
 *
 * `agent_sessions` (`kind: "qa"`) needs nothing here: it is a core table with
 * core's own `ON DELETE CASCADE` still on it — the plugin persists into it
 * through `QaAgentHost`, it does not own it (recipe §2.3's shape).
 *
 * Hooks take the data handle from the wiring slot rather than a
 * `PluginContext` because they run *because* a tenant was deleted — there is
 * no scope left to build a context from. Idempotent; safe to re-run.
 */
const TABLES = [qaAgentTasks, qaAgentTriggers] as const;

export function createDeletionHook(): DeletionHook {
  return {
    async onTeamDeleted(teamId: string): Promise<void> {
      const db = orm(qaAgentWiring().data);
      for (const table of TABLES) {
        await db.delete(table).where(eq(table.teamId, teamId));
      }
    },

    async onRepoDeleted(repoId: string): Promise<void> {
      const db = orm(qaAgentWiring().data);
      for (const table of TABLES) {
        await db.delete(table).where(eq(table.repositoryId, repoId));
      }
    },
  };
}
