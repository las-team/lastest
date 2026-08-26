/**
 * Types shared between this plugin's actions, its UI and the app.
 *
 * They live here rather than in `actions.ts` because of the S1 trap recipe §6
 * records: `export type { A, B };` inside a `"use server"` module compiles to a
 * **runtime action export**, and the production build then fails on every page
 * with `Export A doesn't exist in target module`. `pnpm types` and `pnpm lint`
 * both pass; only `pnpm build` catches it. `gamification` hit it; this file is
 * how it is avoided rather than rediscovered.
 */

export type ValidationCheckStatus = "pass" | "fail" | "warn" | "skip";

export type ValidationCheck = {
  status: ValidationCheckStatus;
  message: string;
};

export type ValidationResult = {
  githubAccount: ValidationCheck;
  workflowFile: ValidationCheck;
  secretToken: ValidationCheck;
  secretUrl: ValidationCheck;
  runner: ValidationCheck;
  serverUrl: ValidationCheck;
  lastRun: ValidationCheck;
};

export type GitlabValidationResult = {
  gitlabAccount: ValidationCheck;
  ciFile: ValidationCheck;
  variableToken: ValidationCheck;
  variableUrl: ValidationCheck;
  runner: ValidationCheck;
  serverUrl: ValidationCheck;
  lastPipeline: ValidationCheck;
};

export type DeployWorkflowResult = {
  workflow: boolean;
  tokenSecret: boolean;
  urlSecret: boolean;
};

export type DeployPipelineResult = {
  ciFile: boolean;
  tokenVar: boolean;
  urlVar: boolean;
  hook: boolean;
  schedule: boolean;
};

/**
 * The core rows this plugin's UI renders but does not own — narrowed to the
 * fields it reads, per recipe §6.1 ("the type belongs to core → narrow it").
 * `src/lib/core/ci-host.ts` carries the `satisfies` clause that asserts the
 * app's real `Runner`/`Repository` still match.
 */
export interface CiRunnerOption {
  id: string;
  name: string;
  status: string;
  type: string;
}

export interface CiRepoOption {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  provider: string;
  /** Null for GitHub repos; the GitLab card keys its project select on it. */
  gitlabProjectId: number | null;
}
