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
export type SelectorType = 'data-testid' | 'id' | 'role-name' | 'text' | 'aria-label' | 'placeholder' | 'name' | 'css-path' | 'ocr-text' | 'coords';

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

export interface PageShiftInfo {
  detected: boolean;
  deltaY: number;
  confidence: number;
  excludedFromDiff: boolean;
}

export interface DiffMetadata {
  changedRegions: { x: number; y: number; width: number; height: number }[];
  affectedComponents?: string[];
  changeCategories?: ('layout' | 'color' | 'text' | 'image' | 'style')[];
  pageShift?: PageShiftInfo;
  isNewTest?: boolean;
}

export const functionalAreas = sqliteTable('functional_areas', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  name: text('name').notNull(),
  description: text('description'),
  parentId: text('parent_id'),
  isRouteFolder: integer('is_route_folder', { mode: 'boolean' }).default(false),
  orderIndex: integer('order_index').default(0),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  name: text('name').notNull(),
  code: text('code').notNull(), // Playwright test code
  targetUrl: text('target_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const testRuns = sqliteTable('test_runs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  runnerId: text('runner_id'), // nullable - set when run via remote runner, null for local runs
  gitBranch: text('git_branch').notNull(),
  gitCommit: text('git_commit').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  status: text('status'), // 'passed', 'failed', 'running'
});

export interface CapturedScreenshot {
  path: string;
  label?: string;
}

// Accessibility violation from axe-core
export interface A11yViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
}

export const testResults = sqliteTable('test_results', {
  id: text('id').primaryKey(),
  testRunId: text('test_run_id').references(() => testRuns.id),
  testId: text('test_id').references(() => tests.id),
  status: text('status'), // 'passed', 'failed', 'skipped'
  screenshotPath: text('screenshot_path'),
  screenshots: text('screenshots', { mode: 'json' }).$type<CapturedScreenshot[]>(),
  diffPath: text('diff_path'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  viewport: text('viewport'), // e.g., '1920x1080'
  browser: text('browser').default('chromium'),
  consoleErrors: text('console_errors', { mode: 'json' }).$type<string[]>(),
  networkRequests: text('network_requests', { mode: 'json' }).$type<NetworkRequest[]>(),
  a11yViolations: text('a11y_violations', { mode: 'json' }).$type<A11yViolation[]>(),
});

// Repositories synced from GitHub
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  teamId: text('team_id'), // Team ownership - FK added after teams table definition
  githubRepoId: integer('github_repo_id').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(), // owner/name
  defaultBranch: text('default_branch'),
  selectedBaseline: text('selected_baseline'), // branch name for baseline comparison
  selectedBranch: text('selected_branch'), // branch for remote scanning via GitHub API
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// GitHub OAuth accounts - per-team GitHub connection
export const githubAccounts = sqliteTable('github_accounts', {
  id: text('id').primaryKey(),
  teamId: text('team_id'), // Team ownership - FK added after teams table definition
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
  baseUrl: text('base_url'),
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
  stepLabel: text('step_label'),
  baselineImagePath: text('baseline_image_path'),
  currentImagePath: text('current_image_path').notNull(),
  diffImagePath: text('diff_image_path'),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'auto_approved'
  pixelDifference: integer('pixel_difference').default(0),
  percentageDifference: text('percentage_difference'), // stored as string for precision
  classification: text('classification'), // 'unchanged' | 'flaky' | 'changed'
  metadata: text('metadata', { mode: 'json' }).$type<DiffMetadata>(),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  // Planned screenshot comparison fields
  plannedImagePath: text('planned_image_path'),
  plannedDiffImagePath: text('planned_diff_image_path'),
  plannedPixelDifference: integer('planned_pixel_difference'),
  plannedPercentageDifference: text('planned_percentage_difference'),
});

// Baselines for carry-forward logic
export const baselines = sqliteTable('baselines', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  testId: text('test_id').references(() => tests.id).notNull(),
  stepLabel: text('step_label'),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(), // SHA256 for carry-forward matching
  approvedFromDiffId: text('approved_from_diff_id').references(() => visualDiffs.id),
  branch: text('branch').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Planned/expected screenshots for design comparison
export const plannedScreenshots = sqliteTable('planned_screenshots', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  stepLabel: text('step_label'),
  routeId: text('route_id').references(() => routes.id, { onDelete: 'cascade' }),
  imagePath: text('image_path').notNull(),
  imageHash: text('image_hash').notNull(),
  name: text('name'),
  description: text('description'),
  uploadedBy: text('uploaded_by').references(() => users.id),
  sourceUrl: text('source_url'), // Original design file URL (Figma, etc.)
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type PlannedScreenshot = typeof plannedScreenshots.$inferSelect;
export type NewPlannedScreenshot = typeof plannedScreenshots.$inferInsert;

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
export type VisualDiffWithTestStatus = VisualDiff & {
  testResultStatus: string | null;
  testName: string | null;
  functionalAreaName: string | null;
  stepLabel?: string | null;
};
export type NewVisualDiff = typeof visualDiffs.$inferInsert;
export type Baseline = typeof baselines.$inferSelect;
export type NewBaseline = typeof baselines.$inferInsert;
export type IgnoreRegion = typeof ignoreRegions.$inferSelect;
export type NewIgnoreRegion = typeof ignoreRegions.$inferInsert;

// Headless mode options: 'true' (standard headless), 'false' (headed), 'shell' (new headless mode with better bot detection avoidance)
export type HeadlessMode = 'true' | 'false' | 'shell';

// Stabilization settings for flaky test prevention
export interface StabilizationSettings {
  // Wait strategies
  waitForNetworkIdle: boolean;      // Wait for no network activity (default: true)
  networkIdleTimeout: number;       // Max wait time in ms (default: 5000)
  waitForDomStable: boolean;        // Wait for DOM mutations to stop (default: true)
  domStableTimeout: number;         // Max wait time in ms (default: 2000)

  // Content freezing
  freezeTimestamps: boolean;        // Replace Date.now(), new Date() (default: true)
  frozenTimestamp: string;          // ISO timestamp to use (default: "2024-01-01T12:00:00Z")
  freezeRandomValues: boolean;      // Seed Math.random() (default: true)
  randomSeed: number;               // Seed value (default: 12345)

  // Third-party handling
  blockThirdParty: boolean;         // Block external domains (default: false)
  allowedDomains: string[];         // Whitelist (default: [])
  mockThirdPartyImages: boolean;    // Replace with placeholders (default: true)

  // Spinner/loader handling
  hideLoadingIndicators: boolean;   // CSS hide common spinners (default: true)
  loadingSelectors: string[];       // Custom selectors to wait for removal

  // Style stabilization
  waitForFonts: boolean;            // Wait for font loading (default: true)
  disableWebfonts: boolean;         // Use system fonts only (default: false)
}

// Default stabilization settings
export const DEFAULT_STABILIZATION_SETTINGS: StabilizationSettings = {
  waitForNetworkIdle: true,
  networkIdleTimeout: 5000,
  waitForDomStable: true,
  domStableTimeout: 2000,
  freezeTimestamps: true,
  frozenTimestamp: '2024-01-01T12:00:00Z',
  freezeRandomValues: true,
  randomSeed: 12345,
  blockThirdParty: false,
  allowedDomains: [],
  mockThirdPartyImages: true,
  hideLoadingIndicators: true,
  loadingSelectors: [],
  waitForFonts: true,
  disableWebfonts: false,
};

// Recording engine options
export type RecordingEngine = 'lastest' | 'playwright-inspector';
export const DEFAULT_RECORDING_ENGINES: RecordingEngine[] = ['lastest', 'playwright-inspector'];

// Playwright settings for recording and running tests
export const playwrightSettings = sqliteTable('playwright_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  selectorPriority: text('selector_priority', { mode: 'json' }).$type<SelectorConfig[]>(),
  browser: text('browser').default('chromium'), // chromium | firefox | webkit
  viewportWidth: integer('viewport_width').default(1280),
  viewportHeight: integer('viewport_height').default(720),
  headlessMode: text('headless_mode').default('true'), // 'true' | 'false' | 'shell'
  navigationTimeout: integer('navigation_timeout').default(30000),
  actionTimeout: integer('action_timeout').default(5000),
  pointerGestures: integer('pointer_gestures', { mode: 'boolean' }).default(false),
  cursorFPS: integer('cursor_fps').default(30),
  enabledRecordingEngines: text('enabled_recording_engines', { mode: 'json' }).$type<RecordingEngine[]>(),
  defaultRecordingEngine: text('default_recording_engine').default('lastest'),
  freezeAnimations: integer('freeze_animations', { mode: 'boolean' }).default(false), // freeze CSS animations/transitions
  screenshotDelay: integer('screenshot_delay').default(0), // ms delay before screenshot
  maxParallelTests: integer('max_parallel_tests').default(1), // max tests to run in parallel locally
  stabilization: text('stabilization', { mode: 'json' }).$type<StabilizationSettings>(), // snapshot stabilization settings
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type PlaywrightSettings = typeof playwrightSettings.$inferSelect;
export type NewPlaywrightSettings = typeof playwrightSettings.$inferInsert;

// Default selector priority - can be used in both server and client components
export const DEFAULT_SELECTOR_PRIORITY: SelectorConfig[] = [
  { type: 'data-testid', enabled: true, priority: 1 },
  { type: 'id', enabled: true, priority: 2 },
  { type: 'role-name', enabled: true, priority: 3 },
  { type: 'aria-label', enabled: true, priority: 4 },
  { type: 'text', enabled: true, priority: 5 },
  { type: 'placeholder', enabled: true, priority: 6 },
  { type: 'name', enabled: true, priority: 7 },
  { type: 'css-path', enabled: true, priority: 8 },
  { type: 'ocr-text', enabled: false, priority: 9 },
  { type: 'coords', enabled: true, priority: 10 },
];

// Discovered routes for coverage tracking
export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  path: text('path').notNull(),
  type: text('type').notNull(), // 'static' | 'dynamic'
  description: text('description'),
  filePath: text('file_path'),
  framework: text('framework'), // 'nextjs-app' | 'nextjs-pages' | 'react-router' | 'vue'
  routerType: text('router_type'), // 'hash' | 'browser'
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  hasTest: integer('has_test', { mode: 'boolean' }).default(false),
  scannedAt: integer('scanned_at', { mode: 'timestamp' }),
});

// Test suggestions for routes from AI discovery
export const routeTestSuggestions = sqliteTable('route_test_suggestions', {
  id: text('id').primaryKey(),
  routeId: text('route_id').references(() => routes.id, { onDelete: 'cascade' }),
  suggestion: text('suggestion').notNull(),
  matchedTestId: text('matched_test_id').references(() => tests.id),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Scan status for progress tracking
export const scanStatus = sqliteTable('scan_status', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  status: text('status').notNull(), // 'idle' | 'scanning' | 'completed' | 'error'
  progress: integer('progress').default(0),
  routesFound: integer('routes_found').default(0),
  framework: text('framework'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type Route = typeof routes.$inferSelect;
export type NewRoute = typeof routes.$inferInsert;
export type RouteTestSuggestion = typeof routeTestSuggestions.$inferSelect;
export type NewRouteTestSuggestion = typeof routeTestSuggestions.$inferInsert;
export type ScanStatus = typeof scanStatus.$inferSelect;
export type NewScanStatus = typeof scanStatus.$inferInsert;

// Environment configuration for managed server startup
export type EnvironmentMode = 'manual' | 'managed';

export const environmentConfigs = sqliteTable('environment_configs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  mode: text('mode').notNull().default('manual'), // 'manual' | 'managed'
  baseUrl: text('base_url').notNull().default('http://localhost:3000'),
  startCommand: text('start_command'), // e.g., 'pnpm dev'
  healthCheckUrl: text('health_check_url'), // defaults to baseUrl if not set
  healthCheckTimeout: integer('health_check_timeout').default(60000), // ms
  reuseExistingServer: integer('reuse_existing_server', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type EnvironmentConfig = typeof environmentConfigs.$inferSelect;
export type NewEnvironmentConfig = typeof environmentConfigs.$inferInsert;

// Diff sensitivity settings for classification thresholds
export const diffSensitivitySettings = sqliteTable('diff_sensitivity_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  unchangedThreshold: integer('unchanged_threshold').default(1),  // percentage
  flakyThreshold: integer('flaky_threshold').default(10),        // percentage
  includeAntiAliasing: integer('include_anti_aliasing', { mode: 'boolean' }).default(false), // include AA pixels in diff
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type DiffSensitivitySettings = typeof diffSensitivitySettings.$inferSelect;
export type NewDiffSensitivitySettings = typeof diffSensitivitySettings.$inferInsert;

// Default diff sensitivity thresholds
export const DEFAULT_DIFF_THRESHOLDS = {
  unchangedThreshold: 1,
  flakyThreshold: 10,
  includeAntiAliasing: false,
};

// Diff classification type
export type DiffClassification = 'unchanged' | 'flaky' | 'changed';

// Build status enum
export type BuildStatus = 'safe_to_merge' | 'review_required' | 'blocked';
export type DiffStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';
export type TriggerType = 'webhook' | 'manual' | 'push';

// AI Provider settings for test generation
export type AIProvider = 'claude-cli' | 'openrouter' | 'claude-agent-sdk';
export type AgentSdkPermissionMode = 'plan' | 'default' | 'acceptEdits';

export const aiSettings = sqliteTable('ai_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  provider: text('provider').notNull().default('claude-cli'), // 'claude-cli' | 'openrouter' | 'claude-agent-sdk'
  openrouterApiKey: text('openrouter_api_key'),
  openrouterModel: text('openrouter_model').default('anthropic/claude-sonnet-4'),
  agentSdkPermissionMode: text('agent_sdk_permission_mode').default('plan'), // 'plan' | 'default' | 'acceptEdits'
  agentSdkWorkingDir: text('agent_sdk_working_dir'),
  customInstructions: text('custom_instructions'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type AISettings = typeof aiSettings.$inferSelect;
export type NewAISettings = typeof aiSettings.$inferInsert;

export const DEFAULT_AI_SETTINGS = {
  provider: 'claude-cli' as AIProvider,
  openrouterModel: 'anthropic/claude-sonnet-4',
  agentSdkPermissionMode: 'plan' as AgentSdkPermissionMode,
};

// AI Prompt Logging for debugging and auditing
export type AIActionType = 'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection' | 'analyze_specs' | 'mcp_explore';
export type AILogStatus = 'pending' | 'success' | 'error';

export const aiPromptLogs = sqliteTable('ai_prompt_logs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  actionType: text('action_type').notNull(), // 'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection'
  provider: text('provider').notNull(), // 'claude-cli' | 'openrouter'
  model: text('model'),
  systemPrompt: text('system_prompt'),
  userPrompt: text('user_prompt').notNull(),
  response: text('response'),
  status: text('status').notNull(), // 'success' | 'error'
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type AIPromptLog = typeof aiPromptLogs.$inferSelect;
export type NewAIPromptLog = typeof aiPromptLogs.$inferInsert;

// Background Jobs for queue tracking
export type BackgroundJobType = 'ai_scan' | 'spec_analysis' | 'build_tests' | 'test_run' | 'build_run';
export type BackgroundJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export const backgroundJobs = sqliteTable('background_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // BackgroundJobType
  status: text('status').notNull().default('pending'), // BackgroundJobStatus
  progress: integer('progress').default(0), // 0-100
  totalSteps: integer('total_steps'),
  completedSteps: integer('completed_steps').default(0),
  label: text('label').notNull(),
  error: text('error'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  repositoryId: text('repository_id').references(() => repositories.id),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;

// Test versions for version history
export type TestChangeReason = 'initial' | 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored';

export const testVersions = sqliteTable('test_versions', {
  id: text('id').primaryKey(),
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }).notNull(),
  version: integer('version').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  targetUrl: text('target_url'),
  changeReason: text('change_reason'), // 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored_from_vN'
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type TestVersion = typeof testVersions.$inferSelect;
export type NewTestVersion = typeof testVersions.$inferInsert;

// Test Suites - ordered collections of tests
export const suites = sqliteTable('suites', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  name: text('name').notNull(),
  description: text('description'),
  orderIndex: integer('order_index').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const suiteTests = sqliteTable('suite_tests', {
  id: text('id').primaryKey(),
  suiteId: text('suite_id').references(() => suites.id, { onDelete: 'cascade' }).notNull(),
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }).notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type Suite = typeof suites.$inferSelect;
export type NewSuite = typeof suites.$inferInsert;
export type SuiteTest = typeof suiteTests.$inferSelect;
export type NewSuiteTest = typeof suiteTests.$inferInsert;

// Notification settings for Slack, Discord, and GitHub PR comments
export const notificationSettings = sqliteTable('notification_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  slackWebhookUrl: text('slack_webhook_url'),
  slackEnabled: integer('slack_enabled', { mode: 'boolean' }).default(false),
  discordWebhookUrl: text('discord_webhook_url'),
  discordEnabled: integer('discord_enabled', { mode: 'boolean' }).default(false),
  githubPrCommentsEnabled: integer('github_pr_comments_enabled', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NewNotificationSettings = typeof notificationSettings.$inferInsert;

export const DEFAULT_NOTIFICATION_SETTINGS = {
  slackEnabled: false,
  discordEnabled: false,
  githubPrCommentsEnabled: false,
};

// Selector statistics for optimizing fallback strategy
export const selectorStats = sqliteTable('selector_stats', {
  id: text('id').primaryKey(),
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  selectorArrayHash: text('selector_array_hash').notNull(),
  selectorType: text('selector_type').notNull(),
  selectorValue: text('selector_value').notNull(),
  successCount: integer('success_count').default(0),
  failureCount: integer('failure_count').default(0),
  totalAttempts: integer('total_attempts').default(0),
  avgResponseTimeMs: integer('avg_response_time_ms'),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type SelectorStat = typeof selectorStats.$inferSelect;
export type NewSelectorStat = typeof selectorStats.$inferInsert;

// ============================================
// Teams & Auth Tables
// ============================================

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

// Teams - Multi-tenancy support
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;

// Users - Core identity
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  hashedPassword: text('hashed_password'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  teamId: text('team_id').references(() => teams.id), // Single team membership
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member' | 'viewer'
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Sessions - Database sessions for auth
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// OAuth accounts - Link providers to users
export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(), // 'github' | 'google'
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

// Password reset tokens
export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Email verification tokens
export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;

// User invitations - Team-scoped invitations
export const userInvitations = sqliteTable('user_invitations', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id), // Team to join on accept
  email: text('email').notNull(),
  invitedById: text('invited_by_id').references(() => users.id),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('member'), // Role to assign on accept
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type UserInvitation = typeof userInvitations.$inferSelect;
export type NewUserInvitation = typeof userInvitations.$inferInsert;

// ============================================
// Runners Table (Remote Execution)
// ============================================

export type RunnerStatus = 'online' | 'offline' | 'busy';
export type RunnerCapability = 'run' | 'record';

export const runners = sqliteTable('runners', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  teamId: text('team_id').notNull().references(() => teams.id),
  createdById: text('created_by_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('offline'), // 'online' | 'offline' | 'busy'
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  capabilities: text('capabilities', { mode: 'json' }).$type<RunnerCapability[]>().default(['run', 'record']),
  maxParallelTests: integer('max_parallel_tests').default(1), // max tests to run in parallel on this runner
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type Runner = typeof runners.$inferSelect;
export type NewRunner = typeof runners.$inferInsert;
