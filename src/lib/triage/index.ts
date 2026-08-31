/**
 * The stateful half of the Triage agent — orchestration, gating, the
 * agent-session lifecycle and the compatibility writer. The pure half (value
 * types, clustering, assessment) lives in `@lastest/triage-model`.
 *
 * See docs/architecture/triage-agent.md.
 */

export { runTriage, type RunTriageOptions, type RunTriageResult } from "./run";
export {
  canRunTriage,
  triageAgentAvailable,
  type TriageGateResult,
  type TeamLike,
} from "./gate";
export {
  writeCompatibilityColumns,
  KIND_TO_CLASSIFICATION,
  KIND_TO_DIFF_VERDICT,
  type CompatCase,
} from "./classify";
export {
  TRIAGE_STEP_IDS,
  buildTriageSteps,
  createTriageSession,
  closeTriageSession,
  type TriageStepId,
} from "./session";
