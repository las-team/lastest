import { db } from "../index";
import { agentExperience } from "../schema";
import type { AgentExperience, ExperienceNote } from "../schema";
import { eq, and, desc, inArray } from "drizzle-orm";

/**
 * Explorer-agent experience: what the agent learned by doing (explorbot's
 * `experience/` directory, DB-backed). Rows are keyed by page state —
 * hashState(normalizedUrl, headings) — and accumulate notes across runs.
 */

/** Cap notes per state so hot pages don't grow unbounded; newest kept. */
const MAX_NOTES_PER_STATE = 40;

export async function getExperienceByState(
  repositoryId: string,
  stateHash: string,
): Promise<AgentExperience | undefined> {
  const [row] = await db
    .select()
    .from(agentExperience)
    .where(
      and(
        eq(agentExperience.repositoryId, repositoryId),
        eq(agentExperience.stateHash, stateHash),
      ),
    );
  return row;
}

export async function listExperienceByStates(
  repositoryId: string,
  stateHashes: string[],
): Promise<AgentExperience[]> {
  if (stateHashes.length === 0) return [];
  return db
    .select()
    .from(agentExperience)
    .where(
      and(
        eq(agentExperience.repositoryId, repositoryId),
        inArray(agentExperience.stateHash, stateHashes),
      ),
    );
}

export async function listExperienceByRepo(
  repositoryId: string,
  limit = 200,
): Promise<AgentExperience[]> {
  return db
    .select()
    .from(agentExperience)
    .where(eq(agentExperience.repositoryId, repositoryId))
    .orderBy(desc(agentExperience.updatedAt))
    .limit(limit);
}

/** Record a visit to a page state: bump timesVisited (creating the row on
 *  first sight) and optionally append learned notes. */
export async function recordExperience(input: {
  repositoryId: string;
  teamId: string;
  stateHash: string;
  normalizedUrl: string;
  headingsDigest?: string;
  sessionId?: string;
  notes?: ExperienceNote[];
}): Promise<AgentExperience> {
  const now = new Date();
  const existing = await getExperienceByState(
    input.repositoryId,
    input.stateHash,
  );
  if (existing) {
    const merged = [...existing.notes, ...(input.notes ?? [])].slice(
      -MAX_NOTES_PER_STATE,
    );
    const [row] = await db
      .update(agentExperience)
      .set({
        notes: merged,
        timesVisited: existing.timesVisited + 1,
        normalizedUrl: input.normalizedUrl,
        headingsDigest: input.headingsDigest ?? existing.headingsDigest,
        lastSessionId: input.sessionId ?? existing.lastSessionId,
        updatedAt: now,
      })
      .where(eq(agentExperience.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(agentExperience)
    .values({
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
    })
    .returning();
  return row;
}

/** Append notes to an existing state without counting a new visit. */
export async function appendExperienceNotes(
  repositoryId: string,
  stateHash: string,
  notes: ExperienceNote[],
): Promise<void> {
  if (notes.length === 0) return;
  const existing = await getExperienceByState(repositoryId, stateHash);
  if (!existing) return;
  await db
    .update(agentExperience)
    .set({
      notes: [...existing.notes, ...notes].slice(-MAX_NOTES_PER_STATE),
      updatedAt: new Date(),
    })
    .where(eq(agentExperience.id, existing.id));
}
