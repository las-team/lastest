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

export interface AlignmentSegment {
  op: 'match' | 'insert' | 'delete';
  count: number;
}

export interface PageShiftInfo {
  detected: boolean;
  deltaY: number;
  confidence: number;
  insertedRows?: number;
  deletedRows?: number;
  alignedBaselineImagePath?: string;
  alignedCurrentImagePath?: string;
  alignedDiffImagePath?: string;
  alignmentSegments?: AlignmentSegment[];
}

export interface AIDiffAnalysis {
  classification: 'insignificant' | 'meaningful' | 'noise';
  recommendation: 'approve' | 'review' | 'flag';
  summary: string;
  confidence: number; // 0-1
  categories?: string[];
  analyzedAt: string;
}

export interface DiffMetadata {
  changedRegions: { x: number; y: number; width: number; height: number }[];
  affectedComponents?: string[];
  changeCategories?: ('layout' | 'color' | 'text' | 'image' | 'style')[];
  pageShift?: PageShiftInfo;
  isNewTest?: boolean;
  textRegions?: { x: number; y: number; width: number; height: number }[];
  textRegionDiffPixels?: number;
  nonTextRegionDiffPixels?: number;
  ocrDurationMs?: number;
}

/** Capabilities that a test requires from Playwright settings (detected during recording). */
export interface TestRequiredCapabilities {
  fileUpload?: boolean;
  clipboard?: boolean;
  networkInterception?: boolean;
  downloads?: boolean;
}

export interface TestSetupOverrides {
  skippedDefaultStepIds: string[];  // IDs from default_setup_steps to skip
  extraSteps: Array<{
    stepType: 'test' | 'script';
    testId?: string | null;
    scriptId?: string | null;
  }>;
}

export interface TestTeardownOverrides {
  skippedDefaultStepIds: string[];  // IDs from default_teardown_steps to skip
  extraSteps: Array<{
    stepType: 'test' | 'script';
    testId?: string | null;
    scriptId?: string | null;
  }>;
}

export const functionalAreas = sqliteTable('functional_areas', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  name: text('name').notNull(),
  description: text('description'),
  parentId: text('parent_id'),
  isRouteFolder: integer('is_route_folder', { mode: 'boolean' }).default(false),
  orderIndex: integer('order_index').default(0),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id'),
  functionalAreaId: text('functional_area_id').references(() => functionalAreas.id),
  name: text('name').notNull(),
  code: text('code').notNull(), // Playwright test code
  description: text('description'),
  isPlaceholder: integer('is_placeholder', { mode: 'boolean' }).default(false),
  targetUrl: text('target_url'),
  // Setup configuration - setupTestId takes precedence over setupScriptId
  setupTestId: text('setup_test_id'), // Use another test as setup (most common)
  setupScriptId: text('setup_script_id'), // OR use dedicated setup script
  setupOverrides: text('setup_overrides', { mode: 'json' }).$type<TestSetupOverrides>(),
  teardownOverrides: text('teardown_overrides', { mode: 'json' }).$type<TestTeardownOverrides>(),
  requiredCapabilities: text('required_capabilities', { mode: 'json' }).$type<TestRequiredCapabilities>(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
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
  testVersionId: text('test_version_id'), // links to testVersions.id — which version was executed
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
  videoPath: text('video_path'),
  softErrors: text('soft_errors', { mode: 'json' }).$type<string[]>(),
});

// Repository provider type
export type RepositoryProvider = 'github' | 'gitlab';

// Repositories synced from GitHub or GitLab
export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  teamId: text('team_id'), // Team ownership - FK added after teams table definition
  provider: text('provider').notNull().default('github'), // 'github' | 'gitlab'
  githubRepoId: integer('github_repo_id'), // nullable for GitLab repos
  gitlabProjectId: integer('gitlab_project_id'), // nullable for GitHub repos
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(), // owner/name or namespace/project
  defaultBranch: text('default_branch'),
  /** @deprecated Always vs_both now — kept for backward compat */
  defaultComparisonMode: text('default_comparison_mode').default('vs_both'), // ComparisonMode
  selectedBaseline: text('selected_baseline'), // branch name for baseline comparison
  selectedBranch: text('selected_branch'), // branch for remote scanning via API
  // Default setup configuration applied to all tests in this repo
  defaultSetupTestId: text('default_setup_test_id'), // Default test-as-setup for all tests
  defaultSetupScriptId: text('default_setup_script_id'), // OR default script
  testingTemplate: text('testing_template'), // Testing template ID (e.g. 'saas', 'marketing', 'canvas')
  autoApproveDefaultBranch: integer('auto_approve_default_branch', { mode: 'boolean' }).default(false),
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

// GitLab OAuth accounts - per-team GitLab connection
export const gitlabAccounts = sqliteTable('gitlab_accounts', {
  id: text('id').primaryKey(),
  teamId: text('team_id'), // Team ownership - FK added after teams table definition
  gitlabUserId: text('gitlab_user_id').notNull(),
  gitlabUsername: text('gitlab_username').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  instanceUrl: text('instance_url').default('https://gitlab.com'), // For self-hosted GitLab
  selectedRepositoryId: text('selected_repository_id').references(() => repositories.id),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

// Pull requests / Merge requests linked to builds
export const pullRequests = sqliteTable('pull_requests', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('github'), // 'github' | 'gitlab'
  githubPrNumber: integer('github_pr_number'), // nullable for GitLab MRs
  gitlabMrIid: integer('gitlab_mr_iid'), // GitLab MR internal ID (nullable for GitHub PRs)
  gitlabProjectId: integer('gitlab_project_id'), // GitLab project ID (nullable for GitHub PRs)
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

/** @deprecated Always vs_both now — kept for backward compat */
export type ComparisonMode = 'vs_main' | 'vs_branch' | 'vs_both' | 'vs_previous' | 'vs_planned';

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
  /** @deprecated Always vs_both now — kept for backward compat */
  comparisonMode: text('comparison_mode').default('vs_main'), // ComparisonMode
  // Build-level setup configuration
  buildSetupTestId: text('build_setup_test_id'), // Use test as build-level setup
  buildSetupScriptId: text('build_setup_script_id'), // OR use dedicated script
  setupStatus: text('setup_status').default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  setupError: text('setup_error'),
  setupDurationMs: integer('setup_duration_ms'),
  teardownStatus: text('teardown_status').default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  teardownError: text('teardown_error'),
  teardownDurationMs: integer('teardown_duration_ms'),
  codeChangeTestIds: text('code_change_test_ids', { mode: 'json' }).$type<string[]>(),
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
  currentImagePath: text('current_image_path'),
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
  // Main baseline comparison fields (for vs_both mode — secondary/informational)
  mainBaselineImagePath: text('main_baseline_image_path'),
  mainDiffImagePath: text('main_diff_image_path'),
  mainPixelDifference: integer('main_pixel_difference'),
  mainPercentageDifference: text('main_percentage_difference'),
  mainClassification: text('main_classification'), // 'unchanged' | 'flaky' | 'changed'
  // AI diff analysis
  aiAnalysis: text('ai_analysis', { mode: 'json' }).$type<AIDiffAnalysis>(),
  aiRecommendation: text('ai_recommendation'), // 'approve' | 'review' | 'flag' | null
  aiAnalysisStatus: text('ai_analysis_status'), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | null
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
export type GitlabAccount = typeof gitlabAccounts.$inferSelect;
export type NewGitlabAccount = typeof gitlabAccounts.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;
export type VisualDiff = typeof visualDiffs.$inferSelect;
export type AIDiffRecommendation = 'approve' | 'review' | 'flag';
export type AIDiffAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type AIDiffingProvider = 'openrouter' | 'anthropic' | 'same-as-test-gen' | 'claude-agent-sdk' | 'ollama';

export type VisualDiffWithTestStatus = VisualDiff & {
  testResultStatus: string | null;
  testName: string | null;
  functionalAreaName: string | null;
  stepLabel?: string | null;
  errorMessage?: string | null;
  a11yViolations?: A11yViolation[] | null;
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

  // Image loading
  waitForImages: boolean;           // Wait for all images to finish loading (default: true)
  waitForImagesTimeout: number;     // Max wait time in ms (default: 5000)

  // Style stabilization
  waitForFonts: boolean;            // Wait for font loading (default: true)
  disableWebfonts: boolean;         // Use system fonts only (default: false)
  crossOsConsistency: boolean;      // Bundled font + Chromium flags for identical screenshots across OS (default: false)

  // Burst capture (multi-frame instability detection)
  burstCapture: boolean;            // Take N screenshots and compare for stability (default: false)
  burstFrameCount: number;          // Number of frames to capture (default: 3)
  burstStabilityThreshold: number;  // % diff below which frames are considered stable (default: 0.5)

  // Dynamic content masking
  autoMaskDynamicContent: boolean;  // Detect and mask dynamic text before screenshot (default: false)
  maskPatterns: string[];           // Pattern types to mask (default: ['timestamps', 'uuids', 'relative-times'])
  maskStyle: 'solid-color' | 'placeholder-text'; // How to mask matched content (default: 'solid-color')
  maskColor: string;                // Color for solid-color mask (default: '#808080')

  // Canvas stabilization
  waitForCanvasStable: boolean;     // Loop canvas.toDataURL() comparisons until stable (default: false)
  canvasStableTimeout: number;      // Max wait time in ms (default: 3000)
  canvasStableThreshold: number;    // Consecutive stable checks needed (default: 2)

  // Canvas rendering
  disableImageSmoothing: boolean;   // Set imageSmoothingEnabled = false on 2D contexts (default: false)
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
  waitForImages: true,
  waitForImagesTimeout: 5000,
  waitForFonts: true,
  disableWebfonts: false,
  crossOsConsistency: false,
  burstCapture: false,
  burstFrameCount: 3,
  burstStabilityThreshold: 0.5,
  autoMaskDynamicContent: false,
  maskPatterns: ['timestamps', 'uuids', 'relative-times'],
  maskStyle: 'solid-color',
  maskColor: '#808080',
  waitForCanvasStable: false,
  canvasStableTimeout: 3000,
  canvasStableThreshold: 2,
  disableImageSmoothing: false,
};

// Stability metadata from burst capture
export interface StabilityMetadata {
  frameCount: number;
  stableFrames: number;
  maxFrameDiff: number;
  isStable: boolean;
}

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
  cursorPlaybackSpeed: integer('cursor_playback_speed').default(1), // 1 = realtime, 0 = instant (skip delays)
  enabledRecordingEngines: text('enabled_recording_engines', { mode: 'json' }).$type<RecordingEngine[]>(),
  defaultRecordingEngine: text('default_recording_engine').default('lastest'),
  freezeAnimations: integer('freeze_animations', { mode: 'boolean' }).default(false), // freeze CSS animations/transitions
  enableVideoRecording: integer('enable_video_recording', { mode: 'boolean' }).default(false), // record test runs as WebM video
  screenshotDelay: integer('screenshot_delay').default(0), // ms delay before screenshot
  maxParallelTests: integer('max_parallel_tests').default(1), // max tests to run in parallel locally
  stabilization: text('stabilization', { mode: 'json' }).$type<StabilizationSettings>(), // snapshot stabilization settings
  acceptAnyCertificate: integer('accept_any_certificate', { mode: 'boolean' }).default(false), // ignore HTTPS/SSL cert errors
  networkErrorMode: text('network_error_mode').default('fail'), // 'fail' | 'warn' | 'ignore'
  ignoreExternalNetworkErrors: integer('ignore_external_network_errors', { mode: 'boolean' }).default(false), // skip errors from different origins
  consoleErrorMode: text('console_error_mode').default('fail'), // 'fail' | 'warn' | 'ignore'
  grantClipboardAccess: integer('grant_clipboard_access', { mode: 'boolean' }).default(false), // grant clipboard-read/write permissions
  acceptDownloads: integer('accept_downloads', { mode: 'boolean' }).default(false), // accept file downloads in tests
  enableNetworkInterception: integer('enable_network_interception', { mode: 'boolean' }).default(false), // enable page.route() network mocking
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

// Diff engine types
export type DiffEngineType = 'pixelmatch' | 'ssim' | 'butteraugli';

// Text detection granularity for text-region-aware diffing
export type TextDetectionGranularity = 'word' | 'line' | 'block';

// Diff sensitivity settings for classification thresholds
export const diffSensitivitySettings = sqliteTable('diff_sensitivity_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  unchangedThreshold: integer('unchanged_threshold').default(1),  // percentage
  flakyThreshold: integer('flaky_threshold').default(10),        // percentage
  includeAntiAliasing: integer('include_anti_aliasing', { mode: 'boolean' }).default(false), // include AA pixels in diff
  ignorePageShift: integer('ignore_page_shift', { mode: 'boolean' }).default(false), // exclude vertical content shifts from diff
  diffEngine: text('diff_engine').default('pixelmatch'), // 'pixelmatch' | 'ssim' | 'butteraugli'
  textRegionAwareDiffing: integer('text_region_aware_diffing', { mode: 'boolean' }).default(false), // opt-in OCR-based text region diffing
  textRegionThreshold: integer('text_region_threshold').default(30), // percentage, stored as 30 = 0.3
  textRegionPadding: integer('text_region_padding').default(4), // pixels to expand text bounding boxes
  textDetectionGranularity: text('text_detection_granularity').default('word'), // 'word' | 'line' | 'block'
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
  ignorePageShift: false,
  diffEngine: 'pixelmatch' as DiffEngineType,
  textRegionAwareDiffing: false,
  textRegionThreshold: 30,
  textRegionPadding: 4,
  textDetectionGranularity: 'word' as TextDetectionGranularity,
};

// Diff classification type
export type DiffClassification = 'unchanged' | 'flaky' | 'changed';

// Build status enum
export type BuildStatus = 'safe_to_merge' | 'review_required' | 'blocked' | 'has_todos';
export type DiffStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'todo';
export type TriggerType = 'webhook' | 'manual' | 'push';

// AI Provider settings for test generation
export type AIProvider = 'claude-cli' | 'openrouter' | 'claude-agent-sdk' | 'ollama';
export type AgentSdkPermissionMode = 'plan' | 'default' | 'acceptEdits';

export const aiSettings = sqliteTable('ai_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  provider: text('provider').notNull().default('claude-cli'), // 'claude-cli' | 'openrouter' | 'claude-agent-sdk'
  openrouterApiKey: text('openrouter_api_key'),
  openrouterModel: text('openrouter_model').default('anthropic/claude-sonnet-4'),
  agentSdkPermissionMode: text('agent_sdk_permission_mode').default('plan'), // 'plan' | 'default' | 'acceptEdits'
  agentSdkModel: text('agent_sdk_model'),
  agentSdkWorkingDir: text('agent_sdk_working_dir'),
  ollamaBaseUrl: text('ollama_base_url'),
  ollamaModel: text('ollama_model'),
  customInstructions: text('custom_instructions'),
  // AI Diffing settings (separate from test generation)
  aiDiffingEnabled: integer('ai_diffing_enabled', { mode: 'boolean' }).default(false),
  aiDiffingProvider: text('ai_diffing_provider'), // 'openrouter' | 'anthropic'
  aiDiffingApiKey: text('ai_diffing_api_key'),
  aiDiffingModel: text('ai_diffing_model').default('anthropic/claude-sonnet-4-5-20250929'),
  aiDiffingOllamaBaseUrl: text('ai_diffing_ollama_base_url'),
  aiDiffingOllamaModel: text('ai_diffing_ollama_model'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type AISettings = typeof aiSettings.$inferSelect;
export type NewAISettings = typeof aiSettings.$inferInsert;

export const DEFAULT_AI_SETTINGS = {
  provider: 'claude-cli' as AIProvider,
  openrouterModel: 'anthropic/claude-sonnet-4',
  agentSdkPermissionMode: 'plan' as AgentSdkPermissionMode,
  agentSdkModel: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: '',
  aiDiffingEnabled: false,
  aiDiffingProvider: 'same-as-test-gen' as AIDiffingProvider,
  aiDiffingModel: 'anthropic/claude-sonnet-4-5-20250929',
  aiDiffingOllamaBaseUrl: 'http://localhost:11434',
  aiDiffingOllamaModel: '',
};

// AI Prompt Logging for debugging and auditing
export type AIActionType = 'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection' | 'analyze_specs' | 'mcp_explore' | 'analyze_diff' | 'extract_user_stories' | 'generate_spec_tests' | 'classify_template';
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
export type BackgroundJobType = 'ai_scan' | 'spec_analysis' | 'build_tests' | 'test_run' | 'build_run' | 'ai_fix' | 'ai_validate';
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
export type TestChangeReason = 'initial' | 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored' | 'branch_merge';

export const testVersions = sqliteTable('test_versions', {
  id: text('id').primaryKey(),
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }).notNull(),
  version: integer('version').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  targetUrl: text('target_url'),
  changeReason: text('change_reason'), // 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored_from_vN' | 'branch_merge'
  branch: text('branch'), // nullable — tracks which branch this version was created on
  firstBuildId: text('first_build_id'), // nullable — first build that executed this version
  firstBuildBranch: text('first_build_branch'), // denormalized branch name from first build
  firstBuildCommit: text('first_build_commit'), // denormalized commit SHA from first build
  viewportWidth: integer('viewport_width'),
  viewportHeight: integer('viewport_height'),
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
  // Setup configuration - setupTestId takes precedence over setupScriptId
  setupTestId: text('setup_test_id'), // Use test as setup
  setupScriptId: text('setup_script_id'), // OR use dedicated script
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

// Notification settings for Slack, Discord, GitHub PR comments, GitLab MR comments, and Custom Webhook
export const notificationSettings = sqliteTable('notification_settings', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  slackWebhookUrl: text('slack_webhook_url'),
  slackEnabled: integer('slack_enabled', { mode: 'boolean' }).default(false),
  discordWebhookUrl: text('discord_webhook_url'),
  discordEnabled: integer('discord_enabled', { mode: 'boolean' }).default(false),
  githubPrCommentsEnabled: integer('github_pr_comments_enabled', { mode: 'boolean' }).default(false),
  gitlabMrCommentsEnabled: integer('gitlab_mr_comments_enabled', { mode: 'boolean' }).default(false),
  customWebhookEnabled: integer('custom_webhook_enabled', { mode: 'boolean' }).default(false),
  customWebhookUrl: text('custom_webhook_url'),
  customWebhookMethod: text('custom_webhook_method').default('POST'),
  customWebhookHeaders: text('custom_webhook_headers'), // JSON: {"Authorization": "Bearer xxx"}
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type NotificationSettings = typeof notificationSettings.$inferSelect;
export type NewNotificationSettings = typeof notificationSettings.$inferInsert;

export const DEFAULT_NOTIFICATION_SETTINGS = {
  slackEnabled: false,
  discordEnabled: false,
  githubPrCommentsEnabled: false,
  gitlabMrCommentsEnabled: false,
  customWebhookEnabled: false,
  customWebhookMethod: 'POST' as const,
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
  earlyAdopterMode: integer('early_adopter_mode', { mode: 'boolean' }).default(false),
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
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// OAuth accounts - Link providers to users
export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(), // 'github' | 'google' | 'credential'
  providerAccountId: text('provider_account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  password: text('password'), // BetterAuth stores credential passwords here
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

// BetterAuth verification table (email verification, password reset, etc.)
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

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

// ============================================
// Spec Import - Document-based US/AC extraction
// ============================================

export type SpecImportStatus = 'pending' | 'extracting' | 'extracted' | 'generating' | 'completed' | 'failed';

export interface ExtractedUserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: ExtractedAcceptanceCriterion[];
}

export interface ExtractedAcceptanceCriterion {
  id: string;
  description: string;
  testName?: string; // AI-suggested test name
  groupedWith?: string; // ID of another AC to group with for a single test
}

export const specImports = sqliteTable('spec_imports', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  name: text('name').notNull(), // Import session name
  sourceType: text('source_type').notNull(), // 'github' | 'upload'
  sourceFiles: text('source_files', { mode: 'json' }).$type<string[]>(), // file paths or names
  branch: text('branch'), // Branch used for code analysis
  status: text('status').notNull().default('pending'), // SpecImportStatus
  extractedStories: text('extracted_stories', { mode: 'json' }).$type<ExtractedUserStory[]>(),
  areasCreated: integer('areas_created').default(0),
  testsCreated: integer('tests_created').default(0),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type SpecImport = typeof specImports.$inferSelect;
export type NewSpecImport = typeof specImports.$inferInsert;

// ============================================
// Setup Scripts & Configs Tables
// ============================================

export type SetupScriptType = 'playwright' | 'api';

// Setup Scripts - Reusable setup code blocks
export const setupScripts = sqliteTable('setup_scripts', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  name: text('name').notNull(),
  type: text('type').notNull().default('playwright'), // 'playwright' | 'api'
  code: text('code').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type SetupScript = typeof setupScripts.$inferSelect;
export type NewSetupScript = typeof setupScripts.$inferInsert;

// Auth types for API seeding
export type SetupAuthType = 'none' | 'bearer' | 'basic' | 'custom';

export interface SetupAuthConfig {
  token?: string;         // For bearer auth
  username?: string;      // For basic auth
  password?: string;      // For basic auth
  headers?: Record<string, string>; // For custom auth
}

// Setup Configs - API seeding configuration per repository
export const setupConfigs = sqliteTable('setup_configs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  authType: text('auth_type').notNull().default('none'), // 'none' | 'bearer' | 'basic' | 'custom'
  authConfig: text('auth_config', { mode: 'json' }).$type<SetupAuthConfig>(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type SetupConfig = typeof setupConfigs.$inferSelect;
export type NewSetupConfig = typeof setupConfigs.$inferInsert;

// Setup status for builds
export type SetupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// Default Setup Steps - Ordered multi-step setup for repositories
export type SetupStepType = 'test' | 'script';

export const defaultSetupSteps = sqliteTable('default_setup_steps', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  stepType: text('step_type').notNull(), // 'test' | 'script'
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').references(() => setupScripts.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type DefaultSetupStep = typeof defaultSetupSteps.$inferSelect;
export type NewDefaultSetupStep = typeof defaultSetupSteps.$inferInsert;

// Default Teardown Steps - Ordered multi-step teardown for repositories
export const defaultTeardownSteps = sqliteTable('default_teardown_steps', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  stepType: text('step_type').notNull(), // 'test' | 'script'
  testId: text('test_id').references(() => tests.id, { onDelete: 'cascade' }),
  scriptId: text('script_id').references(() => setupScripts.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type DefaultTeardownStep = typeof defaultTeardownSteps.$inferSelect;
export type NewDefaultTeardownStep = typeof defaultTeardownSteps.$inferInsert;

// ============================================
// Google Sheets Test Data Sources
// ============================================

// Google Sheets accounts - per-team Google connection with Sheets API scope
export const googleSheetsAccounts = sqliteTable('google_sheets_accounts', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id),
  googleUserId: text('google_user_id').notNull(),
  googleEmail: text('google_email').notNull(),
  googleName: text('google_name'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export type GoogleSheetsAccount = typeof googleSheetsAccounts.$inferSelect;
export type NewGoogleSheetsAccount = typeof googleSheetsAccounts.$inferInsert;

// Cached cell data from a sheet range
export interface SheetCellData {
  row: number;
  col: number;
  value: string;
}

// Column metadata for a sheet
export interface SheetColumnInfo {
  index: number;       // 0-based column index
  letter: string;      // Column letter (A, B, C...)
  header: string;      // First row value as header
  sampleValues: string[]; // First few values for preview
}

// Google Sheets data sources - linked spreadsheets for test data
export const googleSheetsDataSources = sqliteTable('google_sheets_data_sources', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  teamId: text('team_id').references(() => teams.id),
  googleSheetsAccountId: text('google_sheets_account_id').references(() => googleSheetsAccounts.id),
  spreadsheetId: text('spreadsheet_id').notNull(),       // Google Sheets document ID
  spreadsheetName: text('spreadsheet_name').notNull(),    // Document title
  sheetName: text('sheet_name').notNull(),                // Tab/sheet name within the spreadsheet
  sheetGid: integer('sheet_gid'),                         // Sheet tab GID
  alias: text('alias').notNull(),                         // Short name used in test references (e.g. "users", "products")
  headerRow: integer('header_row').default(1),            // Which row contains column headers (1-based)
  dataRange: text('data_range'),                          // Optional fixed range like "A1:D100"
  cachedHeaders: text('cached_headers', { mode: 'json' }).$type<string[]>(),
  cachedData: text('cached_data', { mode: 'json' }).$type<string[][]>(),     // Cached rows of data
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type GoogleSheetsDataSource = typeof googleSheetsDataSources.$inferSelect;
export type NewGoogleSheetsDataSource = typeof googleSheetsDataSources.$inferInsert;

// ============================================
// Compose Configs (per-branch build configuration)
// ============================================

export const composeConfigs = sqliteTable('compose_configs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  branch: text('branch').notNull(),
  selectedTestIds: text('selected_test_ids', { mode: 'json' }).$type<string[]>(),
  excludedTestIds: text('excluded_test_ids', { mode: 'json' }).$type<string[]>(),
  versionOverrides: text('version_overrides', { mode: 'json' }).$type<Record<string, string>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type ComposeConfig = typeof composeConfigs.$inferSelect;
export type NewComposeConfig = typeof composeConfigs.$inferInsert;

// ============================================
// Agent Sessions (Play Agent onboarding flow)
// ============================================

export type AgentSessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type AgentStepId =
  | 'settings_check'
  | 'select_repo'
  | 'scan_and_template'
  | 'discover'
  | 'env_setup'
  | 'run_tests'
  | 'fix_tests'
  | 'rerun_tests'
  | 'summary';

export type AgentStepStatus = 'pending' | 'active' | 'waiting_user' | 'completed' | 'failed' | 'skipped';

export interface AgentSubstep {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

export interface AgentStepState {
  id: AgentStepId;
  status: AgentStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
  userAction?: string;
  substeps?: AgentSubstep[];
}

export interface AgentSessionMetadata {
  buildIds?: string[];
  fixAttempts?: Record<string, number>;
  codeHashes?: Record<string, string[]>;
  testsCreated?: number;
  initialPassedCount?: number;
  initialFailedCount?: number;
  finalPassedCount?: number;
  finalFailedCount?: number;
  [key: string]: unknown;
}

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  teamId: text('team_id'),
  status: text('status').$type<AgentSessionStatus>().notNull().default('active'),
  currentStepId: text('current_step_id').$type<AgentStepId>(),
  steps: text('steps', { mode: 'json' }).$type<AgentStepState[]>().notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<AgentSessionMetadata>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;

// ── Bug Reports ──────────────────────────────────────────────────────────────

export type BugReportSeverity = 'low' | 'medium' | 'high';

export interface BugReportContext {
  url: string;
  viewport: { width: number; height: number };
  userAgent: string;
  appVersion: string | null;
  gitHash: string | null;
  buildDate: string | null;
  consoleErrors: { message: string; timestamp: number }[];
  failedRequests: { url: string; status: number; method: string }[];
  breadcrumbs: { action: string; target: string; timestamp: number }[];
  selectedRepoId?: string | null;
  selectedRepoName?: string | null;
}

export const bugReports = sqliteTable('bug_reports', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  reportedById: text('reported_by_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  description: text('description').notNull(),
  severity: text('severity').$type<BugReportSeverity>().notNull().default('medium'),
  context: text('context', { mode: 'json' }).$type<BugReportContext>(),
  screenshotPath: text('screenshot_path'),
  contentHash: text('content_hash'),
  githubIssueUrl: text('github_issue_url'),
  githubIssueNumber: integer('github_issue_number'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type BugReport = typeof bugReports.$inferSelect;
export type NewBugReport = typeof bugReports.$inferInsert;

// Review todos — branch-specific actionable items created when reviewer flags a diff
export const reviewTodos = sqliteTable('review_todos', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').references(() => repositories.id),
  diffId: text('diff_id').references(() => visualDiffs.id),
  buildId: text('build_id').references(() => builds.id),
  testId: text('test_id').references(() => tests.id),
  branch: text('branch').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'), // 'open' | 'resolved'
  createdBy: text('created_by'),
  resolvedBy: text('resolved_by'),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type ReviewTodo = typeof reviewTodos.$inferSelect;
export type NewReviewTodo = typeof reviewTodos.$inferInsert;

// ============================================
// Runner Commands (DB-backed command queue)
// ============================================

export type RunnerCommandStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'timeout' | 'cancelled';

export const runnerCommands = sqliteTable('runner_commands', {
  id: text('id').primaryKey(), // Same as message UUID (becomes correlationId)
  runnerId: text('runner_id').notNull().references(() => runners.id),
  type: text('type').notNull(), // e.g. 'command:run_test', 'command:shutdown'
  status: text('status').notNull().default('pending'), // RunnerCommandStatus
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  testId: text('test_id'), // Denormalized for dedup lookups
  testRunId: text('test_run_id'), // Denormalized for grouping
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  claimedAt: integer('claimed_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type RunnerCommand = typeof runnerCommands.$inferSelect;
export type NewRunnerCommand = typeof runnerCommands.$inferInsert;

export const runnerCommandResults = sqliteTable('runner_command_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  commandId: text('command_id').notNull().references(() => runnerCommands.id),
  runnerId: text('runner_id').notNull().references(() => runners.id),
  type: text('type').notNull(), // 'response:test_result', 'response:screenshot', 'response:error'
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export type RunnerCommandResult = typeof runnerCommandResults.$inferSelect;
export type NewRunnerCommandResult = typeof runnerCommandResults.$inferInsert;
