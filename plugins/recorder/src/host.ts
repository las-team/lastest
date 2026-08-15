import type { Message } from "@lastest/eb-protocol";

import type { SelectorConfig } from "./types";

/**
 * The core surface the recorder needs and core does not have yet.
 *
 * **Read this file first if you are reviewing the migration.** Nineteen
 * methods, which is above recipe §1.5's "go" line on its own — but they
 * group into five debt items, not nineteen, and four of the five already
 * have a name:
 *
 * - **Ten methods are one missing capability: a runner-channel recording
 *   session.** `claimRunner`/`releaseRunner`/`sendCommand`/`getSession`/
 *   `createSession`/`clearSession`/`completeSession`/`getEvents`/
 *   `updateEventData`/`checkRunnerStillBusy` all wrap
 *   `src/app/api/ws/runner/route.ts`'s in-memory session map plus the
 *   `remote_recording_events` table (core, `schema/runs.ts`, alongside
 *   `runners`/`background_jobs`). Recording does not fit `ctx.browser`'s
 *   `withBrowser` model — the runner drives the page itself and streams
 *   events back over the runner WS channel for the duration of a
 *   human-paced session, not a short server-held Playwright `Page` — so
 *   there is nothing existing to reuse. That is the honest phase-5 backlog
 *   item this migration adds: a `RunnerChannelCapability` (or an extension
 *   of `ctx.browser`) that owns claim/session/command/event lifecycle the
 *   way `BrowserCapability` owns claim/release today.
 * - **Three methods are OCR**, unchanged from the pre-plugin
 *   `src/lib/ocr` facade (`ocrWarmup`/`ocrSleep`/`extractOcrText`). No other
 *   migrated plugin has needed OCR yet, so there is no existing capability
 *   to compare against — this is the first data point, not a duplicate.
 * - **Two methods are guarded writes** into the core `tests` table
 *   (`saveRecordedTest`, `updateRerecordedTest`) — the same shape
 *   `plugins/api-test`'s `createTest`/`updateTest` established: the
 *   authorization runs *inside* the host method, so the plugin has no other
 *   path to the table and cannot perform an unauthorized write by
 *   forgetting a guard.
 * - **One method is a data read** (`getPlaywrightSettings`) plus the
 *   setup-chain resolution it composes with (`resolveSetupSteps`) — two
 *   methods, one conceptual "what should this recording start with" read.
 * - **One method is a security boundary** (`fetchGuarded`), the SSRF guard
 *   on a tenant-typed URL for "Analyze before record". This is the
 *   **fourth** plugin to declare the same gap after `explorer`, `app-map`
 *   and `api-test` (and the fifth counting `ranger`'s narrower
 *   `assertSafeOutboundUrl`) — recipe §1.5's strongest signal that
 *   `core/security` is overdue, restated once more rather than bundled here
 *   (RFC §7.2).
 *
 * ### Where the authorization went
 *
 * Every method here is guarded on the host side
 * (`src/lib/core/recorder-host.ts`), the same way `api-test`'s are. The
 * plugin declares no `capabilities` and holds no `PluginContext` — recording
 * access is `requireCapability("recording:write")`, a team-session check
 * with no repo-ownership component (this is a pre-existing property of
 * `recording:write`, not something this migration introduced: the
 * pre-plugin `src/server/actions/recording.ts` had the same shape). Two
 * methods carry a narrower guard: `saveRecordedTest` requires
 * `tests:write` (repo-scoped when `repositoryId` is present), and
 * `updateRerecordedTest` requires test ownership.
 */

// ── Runner-channel recording session → a future `RunnerChannelCapability` ──

export interface RecordingEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: "preview" | "committed";
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
    selectorMatches?: Array<{ type: string; value: string; count: number }>;
    chosenSelector?: string;
    autoRepaired?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface RecordingEventUpdate {
  actionId: string;
  verified: boolean;
  selectorMatches?: Array<{ type: string; value: string; count: number }>;
  chosenSelector?: string;
  autoRepaired?: boolean;
  thumbnailPath?: string;
}

export interface RecordingSession {
  sessionId: string;
  runnerId: string;
  repositoryId: string | null;
  targetUrl: string;
  isRecording: boolean;
  events: RecordingEvent[];
  generatedCode: string | null;
  startedAt: Date;
  selectorPriority: SelectorConfig[];
  /** Opaque — the plugin passes it through to `saveRecordedTest`, never reads it. */
  domSnapshot?: unknown;
  errorMessage?: string | null;
  pendingEventUpdates?: RecordingEventUpdate[];
}

// ── Data: what a recording should start with ────────────────────────────────

export interface PlaywrightRecordingSettings {
  selectorPriority: SelectorConfig[];
  viewportWidth: number | null;
  viewportHeight: number | null;
  browser: string | null;
  pointerGestures: boolean | null;
  cursorFPS: number | null;
  selectorTimeoutMs: number | null;
  customAttributeName: string | null;
}

export interface SetupChainStep {
  stepType: "test" | "script" | "storage_state";
  testId?: string | null;
  scriptId?: string | null;
  storageStateId?: string | null;
}

export interface ResolvedSetupStep {
  code: string;
  codeHash: string;
}

/**
 * Structural copy of core's `functionalAreas` row (`packages/db/src/schema/tests.ts`).
 * Narrowed per recipe §6.1 — but *all* its columns, not just `id`/`name`,
 * because `recording-client.tsx` merges the result straight into a local
 * `FunctionalArea[]` list that the wider, core-typed area tree also renders.
 */
export interface FunctionalAreaRef {
  id: string;
  name: string;
  repositoryId: string | null;
  parentId: string | null;
  isRouteFolder: boolean | null;
  orderIndex: number | null;
  agentPlan: string | null;
  planGeneratedAt: Date | null;
  planSnapshot: string | null;
  deletedAt: Date | null;
}

// ── Guarded writes into the core `tests` table ──────────────────────────────

export interface SaveRecordedTestInput {
  name: string;
  functionalAreaId: string | null;
  targetUrl: string;
  code: string;
  repositoryId?: string | null;
  requiredCapabilities?: {
    fileUpload?: boolean;
    clipboard?: boolean;
    networkInterception?: boolean;
    downloads?: boolean;
  } | null;
  viewportWidth?: number;
  viewportHeight?: number;
  extraSetupSteps?: Array<{
    stepType: "test" | "script";
    testId?: string | null;
    scriptId?: string | null;
  }>;
  skippedDefaultStepIds?: string[];
  domSnapshot?: unknown;
}

export interface UpdateRerecordedTestInput {
  testId: string;
  code: string;
  targetUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

// ── Security boundary → `core/security` (recipe §1.5, fourth declaration) ──

export interface GuardedFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

export type GuardedFetchResult =
  | { ok: true; status: number; contentType: string | null; text: string }
  | { ok: false; error: string; blocked?: boolean };

export interface RecorderHost {
  /**
   * The team-session guard every recording action opens with
   * (`requireCapability("recording:write")` pre-plugin). One shared method
   * rather than one baked into every session/OCR/settings method below,
   * because those are reads and in-memory session bookkeeping with nothing
   * to authorize *differently* per call — the plugin calls this once per
   * action, mirroring exactly where the pre-plugin code called
   * `requireCapability`. `saveRecordedTest` and `updateRerecordedTest` are
   * the exception: they carry their own guard (repo `tests:write` / test
   * ownership) because they write into a table this method's check does not
   * cover.
   */
  requireRecordingAccess(): Promise<void>;

  // Runner-channel session
  claimRunner(): Promise<{ runnerId: string } | null>;
  releaseRunner(runnerId: string): Promise<void>;
  sendCommand(runnerId: string, message: Message): Promise<void>;
  createSession(input: {
    sessionId: string;
    runnerId: string;
    repositoryId: string | null;
    targetUrl: string;
    selectorPriority: SelectorConfig[];
  }): void;
  getSession(repositoryId?: string | null): RecordingSession | null;
  clearSession(repositoryId?: string | null): Promise<void>;
  completeSession(
    repositoryId: string | null | undefined,
    generatedCode: string | undefined,
  ): void;
  /** Merged same-pod in-memory + DB-forwarded events, deduped by sequence. */
  getEvents(
    repositoryId?: string | null,
    sinceSequence?: number,
  ): Promise<RecordingEvent[]>;
  /** Write OCR-touched event `data` back to `remote_recording_events`. */
  updateEventData(
    sessionId: string,
    events: Array<{ sequence: number; data: Record<string, unknown> }>,
  ): Promise<void>;
  /**
   * Cross-pod fallback for `getRecordingStatus` when this pod has no
   * in-memory session: is the runner still busy, and what DB-forwarded
   * events exist for the hinted session.
   */
  checkRunnerStillBusy(
    runnerId: string,
    sessionId?: string,
    sinceSequence?: number,
  ): Promise<{ stillBusy: boolean; events: RecordingEvent[] }>;

  // OCR
  ocrWarmup(): void;
  ocrSleep(): Promise<void>;
  extractOcrText(imageBuffer: Buffer): Promise<string | null>;

  // Data
  getPlaywrightSettings(
    repositoryId?: string | null,
  ): Promise<PlaywrightRecordingSettings>;
  /**
   * Resolve a recording's setup chain to executable code, mirroring
   * `setup-orchestrator.ts:runTestSetup`'s precedence so recording sees the
   * same chain as test execution: explicit steps > re-record's existing
   * chain > repo defaults > legacy single test/script.
   */
  resolveSetupSteps(input: {
    steps?: SetupChainStep[];
    rerecordTestId?: string | null;
    repositoryId?: string | null;
  }): Promise<ResolvedSetupStep[] | undefined>;
  getOrCreateFunctionalArea(name: string): Promise<FunctionalAreaRef>;

  // Guarded writes
  saveRecordedTest(input: SaveRecordedTestInput): Promise<{ id: string }>;
  updateRerecordedTest(
    input: UpdateRerecordedTestInput,
  ): Promise<{ id: string }>;

  // Security boundary
  /** GET a tenant-typed URL for "Analyze before record". Not a `fetch` — the
   *  plugin has no dispatcher and cannot skip the SSRF check. */
  fetchGuarded(
    url: string,
    opts: GuardedFetchOptions,
  ): Promise<GuardedFetchResult>;
}
