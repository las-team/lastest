/**
 * Configuration: per-repo settings, setup/teardown, and data sources.
 *
 * Rows a user edits to change how tests run rather than rows a run produces:
 * Playwright/diff/AI/notification settings, environment and compose config, the
 * setup and teardown scripts and their defaults, saved storage states, and the
 * external data sources tests read from (Google Sheets, CSV, imported specs).
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  real,
} from "drizzle-orm/pg-core";

import type {
  DesignSystemConfig,
  SelectorConfig,
  StabilizationSettings,
} from "./shared";

import { teams } from "./identity";

import { repositories } from "./repos";

import { tests } from "./tests";

import type { DiffEngineType } from "./tests";

import type { AIDiffingProvider } from "./visual";

// Headless mode options: 'true' (standard headless), 'false' (headed), 'shell' (new headless mode with better bot detection avoidance)
export type HeadlessMode = "true" | "false" | "shell";

// Recording engine options
export type RecordingEngine = "lastest" | "playwright-inspector";

export const DEFAULT_RECORDING_ENGINES: RecordingEngine[] = [
  "lastest",
  "playwright-inspector",
];

// Hostname substrings whose console errors the EB executor drops BEFORE applying
// `consoleErrorMode`. Mirrors the post-hoc third-party classifier in
// src/lib/comparison/console-diff.ts:28 — moved upstream so noisy 3rd-party SDKs
// don't red customer-app demo runs by default. Per-repo override via
// playwright_settings.consoleErrorIgnoreHosts.
export const DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS: string[] = [
  "googletagmanager.com",
  "google-analytics.com",
  "doubleclick.net",
  "facebook.net",
  "fbcdn.net",
  "connect.facebook.net",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "logrocket.com",
  "intercom.io",
  "intercomcdn.com",
  "stripe.com",
  "stripe.network",
  "sentry-cdn.com",
  "browser.sentry-cdn.com",
  "sentry.io",
  "cdnjs.cloudflare.com",
  // Cloudflare email-decode script noise — see feedback_lastest_executor_console_error_fail
  "email-decode.min.js",
];

// Playwright settings for recording and running tests
export const playwrightSettings = pgTable("playwright_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  selectorPriority: jsonb("selector_priority").$type<SelectorConfig[]>(),
  // App-specific test-id attribute (e.g. 'data-automation-id'). When set,
  // the recorder, fallback locator, and AI test-gen prompt will prefer this
  // attribute over `data-testid`. Only takes effect if the user adds the
  // 'custom-attr' entry to selectorPriority with a chosen rank.
  customAttributeName: text("custom_attribute_name"),
  browser: text("browser").default("chromium"), // chromium | firefox | webkit
  viewportWidth: integer("viewport_width").default(1280),
  viewportHeight: integer("viewport_height").default(720),
  lockViewportToRecording: boolean("lock_viewport_to_recording").default(false),
  headlessMode: text("headless_mode").default("true"), // 'true' | 'false' | 'shell'
  navigationTimeout: integer("navigation_timeout").default(30000),
  actionTimeout: integer("action_timeout").default(5000),
  // Per-candidate waitFor budget for locateWithFallback. The 4 runner sites
  // also adaptively shorten this when selector_stats indicate a known-slow
  // selector (see `selectorTimeoutFor` in @lastest/shared/selector-stats).
  selectorTimeoutMs: integer("selector_timeout_ms").default(3000),
  pointerGestures: boolean("pointer_gestures").default(false),
  cursorFPS: integer("cursor_fps").default(30),
  cursorPlaybackSpeed: integer("cursor_playback_speed").default(1), // 1 = realtime, 0 = instant (skip delays)
  enabledRecordingEngines: jsonb("enabled_recording_engines").$type<
    RecordingEngine[]
  >(),
  defaultRecordingEngine: text("default_recording_engine").default("lastest"),
  freezeAnimations: boolean("freeze_animations").default(false), // freeze CSS animations/transitions
  enableVideoRecording: boolean("enable_video_recording").default(false), // record test runs as WebM video
  screenshotDelay: integer("screenshot_delay").default(0), // ms delay before screenshot
  maxParallelTests: integer("max_parallel_tests").default(2), // max tests to run in parallel locally
  // On-demand Kubernetes EB pool (see src/pool-service/provisioner.ts):
  //   maxParallelEBs: per-build cap on concurrent EB claims (1 test per EB).
  //   ebPoolMax:      hard cap on concurrent system EBs across the cluster.
  //   ebIdleTTLSeconds: idle timeout before a released EB Job is torn down.
  maxParallelEBs: integer("max_parallel_ebs").default(30),
  ebPoolMax: integer("eb_pool_max").default(50),
  ebIdleTTLSeconds: integer("eb_idle_ttl_seconds").default(120),
  stabilization: jsonb("stabilization").$type<StabilizationSettings>(), // snapshot stabilization settings
  acceptAnyCertificate: boolean("accept_any_certificate").default(false), // ignore HTTPS/SSL cert errors
  networkErrorMode: text("network_error_mode").default("fail"), // 'fail' | 'warn' | 'ignore'
  ignoreExternalNetworkErrors: boolean(
    "ignore_external_network_errors",
  ).default(true), // skip errors from different origins
  consoleErrorMode: text("console_error_mode").default("fail"), // 'fail' | 'warn' | 'ignore'
  // Hostname substrings whose console errors are dropped BEFORE consoleErrorMode is
  // evaluated. Seed with DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS so the recurring
  // Cloudflare email-decoder noise doesn't red customer-app demos by default. The
  // "any in-scope console error = fail" rule is preserved: only these documented
  // 3rd-party hostnames are filtered.
  consoleErrorIgnoreHosts: jsonb("console_error_ignore_hosts").$type<
    string[]
  >(),
  // Override Chromium's default User-Agent on every newContext(). Set to a modern
  // stable Chrome string to bypass HeadlessChrome-based bot detection (Cloudflare
  // Turnstile, Clerk, several SaaS edge routers). Null preserves stock Playwright UA.
  userAgentOverride: text("user_agent_override"),
  grantClipboardAccess: boolean("grant_clipboard_access").default(false), // grant clipboard-read/write permissions
  acceptDownloads: boolean("accept_downloads").default(false), // accept file downloads in tests
  enableNetworkInterception: boolean("enable_network_interception").default(
    false,
  ), // enable page.route() network mocking
  enableDomDiff: boolean("enable_dom_diff").default(false), // capture DOM snapshots and overlay element changes on screenshots
  browsers: jsonb("browsers").$type<string[]>().default(["chromium"]), // browsers to use for build execution
  autoRetryCount: integer("auto_retry_count").default(0), // 0-3: how many times to retry a failing test to detect flakiness
  enableA11y: boolean("enable_a11y").default(false), // enable WCAG accessibility checks with axe-core
  enableDesignSystem: boolean("enable_design_system").default(false), // enable design-token compliance checks (colors / radii / font-family)
  // Repo-level allowed-tokens set. Tests can override per-test via
  // tests.designSystemOverrides. Empty / null disables the layer even when
  // the enableDesignSystem toggle is on.
  designSystem: jsonb("design_system").$type<DesignSystemConfig>(),
  // Per-check 3-way mode columns driving the Verify cogwheel modal. Each is
  // 'enforce' | 'log' | 'disable'. Source of truth — the legacy enable*/
  // *ErrorMode columns above are mirrored on write for back-compat with
  // executor/runner code paths that still read them. See
  // src/lib/verify/check-modes.ts for the derivation helpers.
  visualMode: text("visual_mode"), // pixel screenshot comparison
  textMode: text("text_mode"), // innerText capture + diff (legacy textDiffEnabled on diff_sensitivity_settings)
  domMode: text("dom_mode"), // DOM snapshot capture (legacy enableDomDiff)
  networkMode: text("network_mode"), // network capture + 4xx/5xx gate (legacy enableNetworkInterception + networkErrorMode)
  consoleMode: text("console_mode"), // console error gate (legacy consoleErrorMode)
  a11yMode: text("a11y_mode"), // axe-core (legacy enableA11y)
  designMode: text("design_mode"), // token compliance (legacy enableDesignSystem)
  perfMode: text("perf_mode"), // web vitals capture
  urlMode: text("url_mode"), // URL trajectory comparison
  apiMode: text("api_mode"), // API-test request/response assertions (E1)
  storageMode: text("storage_mode"), // end-of-run storage state diff (cookies + localStorage)
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type PlaywrightSettings = typeof playwrightSettings.$inferSelect;

export type NewPlaywrightSettings = typeof playwrightSettings.$inferInsert;

// Environment configuration for managed server startup
export type EnvironmentMode = "manual" | "managed";

export const environmentConfigs = pgTable("environment_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  mode: text("mode").notNull().default("manual"), // 'manual' | 'managed'
  baseUrl: text("base_url").notNull().default("http://localhost:3000"),
  startCommand: text("start_command"), // e.g., 'pnpm dev'
  healthCheckUrl: text("health_check_url"), // defaults to baseUrl if not set
  healthCheckTimeout: integer("health_check_timeout").default(60000), // ms
  reuseExistingServer: boolean("reuse_existing_server").default(true),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type EnvironmentConfig = typeof environmentConfigs.$inferSelect;

export type NewEnvironmentConfig = typeof environmentConfigs.$inferInsert;

// Text detection granularity for text-region-aware diffing
export type TextDetectionGranularity = "word" | "line" | "block";

export type RegionDetectionMode = "grid" | "flood-fill";

// Diff sensitivity settings for classification thresholds
export const diffSensitivitySettings = pgTable("diff_sensitivity_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  unchangedThreshold: real("unchanged_threshold").default(1), // percentage
  flakyThreshold: real("flaky_threshold").default(10), // percentage
  includeAntiAliasing: boolean("include_anti_aliasing").default(false), // include AA pixels in diff
  ignorePageShift: boolean("ignore_page_shift").default(false), // exclude vertical content shifts from diff
  diffEngine: text("diff_engine").default("pixelmatch"), // 'pixelmatch' | 'ssim' | 'butteraugli'
  textRegionAwareDiffing: boolean("text_region_aware_diffing").default(false), // opt-in OCR-based text region diffing
  textRegionThreshold: integer("text_region_threshold").default(30), // percentage, stored as 30 = 0.3
  textRegionPadding: integer("text_region_padding").default(4), // pixels to expand text bounding boxes
  textDetectionGranularity: text("text_detection_granularity").default("word"), // 'word' | 'line' | 'block'
  regionDetectionMode: text("region_detection_mode").default("flood-fill"), // 'grid' | 'flood-fill'
  textDiffEnabled: boolean("text_diff_enabled").default(false), // capture page innerText alongside each screenshot and diff it
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type DiffSensitivitySettings =
  typeof diffSensitivitySettings.$inferSelect;

export type NewDiffSensitivitySettings =
  typeof diffSensitivitySettings.$inferInsert;

// Default diff sensitivity thresholds
export const DEFAULT_DIFF_THRESHOLDS = {
  unchangedThreshold: 1,
  flakyThreshold: 10,
  includeAntiAliasing: false,
  ignorePageShift: false,
  diffEngine: "pixelmatch" as DiffEngineType,
  textRegionAwareDiffing: false,
  textRegionThreshold: 30,
  textRegionPadding: 4,
  textDetectionGranularity: "word" as TextDetectionGranularity,
  regionDetectionMode: "flood-fill" as RegionDetectionMode,
  textDiffEnabled: false,
};

// Default settings for API tests (E1). Used when a field is unset on the
// ApiTestDefinition.
export const DEFAULT_API_TEST_SETTINGS = {
  timeoutMs: 15000,
};

// AI Provider settings for test generation
export type AIProvider =
  | "claude-cli"
  | "openrouter"
  | "claude-agent-sdk"
  | "ollama"
  | "openai"
  | "anthropic";

export type AgentSdkPermissionMode = "plan" | "default" | "acceptEdits";

export const aiSettings = pgTable("ai_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  provider: text("provider").notNull().default("claude-cli"), // 'claude-cli' | 'openrouter' | 'claude-agent-sdk'
  openrouterApiKey: text("openrouter_api_key"),
  openrouterModel: text("openrouter_model").default(
    "anthropic/claude-sonnet-4",
  ),
  agentSdkPermissionMode: text("agent_sdk_permission_mode").default("plan"), // 'plan' | 'default' | 'acceptEdits'
  agentSdkModel: text("agent_sdk_model"),
  agentSdkWorkingDir: text("agent_sdk_working_dir"),
  ollamaBaseUrl: text("ollama_base_url"),
  ollamaModel: text("ollama_model"),
  anthropicApiKey: text("anthropic_api_key"),
  anthropicModel: text("anthropic_model").default("claude-sonnet-4-5-20250929"),
  openaiApiKey: text("openai_api_key"),
  openaiModel: text("openai_model").default("gpt-4o"),
  customInstructions: text("custom_instructions"),
  // AI Diffing settings (separate from test generation)
  aiDiffingEnabled: boolean("ai_diffing_enabled").default(false),
  aiDiffingProvider: text("ai_diffing_provider"), // 'openrouter' | 'anthropic'
  aiDiffingApiKey: text("ai_diffing_api_key"),
  aiDiffingModel: text("ai_diffing_model").default(
    "anthropic/claude-sonnet-4-5-20250929",
  ),
  aiDiffingOllamaBaseUrl: text("ai_diffing_ollama_base_url"),
  aiDiffingOllamaModel: text("ai_diffing_ollama_model"),
  pwAgentModel: text("pw_agent_model"),
  pwAgentTimeout: integer("pw_agent_timeout").default(300000),
  // Explorer agent settings
  explorerMaxIterations: integer("explorer_max_iterations").default(8),
  explorerStyleRotation: text("explorer_style_rotation").default(
    "normal,curious,psycho",
  ),
  /** Model override for explorer loop calls (empty = same as test generation). */
  explorerModel: text("explorer_model"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type AISettings = typeof aiSettings.$inferSelect;

export type NewAISettings = typeof aiSettings.$inferInsert;

export const DEFAULT_AI_SETTINGS = {
  // Nominal default only. The provider a team without a saved row actually gets
  // is resolved per-deployment by defaultAiProvider() in src/lib/ai/availability.ts,
  // which falls back to a BYOK provider where the Agent SDK has no credentials —
  // never hand out a default that cannot run.
  provider: "claude-agent-sdk" as AIProvider,
  openrouterModel: "anthropic/claude-sonnet-4",
  agentSdkPermissionMode: "acceptEdits" as AgentSdkPermissionMode,
  agentSdkModel: "",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "",
  anthropicModel: "claude-sonnet-4-5-20250929",
  openaiModel: "gpt-4o",
  aiDiffingEnabled: false,
  aiDiffingProvider: "same-as-test-gen" as AIDiffingProvider,
  aiDiffingModel: "anthropic/claude-sonnet-4-5-20250929",
  aiDiffingOllamaBaseUrl: "http://localhost:11434",
  aiDiffingOllamaModel: "",
  pwAgentModel: "",
  pwAgentTimeout: 300000,
  explorerMaxIterations: 8,
  explorerStyleRotation: "normal,curious,psycho",
  explorerModel: "",
};

// AI Prompt Logging for debugging and auditing
export type AIActionType =
  | "create_test"
  | "fix_test"
  | "enhance_test"
  | "scan_routes"
  | "test_connection"
  | "mcp_explore"
  | "analyze_diff"
  | "extract_user_stories"
  | "generate_spec_tests"
  | "classify_template"
  | "agent_discover"
  | "agent_generate"
  | "agent_heal"
  | "agent_play"
  | "qa_plan"
  | "qa_task_triage"
  | "qa_auth_extract"
  | "triage"
  | "generate_var_value"
  | "suggest_app_fix"
  | "explorer_plan"
  | "explorer_act"
  | "explorer_analyze";

export type AILogStatus = "pending" | "success" | "error";

export const aiPromptLogs = pgTable("ai_prompt_logs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  actionType: text("action_type").notNull(), // 'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection'
  provider: text("provider").notNull(), // 'claude-cli' | 'openrouter'
  model: text("model"),
  systemPrompt: text("system_prompt"),
  userPrompt: text("user_prompt").notNull(),
  response: text("response"),
  status: text("status").notNull(), // 'success' | 'error'
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at"),
});

export type AIPromptLog = typeof aiPromptLogs.$inferSelect;

export type NewAIPromptLog = typeof aiPromptLogs.$inferInsert;

// Notification settings for Slack, Discord, GitHub PR comments, GitLab MR comments, and Custom Webhook
export const notificationSettings = pgTable("notification_settings", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  slackWebhookUrl: text("slack_webhook_url"),
  slackEnabled: boolean("slack_enabled").default(false),
  discordWebhookUrl: text("discord_webhook_url"),
  discordEnabled: boolean("discord_enabled").default(false),
  githubPrCommentsEnabled: boolean("github_pr_comments_enabled").default(false),
  gitlabMrCommentsEnabled: boolean("gitlab_mr_comments_enabled").default(false),
  customWebhookEnabled: boolean("custom_webhook_enabled").default(false),
  customWebhookUrl: text("custom_webhook_url"),
  customWebhookMethod: text("custom_webhook_method").default("POST"),
  customWebhookHeaders: text("custom_webhook_headers"), // JSON: {"Authorization": "Bearer xxx"}
  // Where "Submit as Issue" on a visual diff posts the issue. Only 'github' is wired today.
  issueTrackerProvider: text("issue_tracker_provider")
    .default("github")
    .notNull(),
  // GitHub login auto-assigned to every issue Lastest files (visual diff +
  // verify cases). Point it at your AI engineer bot (e.g. copilot, devin) so
  // filed regressions are picked up without a human dispatcher. Null = no
  // auto-assignment. Invalid logins are dropped by GitHub, not an error.
  issueAssignee: text("issue_assignee"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type NotificationSettings = typeof notificationSettings.$inferSelect;

export type NewNotificationSettings = typeof notificationSettings.$inferInsert;

export type IssueTrackerProvider = "github" | "gitlab";

export const DEFAULT_NOTIFICATION_SETTINGS = {
  slackEnabled: false,
  discordEnabled: false,
  githubPrCommentsEnabled: false,
  gitlabMrCommentsEnabled: false,
  customWebhookEnabled: false,
  customWebhookMethod: "POST" as const,
  issueTrackerProvider: "github" as IssueTrackerProvider,
  issueAssignee: null as string | null,
};

// ============================================
// Spec Import - Document-based US/AC extraction
// ============================================

export type SpecImportStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "generating"
  | "completed"
  | "failed";

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

export const specImports = pgTable("spec_imports", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(), // Import session name
  sourceType: text("source_type").notNull(), // 'github' | 'upload'
  sourceFiles: jsonb("source_files").$type<string[]>(), // file paths or names
  branch: text("branch"), // Branch used for code analysis
  status: text("status").notNull().default("pending"), // SpecImportStatus
  extractedStories: jsonb("extracted_stories").$type<ExtractedUserStory[]>(),
  areasCreated: integer("areas_created").default(0),
  testsCreated: integer("tests_created").default(0),
  error: text("error"),
  createdAt: timestamp("created_at"),
  completedAt: timestamp("completed_at"),
});

export type SpecImport = typeof specImports.$inferSelect;

export type NewSpecImport = typeof specImports.$inferInsert;

// ============================================
// Setup Scripts & Configs Tables
// ============================================

export type SetupScriptType = "playwright" | "api";

// Setup Scripts - Reusable setup code blocks
export const setupScripts = pgTable("setup_scripts", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(),
  type: text("type").notNull().default("playwright"), // 'playwright' | 'api'
  code: text("code").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type SetupScript = typeof setupScripts.$inferSelect;

export type NewSetupScript = typeof setupScripts.$inferInsert;

// Auth types for API seeding
export type SetupAuthType = "none" | "bearer" | "basic" | "custom";

export interface SetupAuthConfig {
  token?: string; // For bearer auth
  username?: string; // For basic auth
  password?: string; // For basic auth
  headers?: Record<string, string>; // For custom auth
}

// Setup Configs - API seeding configuration per repository
export const setupConfigs = pgTable("setup_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  authType: text("auth_type").notNull().default("none"), // 'none' | 'bearer' | 'basic' | 'custom'
  authConfig: jsonb("auth_config").$type<SetupAuthConfig>(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type SetupConfig = typeof setupConfigs.$inferSelect;

export type NewSetupConfig = typeof setupConfigs.$inferInsert;

// Setup status for builds
export type SetupStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

// Default Setup Steps - Ordered multi-step setup for repositories
export type SetupStepType = "test" | "script" | "storage_state";

export const defaultSetupSteps = pgTable("default_setup_steps", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  stepType: text("step_type").notNull(), // 'test' | 'script' | 'storage_state'
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => setupScripts.id, {
    onDelete: "cascade",
  }),
  storageStateId: text("storage_state_id").references(() => storageStates.id, {
    onDelete: "cascade",
  }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at"),
});

export type DefaultSetupStep = typeof defaultSetupSteps.$inferSelect;

export type NewDefaultSetupStep = typeof defaultSetupSteps.$inferInsert;

// Default Teardown Steps - Ordered multi-step teardown for repositories
export const defaultTeardownSteps = pgTable("default_teardown_steps", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  stepType: text("step_type").notNull(), // 'test' | 'script' | 'storage_state'
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  scriptId: text("script_id").references(() => setupScripts.id, {
    onDelete: "cascade",
  }),
  storageStateId: text("storage_state_id").references(() => storageStates.id, {
    onDelete: "cascade",
  }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at"),
});

export type DefaultTeardownStep = typeof defaultTeardownSteps.$inferSelect;

export type NewDefaultTeardownStep = typeof defaultTeardownSteps.$inferInsert;

// ============================================
// Google Sheets Test Data Sources
// ============================================

// Google Sheets accounts - per-team Google connection with Sheets API scope
export const googleSheetsAccounts = pgTable("google_sheets_accounts", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id),
  googleUserId: text("google_user_id").notNull(),
  googleEmail: text("google_email").notNull(),
  googleName: text("google_name"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  createdAt: timestamp("created_at"),
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
  index: number; // 0-based column index
  letter: string; // Column letter (A, B, C...)
  header: string; // First row value as header
  sampleValues: string[]; // First few values for preview
}

// Google Sheets data sources - linked spreadsheets for test data
export const googleSheetsDataSources = pgTable("google_sheets_data_sources", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  teamId: text("team_id").references(() => teams.id),
  googleSheetsAccountId: text("google_sheets_account_id").references(
    () => googleSheetsAccounts.id,
  ),
  spreadsheetId: text("spreadsheet_id").notNull(), // Google Sheets document ID
  spreadsheetName: text("spreadsheet_name").notNull(), // Document title
  sheetName: text("sheet_name").notNull(), // Tab/sheet name within the spreadsheet
  sheetGid: integer("sheet_gid"), // Sheet tab GID
  alias: text("alias").notNull(), // Short name used in test references (e.g. "users", "products")
  headerRow: integer("header_row").default(1), // Which row contains column headers (1-based)
  dataRange: text("data_range"), // Optional fixed range like "A1:D100"
  cachedHeaders: jsonb("cached_headers").$type<string[]>(),
  cachedData: jsonb("cached_data").$type<string[][]>(), // Cached rows of data
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type GoogleSheetsDataSource =
  typeof googleSheetsDataSources.$inferSelect;

export type NewGoogleSheetsDataSource =
  typeof googleSheetsDataSources.$inferInsert;

// CSV data sources - uploaded CSV files cached as repo-scoped tabular data.
// Mirrors googleSheetsDataSources: alias-keyed, cachedHeaders + cachedData, referenced via {{csv:alias.col[row]}} or via TestVariable.sourceAlias.
export const csvDataSources = pgTable("csv_data_sources", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").references(() => repositories.id),
  teamId: text("team_id").references(() => teams.id),
  alias: text("alias").notNull(), // unique per repo
  filename: text("filename").notNull(),
  storagePath: text("storage_path"), // optional persisted file path
  cachedHeaders: jsonb("cached_headers").$type<string[]>().notNull(),
  cachedData: jsonb("cached_data").$type<string[][]>().notNull(),
  rowCount: integer("row_count").notNull().default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export type CsvDataSource = typeof csvDataSources.$inferSelect;

export type NewCsvDataSource = typeof csvDataSources.$inferInsert;

// ============================================
// Compose Configs (per-branch build configuration)
// ============================================

export const composeConfigs = pgTable("compose_configs", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  branch: text("branch").notNull(),
  selectedTestIds: jsonb("selected_test_ids").$type<string[]>(),
  excludedTestIds: jsonb("excluded_test_ids").$type<string[]>(),
  versionOverrides: jsonb("version_overrides").$type<Record<string, string>>(),
  updatedAt: timestamp("updated_at"),
});

export type ComposeConfig = typeof composeConfigs.$inferSelect;

export type NewComposeConfig = typeof composeConfigs.$inferInsert;

// ============================================
// Storage States (saved browser auth for recordings)
// ============================================

export const storageStates = pgTable(
  "storage_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    storageStateJson: text("storage_state_json").notNull(),
    cookieCount: integer("cookie_count").default(0),
    originCount: integer("origin_count").default(0),
    // Provenance metadata — surfaces capture quality + replay strategy hints.
    // includesIndexedDB: true when the JSON was produced with `storageState({ indexedDB: true })`
    // (Playwright v1.51+). Lets the runner decide whether the capture covers Firebase Auth.
    includesIndexedDB: boolean("includes_indexed_db").default(false),
    // authFlavor: free-form hint so the agent can pick the right re-auth strategy.
    // Common values: 'firebase' | 'supabase' | 'clerk' | 'next-auth' | 'better-auth' | 'cookie' | 'unknown'.
    authFlavor: text("auth_flavor"),
    // tokenLocations: where the session lives. Array of 'cookie' | 'localStorage' |
    // 'sessionStorage' | 'indexedDB'. Lets future surfaces flag captures that are
    // missing a location they should have (e.g. firebase without indexedDB).
    tokenLocations: jsonb("token_locations").$type<string[]>(),
    // firebaseApiKey: when authFlavor === 'firebase', stores the project's Web API key
    // so the documented #35302/#35504 IndexedDB workaround can target the right key in
    // firebaseLocalStorageDb. Public web-API key, not a secret.
    firebaseApiKey: text("firebase_api_key"),
    // expiresAt: best-effort estimate based on the auth library's session TTL.
    // Surfaces stale captures so the agent recaptures instead of debugging
    // chain-auth-yielded-unauthenticated as if it were a different bug.
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("idx_storage_states_repo").on(table.repositoryId)],
);

export type StorageState = typeof storageStates.$inferSelect;

export type NewStorageState = typeof storageStates.$inferInsert;
