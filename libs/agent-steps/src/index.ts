/**
 * Step-shape helpers shared by every surface that renders an agent session.
 *
 * Structural on purpose: core's `AgentSession` and the QA plugin's
 * `QaSessionRow` are different types over the same JSON, and a plugin may not
 * import core's schema. Both satisfy `SessionLike`.
 */

export interface SubstepLike {
  label: string;
  detail?: string;
  status: string;
  agent?: string;
}

export interface StepLike {
  id: string;
  status: string;
  label: string;
  description: string;
  startedAt?: string;
  substeps?: SubstepLike[];
}

export interface SessionLike {
  steps: StepLike[];
}

/**
 * The step a session is "at" — the first non-settled one, matching what the
 * phase timelines highlight. A failed step counts: a run that died on step 4
 * is still *at* step 4, and the narration should say so rather than fall
 * silent.
 */
export function activeStep<S extends StepLike>(session: {
  steps: S[];
}): S | undefined {
  return session.steps.find(
    (s) =>
      s.status === "active" ||
      s.status === "waiting_user" ||
      s.status === "failed",
  );
}

/** One line of narration: the active step plus its freshest running substep. */
export function sessionNarration(session: SessionLike): string | null {
  const step = activeStep(session);
  if (!step) return null;
  const running = [...(step.substeps ?? [])]
    .reverse()
    .find((s) => s.status === "running");
  if (running) return `${step.label} — ${running.detail ?? running.label}`;
  return `${step.label} — ${step.description}`;
}

/** 0–100: settled (completed or skipped) steps over all steps. */
export function sessionProgress(session: SessionLike): number {
  const done = session.steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length;
  const total = session.steps.length;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}
