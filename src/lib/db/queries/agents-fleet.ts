import { db } from "../index";
import { agentSessions } from "../schema";
import type { AgentSession, AgentSessionKind } from "../schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { decryptAgentSessionRow } from "./integrations";

/**
 * Fleet-wide reads over `agent_sessions`.
 *
 * The existing readers in `./integrations.ts` are all single-kind: the QA page
 * asks for its own `kind: "qa"` session, the play agent for its own. The
 * Agents console is the first surface that wants *every* kind at once, so the
 * cross-kind selects live here rather than growing `integrations.ts` a set of
 * near-duplicate signatures.
 *
 * Explorer runs are deliberately absent — they live in the explorer plugin's
 * own `explorer_sessions` table, which core cannot select from
 * (`core-scope.md` §6). The console composes them in from
 * `src/lib/core/explorer-reads.ts` instead.
 */

/** Kinds that can appear as a row on the fleet roster. */
export const FLEET_AGENT_KINDS = [
  "qa",
  // Triage and Healer runs are sessions like any other, so an idle row for
  // each appears on the roster even before a build has ever been triaged or
  // healed. Ranger, Play and QuickStart are deliberately NOT on the roster:
  // they are onboarding / one-shot flows, not agents that work a repo.
  "triage",
  "healer",
] as const satisfies readonly AgentSessionKind[];

/**
 * Every live (active or paused) session on a repo, any kind, newest first.
 *
 * Unlike `getActiveAgentSession` this does NOT sweep stuck sessions first —
 * the console is a read-only view rendered on every navigation, and the sweep
 * is a write. `getActiveAgentSession` still runs it on the pages that drive an
 * agent, which is enough to keep the table honest.
 */
export async function listLiveAgentSessions(
  repositoryId: string,
): Promise<AgentSession[]> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        inArray(agentSessions.kind, [...FLEET_AGENT_KINDS]),
        or(
          eq(agentSessions.status, "active"),
          eq(agentSessions.status, "paused"),
        ),
      ),
    )
    .orderBy(desc(agentSessions.createdAt));
  return rows.map(decryptAgentSessionRow);
}

/**
 * The most recently settled sessions on a repo, any kind, for the console's
 * "Settled today" strip. One query, capped — the console only ever renders a
 * handful.
 *
 * NOT partitioned per kind: a repo that settled eight QA sessions and no
 * Ranger runs gets eight QA rows, which is what "most recent" means and what
 * the strip renders. Ordering is `completed_at DESC NULLS LAST` — a settled
 * row can carry a null `completedAt` (a cancel that never stamped it), and
 * Postgres sorts nulls FIRST under a bare `DESC`, which would float exactly
 * the least informative rows to the top of a "recent" list.
 */
export async function listRecentSettledAgentSessions(
  repositoryId: string,
  limit = 8,
): Promise<AgentSession[]> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.repositoryId, repositoryId),
        inArray(agentSessions.kind, [...FLEET_AGENT_KINDS]),
        inArray(agentSessions.status, ["completed", "failed", "cancelled"]),
      ),
    )
    .orderBy(
      sql`${agentSessions.completedAt} DESC NULLS LAST`,
      desc(agentSessions.createdAt),
    )
    .limit(limit);
  return rows.map(decryptAgentSessionRow);
}
