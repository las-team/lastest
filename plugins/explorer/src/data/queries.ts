import { and, count, desc, eq, inArray, lte } from "drizzle-orm";

import { matchUrlPattern } from "../domain/url-match";
import type { ExplorerHost } from "../host";
import {
  explorerExperience,
  explorerFindings,
  explorerKnowledge,
  explorerSessions,
  explorerTriggers,
  type ExplorerExperience,
  type ExplorerFinding,
  type ExplorerKnowledge,
  type ExplorerSession,
  type ExplorerTrigger,
  type NewExplorerFinding,
  type NewExplorerKnowledge,
} from "../schema";
import type {
  ExperienceNote,
  ExplorerFindingStatus,
  ExplorerSessionMetadata,
  ExplorerSessionStatus,
  ExplorerStepId,
  ExplorerStepState,
} from "../types";
import type { ExplorerDb } from "./db";

/**
 * Every read and write explorer performs, all of it against explorer's own
 * tables through the handle `ctx.data` supplied.
 *
 * The equivalent code used to be three modules under `src/lib/db/queries/`,
 * sharing one `db` handle with 98 tables on it. Nothing here can reach a core
 * table: the drizzle instance was built with this plugin's schema, the plugin
 * cannot import `@lastest/db`, and `core/data` refuses at boot to bind a schema
 * whose tables are not `explorer_`-prefixed. Three independent mechanisms, and
 * `core-scope.md` §6 needs all three — the import ban alone would not stop a
 * plugin re-exporting a core table from its own `schema()`.
 *
 * Credential columns are encrypted through `host.encryptField`. That is a core
 * concern the contract does not yet cover; see `host.ts`.
 */

/** Cap notes per state so hot pages do not grow unbounded; newest kept. */
const MAX_NOTES_PER_STATE = 40;

export interface Ctx {
  db: ExplorerDb;
  host: ExplorerHost;
}

// ── sessions ────────────────────────────────────────────────────────────────

function decryptSession({ host }: Ctx, row: ExplorerSession): ExplorerSession {
  const password = row.metadata.password;
  if (!password) return row;
  return {
    ...row,
    metadata: { ...row.metadata, password: host.decryptField(password) },
  };
}

function encryptMetadata(
  { host }: Ctx,
  metadata: ExplorerSessionMetadata,
): ExplorerSessionMetadata {
  if (!metadata.password) return metadata;
  return { ...metadata, password: host.encryptField(metadata.password) };
}

export async function createSession(
  ctx: Ctx,
  input: {
    repositoryId: string;
    teamId: string;
    currentStepId: ExplorerStepId;
    steps: ExplorerStepState[];
    metadata: ExplorerSessionMetadata;
  },
): Promise<ExplorerSession> {
  const now = new Date();
  const [row] = await ctx.db
    .insert(explorerSessions)
    .values({
      id: crypto.randomUUID(),
      repositoryId: input.repositoryId,
      teamId: input.teamId,
      status: "active",
      currentStepId: input.currentStepId,
      steps: input.steps,
      metadata: encryptMetadata(ctx, input.metadata),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return decryptSession(ctx, row);
}

export async function getSession(
  ctx: Ctx,
  id: string,
): Promise<ExplorerSession | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerSessions)
    .where(eq(explorerSessions.id, id));
  return row ? decryptSession(ctx, row) : undefined;
}

export async function updateSession(
  ctx: Ctx,
  id: string,
  patch: Partial<{
    status: ExplorerSessionStatus;
    currentStepId: ExplorerStepId;
    steps: ExplorerStepState[];
    metadata: ExplorerSessionMetadata;
    completedAt: Date;
  }>,
): Promise<void> {
  await ctx.db
    .update(explorerSessions)
    .set({
      ...patch,
      ...(patch.metadata
        ? { metadata: encryptMetadata(ctx, patch.metadata) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(explorerSessions.id, id));
}

/**
 * Compare-and-set a session's status: the write applies only while the row
 * still holds `from`, so two concurrent callers (a double resume, a pause
 * racing a cancel) cannot both win. Returns true for the caller that actually
 * performed the transition.
 */
export async function transitionSessionStatus(
  ctx: Ctx,
  id: string,
  from: ExplorerSessionStatus,
  to: ExplorerSessionStatus,
  extra?: { steps?: ExplorerStepState[]; completedAt?: Date },
): Promise<boolean> {
  const rows = await ctx.db
    .update(explorerSessions)
    .set({ status: to, ...extra, updatedAt: new Date() })
    .where(and(eq(explorerSessions.id, id), eq(explorerSessions.status, from)))
    .returning({ id: explorerSessions.id });
  return rows.length > 0;
}

/** Count a team's currently-active explorer sessions across all its repos.
 *  Used by the trigger dispatcher to cap scheduled fan-out per team. */
export async function countActiveSessionsForTeam(
  ctx: Ctx,
  teamId: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(explorerSessions)
    .where(
      and(
        eq(explorerSessions.teamId, teamId),
        eq(explorerSessions.status, "active"),
      ),
    );
  return row?.value ?? 0;
}

export async function getActiveSession(
  ctx: Ctx,
  repositoryId: string,
): Promise<ExplorerSession | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerSessions)
    .where(
      and(
        eq(explorerSessions.repositoryId, repositoryId),
        eq(explorerSessions.status, "active"),
      ),
    )
    .orderBy(desc(explorerSessions.createdAt))
    .limit(1);
  return row ? decryptSession(ctx, row) : undefined;
}

/**
 * The repo's live run for the Agents console — `active` **or** `paused`.
 *
 * Distinct from `getActiveSession`, which is what the Explorer page drives and
 * must stay `active`-only: resuming, stepping and cancelling all act on a run
 * that is actually running. The roster has the opposite need — a paused run is
 * still a roster row, and showing it as "idle" is exactly the under-report the
 * console exists to prevent.
 */
export async function getLiveSession(
  ctx: Ctx,
  repositoryId: string,
): Promise<ExplorerSession | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerSessions)
    .where(
      and(
        eq(explorerSessions.repositoryId, repositoryId),
        inArray(explorerSessions.status, ["active", "paused"]),
      ),
    )
    .orderBy(desc(explorerSessions.createdAt))
    .limit(1);
  return row ? decryptSession(ctx, row) : undefined;
}

export async function getLatestSession(
  ctx: Ctx,
  repositoryId: string,
): Promise<ExplorerSession | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerSessions)
    .where(eq(explorerSessions.repositoryId, repositoryId))
    .orderBy(desc(explorerSessions.createdAt))
    .limit(1);
  return row ? decryptSession(ctx, row) : undefined;
}

export async function getRecentSessions(
  ctx: Ctx,
  repositoryId: string,
  limit = 10,
): Promise<ExplorerSession[]> {
  const rows = await ctx.db
    .select()
    .from(explorerSessions)
    .where(eq(explorerSessions.repositoryId, repositoryId))
    .orderBy(desc(explorerSessions.createdAt))
    .limit(limit);
  return rows.map((r) => decryptSession(ctx, r));
}

// ── findings ────────────────────────────────────────────────────────────────

export async function createFinding(
  ctx: Ctx,
  data: Omit<NewExplorerFinding, "id" | "createdAt">,
): Promise<ExplorerFinding> {
  const [row] = await ctx.db
    .insert(explorerFindings)
    .values({ ...data, id: crypto.randomUUID(), createdAt: new Date() })
    .returning();
  return row;
}

export async function getFinding(
  ctx: Ctx,
  id: string,
): Promise<ExplorerFinding | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerFindings)
    .where(eq(explorerFindings.id, id));
  return row;
}

export async function listFindingsBySession(
  ctx: Ctx,
  sessionId: string,
): Promise<ExplorerFinding[]> {
  return ctx.db
    .select()
    .from(explorerFindings)
    .where(eq(explorerFindings.sessionId, sessionId))
    .orderBy(desc(explorerFindings.createdAt));
}

export async function listFindingsByRepo(
  ctx: Ctx,
  repositoryId: string,
  opts: { limit?: number } = {},
): Promise<ExplorerFinding[]> {
  return ctx.db
    .select()
    .from(explorerFindings)
    .where(eq(explorerFindings.repositoryId, repositoryId))
    .orderBy(desc(explorerFindings.createdAt))
    .limit(opts.limit ?? 200);
}

export async function updateFindingStatus(
  ctx: Ctx,
  id: string,
  status: ExplorerFindingStatus,
): Promise<void> {
  await ctx.db
    .update(explorerFindings)
    .set({ status })
    .where(eq(explorerFindings.id, id));
}

export async function updateFindingIssue(
  ctx: Ctx,
  id: string,
  issue: { url: string; number?: number },
): Promise<void> {
  await ctx.db
    .update(explorerFindings)
    // Filing an issue *is* the triage: the finding stops being an open
    // question the moment it has a ticket someone owns.
    .set({
      githubIssueUrl: issue.url,
      githubIssueNumber: issue.number ?? null,
      status: "triaged",
    })
    .where(eq(explorerFindings.id, id));
}

export async function updateFindingCluster(
  ctx: Ctx,
  ids: string[],
  patch: Partial<
    Pick<ExplorerFinding, "rootCauseCluster" | "severity" | "kind">
  >,
): Promise<void> {
  if (ids.length === 0) return;
  await ctx.db
    .update(explorerFindings)
    .set(patch)
    .where(inArray(explorerFindings.id, ids));
}

// ── knowledge ───────────────────────────────────────────────────────────────

function decryptKnowledge(
  { host }: Ctx,
  row: ExplorerKnowledge,
): ExplorerKnowledge {
  if (!row.credPassword) return row;
  return { ...row, credPassword: host.decryptField(row.credPassword) };
}

function encryptKnowledge<T extends { credPassword?: string | null }>(
  { host }: Ctx,
  data: T,
): T {
  if (!data.credPassword) return data;
  return { ...data, credPassword: host.encryptField(data.credPassword) };
}

export async function listKnowledgeByRepo(
  ctx: Ctx,
  repositoryId: string,
): Promise<ExplorerKnowledge[]> {
  const rows = await ctx.db
    .select()
    .from(explorerKnowledge)
    .where(eq(explorerKnowledge.repositoryId, repositoryId))
    .orderBy(desc(explorerKnowledge.updatedAt));
  return rows.map((r) => decryptKnowledge(ctx, r));
}

export async function getKnowledge(
  ctx: Ctx,
  id: string,
): Promise<ExplorerKnowledge | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerKnowledge)
    .where(eq(explorerKnowledge.id, id));
  return row ? decryptKnowledge(ctx, row) : undefined;
}

export async function createKnowledge(
  ctx: Ctx,
  data: Omit<NewExplorerKnowledge, "id" | "createdAt" | "updatedAt">,
): Promise<ExplorerKnowledge> {
  const now = new Date();
  const [row] = await ctx.db
    .insert(explorerKnowledge)
    .values({
      ...encryptKnowledge(ctx, data),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return decryptKnowledge(ctx, row);
}

export async function updateKnowledge(
  ctx: Ctx,
  id: string,
  patch: Partial<
    Pick<
      NewExplorerKnowledge,
      | "title"
      | "urlPattern"
      | "matchKind"
      | "body"
      | "credEmail"
      | "credPassword"
      | "pageAutomation"
      | "enabled"
    >
  >,
): Promise<void> {
  await ctx.db
    .update(explorerKnowledge)
    .set({ ...encryptKnowledge(ctx, patch), updatedAt: new Date() })
    .where(eq(explorerKnowledge.id, id));
}

export async function deleteKnowledge(ctx: Ctx, id: string): Promise<void> {
  await ctx.db.delete(explorerKnowledge).where(eq(explorerKnowledge.id, id));
}

/** Enabled notes whose URL pattern matches the page, decrypted. Matching runs
 *  in-process because per-repo note counts are small and the pattern language
 *  includes regexes, which no index would help with anyway. */
export async function matchKnowledgeForUrl(
  ctx: Ctx,
  repositoryId: string,
  url: string,
): Promise<ExplorerKnowledge[]> {
  const rows = await ctx.db
    .select()
    .from(explorerKnowledge)
    .where(
      and(
        eq(explorerKnowledge.repositoryId, repositoryId),
        eq(explorerKnowledge.enabled, true),
      ),
    );
  return rows
    .filter((r) => matchUrlPattern(r.urlPattern, r.matchKind, url))
    .map((r) => decryptKnowledge(ctx, r));
}

// ── experience ──────────────────────────────────────────────────────────────

export async function getExperienceByState(
  ctx: Ctx,
  repositoryId: string,
  stateHash: string,
): Promise<ExplorerExperience | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerExperience)
    .where(
      and(
        eq(explorerExperience.repositoryId, repositoryId),
        eq(explorerExperience.stateHash, stateHash),
      ),
    );
  return row;
}

export async function listExperienceByStates(
  ctx: Ctx,
  repositoryId: string,
  stateHashes: string[],
): Promise<ExplorerExperience[]> {
  if (stateHashes.length === 0) return [];
  return ctx.db
    .select()
    .from(explorerExperience)
    .where(
      and(
        eq(explorerExperience.repositoryId, repositoryId),
        inArray(explorerExperience.stateHash, stateHashes),
      ),
    );
}

export async function listExperienceByRepo(
  ctx: Ctx,
  repositoryId: string,
  limit = 200,
): Promise<ExplorerExperience[]> {
  return ctx.db
    .select()
    .from(explorerExperience)
    .where(eq(explorerExperience.repositoryId, repositoryId))
    .orderBy(desc(explorerExperience.updatedAt))
    .limit(limit);
}

/** Record a visit to a page state: bump timesVisited (creating the row on
 *  first sight) and optionally append learned notes. */
export async function recordExperience(
  ctx: Ctx,
  input: {
    repositoryId: string;
    teamId: string;
    stateHash: string;
    normalizedUrl: string;
    headingsDigest?: string;
    sessionId?: string;
    notes?: ExperienceNote[];
  },
): Promise<void> {
  const now = new Date();
  const existing = await getExperienceByState(
    ctx,
    input.repositoryId,
    input.stateHash,
  );
  if (existing) {
    await ctx.db
      .update(explorerExperience)
      .set({
        notes: [...existing.notes, ...(input.notes ?? [])].slice(
          -MAX_NOTES_PER_STATE,
        ),
        timesVisited: existing.timesVisited + 1,
        normalizedUrl: input.normalizedUrl,
        headingsDigest: input.headingsDigest ?? existing.headingsDigest,
        lastSessionId: input.sessionId ?? existing.lastSessionId,
        updatedAt: now,
      })
      .where(eq(explorerExperience.id, existing.id));
    return;
  }
  await ctx.db.insert(explorerExperience).values({
    id: crypto.randomUUID(),
    repositoryId: input.repositoryId,
    teamId: input.teamId,
    stateHash: input.stateHash,
    normalizedUrl: input.normalizedUrl,
    headingsDigest: input.headingsDigest ?? null,
    notes: (input.notes ?? []).slice(-MAX_NOTES_PER_STATE),
    timesVisited: 1,
    lastSessionId: input.sessionId ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

/** Append notes to an existing state without counting a new visit. */
export async function appendExperienceNotes(
  ctx: Ctx,
  repositoryId: string,
  stateHash: string,
  notes: ExperienceNote[],
): Promise<void> {
  if (notes.length === 0) return;
  const existing = await getExperienceByState(ctx, repositoryId, stateHash);
  if (!existing) return;
  await ctx.db
    .update(explorerExperience)
    .set({
      notes: [...existing.notes, ...notes].slice(-MAX_NOTES_PER_STATE),
      updatedAt: new Date(),
    })
    .where(eq(explorerExperience.id, existing.id));
}

// ── triggers ────────────────────────────────────────────────────────────────

export async function getTrigger(
  ctx: Ctx,
  repositoryId: string,
): Promise<ExplorerTrigger | undefined> {
  const [row] = await ctx.db
    .select()
    .from(explorerTriggers)
    .where(eq(explorerTriggers.repositoryId, repositoryId));
  return row;
}

export async function upsertTrigger(
  ctx: Ctx,
  repositoryId: string,
  teamId: string,
  patch: Partial<{
    scheduleEnabled: boolean;
    cronExpression: string | null;
    maxIterations: number;
    targetUrl: string | null;
    nextRunAt: Date | null;
  }>,
): Promise<ExplorerTrigger> {
  const existing = await getTrigger(ctx, repositoryId);
  const now = new Date();
  if (existing) {
    const [row] = await ctx.db
      .update(explorerTriggers)
      .set({ ...patch, updatedAt: now })
      .where(eq(explorerTriggers.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await ctx.db
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
export async function getDueTriggers(
  ctx: Ctx,
  now: Date = new Date(),
): Promise<ExplorerTrigger[]> {
  return ctx.db
    .select()
    .from(explorerTriggers)
    .where(
      and(
        eq(explorerTriggers.scheduleEnabled, true),
        lte(explorerTriggers.nextRunAt, now),
      ),
    );
}

export async function markTriggerFired(
  ctx: Ctx,
  id: string,
  data: { nextRunAt: Date | null; lastRunAt?: Date; lastSessionId?: string },
): Promise<void> {
  await ctx.db
    .update(explorerTriggers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(explorerTriggers.id, id));
}
