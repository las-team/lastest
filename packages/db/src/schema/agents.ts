/**
 * AI agent state: QA agent, app map, RCA sessions.
 *
 * Session, plan and finding rows written by the autonomous agents. RFC §7 marks
 * this whole module for extraction into the qa-agent / app-map / rca plugins —
 * it holds no table that core reads, which is why that extraction is unblocked.
 *
 * `explorer` has already left: its sessions, knowledge, experience, findings
 * and triggers live in `plugins/explorer/src/schema.ts` under the `explorer_`
 * namespace, with no foreign key back to anything here. What that removed from
 * this file is worth noticing — 15 optional fields off `AgentSessionMetadata`,
 * 8 members off `AgentStepId`, and five tables — because the same shape is
 * waiting behind each of the other three agents.
 */

import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

import type { PwAgentType } from "./shared";

import { repositories } from "./repos";

// ============================================
// Agent Sessions (Play Agent onboarding flow)
// ============================================

export type AgentSessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentSessionKind =
  | "play"
  | "quickstart"
  | "ranger"
  | "qa"
  | "triage"
  | "healer";

export type AgentStepId =
  | "settings_check"
  | "select_repo"
  | "env_setup"
  | "scan_and_template"
  | "plan"
  | "review"
  | "generate"
  | "run_tests"
  | "fix_tests"
  | "rerun_tests"
  | "summary"
  | "heal"
  // QuickStart agent steps
  | "qs_preflight"
  | "qs_scout_public"
  | "qs_auth_setup"
  | "qs_scout_authed"
  | "qs_generate"
  | "qs_run_and_notes"
  | "qs_approve_baselines"
  | "qs_rerun_after_approval"
  | "qs_publish_share"
  // Ranger (EB-backed live page scout, MCP-driven)
  | "ranger_provision"
  | "ranger_browse"
  // QA Agent (dedicated comprehensive-suite builder, /qa-agent page)
  | "qa_setup"
  | "qa_login"
  | "qa_discover"
  | "qa_plan"
  | "qa_plan_review"
  | "qa_generate"
  | "qa_execute"
  | "qa_heal"
  | "qa_summary"
  // Triage agent (build-scoped failure classifier, /triage-agent page)
  | "triage_collect"
  | "triage_cluster"
  | "triage_assess"
  | "triage_publish"
  // Healer agent (build-scoped test repairer, /healer-agent page)
  | "healer_collect"
  | "healer_gate"
  | "healer_heal"
  | "healer_verify"
  | "healer_report";

export type AgentStepStatus =
  | "pending"
  | "active"
  | "waiting_user"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentSubstep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
  /** Which PW sub-agent is handling this substep (shown as a badge in the UI) */
  agent?: PwAgentType;
  /** Planner source identifier for observability */
  source?: string;
  /** Links to aiPromptLogs.id for full input/output drill-down */
  promptLogId?: string;
  /** Short description of planner inputs */
  inputSummary?: string;
  /** Comma-separated area names found */
  outputSummary?: string;
  /** Number of areas discovered */
  areasFound?: number;
  /** Wall-clock duration in ms */
  durationMs?: number;
  /** Full error message (not truncated) */
  rawError?: string;
}

export interface AgentRichResultPlanArea {
  id: string;
  name: string;
  // Short hint string from the planner agent (transient — not persisted; the persistence
  // target is the area's `agentPlan` column). Kept distinct from `testPlan` so the UI
  // can show a one-line preview alongside the full plan.
  summary: string;
  routes: string[];
  testPlan: string;
  approved?: boolean;
}

export type AgentStepRichResult =
  | {
      type: "scan_and_template";
      routes: Array<{ path: string; type: string }>;
      framework?: string;
      template?: string;
      intelligence?: Record<string, unknown>;
    }
  | { type: "plan"; areas: AgentRichResultPlanArea[] }
  | {
      type: "generate";
      tests: Array<{
        testId: string;
        name: string;
        areaName: string;
        code: string;
      }>;
    }
  | { type: "env_setup"; loginScript?: string; pageContext?: string }
  | {
      type: "run_tests";
      buildId: string;
      results: Array<{ testName: string; status: string; error?: string }>;
    }
  | {
      type: "fix_tests";
      fixes: Array<{
        testName: string;
        originalError: string;
        fixed: boolean;
        newCode?: string;
      }>;
    }
  | { type: "generic"; content: string };

export interface AgentStepState {
  id: AgentStepId;
  status: AgentStepStatus;
  label: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
  richResult?: AgentStepRichResult;
  userAction?: string;
  substeps?: AgentSubstep[];
}

export interface QuickstartAuthClassification {
  /**
   * Auth-flow classification. `unknown` is a distinct failure sentinel meaning
   * "the scout could not determine the flow" (browser MCP failure, empty page,
   * etc.) — never confuse with `no_public_register` which means "the scout
   * confirmed there is no public sign-up".
   */
  classification:
    | "email_password"
    | "login_email_password"
    | "magic_link_only"
    | "oauth_only"
    | "captcha_gated"
    | "otp"
    | "no_public_register"
    | "unknown";
  authAutomatable: boolean;
}

export interface QuickstartBusinessInteraction {
  /** Visible label / placeholder of the primary input the founder's hero CTA points at
   *  (e.g. "Paste a startup idea", "Search anything", "Enter a URL"). */
  primaryInputLabel?: string;
  /** Visible text of the hero / primary CTA (e.g. "Validate idea", "Generate brief"). */
  primaryCtaLabel?: string;
  /** Safe demo value to type into the primary input. Plain string, no quotes — must be
   *  additive/idempotent (no destructive actions, no real payments, no outbound mail). */
  demoInputValue?: string;
}

/** Product archetype classified by the public scout from the landing surface.
 *  Drives which deterministic interaction snippet renderWalkthroughCode emits
 *  (canvas draw, search query, sample-file upload, add-to-cart) so the
 *  walkthrough shows the product doing its job, not just nav clicks. */
export type QuickstartProductArchetype =
  | "canvas"
  | "search"
  | "form"
  | "upload"
  | "dashboard"
  | "ecommerce"
  | "other";

export interface QuickstartPublicScout extends QuickstartAuthClassification {
  tagline?: string;
  concept?: string;
  navLinks: Array<{ path: string; label: string }>;
  registerPath?: string | null;
  /** Login page URL observed in the DOM (distinct from registerPath). Relative
   *  path (starting with /) or full https URL for cross-subdomain auth. Used by
   *  the user-credential login path when no automatable signup exists. */
  loginPath?: string | null;
  /** Auth library's REST sign-in endpoint when detectable (e.g.
   *  "/api/auth/sign-in/email" for better-auth). Drives the api-login bypass in
   *  the login template when the React form doesn't persist a session cookie. */
  apiLoginEndpoint?: string | null;
  /** Best-effort auth library guess (better-auth | nextauth | supabase | firebase
   *  | clerk | lucia | unknown). Informational — surfaced in demo notes + used as
   *  authFlavor provenance on the captured storage state. */
  authLibrary?: string;
  /** Where the session token persists, best-effort. Informs storage-capture and
   *  re-auth strategy; replay accepts any of these so a precise value isn't
   *  required for correctness. */
  tokenLocation?:
    | "cookie"
    | "localstorage"
    | "indexeddb"
    | "sessionstorage"
    | "unknown";
  cookieBannerSelectorHint?: string;
  friction?: Array<{ kind: string; note: string }>;
  businessInteraction?: QuickstartBusinessInteraction;
  /** What kind of product surface the scout saw — picks the walkthrough's
   *  archetype-specific interaction snippet. Absent on pre-archetype scouts
   *  (the template then falls back to its legacy canvas auto-detection). */
  productArchetype?: QuickstartProductArchetype;
}

export interface QuickstartAuthedScout {
  inAppNavLinks: Array<{ path: string; label: string }>;
  safeCtaCandidates: Array<{ label: string; selectorHint?: string }>;
  observedRoutes: string[];
  friction?: Array<{ kind: string; note: string }>;
}

export interface QuickstartAuthSetupMeta {
  testId?: string;
  storageStateId?: string;
  captured: boolean;
  failureReason?: string;
  /** Which handshake produced the session: "login" (user-supplied creds) or
   *  "signup" (fresh demo account). Surfaced in demo notes. */
  mode?: "login" | "signup";
}

// ── QA Agent (comprehensive suite builder) ──────────────────────────────────
//
// The payload shapes below are owned by `@lastest/plugin-qa-agent` and live in
// `@lastest/eb-protocol`, re-exported here. Same move `api-test`'s six made
// (see `./tests.ts`): they are jsonb the plugin is the only writer and reader
// of, sitting in a **core** column — `agent_sessions.metadata`, whose row shape
// is shared with the still-unmigrated `play` agent and with `quickstart`. The
// plugin may not import `@lastest/db`, and core may not import the plugin, so
// the type has to sit in a package both can name. App code has always imported
// these from `@/lib/db/schema` next to the rows they live in, and still does.
export type {
  ExploreStrategy,
  QaAuthState,
  QaAuthStrategy,
  QaDiscovery,
  QaExploreBlocked,
  QaExploreConfig,
  QaExplorerState,
  QaExploreState,
  QaGeneratedTest,
  QaGeneratedTestStatus,
  QaMatrixCell,
  QaPageSnapshot,
  QaPlanItem,
  QaPlanJourney,
  QaPrChangedFile,
  QaPrChanges,
  QaPrCoverage,
  QaPrCoverageEntry,
  QaPrEndpoint,
  QaPrSymbol,
  QaPriority,
  QaRunMode,
  QaSessionTrigger,
  QaSummaryData,
  QaTaskTriage,
  QaTestGroup,
  QaTestPlan,
} from "@lastest/eb-protocol";

// `AgentSessionMetadata` below names these directly, so they are imported as
// well as re-exported.
import type {
  QaAuthState,
  QaDiscovery,
  QaExploreState,
  QaGeneratedTest,
  QaRunMode,
  QaSessionTrigger,
  QaSummaryData,
  QaTaskTriage,
  QaTestGroup,
  QaTestPlan,
} from "@lastest/eb-protocol";

/** Why the Healer did, or did not, touch a failing test. */
export type HealerOutcomeKind =
  | "healed"
  | "still_failing"
  | "skipped_real_bug"
  | "skipped_environment"
  | "skipped_unclassified"
  | "skipped_human_verdict"
  | "skipped_budget"
  | "skipped_cap"
  | "heal_failed";

export interface HealerOutcome {
  testId: string;
  testName: string;
  outcome: HealerOutcomeKind;
  /** Heal attempts spent on this test across campaigns (post-run). */
  attempts: number;
  /** One line for the report — the triage classification, the error, or why
   *  the healer gave up. */
  detail?: string;
}

export interface AgentSessionMetadata {
  buildIds?: string[];
  /** Healer agent — per-test outcome ledger for the campaign. See
   *  `src/lib/healer/run.ts`. */
  healerOutcomes?: HealerOutcome[];
  /** Healer agent — how many heal→verify rounds the campaign ran. */
  healerRounds?: number;
  /** Healer agent — the test run the current verify round is waiting on. */
  verifyRunId?: string;
  fixAttempts?: Record<string, number>;
  codeHashes?: Record<string, string[]>;
  testsCreated?: number;
  initialPassedCount?: number;
  initialFailedCount?: number;
  finalPassedCount?: number;
  finalFailedCount?: number;
  approvedAreaIds?: string[];
  autoApproveReview?: boolean;
  manualMode?: boolean;
  skipGithub?: boolean;
  skipAI?: boolean;
  // QuickStart-only fields
  quickstartEmail?: string;
  /** User's real app-login password (QuickStart against their own baseURL).
   *  Encrypted at rest (AES-256-GCM) via the agent-session query layer in
   *  queries/integrations.ts — callers always see the decrypted plaintext. */
  quickstartPassword?: string;
  quickstartSlug?: string;
  quickstartStamp?: string;
  /** True when the user supplied real app login credentials for their own
   *  baseURL (QuickStart runs against the user's own app). When set,
   *  quickstartEmail/quickstartPassword hold those creds and the auth-setup runs
   *  a LOGIN handshake instead of registering a fresh demo account. */
  credsProvided?: boolean;
  /** Resolved auth handshake for this run, decided at auth-setup time. */
  authMode?: "login" | "signup" | "public_only";
  publicScout?: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: QuickstartAuthSetupMeta;
  /** Live CDP screencast URL of the EB the scout is currently driving. Set while
   *  a scout step holds an EB, cleared when it releases. Powers the panel's live
   *  browser view. */
  streamUrl?: string;
  /** True while an agent step is blocked waiting for an EB from the pool. */
  queuedForBrowser?: boolean;
  walkthroughTestId?: string;
  buildId?: string;
  /** Build id of the second walkthrough run (after baselines are approved). Replaces
   *  buildId for share publication so newly-added authed scenarios pair with their own
   *  baselines (isNewTest pairing trap fix). */
  rerunBuildId?: string;
  demoNotesId?: string;
  /** Share id returned by publishBuildShare after the rerun completes. */
  shareId?: string;
  shareSlug?: string;
  shareUrl?: string;
  disabledReason?: string;
  // Ranger-only fields
  /** URL the ranger session is browsing. */
  rangerUrl?: string;
  /** Deterministic rendered page map produced by the ranger EB browse. */
  rangerPageMap?: Record<string, unknown>;
  // QA Agent fields (kind = "qa"). Credentials for the target app reuse
  // quickstartEmail/quickstartPassword above so they get the same AES-256-GCM
  // encryption-at-rest treatment from the agent-session query layer.
  /** Target app base URL under test. */
  qaTargetUrl?: string;
  /** How this session runs (full | refresh_spec | fill_gaps). Absent on
   *  sessions created before modes existed — treated as "full". */
  qaMode?: QaRunMode;
  /** For fill_gaps runs: the prior session whose plan/discovery was reused. */
  qaPlanSourceSessionId?: string;
  /** Coverage groups selected for this run ("journey" is always included). */
  qaGroups?: QaTestGroup[];
  /** Skip the human plan-review gate and generate immediately. */
  qaAutoApprove?: boolean;
  /** Allow the qa_login step to self-register a throwaway account when no
   *  credentials/setup exist and a signup link is discovered in the DOM.
   *  Absent = allowed (opt-out via the setup form). */
  qaAllowRegistration?: boolean;
  /** Resolved auth strategy for this run, decided by the qa_login step. */
  qaAuth?: QaAuthState;
  /** Live + static discovery output feeding the planner. */
  qaDiscovery?: QaDiscovery;
  /** Uploaded product docs (name + decoded size only — raw files are never
   *  persisted). */
  qaDocs?: Array<{ name: string; chars: number }>;
  /** Condensed documentation text the planner treats as authoritative for
   *  intended behavior. Capped (see src/lib/qa-agent/docs.ts). */
  qaDocsDigest?: string;
  /** The structured test plan produced by the planner subagent. */
  qaPlan?: QaTestPlan;
  /** User feedback captured on "request changes" — fed to the planner rerun. */
  qaPlannerFeedback?: string;
  /** Plain-language journeys the user added at the review gate. Refined by AI
   *  into structured journeys + covering items and merged into qaPlan; kept for
   *  provenance and so refresh/rerun paths preserve human-supplied intent. */
  qaUserJourneys?: string[];
  /** Per-plan-item generation/execution status ledger. */
  qaGeneratedTests?: QaGeneratedTest[];
  /** Test-run ids started by the execute/heal phases. */
  qaRunIds?: string[];
  /** Final coverage/traceability summary. */
  qaSummary?: QaSummaryData;
  /** Task from the direction queue this session is working (dispatcher-run). */
  qaTaskId?: string;
  /** Task-scoped runs: the plan item ids the directive resolved to. When set,
   *  qa_generate considers ONLY these items — the rest of the stored plan is
   *  context, not work — so execute/heal/reply stay scoped to the directive. */
  qaTaskItemIds?: string[];
  /** How the dispatcher routed the directive (targeted vs explore) + why. */
  qaTaskTriage?: QaTaskTriage;
  /** What started this session — powers the run-history provenance chip.
   *  Absent on sessions created before triggers existed = "manual". */
  qaTrigger?: QaSessionTrigger;
  /** Live App Map exploration state (mode = "explore"). */
  qaExplore?: QaExploreState;
  /** Free-text sign-in instructions from the Explore dialog ("Log in with
   *  demo@acme.com / hunter2, then tap Continue"). qa_login AI-extracts
   *  structured creds/loginUrl from it and feeds the existing cascade.
   *  Encrypted at rest (AES-256-GCM) via the agent-session query layer —
   *  the prose routinely contains a password. */
  qaAuthContext?: string;
  [key: string]: unknown;
}

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull(),
  teamId: text("team_id"),
  kind: text("kind").$type<AgentSessionKind>().notNull().default("play"),
  status: text("status")
    .$type<AgentSessionStatus>()
    .notNull()
    .default("active"),
  currentStepId: text("current_step_id").$type<AgentStepId>(),
  steps: jsonb("steps").$type<AgentStepState[]>().notNull(),
  metadata: jsonb("metadata").$type<AgentSessionMetadata>().notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  completedAt: timestamp("completed_at"),
});

export type AgentSession = typeof agentSessions.$inferSelect;

export type NewAgentSession = typeof agentSessions.$inferInsert;

// ── QA Agent tasks + triggers: moved ────────────────────────────────────────
//
// `qa_tasks` and `qa_agent_triggers` became `@lastest/plugin-qa-agent`'s own
// tables (RFC §9 phase 4, the last pseudo-plugin) — `qa_agent_tasks` and
// `qa_agent_triggers` in `plugins/qa-agent/src/schema.ts`, renamed/stripped of
// their FKs by `migrateQaAgentTables()` in `scripts/migrate.js` BEFORE
// `drizzle-kit push` runs (push cannot see a rename — recipe §2.4). The task
// types (`QaTaskStatus`/`QaTaskSource`/`QaTaskTestRef`) moved to the plugin's
// `types.ts`. `agent_sessions` above deliberately stays: a QA run's own state
// is a `kind = "qa"` row here, reached through `QaAgentHost` — see that
// file's item 1 for why the shared field-name-keyed metadata encryption keeps
// this table shared between the quickstart and qa-agent plugins.
