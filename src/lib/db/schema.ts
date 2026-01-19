import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Type definitions for JSON columns
export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
}

// Selector configuration for multi-input recording
export type SelectorType = 'data-testid' | 'id' | 'role-name' | 'text' | 'aria-label' | 'css-path' | 'ocr-text';

export interface SelectorConfig {
  type: SelectorType;
  enabled: boolean;
  priority: number;
}

export interface ActionSelector {
  type: SelectorType;
  value: string;
}

export interface RecordedAction {
  action: 'click' | 'fill' | 'selectOption' | 'goto';
  selectors: ActionSelector[];
  value?: string;
  timestamp: number;
}

export interface DiffMetadata {
  changedRegions: { x: number; y: number; width: number; height: number }[];
  affectedComponents?: string[];
  changeCategories?: ('layout' | 'color' | 'text' | 'image' | 'style')[];
}

export const functionalAreas = sqliteTable('functional_areas', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  name: text('name').notNull(),
  description: text('description'),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  name: text('name').notNull(),
  pathType: text('path_type').notNull(), // 'happy' or 'unhappy'
  code: text('code').notNull(), // Playwright test code
  targetUrl: text('target_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  gitBranch: text('git_branch').notNull(),
  gitCommit: text('git_commit').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status'), // 'passed', 'failed', 'running'
});

export const testResults = sqliteTable('test_results', {
  id: text('id').primaryKey(),
  testRunId: text('test_run_id').references(() => testRuns.id),
  testId: text('test_id').references(() => tests.id),
  status: text('status'), // 'passed', 'failed', 'skipped'
  screenshotPath: text('screenshot_path'),
  diffPath: text('diff_path'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  viewport: text('viewport'), // e.g., '1920x1080'
  browser: text('browser').default('chromium'),
  consoleErrors: text('console_errors', { mode: 'json' }).$type<string[]>(),
  networkRequests: text('network_requests', { mode: 'json' }).$type<NetworkRequest[]>(),
});

// Repositories synced from GitHub
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  githubRepoId: integer('github_repo_id').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(), // owner/name
  defaultBranch: text('default_branch'),
  selectedBaseline: text('selected_baseline'), // branch name for baseline comparison
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// GitHub OAuth accounts
export const githubAccounts = sqliteTable('github_accounts', {
  id: text('id').primaryKey(),
  githubUserId: text('github_user_id').notNull(),
  githubUsername: text('github_username').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  selectedRepositoryId: text('selected_repository_id').references(() => repositories.id),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Pull requests linked to builds
export const pullRequests = sqliteTable('pull_requests', {
  id: text('id').primaryKey(),
  githubPrNumber: integer('github_pr_number').notNull(),
  repoOwner: text('repo_owner').notNull(),
  repoName: text('repo_name').notNull(),
  headBranch: text('head_branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  headCommit: text('head_commit').notNull(),
  title: text('title'),
  status: text('status'), // 'open', 'closed', 'merged'
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// Builds - aggregated test run with status
export const builds = sqliteTable('builds', {
  id: text('id').primaryKey(),
  testRunId: text('test_run_id').references(() => testRuns.id),
  pullRequestId: text('pull_request_id').references(() => pullRequests.id),
  triggerType: text('trigger_type').notNull(), // 'webhook', 'manual', 'push'
  overallStatus: text('overall_status').notNull(), // 'safe_to_merge', 'review_required', 'blocked'
  totalTests: integer('total_tests').default(0),
  changesDetected: integer('changes_detected').default(0),
  flakyCount: integer('flaky_count').default(0),
  failedCount: integer('failed_count').default(0),
  passedCount: integer('passed_count').default(0),
  elapsedMs: integer('elapsed_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// Visual diffs with approval workflow
export const visualDiffs = sqliteTable('visual_diffs', {
  id: text('id').primaryKey(),
  buildId: text('build_id').references(() => builds.id).notNull(),
  testResultId: text('test_result_id').references(() => testResults.id).notNull(),
  testId: text('test_id').references(() => tests.id).notNull(),
  baselineImagePath: text('baseline_image_path'),
  currentImagePath: text('current_image_path').notNull(),
  diffImagePath: text('diff_image_path'),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'auto_approved'
  pixelDifference: integer('pixel_difference').default(0),
  percentageDifference: text('percentage_difference'), // stored as string for precision
  metadata: text('metadata', { mode: 'json' }).$type<DiffMetadata>(),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Baselines for carry-forward logic
export const baselines = sqliteTable('baselines', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  testId: text('test_id').references(() => tests.id).notNull(),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(), // SHA256 for carry-forward matching
  approvedFromDiffId: text('approved_from_diff_id').references(() => visualDiffs.id),
  branch: text('branch').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Ignore regions for masking areas during diff
export const ignoreRegions = sqliteTable('ignore_regions', {
  id: text('id').primaryKey(),
  testId: text('test_id').references(() => tests.id).notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type FunctionalArea = typeof functionalAreas.$inferSelect;
export type NewFunctionalArea = typeof functionalAreas.$inferInsert;
export type Test = typeof tests.$inferSelect;
export type NewTest = typeof tests.$inferInsert;
export type TestRun = typeof testRuns.$inferSelect;
export type NewTestRun = typeof testRuns.$inferInsert;
export type TestResult = typeof testResults.$inferSelect;
export type NewTestResult = typeof testResults.$inferInsert;
export type GithubAccount = typeof githubAccounts.$inferSelect;
export type NewGithubAccount = typeof githubAccounts.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;
export type VisualDiff = typeof visualDiffs.$inferSelect;
export type NewVisualDiff = typeof visualDiffs.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type NewBaseline = typeof baselines.$inferInsert;
export type IgnoreRegion = typeof ignoreRegions.$inferSelect;
export type NewIgnoreRegion = typeof ignoreRegions.$inferInsert;

// Playwright settings for recording and running tests
export const playwrightSettings = sqliteTable('playwright_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  selectorPriority: text('selector_priority', { mode: 'json' }).$type<SelectorConfig[]>(),
  browser: text('browser').default('chromium'), // chromium | firefox | webkit
  viewportWidth: integer('viewport_width').default(1280),
  viewportHeight: integer('viewport_height').default(720),
  headless: integer('headless', { mode: 'boolean' }).default(false),
  navigationTimeout: integer('navigation_timeout').default(30000),
  actionTimeout: integer('action_timeout').default(5000),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type PlaywrightSettings = typeof playwrightSettings.$inferSelect;
export type NewPlaywrightSettings = typeof playwrightSettings.$inferInsert;

// Build status enum
export type BuildStatus = 'safe_to_merge' | 'review_required' | 'blocked';
export type DiffStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
export type TriggerType = 'webhook' | 'manual' | 'push';
