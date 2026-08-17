import type {
  QuickstartAuthedScout,
  QuickstartDemoNotes,
  QuickstartPublicScout,
  QuickstartSessionMetadata,
  QuickstartSessionRow,
  QuickstartStepState,
} from "./types";

/**
 * The core surface QuickStart needs and core does not have yet.
 *
 * **Read this file first.** It is the largest host port migrated so far —
 * larger than `share`'s 14, the previous high-water mark — and recipe §1.5's
 * stop line is "> ~15, the port would be bigger than the feature." This one
 * is not: what stays in `plugins/quickstart/src/actions.ts` after this port
 * is declared is still the entire nine-step orchestrator's control flow (the
 * auth-mode decision tree, the credential-vs-throwaway-account branch, the
 * storage-state reuse window, the auth-chain-failure downgrade-and-rerun,
 * the share-readiness quality gate) plus gating and the full UI. The port is
 * this large because the *feature* is: QuickStart is an end-to-end demo
 * pipeline that touches nearly every other subsystem in the product on
 * purpose (tests, builds, diffs, storage states, shares, activity events).
 * Below is the grouping recipe §1.5 asks for — **9 items, not 30-odd
 * unrelated reads** — with each item's honest future.
 *
 * 1. **Gating/settings** (`getRepoGateInfo`…`saveBranchBaseUrl`, 6 methods).
 *    Read-mostly repo/team configuration no capability covers today.
 *    `ReposCapability.baseUrl()` was checked and does not fit —
 *    `pickRepoBaseUrl`'s branch-priority order (default branch, then
 *    comparison-baseline branch, then any other, explicitly never the legacy
 *    `"default"` key) and its localhost exclusion are QuickStart's own
 *    business rules, not core's, so this stays a host read of the raw
 *    fields rather than a capability call. A `core/repos` widening (a
 *    `settings()` method) is the natural future home.
 *
 * 2. **Session CRUD** (`createSession`…`getActiveSession`, 4 methods).
 *    QuickStart's rows are `agent_sessions` (`kind: "quickstart"`) — the
 *    same polymorphic table `explorer` and `ranger` already left behind by
 *    getting their own `<id>_sessions` table. QuickStart does **not** follow
 *    that precedent, and that is a deliberate deviation, not an oversight:
 *    two of its metadata fields (`quickstartEmail`/`quickstartPassword`) are
 *    *literally, deliberately* shared with the still-unmigrated `qa-agent`
 *    pseudo-plugin's own `kind: "qa"` rows (same field names, same
 *    encryption path — see `packages/db/src/schema/agents.ts`'s own comment
 *    on the column), and core's `crypto-fields.ts` encrypts by field name
 *    across the whole table regardless of `kind`. Splitting QuickStart onto
 *    its own table would mean either forking that encryption logic or
 *    shipping the split with QuickStart's copy unencrypted — a regression,
 *    not a cleanup. This debt item is inherited (the shared-table cost
 *    `ranger-migration-result.md` §1 named), and it does not clear until
 *    `qa-agent` migrates too — recipe §1.6.2's "blocked on that migration
 *    landing first," paid down in kind rather than in full.
 *
 * 3. **Test CRUD** (`createTest`, `getTest`, `updateTest`, 3 methods). Same
 *    shape and the same reasoning as `api-test`'s two: an *authored test* is
 *    a `tests` row, a core table with 24 inbound FKs, and `ctx.tests`
 *    (`createQuarantined`) cannot express an un-quarantined write or an
 *    update. The guard lives inside the host method, not beside it — see
 *    `src/lib/core/quickstart-host.ts`.
 *
 * 4. **Storage states** (`listStorageStates`…`captureStorageState`, 3
 *    methods). `captureStorageState` alone folds the ~150 lines that used to
 *    be `src/lib/quickstart/storage-capture.ts` — a disposable-runner claim
 *    with a direct-Chromium fallback for self-hosted installs with no EB
 *    pool at all. That fallback does not fit `ctx.browser.withBrowser`
 *    (which claims a *pooled* EB; the fallback exists for exactly the
 *    deployments where no pool exists) and is why `browser`/`pool-service`
 *    were 2 of QuickStart's 3 attributed violations in the pre-migration
 *    baseline. Both are gone: the code moved wholesale to
 *    `src/lib/core/quickstart-storage-shared.ts`, unchanged, which is also
 *    where `qa-agent.ts` now calls it from (recipe §1.6.2 — see that file's
 *    header).
 *
 * 5. **Scout — scaffolding, not a permanent seam** (`runPublicScout`,
 *    `runAuthedScout`, `claimScoutBrowser`, `releaseScoutBrowser`,
 *    `injectStorageState`, 5 methods). This is the item to read if you read
 *    only one. `src/lib/playwright/quickstart-scout.ts` hands a raw CDP
 *    endpoint to an out-of-process `@playwright/mcp` binary so the AI can
 *    drive the browser directly — structurally the identical shape that
 *    stopped `authoring-ai`'s migration outright
 *    (`authoring-ai-migration-result.md`): `core/contracts/src/browser.ts`'s
 *    `BrowserSession` documents, verbatim, that "notably absent is any way
 *    to obtain the CDP URL or the pod address," and no
 *    `AiCallOptions.browserTools`-shaped extension has been built. Unlike
 *    `authoring-ai`, this is not the *whole* feature — `quickstart-scout.ts`
 *    is 2 of QuickStart's 9 steps and ~16% of its lines — so rather than
 *    stopping the migration, the scout module **stays behind**,
 *    unmigrated, in `src/lib/playwright/`, and this group is the seam: five
 *    thin methods whose sole app-side implementation
 *    (`src/lib/core/quickstart-host.ts`) calls straight into the
 *    still-`@/`-rooted scout code and the raw-EB-claim dance
 *    (`claimEmbeddedBrowserForAgent`/`releasePoolEB`/`injectStorageStateIntoEb`)
 *    that used to live in `quickstart-agent.ts` itself. The plugin package
 *    never sees a CDP URL, a `Page`, or `playwright` — it awaits a typed
 *    result. This *doubles* the case for the `browserTools` core PR
 *    `authoring-ai-migration-result.md` asked for: it would now unblock two
 *    stalled migrations, not one.
 *
 * 6. **Build orchestration + notes evidence** (`startBuild`…
 *    `getRunFactsForBuild`, 6 methods). "The feature needs a build/execution
 *    capability nothing has built yet" — the same shape `app-map`'s "5 reads
 *    of one missing capability" named. `core/exec` is core (RFC §6.1) but
 *    has no capability surface today; these calls used to go straight to
 *    `src/server/actions/builds.ts`/`diffs.ts` (already core-classified,
 *    just not capability-shaped).
 *
 * 7. **Notes persistence** (`generateNotes`…`getLatestDemoNotesForRepo`, 4
 *    methods). `generateNotes` does **not** go through `ctx.ai` — see
 *    `src/lib/core/quickstart-notes-shared.ts`'s header for why: the same
 *    generation logic is also `demo`'s (a second, still-unmigrated
 *    pseudo-plugin's) own `generateNotesForBuild`, so it stays shared,
 *    app-level code both callers reach through a host method / a direct
 *    import respectively, rather than becoming something only a
 *    `PluginContext` can invoke. `ai_prompt_logs.action_type` attribution is
 *    therefore **unchanged** by this migration — still `"agent_discover"`,
 *    still outside `ai-capability.ts`'s `ACTION_TYPES` allowlist, exactly as
 *    before. `getBuildDemoNotes`/`upsertBuildDemoNotes`/
 *    `getLatestDemoNotesForRepo` read/write the core `build_demo_notes`
 *    table, which nothing else scopes to one feature (`share` reads it too).
 *
 * 8. **Activity** (`emitActivity`, 1 method, fire-and-forget). NOT
 *    `ctx.events` — see `index.ts`'s header for why the generic events
 *    capability is the wrong shape here (it cannot express the
 *    `sourceType: "play_agent"` / `agentType: "quickstart"` tagging the
 *    activity feed's UI keys its agent badges on) and preserves the original
 *    call shape exactly instead.
 *
 * 9. **Share** (`publishShare`, 1 method). Crosses into
 *    `@lastest/plugin-share` — an already-*migrated* real package, so a
 *    direct import from `plugins/quickstart` would be exactly the
 *    plugin→plugin edge RFC §3 forbids (recipe survey flagged this: pre-
 *    migration `quickstart-agent.ts` already imported
 *    `publishBuildShare` from `@lastest/plugin-share`, invisible to
 *    `pnpm arch`'s *current*-layout walker because it targets an
 *    already-packaged plugin, not a `PSEUDO_PLUGINS` entry — it would not
 *    have stayed invisible once QuickStart itself became a package). Routed
 *    through the host exactly like every other cross-plugin read
 *    (`share-reads.ts`/`awards-host.ts`), just a write this time.
 *    `resolveTestVideoUrl` needed no method at all — `@lastest/video-fallback`
 *    is a `libs/*` package already, so the plugin depends on it directly.
 */
export interface QuickstartHost {
  // ---- 1. Gating / settings --------------------------------------------
  getRepoGateInfo(repositoryId: string): Promise<QuickstartRepoGateInfo | null>;
  /** Resolves to the team's override, or the product default when unset. */
  getTeamEmailTemplate(teamId: string): Promise<string>;
  setTeamEmailTemplate(teamId: string, template: string): Promise<void>;
  hasAiProvider(repositoryId: string): Promise<boolean>;
  /** Best-effort; returns whether it actually applied. Never throws. */
  relaxErrorModesForDemo(repositoryId: string): Promise<boolean>;
  saveBranchBaseUrl(
    repositoryId: string,
    branch: string,
    baseUrl: string,
  ): Promise<void>;

  // ---- 2. Session CRUD (agent_sessions, kind: "quickstart") -------------
  createSession(input: CreateQuickstartSessionInput): Promise<{ id: string }>;
  /** `teamId`, when passed, is an ownership check baked into the read —
   *  mismatched rows resolve `null`, the same non-oracle shape
   *  `ReposCapability.baseUrl` uses. */
  getSession(
    sessionId: string,
    teamId?: string,
  ): Promise<QuickstartSessionRow | null>;
  updateSession(
    sessionId: string,
    patch: QuickstartSessionPatch,
  ): Promise<void>;
  getActiveSession(repositoryId: string): Promise<{ id: string } | null>;

  // ---- 3. Test CRUD -------------------------------------------------------
  createTest(input: QuickstartCreateTestInput): Promise<{ id: string }>;
  getTest(testId: string): Promise<{ id: string; code: string | null } | null>;
  updateTest(testId: string, patch: QuickstartUpdateTestInput): Promise<void>;

  // ---- 4. Storage states --------------------------------------------------
  listStorageStates(
    repositoryId: string,
  ): Promise<QuickstartStorageStateSummary[]>;
  getStorageStateJson(storageStateId: string): Promise<string | null>;
  captureStorageState(
    input: QuickstartCaptureStorageStateInput,
  ): Promise<QuickstartCaptureStorageStateResult>;

  // ---- 5. Scout (scaffolding — see header item 5) -------------------------
  claimScoutBrowser(onQueued: () => void): Promise<QuickstartScoutClaim>;
  releaseScoutBrowser(runnerId: string): Promise<void>;
  injectStorageState(
    cdpUrl: string,
    storageStateJson: string,
  ): Promise<boolean>;
  runPublicScout(
    repositoryId: string,
    baseUrl: string,
    cdpUrl: string,
  ): Promise<QuickstartScoutPublicRun>;
  runAuthedScout(
    repositoryId: string,
    baseUrl: string,
    authTestCode: string,
    opts: { cdpUrl: string; preAuthenticated: boolean },
  ): Promise<QuickstartScoutAuthedRun>;

  // ---- 6. Build orchestration + notes evidence ----------------------------
  startBuild(
    repositoryId: string,
    testIds: string[],
  ): Promise<QuickstartBuildStart>;
  getBuildSummary(buildId: string): Promise<QuickstartBuildSummary | null>;
  getBuildStreamUrl(buildId: string): Promise<string | undefined>;
  approveAllDiffs(
    buildId: string,
    actor: string,
  ): Promise<{ approvedCount: number }>;
  /** Masks run-to-run noise (animated heroes, timestamps) as ignore regions
   *  after baseline approval. Folds reading the diffs, resolving image paths,
   *  clustering pixel diffs and writing ignore regions into one call. */
  maskDemoNoiseRegions(buildId: string): Promise<number>;
  getRunFactsForBuild(buildId: string): Promise<QuickstartRunFacts>;

  // ---- 7. Notes persistence ------------------------------------------------
  generateNotes(
    input: QuickstartGenerateNotesInput,
  ): Promise<QuickstartDemoNotes>;
  getBuildDemoNotes(buildId: string): Promise<QuickstartDemoNotes | null>;
  upsertBuildDemoNotes(
    buildId: string,
    notes: QuickstartDemoNotes,
  ): Promise<void>;
  getLatestDemoNotesForRepo(
    repositoryId: string,
  ): Promise<QuickstartDemoNotes | null>;

  // ---- 8. Activity ----------------------------------------------------------
  /** Fire-and-forget. Never throws — failures are logged host-side. */
  emitActivity(evt: QuickstartActivityEvent): void;

  // ---- 9. Share -------------------------------------------------------------
  publishShare(
    buildId: string,
    opts: { scopedTestId: string; kind: "demo" },
  ): Promise<{ shareId: string; slug: string; url: string }>;
}

export interface QuickstartActivityEvent {
  teamId: string;
  repositoryId: string;
  sessionId: string;
  eventType:
    | "session:start"
    | "session:complete"
    | "session:error"
    | "step:start"
    | "step:complete"
    | "step:error"
    | "artifact:created";
  summary: string;
  stepId?: string;
  detail?: Record<string, unknown>;
  artifactType?: "test" | "build" | "area" | "baseline" | "score";
  artifactId?: string;
  artifactLabel?: string;
  durationMs?: number;
}

export interface QuickstartRepoGateInfo {
  readonly id: string;
  readonly name: string;
  readonly teamId: string | null;
  readonly defaultBranch: string | null;
  readonly comparisonBaselineBranch: string | null;
  readonly branchBaseUrls: Record<string, string> | null;
}

export interface CreateQuickstartSessionInput {
  repositoryId: string;
  teamId: string;
  currentStepId: string;
  steps: QuickstartStepState[];
  metadata: QuickstartSessionMetadata;
}

export interface QuickstartSessionPatch {
  status?: "active" | "paused" | "completed" | "failed" | "cancelled";
  currentStepId?: string;
  steps?: QuickstartStepState[];
  metadata?: QuickstartSessionMetadata;
  completedAt?: Date;
}

export interface QuickstartCreateTestInput {
  repositoryId: string;
  name: string;
  code: string;
  setupOverrides?: {
    skippedDefaultStepIds: string[];
    extraSteps: Array<{
      stepType: "test" | "script" | "storage_state";
      testId?: string | null;
      scriptId?: string | null;
      storageStateId?: string | null;
    }>;
  };
}

export interface QuickstartUpdateTestInput {
  code?: string;
  setupOverrides?: null;
}

export interface QuickstartStorageStateSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date | null;
  readonly expiresAt: Date | null;
}

export interface QuickstartCaptureStorageStateInput {
  repositoryId: string;
  baseUrl: string;
  testCode: string;
  name: string;
  tokenLocation?:
    | "cookie"
    | "localstorage"
    | "indexeddb"
    | "sessionstorage"
    | "unknown";
  authFlavor?: string;
}

export interface QuickstartCaptureStorageStateResult {
  captured: boolean;
  storageStateId?: string;
  failureReason?: string;
  durationMs: number;
}

export type QuickstartScoutClaim =
  | {
      claimed: true;
      runnerId: string;
      cdpUrl: string;
      streamUrl: string | undefined;
    }
  | { claimed: false; failureReason: string };

export interface QuickstartScoutPublicRun {
  data: QuickstartPublicScout;
  promptLogId?: string;
  retryCount: number;
}

export interface QuickstartScoutAuthedRun {
  data: QuickstartAuthedScout;
  promptLogId?: string;
  retryCount: number;
}

export type QuickstartBuildStart =
  | { started: true; buildId: string }
  | { started: false; error: string };

export interface QuickstartBuildSummary {
  readonly completedAt: Date | null;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly changesDetected: number;
}

export interface QuickstartRunFacts {
  testResults: Array<{
    testId: string | null;
    testName: string | null;
    status: string | null;
    errorMessage: string | null;
    consoleErrors: string[] | null;
    hasVideo: boolean;
    screenshotCount: number;
  }>;
  a11yTopRules: string[];
}

export interface QuickstartGenerateNotesInput {
  repositoryId: string;
  productName: string;
  publicScout?: QuickstartPublicScout;
  authedScout?: QuickstartAuthedScout;
  authSetup?: {
    testId?: string;
    storageStateId?: string;
    captured: boolean;
    failureReason?: string;
    mode?: "login" | "signup";
  };
  runFacts: {
    passedCount: number;
    failedCount: number;
    changesDetected: number;
    testNames: string[];
    consoleErrors: string[];
    failedSteps: Array<{ test: string; step: string; error: string }>;
    a11yTopRules?: string[];
  };
  authVerificationFailed?: boolean;
}
