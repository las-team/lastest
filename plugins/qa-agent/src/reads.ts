import { orm } from "./data/db";
import { getQaTaskRow, getQaTasksByRepoRows } from "./data/tasks";
import { getQaAgentTriggerRow } from "./data/triggers";
import type { QaAgentTask, QaAgentTriggerRow } from "./schema";
import { qaAgentWiring } from "./wiring";

/**
 * Server-component and API-route reads — NOT `"use server"` actions, for the
 * reason `gamification`/`ci` established: a read that is only ever called
 * from server components (the `/qa-agent` page) and bearer-authed API routes
 * does not need — and should not be — a live RPC endpoint.
 *
 * Authorization is the caller's: the page runs behind `getSelectedRepository`
 * on the signed-in team, and the v1 route behind `verifyRepoOwnership`. The
 * data handle comes from the wiring slot (the same route the deletion hook
 * takes), which is scoped to this plugin's own tables and nothing else.
 */

/** All tasks for a repo, newest first, terminal ones capped. */
export async function getQaTasksByRepo(
  repositoryId: string,
  opts: { terminalLimit?: number } = {},
): Promise<QaAgentTask[]> {
  return getQaTasksByRepoRows(orm(qaAgentWiring().data), repositoryId, opts);
}

/** One task by id (the v1 API's post-create echo). */
export async function getQaTask(id: string): Promise<QaAgentTask | undefined> {
  return getQaTaskRow(orm(qaAgentWiring().data), id);
}

/** The repo's automation config, or undefined when never configured. */
export async function getQaAgentTrigger(
  repositoryId: string,
): Promise<QaAgentTriggerRow | undefined> {
  return getQaAgentTriggerRow(orm(qaAgentWiring().data), repositoryId);
}
