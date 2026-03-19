/**
 * Shared types for the multi-planner discovery pipeline.
 */

export interface PlannerArea {
  name: string;
  description?: string;
  routes: string[];
  testPlan: string;
}

export type PlannerSource = 'browser' | 'code' | 'spec' | 'routes';

export interface PlannerResult {
  source: PlannerSource;
  areas: PlannerArea[];
  /** Raw text output from the planner (used by merger as fallback when areas is empty) */
  rawOutput?: string;
  error?: string;
  /** ID of the aiPromptLog entry for this planner's AI call */
  promptLogId?: string;
  /** Wall-clock duration in milliseconds */
  durationMs?: number;
  /** Human-readable summary of the inputs used */
  inputSummary?: string;
}
