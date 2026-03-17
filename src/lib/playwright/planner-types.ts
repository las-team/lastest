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
  error?: string;
}
