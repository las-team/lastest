import type { CompareResult, TreeEntry } from "@lastest/github";
import type {
  ApiTestDefinition,
  QaGeneratedTestStatus,
  QaRunMode,
  QaTestGroup,
} from "@lastest/eb-protocol";

import type {
  QaAgentRole,
  QaPlaywrightOverrides,
  QaSessionMetadata,
  QaSessionRow,
  QaSessionStatus,
  QaSetupOverrides,
  QaStepId,
  QaStepState,
} from "./types";

/**
 * The core surface QA Agent needs and core does not have yet.
 *
 * **Read this file first.** At **29 methods** it edges out `quickstart`'s 28
 * (the previous largest) as the widest port in the repo, and for the same
 * reason quickstart's was defensible: recipe
 * §1.5's stop line ("> ~15, the port would be bigger than the feature") is
 * about a port dwarfing its feature, and this one does not — what stays in
 * `plugins/qa-agent/src/actions.ts` after the port is declared is the entire
 * nine-phase orchestrator (the login-resolution cascade, the discovery
 * swarm's shared-frontier claim protocol, coverage-aware planning, the
 * review gate, the generation/heal loops, the direction-queue dispatcher and
 * its triage protocols) plus ~2,700 lines of UI. The port is this large
 * because the *feature* is: an end-to-end suite builder that touches nearly
 * every other subsystem on purpose. Below is the grouping recipe §1.5 asks
 * for — **12 items, not 29 unrelated reads** — with each item's honest
 * future. Methods marked *(verbatim: <plugin>)* already exist in another
 * plugin's port with the same shape; per recipe §1.5 that repetition is the
 * argument for the core capability that retires them.
 *
 * 1. **Session CRUD** (`createSession`…`getRecentSessions`, 5 methods).
 *    QA runs are `agent_sessions` rows (`kind: "qa"`) — the shared
 *    polymorphic table `explorer`/`ranger` left and `quickstart` deliberately
 *    did not (see `plugins/quickstart/src/host.ts` item 2, which names THIS
 *    plugin as the reason). The constraint is symmetric: QA's
 *    `quickstartEmail`/`quickstartPassword`/`qaAuthContext` metadata fields
 *    are encrypted at rest by core's query layer *by field name, across the
 *    whole table* (`crypto-fields.ts`; `scripts/rotate-encryption-key.ts`
 *    rotates them), and the field names are shared with QuickStart's
 *    `kind: "quickstart"` rows by core's own schema comment. Splitting onto
 *    a plugin table would fork that encryption path or ship this copy
 *    unencrypted. The debt clears only when BOTH agents move together, onto
 *    a core credential capability — that is a core PR, not a migration.
 *    (verbatim: quickstart — its 4 session methods plus a recent-sessions
 *    read only this plugin needs for run-history seeding.)
 * 2. **Run-minute quota** (`assertRunMinutesAvailable`, 1). The claim path
 *    inside `ctx.browser` meters and enforces run minutes too; this is the
 *    *pre-flight* check that lets `startQaAgent` refuse (and a trigger skip)
 *    before a nine-phase pipeline starts, rather than fail at the first
 *    claim minutes in. Honest future: a `BrowserCapability`/entitlements
 *    read.
 * 3. **SSRF guard** (`checkOutboundUrl`, 1). The FOURTH declaration of the
 *    same boundary, after `explorer.assertSafeOutboundUrl`,
 *    `app-map.fetchSitemapXml` and `api-test.fetchGuarded` — the
 *    `core/security` PR the recipe has been asking for since `api-test`
 *    retires all four at once. Shaped as check-and-report rather than
 *    re-exported assert (§3.1): the plugin never holds the guard *and* a
 *    fetch it could skip it for.
 * 4. **Test CRUD** (`createTest`, `updateTestCode`, `listTests`,
 *    `getOrCreateFunctionalArea`, `getAuthSetupCode`, 5). Same shape and
 *    same reasoning as `api-test`'s and `quickstart`'s item 3:
 *    `ctx.tests.createQuarantined` deliberately cannot express an
 *    un-quarantined write with code, per-layer overrides, an
 *    `apiDefinition` and bot attribution, and `listCoverage` returns no test
 *    ids — which the coverage matcher keys on. The write guard lives inside
 *    the host method (§3.1). `createTest` always attributes to the
 *    `play_agent` bot host-side; the plugin cannot forge authorship.
 * 5. **Execution** (`startRun`, `isRunSettled`, `getLatestResultStatus`, 3).
 *    "The feature needs a build/execution capability nothing has built yet"
 *    — the exact gap `quickstart`'s item 6 named. `startRun` wraps the app's
 *    `runTestsCore` (headless, pool-queued when busy); the other two are the
 *    polling loop's reads.
 * 6. **Storage states / auth resolution** (`persistStorageState`,
 *    `captureStorageState`, `resolveExistingAuth`, 3). `captureStorageState`
 *    is `src/lib/core/quickstart-storage-shared.ts` — the shared
 *    composition-root module `quickstart`'s migration created *for this
 *    plugin* (its §4/§11); both hosts now call the same file and the
 *    "re-examine when qa-agent lands" note there is resolved: it stays
 *    shared, now between two packaged plugins' hosts (verbatim:
 *    quickstart). `resolveExistingAuth` is
 *    `src/lib/core/auth-setup-resolution.ts` (verbatim: explorer's
 *    `resolveExistingAuth` — second declaration; a `core/browser`
 *    credential-resolution capability retires both).
 * 7. **Repo/source facts** (`getRepoInfo`, `getStaticRoutes`,
 *    `getSourceAccess`, `getEnvironmentBaseUrl`, `getUserAgentOverride`,
 *    `getAiProviderName`, 6). Read-mostly configuration no capability
 *    covers: `ctx.repos.baseUrl` answers a question this plugin never asks
 *    (it needs provider/owner/branches for GitHub-aware discovery, not a
 *    deploy URL). `getSourceAccess` is the credential boundary: it returns
 *    *bound closures* over the team's GitHub token (tree, file content,
 *    branch diff, codebase intelligence) so the token itself never crosses
 *    into the package — the same "resolve the account host-side" rule
 *    `authoring-ai`'s host states. (`getAiProviderName` is quickstart's
 *    `hasAiProvider` widened to the name the preflight step reports.)
 * 8. **Team settings** (`getTeamEmailTemplate`, 1). (verbatim: quickstart —
 *    self-registration renders the same throwaway-account email template.)
 * 9. **Pool headroom** (`getEbPoolMax`, 1). The swarm sizes itself to
 *    `min(requested, poolMax − 5)` so builds keep headroom; the pool cap is
 *    the pool service's and arrives through settings core owns.
 * 10. **Activity** (`emitActivity`, 1, fire-and-forget). NOT `ctx.events` —
 *    the same finding as `quickstart` §3: the feed's UI keys agent badges on
 *    `sourceType: "qa_agent"` + a per-event `agentType`, which
 *    `plugins/events`' generic `emit()` cannot express. Preserves the exact
 *    pre-migration event shape, `promptLogId` link included.
 * 11. **Authoring sessions** (`withAuthoringSession`, 1). Crosses into
 *    `@lastest/plugin-authoring-ai` — an already-migrated package, so a
 *    direct import would be exactly the plugin→plugin edge RFC §3 forbids.
 *    Routed through the host the way `quickstart.publishShare` crosses into
 *    `share`: the composition root is where two features are allowed to
 *    meet. The generator/healer session type is *narrowed* here
 *    (`QaAuthoringSession`) rather than imported for the same reason.
 * 12. **Identity** (`currentActor`, 1). "Who is calling", for the task
 *    board's `created_by` attribution. The NINTH identity-shaped method
 *    across five plugins (`launch`/`playground`'s `resolveActor`,
 *    `gamification`'s four, `share`'s pair) — `core/identity` was already "a
 *    costed piece of work with a known payoff" at seven; this is two more
 *    data points for the same PR.
 */
export interface QaAgentHost {
  // ---- 1. Session CRUD (agent_sessions, kind: "qa") ------------------------
  createSession(input: CreateQaSessionInput): Promise<{ id: string }>;
  /** Resolves null for missing rows AND rows of another kind — the kind
   *  filter lives host-side so the plugin cannot read another agent's rows. */
  getSession(sessionId: string): Promise<QaSessionRow | null>;
  updateSession(sessionId: string, patch: QaSessionPatch): Promise<void>;
  /** Newest active/paused QA session for a repo (one-session-per-repo lock). */
  getActiveSession(repositoryId: string): Promise<{ id: string } | null>;
  /** Recent QA sessions, newest first, any status — run-history seeding
   *  (stored plan, credentials, target URL) and prior-ledger lookup. */
  getRecentSessions(
    repositoryId: string,
    limit: number,
  ): Promise<QaSessionRow[]>;

  // ---- 2. Run-minute quota -------------------------------------------------
  /** Throws the user-facing quota error when the team's monthly agent
   *  run-minutes are exhausted. */
  assertRunMinutesAvailable(teamId: string): Promise<void>;

  // ---- 3. SSRF guard -------------------------------------------------------
  /** `ok: false` for a policy rejection (private range, metadata IP, …);
   *  unexpected failures still throw. The plugin holds no fetch this could
   *  be skipped for — discovery browses through `ctx.browser`. */
  checkOutboundUrl(
    url: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;

  // ---- 4. Test CRUD --------------------------------------------------------
  /** Guarded write (repo must belong to the caller's team — asserted
   *  host-side); always attributed to the `play_agent` bot. */
  createTest(input: QaCreateTestInput): Promise<{ id: string }>;
  updateTestCode(testId: string, code: string): Promise<void>;
  /** Live tests with resolved area names — the coverage matcher's and
   *  planner's view of what already exists. */
  listTests(repositoryId: string): Promise<QaTestSummary[]>;
  getOrCreateFunctionalArea(
    repositoryId: string,
    name: string,
  ): Promise<{ id: string }>;
  /** Code of an existing setup test or script (qa_login runs it to mint a
   *  fresh session). Null when the row is gone or has no code. */
  getAuthSetupCode(ref: {
    testId?: string;
    scriptId?: string;
  }): Promise<string | null>;

  // ---- 5. Execution --------------------------------------------------------
  /** Start a headless run of the given tests. `runId: null` + `jobId` means
   *  the pool was busy and the run queued as a background job. */
  startRun(
    repositoryId: string,
    testIds: string[],
  ): Promise<{ runId: string | null; jobId?: string }>;
  /** Whether the run (or its queued background job) has left the running
   *  states — the execute/heal polling loop's single read. */
  isRunSettled(ref: { runId?: string; jobId?: string }): Promise<boolean>;
  /** Latest result status for a test; null when it has never run. */
  getLatestResultStatus(testId: string): Promise<"passed" | "failed" | null>;

  // ---- 6. Storage states / auth resolution ---------------------------------
  /** Persist a captured storage-state JSON (encrypted at rest by core). */
  persistStorageState(input: {
    repositoryId: string;
    name: string;
    storageStateJson: string;
  }): Promise<{ id: string }>;
  /** Run arbitrary setup/signup code in a disposable runner/EB and capture
   *  the resulting session. Never runs the code in-process. */
  captureStorageState(
    input: QaCaptureStorageStateInput,
  ): Promise<QaCaptureStorageStateResult>;
  /** What the repo's existing setup infrastructure offers for auth. */
  resolveExistingAuth(repositoryId: string): Promise<QaExistingAuthSetup>;

  // ---- 7. Repo / source facts ----------------------------------------------
  getRepoInfo(repositoryId: string): Promise<QaRepoInfo | null>;
  /** Known static routes: a prior scan's rows, else a fresh GitHub-tree scan
   *  when the repo is connected. Null when neither is available. */
  getStaticRoutes(repositoryId: string): Promise<{
    routes: Array<{ path: string; type: string }>;
    framework?: string;
  } | null>;
  /** Bound access to the repo's source on GitHub — closures over the team's
   *  token, which itself never crosses this boundary. Null when the repo is
   *  not a connected GitHub repo. */
  getSourceAccess(repositoryId: string): Promise<QaSourceAccess | null>;
  /** Environment-settings base URL fallback for trigger-started runs. */
  getEnvironmentBaseUrl(repositoryId: string): Promise<string | null>;
  /** Repo's Playwright user-agent override — crawls run on a core-claimed
   *  EB's existing context, so `newContext()` never applies it for them. */
  getUserAgentOverride(repositoryId: string): Promise<string | null>;
  /** Configured AI provider name, or null when none — the preflight check. */
  getAiProviderName(repositoryId: string): Promise<string | null>;

  // ---- 8. Team settings ----------------------------------------------------
  /** The team's throwaway-account email template, or the product default. */
  getTeamEmailTemplate(teamId: string): Promise<string>;

  // ---- 9. Pool headroom ----------------------------------------------------
  /** Global EB pool cap, or null when unset. */
  getEbPoolMax(): Promise<number | null>;

  // ---- 10. Activity --------------------------------------------------------
  /** Fire-and-forget. Never throws — failures are logged host-side. */
  emitActivity(evt: QaActivityEvent): void;

  // ---- 11. Authoring sessions (generation / healing) -----------------------
  /** Claim ONE Embedded Browser and run several generator/healer calls on it
   *  sequentially, via `@lastest/plugin-authoring-ai`. */
  withAuthoringSession<T>(
    repositoryId: string,
    claimOptions: QaAuthoringClaimOptions | undefined,
    fn: (session: QaAuthoringSession) => Promise<T>,
  ): Promise<T>;

  // ---- 12. Identity --------------------------------------------------------
  /** Who is calling — the session user filed on a task card
   *  (`created_by_id`/`created_by_name`). Null outside a session. */
  currentActor(): Promise<{
    id: string;
    name: string | null;
    email: string | null;
  } | null>;
}

// ── Session shapes ───────────────────────────────────────────────────────────

export interface CreateQaSessionInput {
  repositoryId: string;
  teamId: string;
  currentStepId: QaStepId;
  steps: QaStepState[];
  metadata: QaSessionMetadata;
}

export interface QaSessionPatch {
  status?: QaSessionStatus;
  currentStepId?: QaStepId;
  steps?: QaStepState[];
  metadata?: QaSessionMetadata;
  completedAt?: Date;
}

// ── Test shapes ──────────────────────────────────────────────────────────────

export interface QaTestSummary {
  id: string;
  name: string;
  testType: string | null;
  functionalAreaName: string | null;
}

/** The check-layer override object the generator writes — see
 *  `types.ts`'s `QaPlaywrightOverrides` for why it is narrowed. */
export interface QaCreateTestInput {
  repositoryId: string;
  name: string;
  code: string;
  targetUrl?: string;
  functionalAreaId?: string;
  testType?: "api";
  /** Headless API-test definition (method/url/assertions jsonb). */
  apiDefinition?: ApiTestDefinition;
  playwrightOverrides?: QaPlaywrightOverrides;
  setupOverrides?: QaSetupOverrides;
}

// ── Storage-state shapes ─────────────────────────────────────────────────────

export interface QaCaptureStorageStateInput {
  repositoryId: string;
  baseUrl: string;
  testCode: string;
  name: string;
}

export interface QaCaptureStorageStateResult {
  captured: boolean;
  storageStateId?: string;
  failureReason?: string;
  durationMs: number;
}

/** What the repo's existing setup infrastructure offers for auth — the shape
 *  of `src/lib/core/auth-setup-resolution.ts`'s `ExistingAuthSetup`, declared
 *  here so the plugin does not import app code; the host's implementation is
 *  the assignability assertion. */
export interface QaExistingAuthSetup {
  storageStateId?: string;
  storageStateName?: string;
  setupTestId?: string;
  setupScriptId?: string;
  setupStepName?: string;
  defaultSetupInUse: boolean;
}

// ── Repo / source shapes ─────────────────────────────────────────────────────

export interface QaRepoInfo {
  id: string;
  teamId: string | null;
  name: string | null;
  provider: string | null;
  owner: string | null;
  selectedBranch: string | null;
  defaultBranch: string | null;
  /** A GitHub account with a token exists for the team AND the repo is a
   *  GitHub repo with an owner — the repo-aware discovery switch. */
  githubConnected: boolean;
}

/** The slice of core's `CodebaseIntelligence` the planner digest reads. */
export interface QaCodebaseIntel {
  framework?: string;
  authMechanism?: string;
  apiLayer?: string;
  projectDescription?: string;
  keyDeps: Array<{ name: string; testingImplication: string }>;
  testingRecommendations: string[];
}

/**
 * Bound access to a connected repo's source. Every closure carries the
 * team's GitHub token internally; the token is never a return value. All
 * throw on API failure — call sites keep their pre-migration `.catch(() =>
 * null)` degradation.
 */
export interface QaSourceAccess {
  /** Branch under test (repo's selected branch, else default, else main). */
  branch: string;
  /** The diff baseline (repo's default branch, else main). */
  baseBranch: string;
  gatherIntelligence(): Promise<QaCodebaseIntel>;
  getRepoTree(): Promise<TreeEntry[]>;
  /** Null when the blob cannot be fetched — the shape
   *  `extractDeclaredEndpoints`' content callback already accepts. */
  getFileContent(path: string): Promise<string | null>;
  /** `baseBranch...branch` comparison; null when branch === baseBranch. */
  compareBranches(): Promise<CompareResult | null>;
}

// ── Activity shape ───────────────────────────────────────────────────────────

/** The `activity_events.event_type` values this pipeline emits — a narrowed
 *  slice of core's `ActivityEventType` union; the host asserts assignability. */
export type QaActivityEventType =
  | "session:start"
  | "session:complete"
  | "session:error"
  | "step:start"
  | "step:complete"
  | "substep:update"
  | "artifact:created"
  | "map:page_discovered"
  | "map:explorer_status"
  | "map:blocked"
  | "task:created"
  | "task:started"
  | "task:triaged"
  | "task:completed"
  | "task:failed";

export interface QaActivityEvent {
  teamId: string;
  repositoryId: string;
  sessionId: string;
  eventType: QaActivityEventType;
  summary: string;
  stepId?: string;
  /** Which sub-agent produced it — keys the feed's badge rendering. */
  agentType?: QaAgentRole;
  detail?: Record<string, unknown>;
  artifactType?: "test" | "build";
  artifactId?: string;
  artifactLabel?: string;
  durationMs?: number;
  /** ai_prompt_logs id when the event was produced by an AI call. */
  promptLogId?: string;
}

// ── Authoring-session shapes (narrowed from @lastest/plugin-authoring-ai) ────

export interface QaAuthoringClaimOptions {
  storageStateId?: string;
  onQueued?: () => void;
  onSessionReady?: (streamUrl: string | null) => void;
}

/** The generator/healer surface of `AuthoringAiSession`, narrowed — a plugin
 *  may not import another plugin's types. `src/lib/core/qa-agent-host.ts`'s
 *  pass-through is the assignability assertion. */
export interface QaAuthoringSession {
  createTest(
    generatorContext: {
      testName?: string;
      baseUrl?: string;
      routePath?: string;
      preAuthenticated?: boolean;
      userPrompt?: string;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; code?: string; error?: string }>;
  healTest(
    testId: string,
    options?: { signal?: AbortSignal; intent?: string },
  ): Promise<{ success: boolean; code?: string; error?: string }>;
}

// Re-exported so `src/lib/core/qa-agent-host.ts` can type its ledger fields
// without reaching for eb-protocol directly.
export type { QaGeneratedTestStatus, QaRunMode, QaTestGroup };
