import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-ci` — CI provider integration. Generates the customer's
 * `.github/workflows/lastest.yml` or `.gitlab-ci.yml`, pushes it to their
 * repository, provisions the runner token as a repo secret / masked project
 * variable, installs the project hook, and validates the whole setup from the
 * outside. The seventh plugin of RFC §9 phase 4.
 *
 * ### What this one is, that the previous six were not
 *
 * It is the first migration where **the pseudo-plugin was two features** and
 * only one of them was a feature. RFC §6.3 maps `scm` to
 * `src/lib/github` + `src/lib/gitlab` + their two action modules; reading the
 * import lists (the `launch` lesson) splits that cleanly down the middle:
 *
 * - **OAuth, tokens, webhooks, repo-content reads** — imported by
 *   `src/lib/auth/auth.ts`, `src/lib/ai/codebase-intelligence.ts`,
 *   `src/lib/change-map/compute.ts` and six action modules. A credential
 *   boundary that half the app depends on. **Reclassified as core**, the way
 *   `url-diff` was, and it stayed exactly where it is.
 * - **CI configuration** — imported by its own two action modules and its own
 *   settings UI, and by nothing else. That is this package.
 *
 * The recipe §1.6 grep is what surfaced it, and the resolution is the *third*
 * outcome that check can have. `gamification`'s core→feature edge had to be
 * **inverted** (core declares a port, the composition root registers the
 * listener). This one did not: core was not calling a feature, it was calling
 * the part of `src/lib/github` that had been misfiled as a feature. Nothing
 * moved and nothing inverted — the map was wrong.
 *
 * ### Surfaces
 *
 * - **Server actions** (`./actions`) — 12: five per provider plus two previews.
 * - **Server-component reads** (`./reads`) — the settings page's two config
 *   lists, deliberately not actions.
 * - **The GitLab webhook gate** (`./webhook`) — *not* the webhook route. The
 *   route stays in the app because everything it does (pull-request records,
 *   triggering a build) is core's; this plugin answers only the four questions
 *   that are its own. See that file.
 * - **UI** (`./ui/*`) — the two settings cards and their dialogs.
 * - **No `ui.nav`.** Both cards mount inside the app's `/settings` page next to
 *   a dozen unrelated ones; composition is the app's job.
 */
export const ciPlugin = definePlugin({
  id: "ci",
  title: "CI integration",

  // `data` only. No `ai`, no `browser`, no `jobs` — this feature talks to two
  // third-party REST APIs and its own two tables, and that is all.
  capabilities: ["data"],

  // Loaded once at boot by `core/data`, which validates the `ci_` prefix on
  // both tables before binding a handle to it. Both had to be renamed — see
  // `schema.ts`.
  schema: () => import("./schema"),

  // Required whenever `schema` is present. Unlike `gamification`'s, this hook
  // is replacing three foreign keys that genuinely existed — and it cannot
  // replace one of them. See `deletion.ts`.
  deletion: createDeletionHook(),
});

export default ciPlugin;

export {
  generateWorkflowYaml,
  type WorkflowConfig,
} from "./domain/workflow-yaml";
export { generateCiYaml, type CiYamlConfig } from "./domain/ci-yaml";
export type {
  CiHost,
  CreatedRunner,
  PublicUrlProbe,
  RunnerRef,
  ScmCredential,
  ScmProvider,
} from "./host";
export type {
  GithubActionConfig,
  GithubActionMode,
  GithubActionTriggerEvent,
  GitlabPipelineConfig,
  GitlabPipelineDeliveryMode,
  GitlabPipelineMode,
  GitlabPipelineTriggerEvent,
} from "./schema";
export {
  DEFAULT_GITLAB_BRANCH_FILTER,
  DEFAULT_GITLAB_PIPELINE_TRIGGER_EVENTS,
} from "./schema";
export type {
  CiRepoOption,
  CiRunnerOption,
  DeployPipelineResult,
  DeployWorkflowResult,
  GitlabValidationResult,
  ValidationCheck,
  ValidationCheckStatus,
  ValidationResult,
} from "./types";
export { configureCi, isCiConfigured, type CiWiring } from "./wiring";
