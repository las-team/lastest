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

import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

export type AgentSessionKind = "play" | "quickstart" | "ranger" | "qa";

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
  | "qa_summary";

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

/** Coverage groups the QA agent plans and generates tests for. Mirrors the
 *  industry-standard suite tiers (smoke/regression) and coverage angles
 *  (a11y/perf/resilience/negative); `journey` is the business-outcome E2E
 *  tier (e.g. "an order is actually placed") and is always planned. */
export type QaTestGroup =
  | "smoke"
  | "api"
  | "ui"
  | "hybrid"
  | "a11y"
  | "perf"
  | "resilience"
  | "negative"
  | "journey";

export type QaPriority = "P1" | "P2" | "P3";

/** How the qa_login step resolved authentication for the run. */
export type QaAuthStrategy =
  /** Repo setup infrastructure reused (default setup steps / storage state). */
  | "existing_setup"
  /** User-provided credentials verified on the EB; storage state captured. */
  | "user_creds"
  /** The agent registered its own throwaway account and captured a session. */
  | "self_registered"
  /** Credentials exist but could not be verified — discovery tests them inline. */
  | "creds_untested"
  /** No auth resolvable — public surface only (discovery maps the auth pages). */
  | "public_only";

/** Outcome of the qa_login resolution cascade. Holds no secrets — registered
 *  credentials go into quickstartEmail/quickstartPassword (encrypted at rest). */
export interface QaAuthState {
  strategy: QaAuthStrategy;
  /** The authed heuristic was confirmed live on an EB (no password field,
   *  final URL not an auth page). False = deferred to discovery/execution. */
  validated: boolean;
  storageStateId?: string;
  /** Login/signup setup test created or found for reuse via setupOverrides. */
  setupTestId?: string;
  /** Repo default setup steps already cover auth — generated tests must NOT
   *  add extraSteps (the executor applies defaults to every test already). */
  defaultSetupInUse?: boolean;
  /** Observed in the target app's DOM — never URL-guessed. */
  loginUrl?: string;
  /** Observed in the target app's DOM — never URL-guessed. */
  signupUrl?: string;
  registeredEmail?: string;
  notes?: string;
}

/** A critical user journey with a verifiable business outcome. */
export interface QaPlanJourney {
  id: string;
  title: string;
  priority: QaPriority;
  /** Ordered user-visible steps of the journey. */
  steps: string[];
  /** Business/functional domain of the journey (matrix axis). */
  businessArea?: string;
  /** The business outcome this journey must produce (e.g. "order placed"). */
  businessOutcome: string;
  /** How the outcome is proven beyond UI toasts (end-state via API/data/UI). */
  endStateVerification: string;
}

/** One planned test case. `scenario` is generator-ready prose (steps +
 *  expected results); `api` is set for api-group items and drives a headless
 *  ApiTestDefinition instead of a browser test. */
export interface QaPlanItem {
  id: string;
  /** Primary group — drives functional-area assignment and legacy plans. */
  group: QaTestGroup;
  /** All coverage groups this single test satisfies (primary first). One
   *  test execution runs every check layer, so a page visit can serve
   *  smoke+ui+a11y+perf at once. Absent = [group] (legacy plans). */
  groups?: QaTestGroup[];
  title: string;
  priority: QaPriority;
  /** Traceability link to the journey this test covers, when applicable. */
  journeyId?: string;
  /** Business/functional domain this item exercises (e.g. "Authentication",
   *  "Checkout") — one axis of the coverage matrix. Missing values roll up
   *  under "General". */
  businessArea?: string;
  /** Route/page under test, relative to the target base URL. */
  pagePath?: string;
  rationale?: string;
  scenario: string;
  /** Verified selectors from discovery the generator should prefer. */
  selectorHints?: string[];
  /** Exact ref strings from the branch-diff digest this item covers (symbol
   *  names, "METHOD /path" endpoints, file paths) — drives PR coverage. */
  changeRefs?: string[];
  /** Set at plan time when a pre-existing test already covers this item
   *  (matchPlanToExistingTests) — the review UI shows what already exists. */
  existingTestId?: string;
  existingTestName?: string;
  api?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    expectedStatus?: number;
    body?: unknown;
    description?: string;
  };
  /** User can exclude items during plan review. Absent = enabled. */
  enabled?: boolean;
}

export interface QaTestPlan {
  appProfile: {
    summary: string;
    businessDomain?: string;
    /** The single most valuable business outcome of the app. */
    primaryOutcome?: string;
  };
  journeys: QaPlanJourney[];
  items: QaPlanItem[];
  entryCriteria?: string[];
  exitCriteria?: string[];
  risks?: string[];
}

/** One live-crawled page: rendered-DOM facts + same-origin API endpoints
 *  observed while the page loaded. Fed (condensed) to the planner. */
export interface QaPageSnapshot {
  url: string;
  finalUrl: string;
  title: string | null;
  headings: Array<{ level: number; text: string }>;
  forms: Array<{
    name: string | null;
    action: string | null;
    method: string;
    inputs: Array<{
      tag: string;
      type: string | null;
      name: string | null;
      id: string | null;
      label: string | null;
    }>;
  }>;
  buttons: string[];
  links: Array<{ text: string; href: string }>;
  testIds: string[];
  candidateSelectors: string[];
  apiEndpoints: Array<{ method: string; path: string; status: number }>;
  /** Console errors observed while this page loaded — surfaces third-party /
   *  analytics noise so the planner can route-block it or downgrade the
   *  console check layer (the executor reds on ANY console error otherwise). */
  consoleErrors?: string[];
}

/** One file changed on the working branch vs the base branch. */
export interface QaPrChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  previousPath?: string;
}

/** A function/class/component the branch diff added or modified — extracted
 *  deterministically from diff hunks (src/lib/qa-agent/pr-check). */
export interface QaPrSymbol {
  name: string;
  kind: "function" | "component" | "class" | "endpoint";
  file: string;
  change: "added" | "modified";
}

/** An API endpoint whose route file the branch diff touched. */
export interface QaPrEndpoint {
  method: string;
  path: string;
  file: string;
  change: "added" | "modified" | "removed";
}

/** Branch/PR diff facts (head vs base) feeding the planner + coverage report. */
export interface QaPrChanges {
  baseBranch: string;
  headBranch: string;
  files: QaPrChangedFile[];
  symbols: QaPrSymbol[];
  endpoints: QaPrEndpoint[];
  /** True when file/symbol caps dropped part of the diff. */
  truncated?: boolean;
}

/** Coverage verdict for one branch change (symbol/endpoint) in the summary. */
export interface QaPrCoverageEntry {
  /** Ref string as listed in the digest ("createInvoice", "POST /api/x"). */
  ref: string;
  kind: "symbol" | "endpoint";
  file: string;
  change: "added" | "modified" | "removed";
  planItemIds: string[];
  testIds: string[];
  status: "passed" | "covered" | "generated" | "planned" | "uncovered";
}

export interface QaPrCoverage {
  baseBranch: string;
  headBranch: string;
  /** Entries with a live test (passed/covered/generated). */
  coveredCount: number;
  entries: QaPrCoverageEntry[];
}

export interface QaDiscovery {
  targetUrl: string;
  crawledPages: QaPageSnapshot[];
  /** Routes from the static GitHub-tree scan (repo-aware mode only). */
  staticRoutes?: Array<{ path: string; type: string }>;
  framework?: string;
  githubConnected: boolean;
  /** Branch the static scan + code check analyzed (the repo's selected
   *  branch, falling back to its default branch). */
  branch?: string;
  /** Base branch for the PR diff (the repo's default branch). branch ===
   *  baseBranch means the run analyzed the base itself — no diff exists. */
  baseBranch?: string;
  /** Code-check output (repo-aware mode): stack facts, testing implications,
   *  and API endpoints declared in code. Shape in src/lib/qa-agent/code-check. */
  codeCheck?: {
    framework?: string;
    authMechanism?: string;
    apiLayer?: string;
    projectDescription?: string;
    testingNotes: string[];
    declaredEndpoints: Array<{ method: string; path: string; file: string }>;
  };
  /** Branch diff vs the base branch (repo-aware mode, head ≠ base): the
   *  functions/endpoints this branch adds or changes. Feeds the planner
   *  ("cover these") and the summary's PR coverage report. */
  prChanges?: QaPrChanges;
}

/** How a QA session runs. `full` is the complete pipeline; `refresh_spec`
 *  re-discovers the app and re-plans against existing coverage (no
 *  generation); `fill_gaps` takes the latest plan and generates only the
 *  items not already covered by a live test; `explore` maps the app for the
 *  App Map (setup → login → discover only — no plan/generation). */
export type QaRunMode = "full" | "refresh_spec" | "fill_gaps" | "explore";

// ── App Map Explore (mode = "explore") ───────────────────────────────────────

/** How the explore frontier orders undiscovered pages. */
export type ExploreStrategy = "breadth" | "depth" | "balanced";

/** User-chosen parameters from the App Map "Explore app" dialog. All jsonb —
 *  no migration needed. */
export interface QaExploreConfig {
  /** Requested explorer (EB) count. Capped by the plan's `maxExplorers`. */
  explorers: number;
  /** Crawl depth 1–6 (link hops from the entry URL). */
  depth: number;
  strategy: ExploreStrategy;
  /** Wall-clock budget in minutes. */
  maxMinutes: number;
  /** Page budget derived from depth (`6 + depth*5`, capped at 40). */
  pageBudget: number;
}

/** Live status of one explorer in the swarm (progress-panel card). */
export interface QaExplorerState {
  index: number;
  status: "claiming" | "exploring" | "blocked" | "done" | "failed";
  pagesMapped: number;
  currentUrl?: string;
  /** Proxied EB screencast URL while this explorer holds an EB. */
  streamUrl?: string;
  detail?: string;
}

/** A frontier entry the exploration could not get past. */
export interface QaExploreBlocked {
  url: string;
  reason: "auth_wall" | "dead_end";
}

/** Aggregate live explore state (metadata.qaExplore) — written throttled
 *  during the run, polled by the App Map progress UI. */
export interface QaExploreState {
  config: QaExploreConfig;
  explorers: QaExplorerState[];
  pagesDiscovered: number;
  blocked: QaExploreBlocked[];
  startedAt: string;
  deadlineAt: string;
}

/** What started a QA session. `schedule`/`pr`/`mcp` are reserved for the
 *  trigger phases (cron, PR webhook, MCP control). */
export type QaSessionTrigger =
  | "manual"
  | "task"
  | "rerun"
  | "schedule"
  | "pr"
  | "mcp";

export type QaGeneratedTestStatus =
  | "generating"
  | "generated"
  | "generation_failed"
  /** Matched to a pre-existing test (from a prior run or manual authoring) —
   *  generation skipped, `testId` points at that test. */
  | "covered"
  | "passed"
  | "failed"
  | "healed";

export interface QaGeneratedTest {
  planItemId: string;
  group: QaTestGroup;
  /** All coverage groups of the source plan item (primary first). */
  groups?: QaTestGroup[];
  /** Absent when generation failed before a test row was created. */
  testId?: string;
  name: string;
  status: QaGeneratedTestStatus;
  error?: string;
}

/** The task dispatcher's routing decision for a Direct-the-agent directive.
 *  Stored on the session for provenance; `promptLogId` links to the
 *  ai_prompt_logs row holding the exact triage prompt + response. */
export interface QaTaskTriage {
  scope: "targeted" | "explore";
  reason: string;
  promptLogId?: string;
}

/** One cell of the business-area × test-group coverage matrix. */
export interface QaMatrixCell {
  planned: number;
  /** Plan items satisfied by pre-existing tests. */
  covered: number;
  generated: number;
  /** Passing among covered+generated is not knowable for covered (they run
   *  in normal builds) — `passed` counts this run's passing tests only. */
  passed: number;
}

export interface QaSummaryData {
  planned: number;
  generated: number;
  /** Plan items satisfied by pre-existing tests (no generation needed). */
  covered: number;
  passed: number;
  failed: number;
  healed: number;
  byGroup: Partial<
    Record<
      QaTestGroup,
      { planned: number; generated: number; covered: number; passed: number }
    >
  >;
  /** Coverage matrix: business area → test group → cell. Areas come from
   *  QaPlanItem.businessArea ("General" when unset). */
  matrix?: Record<string, Partial<Record<QaTestGroup, QaMatrixCell>>>;
  /** journeyId → testIds covering it (traceability matrix). */
  journeyCoverage: Record<string, string[]>;
  /** Per-change coverage of the branch diff (repo-aware runs on a branch). */
  prCoverage?: QaPrCoverage;
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

// ── QA Agent Tasks (direction queue for the ongoing QA agent) ───────────────

export type QaTaskStatus =
  | "queued"
  | "working"
  /** The agent finished abnormally (failed/cancelled run) and left a reply —
   *  the human decides whether to retry (→ queued) or drop (→ cancelled). */
  | "needs_input"
  | "done"
  | "cancelled";

export type QaTaskSource = "user" | "mcp" | "coverage_gap";

/** A test the task's run touched — rendered as a linked chip on the board
 *  card when the task settles. `status` is the ledger outcome at settle time
 *  (passed/healed/failed/generated/covered). */
export interface QaTaskTestRef {
  testId: string;
  name: string;
  status: QaGeneratedTestStatus;
}

/** A directive dropped into the QA agent's queue ("test the billing flow",
 *  "increase Dashboard a11y coverage"). The dispatcher picks tasks up oldest
 *  first whenever no QA session is active, runs a task-scoped session, writes
 *  the agent's reply back, and advances the status — the /qa-agent task board
 *  renders these as kanban columns. */
export const qaTasks = pgTable(
  "qa_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: text("repository_id")
      .references(() => repositories.id, { onDelete: "cascade" })
      .notNull(),
    teamId: text("team_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<QaTaskStatus>().notNull().default("queued"),
    source: text("source").$type<QaTaskSource>().notNull().default("user"),
    /** Display name of who filed it (user name or MCP client name). */
    createdByName: text("created_by_name"),
    createdById: text("created_by_id"),
    /** Agent session that is working (or worked) this task. */
    sessionId: text("session_id"),
    /** The agent's reply when it finishes — or why it needs input. */
    agentReply: text("agent_reply"),
    /** Tests the run generated/healed/matched for this task — board chips. */
    tests: jsonb("tests").$type<QaTaskTestRef[]>(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("idx_qa_tasks_repo_status").on(table.repositoryId, table.status),
  ],
);

export type QaTask = typeof qaTasks.$inferSelect;

export type NewQaTask = typeof qaTasks.$inferInsert;

/** Per-repo automation config for the QA agent: an optional cron schedule and
 *  an optional PR-webhook trigger. One row per repository; both triggers start
 *  autonomous sessions (review gate auto-approved) and are skipped with an
 *  activity event when a session is already running. */
export const qaAgentTriggers = pgTable("qa_agent_triggers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositoryId: text("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  teamId: text("team_id").notNull(),
  /** Cron schedule (5-field expression, UTC). */
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  cronExpression: text("cron_expression"),
  scheduleMode: text("schedule_mode")
    .$type<QaRunMode>()
    .notNull()
    .default("fill_gaps"),
  /** Run on PR opened/synchronize webhooks. */
  prEnabled: boolean("pr_enabled").notNull().default(false),
  prMode: text("pr_mode").$type<QaRunMode>().notNull().default("refresh_spec"),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastSessionId: text("last_session_id"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

export type QaAgentTrigger = typeof qaAgentTriggers.$inferSelect;

export type NewQaAgentTrigger = typeof qaAgentTriggers.$inferInsert;
