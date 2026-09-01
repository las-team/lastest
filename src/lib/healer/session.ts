/**
 * Agent-session lifecycle for the Healer agent.
 *
 * Same shape as `src/lib/triage/session.ts`: the `/agents` roster narrates
 * straight off `agent_sessions.steps`, so a healing campaign drives five steps
 * through the shape every other agent uses:
 *
 *   healer_collect → healer_gate → healer_heal → healer_verify → healer_report
 *
 * `healer_heal` and `healer_verify` are re-entered once per round; the step
 * row is patched in place rather than duplicated, so the timeline stays five
 * long and the round count lives in `metadata.healerRounds`.
 *
 * Every function here is best-effort. Narration must never fail a campaign,
 * so failures are logged and swallowed.
 */

import * as queries from "@/lib/db/queries";
import { getLogger } from "@/lib/logger";
import type {
  AgentSession,
  AgentSessionMetadata,
  AgentStepId,
  AgentStepState,
  AgentStepStatus,
  AgentSubstep,
} from "@/lib/db/schema";

const log = getLogger("Healer");

export const HEALER_STEP_IDS = [
  "healer_collect",
  "healer_gate",
  "healer_heal",
  "healer_verify",
  "healer_report",
] as const satisfies readonly AgentStepId[];

export type HealerStepId = (typeof HEALER_STEP_IDS)[number];

const STEP_LABELS: Record<
  HealerStepId,
  { label: string; description: string }
> = {
  healer_collect: {
    label: "Collect",
    description: "Gather every failed test in the build",
  },
  healer_gate: {
    label: "Gate",
    description:
      "Keep only test problems — skip real bugs, environment issues and exhausted budgets",
  },
  healer_heal: {
    label: "Heal",
    description: "Patch selectors and timing on the live page",
  },
  healer_verify: {
    label: "Verify",
    description: "Re-run the patched tests and confirm they pass",
  },
  healer_report: {
    label: "Report",
    description: "Record what was healed and what needs a human",
  },
};

export function buildHealerSteps(): AgentStepState[] {
  return HEALER_STEP_IDS.map((id) => ({
    id,
    status: "pending" as AgentStepStatus,
    label: STEP_LABELS[id].label,
    description: STEP_LABELS[id].description,
  }));
}

export async function createHealerSession(input: {
  repositoryId: string;
  teamId?: string | null;
  buildId: string;
}): Promise<AgentSession | null> {
  try {
    return await queries.createAgentSession({
      repositoryId: input.repositoryId,
      teamId: input.teamId ?? null,
      kind: "healer",
      status: "active",
      currentStepId: "healer_collect",
      steps: buildHealerSteps(),
      metadata: { buildId: input.buildId, healerOutcomes: [], healerRounds: 0 },
    });
  } catch (err) {
    log.warn(
      { err, buildId: input.buildId },
      "could not create healer session",
    );
    return null;
  }
}

/** Patch one step in place, reading the row first so concurrent narration
 *  can't drop another step's state. */
export async function updateHealerStep(
  sessionId: string | null,
  stepId: HealerStepId,
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
    log.warn({ err, sessionId, stepId }, "could not update healer step");
  }
}

export async function startHealerStep(
  sessionId: string | null,
  stepId: HealerStepId,
  substeps?: AgentSubstep[],
): Promise<void> {
  await updateHealerStep(sessionId, stepId, {
    status: "active",
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    error: undefined,
    ...(substeps ? { substeps } : {}),
  });
}

export async function setHealerSubsteps(
  sessionId: string | null,
  stepId: HealerStepId,
  substeps: AgentSubstep[],
): Promise<void> {
  await updateHealerStep(sessionId, stepId, { substeps });
}

export async function finishHealerStep(
  sessionId: string | null,
  stepId: HealerStepId,
  result?: Record<string, unknown>,
  status: AgentStepStatus = "completed",
): Promise<void> {
  await updateHealerStep(sessionId, stepId, {
    status,
    completedAt: new Date().toISOString(),
    ...(result ? { result } : {}),
  });
}

export async function failHealerStep(
  sessionId: string | null,
  stepId: HealerStepId,
  error: string,
): Promise<void> {
  await updateHealerStep(sessionId, stepId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: error.slice(0, 1000),
  });
}

/** Shallow-merge into the session's metadata (re-read first). */
export async function mergeHealerMetadata(
  sessionId: string | null,
  patch: Partial<AgentSessionMetadata>,
): Promise<void> {
  if (!sessionId) return;
  try {
    const session = await queries.getAgentSession(sessionId);
    if (!session) return;
    await queries.updateAgentSession(sessionId, {
      metadata: { ...session.metadata, ...patch },
    });
  } catch (err) {
    log.warn({ err, sessionId }, "could not merge healer metadata");
  }
}

/** True when the session was paused or cancelled from the UI. */
export async function healerStopped(
  sessionId: string | null,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return true;
  if (!sessionId) return false;
  try {
    const session = await queries.getAgentSession(sessionId);
    return !session || session.status !== "active";
  } catch {
    return false;
  }
}

export async function closeHealerSession(
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
    log.warn({ err, sessionId }, "could not close healer session");
  }
}
