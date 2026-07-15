import { db } from "../index";
import { agentFindings, explorerTriggers } from "../schema";
import type {
  AgentFinding,
  NewAgentFinding,
  ExplorerFindingStatus,
  ExplorerSeverity,
  ExplorerFindingKind,
  ExplorerTrigger,
} from "../schema";
import { eq, and, desc, lte, inArray } from "drizzle-orm";

/**
 * Explorer-agent findings (defects / UX issues observed while exploring) and
 * the per-repo explorer cron trigger. Session rows live in agent_sessions
 * (kind = "explorer") via the generic queries in ./integrations.ts.
 */

// ── agent_findings ───────────────────────────────────────────────────────────

export async function createAgentFinding(
  data: Omit<NewAgentFinding, "id" | "createdAt">,
): Promise<AgentFinding> {
  const [row] = await db
    .insert(agentFindings)
    .values({ ...data, id: crypto.randomUUID(), createdAt: new Date() })
    .returning();
  return row;
}

export async function getAgentFinding(
  id: string,
): Promise<AgentFinding | undefined> {
  const [row] = await db
    .select()
    .from(agentFindings)
    .where(eq(agentFindings.id, id));
  return row;
}

export async function listFindingsBySession(
  sessionId: string,
): Promise<AgentFinding[]> {
  return db
    .select()
    .from(agentFindings)
    .where(eq(agentFindings.sessionId, sessionId))
    .orderBy(desc(agentFindings.createdAt));
}

export async function listFindingsByRepo(
  repositoryId: string,
  opts?: { status?: ExplorerFindingStatus; limit?: number },
): Promise<AgentFinding[]> {
  const conds = [eq(agentFindings.repositoryId, repositoryId)];
  if (opts?.status) conds.push(eq(agentFindings.status, opts.status));
  return db
    .select()
    .from(agentFindings)
    .where(and(...conds))
    .orderBy(desc(agentFindings.createdAt))
    .limit(opts?.limit ?? 200);
}

export async function updateFindingStatus(
  id: string,
  status: ExplorerFindingStatus,
): Promise<void> {
  await db
    .update(agentFindings)
    .set({ status })
    .where(eq(agentFindings.id, id));
}

/** Analyst back-fill: stamp a shared root-cause label (and refined
 *  severity/kind) onto every finding in a cluster. */
export async function updateFindingCluster(
  findingIds: string[],
  patch: {
    rootCauseCluster: string;
    severity?: ExplorerSeverity;
    kind?: ExplorerFindingKind;
  },
): Promise<void> {
  if (findingIds.length === 0) return;
  await db
    .update(agentFindings)
    .set(patch)
    .where(inArray(agentFindings.id, findingIds));
}

export async function linkFindingToBugReport(
  id: string,
  bugReportId: string,
): Promise<void> {
  await db
    .update(agentFindings)
    .set({ bugReportId, status: "triaged" })
    .where(eq(agentFindings.id, id));
}

// ── explorer_triggers (cron automation, mirrors qa-agent-triggers) ──────────

export async function getExplorerTrigger(
  repositoryId: string,
): Promise<ExplorerTrigger | undefined> {
  const [row] = await db
    .select()
    .from(explorerTriggers)
    .where(eq(explorerTriggers.repositoryId, repositoryId));
  return row;
}

export async function upsertExplorerTrigger(
  repositoryId: string,
  teamId: string,
  patch: Partial<{
    scheduleEnabled: boolean;
    cronExpression: string | null;
    maxIterations: number;
    nextRunAt: Date | null;
  }>,
): Promise<ExplorerTrigger> {
  const existing = await getExplorerTrigger(repositoryId);
  const now = new Date();
  if (existing) {
    const [row] = await db
      .update(explorerTriggers)
      .set({ ...patch, updatedAt: now })
      .where(eq(explorerTriggers.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(explorerTriggers)
    .values({
      id: crypto.randomUUID(),
      repositoryId,
      teamId,
      ...patch,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

/** Enabled cron triggers whose nextRunAt has passed — the scheduler's pick. */
export async function getDueExplorerTriggers(
  now: Date = new Date(),
): Promise<ExplorerTrigger[]> {
  return db
    .select()
    .from(explorerTriggers)
    .where(
      and(
        eq(explorerTriggers.scheduleEnabled, true),
        lte(explorerTriggers.nextRunAt, now),
      ),
    );
}

export async function markExplorerTriggerFired(
  id: string,
  data: { nextRunAt: Date | null; lastRunAt?: Date; lastSessionId?: string },
): Promise<void> {
  await db
    .update(explorerTriggers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(explorerTriggers.id, id));
}
