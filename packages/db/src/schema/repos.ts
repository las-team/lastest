/**
 * The unit of work: repositories, their SCM accounts, PRs and issues.
 *
 * `repositories` is the single most-referenced table in the schema (36
 * inbound FKs) — almost every feature table is scoped by it. This module holds
 * the repository itself plus the SCM identities and artifacts attached to it:
 * connected GitHub/GitLab accounts, pull requests, and filed issues.
 *
 * Deliberately NOT here: the GitHub Actions / GitLab pipeline *configuration*
 * tables — see `./scm` for why.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// `identity` imports this module for `teams.selectedRepositoryId`, so the
// team-ownership FKs below close a module cycle. Safe in both directions: the
// `.references()` argument is a lazy callback drizzle only invokes once every
// table is defined, and the `AnyPgColumn` return annotation stops TypeScript
// from chasing the inference cycle.
import { teams } from "./identity";

// Repository provider type
export type RepositoryProvider = "github" | "gitlab" | "local";

// Repositories synced from GitHub or GitLab, or created locally
export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  // Team ownership. The FK is load-bearing for account deletion: without it a
  // deleted team left its repositories — and the ~30 tables scoped by them —
  // behind as unreachable rows, which is a GDPR problem, not just untidy.
  // `deleteTeam` still unwinds repositories through `deleteRepository()` first;
  // this cascade is the backstop for anything that deletes a team row directly.
  teamId: text("team_id").references((): AnyPgColumn => teams.id, {
    onDelete: "cascade",
  }),
  provider: text("provider").notNull().default("github"), // 'github' | 'gitlab' | 'local'
  githubRepoId: integer("github_repo_id"), // nullable for GitLab repos
  gitlabProjectId: integer("gitlab_project_id"), // nullable for GitHub repos
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(), // owner/name or namespace/project
  defaultBranch: text("default_branch"),
  /** @deprecated Always vs_both now — kept for backward compat */
  defaultComparisonMode: text("default_comparison_mode").default("vs_both"), // ComparisonMode
  selectedBaseline: text("selected_baseline"), // branch name for baseline comparison
  selectedBranch: text("selected_branch"), // branch for remote scanning via API
  // Default setup configuration applied to all tests in this repo
  defaultSetupTestId: text("default_setup_test_id"), // Default test-as-setup for all tests
  defaultSetupScriptId: text("default_setup_script_id"), // OR default script
  testingTemplate: text("testing_template"), // Testing template ID (e.g. 'saas', 'marketing', 'canvas')
  autoApproveDefaultBranch: boolean("auto_approve_default_branch").default(
    false,
  ),
  branchBaseUrls: jsonb("branch_base_urls").$type<Record<string, string>>(),
  comparisonRunEnabled: boolean("comparison_run_enabled").default(false),
  comparisonBaselineBranch: text("comparison_baseline_branch"), // branch used as baseline in comparison runs
  createdAt: timestamp("created_at"),
});

// GitHub OAuth accounts - per-team GitHub connection
export const githubAccounts = pgTable("github_accounts", {
  id: text("id").primaryKey(),
  // Team ownership — cascaded, and more urgently than most: the row holds the
  // team's encrypted OAuth access/refresh tokens. No inbound FKs, so the
  // cascade is unconditional.
  teamId: text("team_id").references((): AnyPgColumn => teams.id, {
    onDelete: "cascade",
  }),
  githubUserId: text("github_user_id").notNull(),
  githubUsername: text("github_username").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
  ),
  reposSyncedAt: timestamp("repos_synced_at"),
  createdAt: timestamp("created_at"),
});

// GitLab OAuth / PAT accounts - per-team GitLab connection
export const gitlabAccounts = pgTable("gitlab_accounts", {
  id: text("id").primaryKey(),
  // Team ownership — cascaded; holds encrypted OAuth/PAT credentials. See
  // `githubAccounts.teamId`.
  teamId: text("team_id").references((): AnyPgColumn => teams.id, {
    onDelete: "cascade",
  }),
  gitlabUserId: text("gitlab_user_id").notNull(),
  gitlabUsername: text("gitlab_username").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  instanceUrl: text("instance_url").default("https://gitlab.com"), // For self-hosted GitLab
  // 'oauth' (default — uses env or per-account oauth client) | 'pat' (personal access token)
  authMethod: text("auth_method").notNull().default("oauth"),
  // Per-account OAuth client (for self-hosted instances where the global env vars don't apply)
  oauthClientId: text("oauth_client_id"),
  oauthClientSecret: text("oauth_client_secret"),
  selectedRepositoryId: text("selected_repository_id").references(
    () => repositories.id,
  ),
  reposSyncedAt: timestamp("repos_synced_at"),
  createdAt: timestamp("created_at"),
});

// Pull requests / Merge requests linked to builds
export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().default("github"), // 'github' | 'gitlab'
  githubPrNumber: integer("github_pr_number"), // nullable for GitLab MRs
  gitlabMrIid: integer("gitlab_mr_iid"), // GitLab MR internal ID (nullable for GitHub PRs)
  gitlabProjectId: integer("gitlab_project_id"), // GitLab project ID (nullable for GitHub PRs)
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  headBranch: text("head_branch").notNull(),
  baseBranch: text("base_branch").notNull(),
  headCommit: text("head_commit").notNull(),
  title: text("title"),
  status: text("status"), // 'open', 'closed', 'merged'
  author: text("author"), // GitHub username of PR author
  mergedAt: timestamp("merged_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type Repository = typeof repositories.$inferSelect;

export type NewRepository = typeof repositories.$inferInsert;

export type GithubAccount = typeof githubAccounts.$inferSelect;

export type NewGithubAccount = typeof githubAccounts.$inferInsert;

export type GitlabAccount = typeof gitlabAccounts.$inferSelect;

export type NewGitlabAccount = typeof gitlabAccounts.$inferInsert;

export type PullRequest = typeof pullRequests.$inferSelect;

export type NewPullRequest = typeof pullRequests.$inferInsert;

// ============================================
// GitHub Issues (cached for analytics)
// ============================================

export const githubIssues = pgTable(
  "github_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    githubIssueNumber: integer("github_issue_number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(), // 'open' | 'closed'
    labels: jsonb("labels").$type<string[]>().default([]),
    author: text("author"),
    createdAt: timestamp("created_at"),
    closedAt: timestamp("closed_at"),
    syncedAt: timestamp("synced_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_github_issues_repo").on(table.repositoryId),
    index("idx_github_issues_repo_number").on(
      table.repositoryId,
      table.githubIssueNumber,
    ),
  ],
);

export type GithubIssue = typeof githubIssues.$inferSelect;

export type NewGithubIssue = typeof githubIssues.$inferInsert;
