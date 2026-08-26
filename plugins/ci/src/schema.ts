import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The two CI-provider configuration tables — moved out of
 * `packages/db/src/schema/scm.ts`, whose header already named this file as the
 * seam the extraction would cut along.
 *
 * ### Renamed, for the second time in phase 4
 *
 * | Was | Now |
 * | --- | --- |
 * | `github_action_configs` | `ci_github_action_configs` |
 * | `gitlab_pipeline_configs` | `ci_gitlab_pipeline_configs` |
 *
 * `core/data`'s `validateSchemaNamespace` requires a plugin's tables to carry
 * its id as a prefix, and neither did. `scripts/migrate.js` does the two
 * `ALTER TABLE … RENAME TO` **before** `drizzle-kit push`, because push cannot
 * see a rename — it would drop `github_action_configs` and create
 * `ci_github_action_configs`, silently, under `--force`, taking every
 * customer's deployed workflow config with it (including
 * `gitlab_pipeline_configs.webhook_secret`, which is not recoverable: the
 * matching secret lives in the customer's GitLab project hook, so losing this
 * side turns every subsequent delivery into a 401).
 *
 * `gamification` was the first migration to hit this and read as bad luck
 * against five clean ones. Two in a row says the opposite — recipe §2.4's
 * check is now the expected case, not the exception.
 *
 * ### Three foreign keys to core tables, dropped
 *
 * These are the *most* core-referencing tables in the schema — the scm.ts
 * header says so, and it is why they were given their own module: they are the
 * only two that point at `teams`, `runners` **and** `repositories` at once.
 * All three FKs go, per `core-scope.md` §6, and each loses something specific
 * that `deletion.ts` has to put back:
 *
 * | Was | Did | Replaced by |
 * | --- | --- | --- |
 * | `team_id -> teams.id` (restrict) | blocked deleting a team with configs | `onTeamDeleted` |
 * | `runner_id -> runners.id` (set null) | un-linked a deleted runner | nothing yet — see below |
 * | `repository_id -> repositories.id` (cascade) | deleted the config with the repo | `onRepoDeleted` |
 *
 * The middle row is the interesting one and it is called out in `deletion.ts`:
 * a runner is neither a team nor a repo nor a user, so `DeletionTarget` has no
 * case for it and the hook cannot fire. That is a real, named gap rather than
 * an oversight — see the comment there.
 *
 * `drizzle-orm/pg-core` is imported directly, as in every other plugin schema:
 * it defines tables, it opens nothing. What a plugin may never import is a
 * *connection*.
 */

// ============================================
// GitHub Actions configs
// ============================================

export type GithubActionMode = "persistent" | "auto";

export type GithubActionTriggerEvent =
  | "push"
  | "pull_request"
  | "workflow_dispatch"
  | "schedule";

export const ciGithubActionConfigs = pgTable(
  "ci_github_action_configs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Convention-only references to core tables, per core-scope.md §6.
    teamId: text("team_id").notNull(),
    runnerId: text("runner_id"),
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    githubRepoId: integer("github_repo_id"),
    mode: text("mode").notNull().default("persistent"),
    triggerEvents: jsonb("trigger_events")
      .$type<GithubActionTriggerEvent[]>()
      .default(["push", "pull_request", "workflow_dispatch"]),
    branchFilter: jsonb("branch_filter").$type<string[]>().default(["main"]),
    cronSchedule: text("cron_schedule"),
    targetUrl: text("target_url"),
    timeout: integer("timeout").default(300000),
    failOnChanges: boolean("fail_on_changes").default(true),
    maxParallelTests: integer("max_parallel_tests"),
    pollInterval: integer("poll_interval"),
    workflowDeployed: boolean("workflow_deployed").default(false),
    lastDeployedAt: timestamp("last_deployed_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_ci_github_configs_team").on(table.teamId)],
);

export type GithubActionConfig = typeof ciGithubActionConfigs.$inferSelect;

export type NewGithubActionConfig = typeof ciGithubActionConfigs.$inferInsert;

// ============================================
// GitLab pipeline configs
// ============================================

export type GitlabPipelineMode = "persistent" | "auto";

export type GitlabPipelineTriggerEvent =
  | "push"
  | "merge_request"
  | "schedule"
  | "manual";

/**
 * `ci_file` — generate `.gitlab-ci.yml` and push it through the Repo Files API
 * (full GitHub-Actions parity); the customer's pipeline drives the runner.
 * `webhook` — no CI file at all; the project hook fires a server-side build,
 * so nothing in the customer's repository is edited.
 */
export type GitlabPipelineDeliveryMode = "ci_file" | "webhook";

export const DEFAULT_GITLAB_PIPELINE_TRIGGER_EVENTS: GitlabPipelineTriggerEvent[] =
  ["push", "merge_request"];

export const DEFAULT_GITLAB_BRANCH_FILTER: string[] = ["main"];

export const ciGitlabPipelineConfigs = pgTable(
  "ci_gitlab_pipeline_configs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Convention-only references to core tables, per core-scope.md §6.
    teamId: text("team_id").notNull(),
    runnerId: text("runner_id"),
    repositoryId: text("repository_id"),
    projectPath: text("project_path").notNull(), // "namespace/project"
    gitlabProjectId: integer("gitlab_project_id"),
    mode: text("mode").notNull().default("persistent"), // GitlabPipelineMode
    deliveryMode: text("delivery_mode").notNull().default("ci_file"),
    triggerEvents: jsonb("trigger_events")
      .$type<GitlabPipelineTriggerEvent[]>()
      .default(["push", "merge_request"]),
    branchFilter: jsonb("branch_filter").$type<string[]>().default(["main"]),
    cronSchedule: text("cron_schedule"),
    timeout: integer("timeout").default(300000),
    failOnChanges: boolean("fail_on_changes").default(true),
    maxParallelTests: integer("max_parallel_tests"),
    pollInterval: integer("poll_interval"),
    webhookSecret: text("webhook_secret"),
    pipelineDeployed: boolean("pipeline_deployed").default(false),
    lastDeployedAt: timestamp("last_deployed_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_ci_gitlab_configs_team").on(table.teamId),
    index("idx_ci_gitlab_configs_repo").on(table.repositoryId),
  ],
);

export type GitlabPipelineConfig = typeof ciGitlabPipelineConfigs.$inferSelect;

export type NewGitlabPipelineConfig =
  typeof ciGitlabPipelineConfigs.$inferInsert;
