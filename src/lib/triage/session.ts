/**
 * Agent-session lifecycle for the Triage agent.
 *
 * The `/agents` console roster renders live narration straight off
 * `agent_sessions.steps`, so a triage run drives four steps through the same
 * shape every other agent uses (the QA agent's `updateStep` in
 * `src/server/actions/qa-agent.ts` is the reference implementation):
 *
 *   triage_collect → triage_cluster → triage_assess → triage_publish
 *
 * Every function here is best-effort. Narration must never fail a triage run,
 * so failures are logged and swallowed.
 */

import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type {
  AgentSession,
  AgentStepId,
  AgentStepState,
  AgentStepStatus,
} from "@/lib/db/schema";

const log = getLogger("Triage");

export const TRIAGE_STEP_IDS = [
  "triage_collect",
  "triage_cluster",
  "triage_assess",
  "triage_publish",
] as const satisfies readonly AgentStepId[];

export type TriageStepId = (typeof TRIAGE_STEP_IDS)[number];

const STEP_LABELS: Record<
  TriageStepId,
  { label: string; description: string }
> = {
  triage_collect: {
    label: "Collect",
    description: "Gather every failed and review-required case in the build",
  },
  triage_cluster: {
    label: "Cluster",
    description: "Group cases by root cause (error, region, spec + browsers)",
  },
  triage_assess: {
    label: "Assess",
    description: "Name, narrate and classify each cluster",
  },
  triage_publish: {
    label: "Publish",
    description: "Write the groups, cases and classification columns",
  },
};

export function buildTriageSteps(): AgentStepState[] {
  return TRIAGE_STEP_IDS.map((id) => ({
    id,
    status: "pending" as AgentStepStatus,
    label: STEP_LABELS[id].label,
    description: STEP_LABELS[id].description,
  }));
}

export async function createTriageSession(input: {
  repositoryId: string;
  teamId?: string | null;
  buildId: string;
}): Promise<AgentSession | null> {
  try {
    return await queries.createAgentSession({
      repositoryId: input.repositoryId,
      teamId: input.teamId ?? null,
      kind: "triage",
      status: "active",
      currentStepId: "triage_collect",
      steps: buildTriageSteps(),
      metadata: { buildId: input.buildId },
    });
  } catch (err) {
    log.warn(
      { err, buildId: input.buildId },
      "could not create triage session",
    );
    return null;
  }
}

/**
 * Patch one step in place. Reads the row first so concurrent narration from a
 * re-triage can't drop another step's state.
 */
export async function updateTriageStep(
  sessionId: string | null,
  stepId: TriageStepId,
  patch: Partial<Omit<AgentStepState, "id">>,
): Promise<void> {
  if (!sessionId) return;
  try {
    const session = await queries.getAgentSession(sessionId);
    if (!session) return;
    const steps = session.steps.map((s) =>
      s.id === stepId ? { ...s, ...patch } : s,
    );
    await queries.updateAgentSession(sessionId, {
      steps,
      currentStepId: stepId,
    });
  } catch (err) {
    log.warn({ err, sessionId, stepId }, "could not update triage step");
  }
}

/** Mark a step active, stamping its start time. */
export async function startTriageStep(
  sessionId: string | null,
  stepId: TriageStepId,
): Promise<void> {
  await updateTriageStep(sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
  });
}

/** Mark a step completed (or skipped), stamping its end time. */
export async function finishTriageStep(
  sessionId: string | null,
  stepId: TriageStepId,
  result?: Record<string, unknown>,
  status: AgentStepStatus = "completed",
): Promise<void> {
  await updateTriageStep(sessionId, stepId, {
    status,
    completedAt: new Date().toISOString(),
    ...(result ? { result } : {}),
  });
}

export async function failTriageStep(
  sessionId: string | null,
  stepId: TriageStepId,
  error: string,
): Promise<void> {
  await updateTriageStep(sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: error.slice(0, 1000),
  });
}

export async function closeTriageSession(
  sessionId: string | null,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  if (!sessionId) return;
  try {
    await queries.updateAgentSession(sessionId, {
      status,
      completedAt: new Date(),
    });
  } catch (err) {
    log.warn({ err, sessionId }, "could not close triage session");
  }
}
