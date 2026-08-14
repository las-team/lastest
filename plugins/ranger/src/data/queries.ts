import { eq } from "drizzle-orm";

import { rangerSessions, type RangerSession } from "../schema";
import type {
  RangerSessionMetadata,
  RangerStepId,
  RangerStepState,
} from "../types";
import type { RangerDb } from "./db";

/** Every read and write ranger performs, all against its own table. */

export async function createSession(
  db: RangerDb,
  input: {
    repositoryId: string;
    teamId: string;
    steps: RangerStepState[];
    metadata: RangerSessionMetadata;
  },
): Promise<RangerSession> {
  const [row] = await db
    .insert(rangerSessions)
    .values({
      repositoryId: input.repositoryId,
      teamId: input.teamId,
      status: "active",
      currentStepId: input.steps[0]?.id,
      steps: input.steps,
      metadata: input.metadata,
    })
    .returning();
  return row;
}

export async function getSession(
  db: RangerDb,
  id: string,
): Promise<RangerSession | undefined> {
  const [row] = await db
    .select()
    .from(rangerSessions)
    .where(eq(rangerSessions.id, id))
    .limit(1);
  return row;
}

export async function patchStep(
  db: RangerDb,
  id: string,
  stepId: RangerStepId,
  patch: Partial<RangerStepState>,
): Promise<void> {
  const session = await getSession(db, id);
  if (!session) return;
  const steps = session.steps.map((s) =>
    s.id === stepId ? { ...s, ...patch } : s,
  );
  await db
    .update(rangerSessions)
    .set({
      steps,
      currentStepId: patch.status === "active" ? stepId : session.currentStepId,
      updatedAt: new Date(),
    })
    .where(eq(rangerSessions.id, id));
}

export async function mergeMetadata(
  db: RangerDb,
  id: string,
  patch: Partial<RangerSessionMetadata>,
): Promise<void> {
  const session = await getSession(db, id);
  if (!session) return;
  await db
    .update(rangerSessions)
    .set({ metadata: { ...session.metadata, ...patch }, updatedAt: new Date() })
    .where(eq(rangerSessions.id, id));
}

export async function completeSession(
  db: RangerDb,
  id: string,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  await db
    .update(rangerSessions)
    .set({ status, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(rangerSessions.id, id));
}
