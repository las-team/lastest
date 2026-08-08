/**
 * CI provider configuration (GitHub Actions / GitLab pipelines).
 *
 * Two tables live here for a structural reason rather than a taxonomic one.
 * `github_action_configs` and `gitlab_pipeline_configs` are the only tables
 * that reference `teams`, `runners` AND `repositories`, and putting them in
 * `repos` is what creates both of the domain-level import cycles that
 * `pnpm schema:graph` reports (identity ⇄ repos and repos ⇄ runs). Giving them
 * their own module removes both.
 *
 * They are also the tables RFC §6.3 earmarks for the `scm` plugin, so this file
 * is the seam that extraction will cut along. It stays in core for now.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

import { teams } from "./identity";

import { repositories } from "./repos";

import { runners } from "./runs";

// ============================================
// GitHub Actions Configs
// ============================================

export type GithubActionMode = "persistent" | "auto";

export type GithubActionTriggerEvent =
  | "push"
  | "pull_request"
  | "workflow_dispatch"
  | "schedule";

export const githubActionConfigs = pgTable("github_action_configs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id, {
    onDelete: "set null",
  }),
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
});

export type GithubActionConfig = typeof githubActionConfigs.$inferSelect;

export type NewGithubActionConfig = typeof githubActionConfigs.$inferInsert;

// ============================================
// GitLab Pipeline Configs
// ============================================

export type GitlabPipelineMode = "persistent" | "auto";

export type GitlabPipelineTriggerEvent =
  | "push"
  | "merge_request"
  | "schedule"
  | "manual";

// 'ci_file' = generate .gitlab-ci.yml + push it via Repo Files API (full GH-Actions parity)
// 'webhook' = no CI file; webhook fires server-side createAndRunBuild (no edits to user repo)
export type GitlabPipelineDeliveryMode = "ci_file" | "webhook";

export const DEFAULT_GITLAB_PIPELINE_TRIGGER_EVENTS: GitlabPipelineTriggerEvent[] =
  ["push", "merge_request"];

export const DEFAULT_GITLAB_BRANCH_FILTER: string[] = ["main"];

export const gitlabPipelineConfigs = pgTable("gitlab_pipeline_configs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id, {
    onDelete: "set null",
  }),
  // Repository reference
  repositoryId: text("repository_id").references(() => repositories.id, {
    onDelete: "cascade",
  }),
  projectPath: text("project_path").notNull(), // "namespace/project"
  gitlabProjectId: integer("gitlab_project_id"),
  mode: text("mode").notNull().default("persistent"), // GitlabPipelineMode
  deliveryMode: text("delivery_mode").notNull().default("ci_file"), // GitlabPipelineDeliveryMode
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
});

export type GitlabPipelineConfig = typeof gitlabPipelineConfigs.$inferSelect;

export type NewGitlabPipelineConfig = typeof gitlabPipelineConfigs.$inferInsert;
