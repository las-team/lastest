/**
 * Execution: builds, schedules, runners, jobs and build-level artifacts.
 *
 * Everything about *executing* tests rather than defining them — the build
 * that groups a run, the runner or embedded browser that performs it, the
 * background jobs and cron schedules that start it, and the artifacts a finished
 * build produces (Change Map, demo notes, app fix suggestions).
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { DesignSystemTokenUsage } from "@lastest/eb-protocol";

import { teams, users } from "./identity";

import { pullRequests, repositories } from "./repos";

import { testRuns, tests } from "./tests";

/** @deprecated Always vs_both now — kept for backward compat */
export type ComparisonMode =
  | "vs_main"
  | "vs_branch"
  | "vs_both"
  | "vs_previous"
  | "vs_planned";

// Builds - aggregated test run with status
export const builds = pgTable("builds", {
  id: text("id").primaryKey(),
  testRunId: text("test_run_id").references(() => testRuns.id),
  pullRequestId: text("pull_request_id").references(() => pullRequests.id),
  triggerType: text("trigger_type").notNull(), // 'webhook', 'manual', 'push'
  overallStatus: text("overall_status").notNull(), // 'safe_to_merge', 'review_required', 'blocked'
  totalTests: integer("total_tests").default(0),
  changesDetected: integer("changes_detected").default(0),
  flakyCount: integer("flaky_count").default(0),
  failedCount: integer("failed_count").default(0),
  passedCount: integer("passed_count").default(0),
  baseUrl: text("base_url"),
  elapsedMs: integer("elapsed_ms"),
  /** @deprecated Always vs_both now — kept for backward compat */
  comparisonMode: text("comparison_mode").default("vs_main"), // ComparisonMode
  // Build-level setup configuration
  buildSetupTestId: text("build_setup_test_id"), // Use test as build-level setup
  buildSetupScriptId: text("build_setup_script_id"), // OR use dedicated script
  setupStatus: text("setup_status").default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  setupError: text("setup_error"),
  setupDurationMs: integer("setup_duration_ms"),
  teardownStatus: text("teardown_status").default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  teardownError: text("teardown_error"),
  teardownDurationMs: integer("teardown_duration_ms"),
  codeChangeTestIds: jsonb("code_change_test_ids").$type<string[]>(),
  browsers: jsonb("browsers").$type<string[]>(), // browsers used in this build
  scheduleId: text("schedule_id"),
  a11yScore: integer("a11y_score"),
  a11yViolationCount: integer("a11y_violation_count"),
  a11yCriticalCount: integer("a11y_critical_count"),
  a11yTotalRulesChecked: integer("a11y_total_rules_checked"),
  designSystemScore: integer("design_system_score"),
  designSystemViolationCount: integer("design_system_violation_count"),
  designSystemCriticalCount: integer("design_system_critical_count"),
  designSystemTotalRulesChecked: integer("design_system_total_rules_checked"),
  // Build-level merge of test_results.designSystemTokenUsage. Sums each
  // (category, value) usage across every test in the run so the review
  // panel reads a single object instead of folding it client-side.
  designSystemTokenUsage: jsonb(
    "design_system_token_usage",
  ).$type<DesignSystemTokenUsage>(),
  comparisonPairId: text("comparison_pair_id"), // shared ID linking baseline + feature builds
  comparisonRole: text("comparison_role"), // 'baseline' | 'feature' | null
  comparisonMeta: jsonb("comparison_meta").$type<{
    featureBranch: string;
    featureUrl: string;
    runnerId?: string;
    testIds?: string[];
    versionOverrides?: Record<string, string>;
  }>(),
  // Verify phase (v1.14+): areas the user explicitly flagged as in-scope
  // before kicking off the build. Promotes those areas in the change-map.
  manuallyScopedAreaIds: jsonb("manually_scoped_area_ids").$type<string[]>(),
  createdAt: timestamp("created_at"),
  completedAt: timestamp("completed_at"),
  // Captured when runBuildAsync's outer try/catch fires AND no per-test
  // results landed — surfaces executor-level failures (B6) instead of
  // silently coercing to 'blocked'.
  executorError: text("executor_error"),
  executorFailedAt: timestamp("executor_failed_at"),
});

export type Build = typeof builds.$inferSelect;

export type NewBuild = typeof builds.$inferInsert;

// Build status enum.
// 'executor_failed' = build orchestration crashed before per-test results could
// be written (e.g. EB pod schedule failure, runner unreachable). Distinguished
// from 'blocked' so the UI / MCP surface can differentiate "review needed" from
// "infrastructure broke". See `runBuildAsync` catch block.
export type BuildStatus =
  | "safe_to_merge"
  | "review_required"
  | "blocked"
  | "has_todos"
  | "executor_failed";

export type TriggerType =
  | "webhook"
  | "manual"
  | "push"
  | "scheduled"
  | "validate_diff";

// Background Jobs for queue tracking
export type BackgroundJobType =
  | "ai_scan"
  | "build_tests"
  | "test_run"
  | "build_run"
  | "ai_fix"
  | "ai_validate"
  | "ai_diff"
  | "storage_cleanup"
  | "spec_import"
  | "url_diff"
  | "coverage_sync";

export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export const backgroundJobs = pgTable("background_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // BackgroundJobType
  status: text("status").notNull().default("pending"), // BackgroundJobStatus
  progress: integer("progress").default(0), // 0-100
  totalSteps: integer("total_steps"),
  completedSteps: integer("completed_steps").default(0),
  label: text("label").notNull(),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  parentJobId: text("parent_job_id"),
  repositoryId: text("repository_id").references(() => repositories.id),
  targetRunnerId: text("target_runner_id"), // 'local' or runner UUID — tracks which runner this job targets
  actualRunnerId: text("actual_runner_id"), // Runner UUID that actually executed (resolved from 'auto')
  createdAt: timestamp("created_at"),
  startedAt: timestamp("started_at"),
  lastActivityAt: timestamp("last_activity_at"),
  completedAt: timestamp("completed_at"),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;

export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;

/**
 * The queue backing `core/jobs`'s `JobsCapability`.
 *
 * Deliberately not `background_jobs`: that table's shape (progress/steps for a
 * build or test run in flight) predates plugins entirely and is read directly
 * by build/run UI. Bending it to also carry `type`/`payload`/`dedupeKey` for
 * arbitrary plugin work would mean two unrelated concerns sharing one table's
 * migrations forever. This is core-owned per `core-scope.md` §2 as *capacity*
 * — a runaway plugin enqueuing without bound starves every tenant's queue —
 * which is why it lives here and not under any plugin's own `src/schema.ts`.
 *
 * `pluginId` is stored redundantly with the `<pluginId>.<name>` prefix already
 * encoded in `type`, because `resolveRegistry` enforces that prefix at
 * boot but a table row should not depend on parsing a string to know who owns
 * it — a worker-loop bug that let `dispatch` throw for an unparseable type
 * would otherwise be unable to even log whose job failed.
 */
export const pluginJobs = pgTable(
  "plugin_jobs",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id").notNull(),
    /** `"<pluginId>.<name>"` — validated against the live registry at claim time, not here. */
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>(),
    status: text("status")
      .$type<"pending" | "running" | "done" | "failed" | "cancelled">()
      .notNull()
      .default("pending"),
    /** Scope to resolve a `PluginContext` for the handler — see `ScopeRequest`. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id").references(() => repositories.id, {
      onDelete: "cascade",
    }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after").notNull(),
    /**
     * Collapses duplicate enqueues while one is pending. Enforced in the query
     * layer (check-then-insert), not as a DB constraint — a partial unique
     * index scoped to `status IN ('pending','running')` is not a pattern used
     * elsewhere in this schema, and the race it would close (two concurrent
     * enqueues of the same key) is already vanishingly narrow given jobs are
     * enqueued from request handlers, not a hot loop.
     */
    dedupeKey: text("dedupe_key"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_plugin_jobs_claim").on(table.status, table.runAfter),
    index("idx_plugin_jobs_dedupe").on(table.dedupeKey),
  ],
);

export type PluginJob = typeof pluginJobs.$inferSelect;
export type NewPluginJob = typeof pluginJobs.$inferInsert;

// Build schedules for recurring test runs moved to
// plugins/scheduling/src/schema.ts (RFC §9 phase 4, thirteenth plugin,
// scheduling_build_schedules) — see
// docs/architecture/scheduling-migration-result.md.

// ============================================
// Runners Table (Remote Execution)
// ============================================

export type RunnerStatus = "online" | "offline" | "busy";

export type RunnerCapability = "run" | "record";

export const runners = pgTable("runners", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("offline"), // 'online' | 'offline' | 'busy'
  lastSeen: timestamp("last_seen"),
  capabilities: jsonb("capabilities")
    .$type<RunnerCapability[]>()
    .default(["run", "record"]),
  type: text("type").notNull().default("remote"), // 'remote' | 'embedded'
  maxParallelTests: integer("max_parallel_tests").default(4), // max tests to run in parallel on this runner
  isSystem: boolean("is_system").notNull().default(false), // System EB runners (host-provided, cross-team)
  authOnly: boolean("auth_only").notNull().default(false), // Auth-only runners (for GHA auto mode — not used for execution)
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
});

export type RunnerType = "remote" | "embedded";

export type Runner = typeof runners.$inferSelect;

export type NewRunner = typeof runners.$inferInsert;

// ============================================
// Embedded Browser Sessions
// ============================================

export type EmbeddedSessionStatus =
  | "starting"
  | "ready"
  | "busy"
  | "stopping"
  | "stopped";

export const embeddedSessions = pgTable("embedded_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  runnerId: text("runner_id").references(() => runners.id),
  status: text("status").notNull().default("starting"), // EmbeddedSessionStatus
  // Provisioner instanceId (`eb-<ts>-<rand>`) reported at auto-register and
  // bound to the pod's EB_BOOTSTRAP_TOKEN. The front proxy derives this EB's
  // STREAM_AUTH_TOKEN from it, so it must round-trip into the stream grant.
  // Null for static-fleet EBs, which have no provisioner-assigned identity.
  instanceId: text("instance_id"),
  streamUrl: text("stream_url"), // ws://host:9223
  cdpUrl: text("cdp_url"), // http://host:9222 (CDP endpoint for MCP)
  containerUrl: text("container_url"), // http://host:port (for health checks)
  viewport: jsonb("viewport").$type<{ width: number; height: number }>(),
  currentUrl: text("current_url"),
  userId: text("user_id"), // Clerk user who claimed the session
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastActivityAt: timestamp("last_activity_at"),
  expiresAt: timestamp("expires_at"),
  busySince: timestamp("busy_since"), // Set when claimed by pool, cleared on release. Used for stale-lock detection.
});

export type EmbeddedSession = typeof embeddedSessions.$inferSelect;

export type NewEmbeddedSession = typeof embeddedSessions.$inferInsert;

// ============================================
// Runner Commands (DB-backed command queue)
// ============================================

export type RunnerCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export const runnerCommands = pgTable(
  "runner_commands",
  {
    id: text("id").primaryKey(), // Same as message UUID (becomes correlationId)
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id),
    type: text("type").notNull(), // e.g. 'command:run_test', 'command:shutdown'
    status: text("status").notNull().default("pending"), // RunnerCommandStatus
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    testId: text("test_id"), // Denormalized for dedup lookups
    testRunId: text("test_run_id"), // Denormalized for grouping
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    // Stamped when the server returns this command in a heartbeat response.
    // The row stays at status='pending' until the runner POSTs `response:command_ack`,
    // at which point status flips to 'claimed'. If no ack within REDISPATCH_TTL the
    // next heartbeat re-delivers; EB-side `activeTestIds` dedup keeps it safe.
    dispatchedAt: timestamp("dispatched_at"),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_runner_commands_runner_status").on(table.runnerId, table.status),
    index("idx_runner_commands_test_run").on(table.testRunId),
  ],
);

export type RunnerCommand = typeof runnerCommands.$inferSelect;

export type NewRunnerCommand = typeof runnerCommands.$inferInsert;

export const runnerCommandResults = pgTable(
  "runner_command_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // `command_id` is intentionally NOT an FK: the parent runner_commands row
    // can be reaped (`reapIdleEBJobs`, `cleanupOldCommands`) before an EB
    // finishes draining late `response:*` POSTs after Job termination. With a
    // hard FK we got `runner_command_results_command_id_runner_commands_id_fk`
    // violations on those late inserts, while the on-disk artifact (screenshot,
    // network-bodies file, etc.) was already written. Keeping the column as a
    // logical reference lets the insert succeed; cleanup still happens — orphan
    // result rows are deleted by `reapIdleEBJobs` via `runnerId`, and
    // `cleanupOldCommands` deletes by `commandId` while the parent still
    // exists.
    commandId: text("command_id").notNull(),
    runnerId: text("runner_id")
      .notNull()
      .references(() => runners.id),
    type: text("type").notNull(), // 'response:test_result', 'response:screenshot', 'response:error'
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    acknowledged: boolean("acknowledged").default(false),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_runner_cmd_results_cmd_ack").on(
      table.commandId,
      table.acknowledged,
    ),
  ],
);

export type RunnerCommandResult = typeof runnerCommandResults.$inferSelect;

export type NewRunnerCommandResult = typeof runnerCommandResults.$inferInsert;

// ============================================
// Remote Recording Events (cross-pod forwarding)
// ============================================
// Recording events POSTed by the EB land on whichever pod serves LASTEST_URL
// (the envoy-less `*-internal` pod in kubernetes mode). The recording session
// state lives in-memory on the main pod (where startRecording ran). Without
// this table the internal pod has no way to hand events back to the main pod
// — logs fill with "Received events for unknown session". This table is the
// shared inbox: internal pod inserts, main pod reads since-last-sequence.
export const remoteRecordingEvents = pgTable(
  "remote_recording_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    status: text("status").notNull(), // 'preview' | 'committed'
    verification: jsonb("verification").$type<Record<string, unknown> | null>(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    // MUST be unique: the recording_event ingest upserts on (sessionId,
    // sequence) — the EB re-emits an event with the same sequence when its
    // verification settles or a thumbnail arrives, and replaces trailing
    // hover-previews in place. With a plain index the insert's ON CONFLICT
    // never fired and every re-emit piled up a duplicate row; the merged
    // timeline (and the code generated from it at stop time) then picked an
    // arbitrary stale/new copy per sequence.
    uniqueIndex("idx_remote_recording_events_session_seq").on(
      table.sessionId,
      table.sequence,
    ),
  ],
);

export type RemoteRecordingEventRow = typeof remoteRecordingEvents.$inferSelect;

export type NewRemoteRecordingEventRow =
  typeof remoteRecordingEvents.$inferInsert;

// Shared state for an in-flight remote debug session. Previously a per-pod
// `globalThis` Map; moved to DB because the Olares deployment runs TWO app
// pods (envoy-fronted `lastest-dev` for the UI + envoy-less
// `lastest-internal-dev` that receives EB POSTs), and they can't share
// in-process memory. The UI reads state via polling from pod A while the
// EB writes state via `response:debug_state` POSTs that land on pod B.
export const remoteDebugSessions = pgTable(
  "remote_debug_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    runnerId: text("runner_id").notNull(),
    repositoryId: text("repository_id"),
    testId: text("test_id").notNull(),
    state: jsonb("state"),
    // Durable "this recording's events have been spliced + persisted" marker.
    // Lives OUTSIDE `state` because the runner overwrites the whole `state`
    // blob on every debug_state push (and keeps reporting pendingRecordingEvents
    // until update_code round-trips), which would otherwise re-arm a consumed
    // splice. Set once by consumeStopRecording after the test version is saved;
    // makes the consume idempotent so a re-entrant poll can't splice twice.
    splicedAt: timestamp("spliced_at"),
    startedAt: timestamp("started_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [index("idx_remote_debug_sessions_runner").on(table.runnerId)],
);

export type RemoteDebugSessionRow = typeof remoteDebugSessions.$inferSelect;

export type NewRemoteDebugSessionRow = typeof remoteDebugSessions.$inferInsert;

// ---------------------------------------------------------------------------
// Verify phase — Build-level Change Map (v1.14+)
// ---------------------------------------------------------------------------
//
// Computed once per build at completion time and cached. Aggregates four
// signals into a single ranked list of areas worth verifying:
//   - code   : git diff vs base branch → routes/areas
//   - ai     : LLM narrative + risk per area
//   - signals: step_comparisons verdicts (red/yellow) on this build
//   - manual : developer-flagged areas (builds.manuallyScopedAreaIds)

export type ChangeSource = "code" | "ai" | "signals" | "manual";

export type ChangeRisk = "low" | "medium" | "high";

export interface ChangeMapFile {
  path: string;
  pkg: string;
  status: "A" | "M" | "D";
  insertions: number;
  deletions: number;
}

export interface ChangeMapArea {
  areaId: string;
  areaName: string;
  sources: ChangeSource[];
  risk: ChangeRisk;
  /** 3-bullet narrative from the LLM. Empty when AI skipped/disabled. */
  aiNarrative: string[];
}

export interface ChangeMapTest {
  testId: string;
  reason: string;
  lastStatus: string | null;
}

export interface ChangeMapStep {
  testId: string;
  stepLabel: string;
  reason: string;
}

export interface ChangeMap {
  files: ChangeMapFile[];
  areas: ChangeMapArea[];
  tests: ChangeMapTest[];
  steps: ChangeMapStep[];
  /** One-sentence build intent summary (AI-generated when enabled). */
  intentSummary: string;
  /** One-sentence build risk summary (AI-generated when enabled). */
  riskSummary: string;
  /** Areas the developer pinned via the Focus-on multi-select. */
  manuallyScopedAreaIds: string[];
  generatedAt: string;
  /** Provider/model id used for the AI summary, when applicable. */
  modelId: string;
  /** True if the AI-summary call was skipped (cap, missing key, etc). */
  aiSkipped?: boolean;
  aiSkippedReason?: string;
}

export const buildChangeMaps = pgTable("build_change_maps", {
  buildId: text("build_id")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<ChangeMap>().notNull(),
  computedAt: timestamp("computed_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type BuildChangeMapRow = typeof buildChangeMaps.$inferSelect;

export type NewBuildChangeMapRow = typeof buildChangeMaps.$inferInsert;

// ---------------------------------------------------------------------------
// Build-level demo notes — AI-generated UI/UX summary captured at the end of
// a /gtm-lastest-saas-demo run. Surfaced on the public /r/<slug> share page
// above the screenshot grid so the recipient (the founder we're DM'ing) sees
// "here's what we noticed" before scrolling into the baselines.
//
// Bucketed deliberately:
//   highlights        → safe to quote in outreach DMs
//   frictionPoints    → PUBLIC on the share and read by the founder: max 2,
//                       each with a one-line fix, "fixable, not embarrassing"
//                       tone — findings build credibility
//   testingStruggles  → automation gotchas (captcha, hangs); hidden from the
//                       share, routed to the operator (publish step + Discord)
//   skippedRoutes     → explicit "couldn't get here" provenance — beats a
//                       silent omission in the screenshot list
//   outreachHook      → tweet-length opener for the X reply/DM + the share
//                       page's Post-to-X prefill
// ---------------------------------------------------------------------------

export interface DemoNoteItem {
  label: string;
  note: string;
}

export interface DemoNoteSkippedRoute {
  path: string;
  reason: string;
}

// One narration cue for the share-page recording. The AI vision pass writes
// one of these per captured step (aligned to test_results.screenshots[] order)
// describing what the agent does and what's visible on screen. Cue timing is
// an EVEN SPLIT of the recording's duration_ms — we don't persist a real
// per-step video timestamp (see src/lib/demo-captions/captions.ts /
// plugins/share/src/vtt.ts). `focus`
// and `annotation` are captured now but only rendered by the (planned)
// arrow/underline overlay; the v1 subtitle track ignores them.
export interface VideoCaption {
  /** 0-based, aligns to test_results.screenshots[] order. */
  stepIndex: number;
  /** Cue start in ms (even-split approximation of duration_ms). */
  startMs: number;
  /** Cue end in ms. */
  endMs: number;
  /** One short present-tense narration line. */
  text: string;
  /** Normalized 0..1 region of the primary element the agent acted on.
   *  Stored for the future annotation overlay; not rendered by the v1 track. */
  focus?: { x: number; y: number; w: number; h: number };
  /** How the focus region should be marked once the overlay ships. */
  annotation?: "arrow" | "underline" | "box";
}

export interface DemoNotes {
  /** 2–3 sentence overall UI/UX impression. */
  uxSummary: string;
  /** Things that worked well; safe for outreach. */
  highlights: DemoNoteItem[];
  /** Real UX issues (max 2), each with a one-line fix. PUBLIC on the share and
   *  read by the founder — fixable-not-embarrassing tone, never security-sensitive. */
  frictionPoints: DemoNoteItem[];
  /** Automation pain points (captcha, hangs, OAuth-only flows). Hidden from the
   *  share; routed to the operator via the publish step result + Discord ping. */
  testingStruggles: DemoNoteItem[];
  /** Routes the agent tried but couldn't capture. */
  skippedRoutes?: DemoNoteSkippedRoute[];
  /** One tweet-length sentence (≤200 chars) leading with the most striking
   *  concrete observation — intended first line of the outreach reply/DM and
   *  the prefill for the share page's Post-to-X button. */
  outreachHook?: string;
  /** True when uxSummary is the deterministic fallback (AI call failed or
   *  returned nothing) — the share-readiness gate treats such notes as absent. */
  fallbackSummary?: boolean;
  /** Time-coded narration for the recording, rendered as the <video> subtitle
   *  track on /r/<slug>. Optional — absent on notes written before captions
   *  shipped, in which case the share renders no track. */
  captions?: VideoCaption[];
  generatedAt: string;
  /** Provider/model id used for the AI summary, when applicable. */
  modelId?: string;
}

export const buildDemoNotes = pgTable("build_demo_notes", {
  buildId: text("build_id")
    .primaryKey()
    .references(() => builds.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<DemoNotes>().notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type BuildDemoNotesRow = typeof buildDemoNotes.$inferSelect;

export type NewBuildDemoNotesRow = typeof buildDemoNotes.$inferInsert;

// ---------------------------------------------------------------------------
// App-fix suggestions — "Fix the app" loop (E5)
// ---------------------------------------------------------------------------
//
// When a failure is classified `real_regression`, the advisor produces a
// structured *application-code* fix recommendation that is returned to the
// calling coding agent (never auto-applied). Distinct from the test healer,
// which patches test code.

export interface AppFixSuggestionFile {
  path: string;
  startLine?: number;
  endLine?: number;
  currentSnippet?: string;
  suggestedSnippet?: string;
  rationale: string;
}

export interface AppFixSuggestion {
  summary: string;
  classification: "real_regression";
  confidence: number;
  files: AppFixSuggestionFile[];
  /** Files from the build's change map that likely introduced the regression. */
  relatedChangeMapFiles?: string[];
  generatedAt: string;
  modelId: string;
}

export const appFixSuggestions = pgTable("app_fix_suggestions", {
  id: text("id").primaryKey(),
  buildId: text("build_id").references(() => builds.id, {
    onDelete: "cascade",
  }),
  testId: text("test_id").references(() => tests.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<AppFixSuggestion>().notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export type AppFixSuggestionRow = typeof appFixSuggestions.$inferSelect;

export type NewAppFixSuggestionRow = typeof appFixSuggestions.$inferInsert;
