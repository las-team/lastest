/**
 * Test Executor for Embedded Browser
 *
 * Executes test code against the live shared page (no new browser launch).
 * Uses the same `new Function()` pattern as `packages/runner/src/runner.ts`
 * but adapted for the embedded context.
 *
 * Features mirrored from the standard runner:
 * - Stabilization (freeze timestamps/random/animations, wait for network idle/DOM/canvas)
 * - StorageState injection
 * - Timeout handling with context.close to kill in-flight ops
 * - Heartbeat logging
 * - RAF flush wrapping for actions
 * - locateWithFallback with { type, value } selectors, ocr-text, role-name, coordinate fallback
 * - Speed-aware replayCursorPath
 * - stepLogger with softExpect/softAction
 * - Robust stripTypeAnnotations
 * - Removal of test-local function definitions
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import type { StabilizationPayload } from './protocol.js';
import { setupFreezeScripts, applyPreScreenshotStabilization } from './stabilization.js';
import { getAllDomSelectors, type DomSnapshotResult, type SelectorPriorityConfig } from './selector-utils.js';
import {
  UrlTrajectoryRecorder,
  VITALS_INIT_SCRIPT,
  sampleWebVitals,
  captureStorageStateSnapshot,
  type UrlTrajectoryStep,
  type WebVitalsSample,
  type StorageStateSnapshot,
} from './multi-layer-capture.js';
import {
  instrumentAssertionTracking,
  instrumentStepTracking,
  stripTypeAnnotations,
  watermarkVideo,
  hashSelectors,
  sortSelectorsByStats,
  selectorTimeoutFor,
  extractTestBody,
  createExpect,
  createFileUploadHelper,
  createClipboardHelper,
  createNetworkHelper,
  decodeFixturesToTmp,
  type SelectorOutcome,
  type SelectorRef,
  type SelectorStatRow,
} from '@lastest/shared';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_DOM_SNAPSHOT_PRIORITY: SelectorPriorityConfig = [
  { type: 'data-testid', enabled: true, priority: 1 },
  { type: 'id', enabled: true, priority: 2 },
  { type: 'label', enabled: true, priority: 3 },
  { type: 'role-name', enabled: true, priority: 4 },
  { type: 'aria-label', enabled: true, priority: 5 },
  { type: 'text', enabled: true, priority: 6 },
  { type: 'placeholder', enabled: true, priority: 7 },
  { type: 'name', enabled: true, priority: 8 },
  { type: 'css-path', enabled: true, priority: 9 },
  { type: 'heading-context', enabled: true, priority: 10 },
];

export interface EmbeddedNetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  resourceType: string;
  failed?: boolean;
  errorText?: string;
  startTime?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  responseBody?: string;
  responseSize?: number;
}

export interface EmbeddedTestResult {
  status: 'passed' | 'failed' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  error?: { message: string; stack?: string; screenshot?: string };
  logs: Array<{ timestamp: number; level: string; message: string }>;
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
  /** Page innerText captured alongside each screenshot when textCaptureEnabled.
   *  Filename is the screenshot's filename with `.txt` extension so the host
   *  can pair them by replacing the extension. */
  texts?: Array<{ filename: string; data: string }>;
  consoleErrors?: string[];
  networkRequests?: EmbeddedNetworkRequest[];
  softErrors?: string[];
  /** One entry per `expect(...)` call wrapped by `instrumentAssertionTracking`.
   *  `assertionId` matches a parsed `TestAssertion.id` from the host. The
   *  Criteria evaluator (`src/lib/execution/evaluation.ts`) keys on these to
   *  promote a soft assertion failure to a hard test failure. */
  assertionResults?: Array<{
    assertionId: string;
    status: 'passed' | 'failed' | 'skipped';
    actualValue?: string;
    errorMessage?: string;
    durationMs?: number;
  }>;
  videoData?: string; // base64-encoded video file
  videoFilename?: string;
  lastReachedStep?: number;
  totalSteps?: number;
  domSnapshot?: DomSnapshotResult; // DOM state captured after test body ran
  /** axe-core violations harvested from `window.__urlDiffResult` when
   *  `enableA11y` is set. Duck-typed shape matching `A11yViolation` in
   *  `src/lib/db/schema.ts` (intentionally inline to avoid pulling the
   *  schema dep into this package). */
  a11yViolations?: Array<{
    id: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    description: string;
    help: string;
    helpUrl: string;
    nodes: number;
    tags?: string[];
    wcagLevel?: 'A' | 'AA' | 'AAA';
  }>;
  a11yPassesCount?: number;
  /** Off-token CSS values harvested by walking the live DOM and matching
   *  computed styles against the configured DesignSystemConfig. Duck-typed
   *  to mirror `DesignSystemViolation` in src/lib/db/schema.ts. */
  designSystemViolations?: Array<{
    id: string;
    category: 'color' | 'border-radius' | 'font-family' | 'font-size' | 'spacing';
    property: string;
    actual: string;
    expected?: string;
    expectedName?: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    nodes: number;
    sampleNodes?: Array<{
      target: string[];
      failureSummary?: string;
      html?: string;
    }>;
  }>;
  designSystemRulesChecked?: number;
  /** Playwright `page.accessibility.snapshot()` output, capped at ~512 KB
   *  by the executor. Truncated trees are marked `{ _truncated: true }`. */
  accessibilityTree?: unknown;
  extractedVariables?: Record<string, string>; // Values pulled from page fields by extract-mode TestVariables
  /** Per-attempt selector outcomes captured by `locateWithFallback`. The
   *  host writes these to `selector_stats` so future runs can promote
   *  the winning candidate. */
  selectorOutcomes?: SelectorOutcome[];
  // ── Multi-layer comparison capture (v1.13) ─────────────────────────────
  /** Per-step finalUrl + redirect chain. Empty array means the recorder
   *  ran but no main-frame navigations were observed; undefined means the
   *  layer was disabled or the recorder failed to install. */
  urlTrajectory?: UrlTrajectoryStep[];
  /** Per-screenshot Web Vitals samples (LCP/CLS/INP/FCP/TBT/TTFB). */
  webVitals?: WebVitalsSample[];
  /** End-of-test cookie + localStorage snapshot. Token-shaped names redacted. */
  storageStateSnapshot?: StorageStateSnapshot;
}

export interface EmbeddedSetupResult {
  status: 'passed' | 'failed' | 'error' | 'timeout';
  storageState?: string;
  // Serialized JSON of the captured storageState. `storageState` above may be
  // a "persistent:<setupId>" marker that instructs the test-executor to reuse
  // the live BrowserContext; consumers that can't access that in-process map
  // (e.g. the debug-executor) need the real JSON here.
  storageStateJson?: string;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
  logs: Array<{ timestamp: number; level: string; message: string }>;
}

export interface RunSetupPayload {
  setupId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  stabilization?: StabilizationPayload;
  browser?: string;
  headed?: boolean;
  /** Stable Chrome UA string to bypass HeadlessChrome bot detection. Applied
   *  via newContext({ userAgent }) on the setup context. Sourced from
   *  playwright_settings.userAgentOverride. */
  userAgentOverride?: string;
}

export interface RunTestPayload {
  testId: string;
  testRunId: string;
  code: string;
  codeHash: string;
  targetUrl: string;
  timeout?: number;
  viewport?: { width: number; height: number };
  repositoryId?: string;
  storageState?: string;
  setupVariables?: Record<string, unknown>;
  cursorPlaybackSpeed?: number;
  stabilization?: StabilizationPayload;
  consoleErrorMode?: 'fail' | 'warn' | 'ignore';
  networkErrorMode?: 'fail' | 'warn' | 'ignore';
  ignoreExternalNetworkErrors?: boolean;
  enableNetworkInterception?: boolean;
  /** Hostname substrings whose console errors the EB drops BEFORE applying
   *  consoleErrorMode. Mirrors src/lib/db/schema.ts DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS;
   *  null/undefined falls back to the in-EB default list (kept in sync).
   *  "Any in-scope console error = fail" rule is preserved. */
  consoleErrorIgnoreHosts?: string[];
  /** Stable Chrome UA string to bypass HeadlessChrome bot detection. Applied
   *  via newContext({ userAgent }) on every test context. Sourced from
   *  playwright_settings.userAgentOverride. */
  userAgentOverride?: string;
  /** When true, after the test body completes the executor reads
   *  `window.__urlDiffResult` and stamps `a11yViolations`/`a11yPassesCount`/
   *  `accessibilityTree` onto the result. Used by the URL Diff feature; the
   *  synthetic test body is responsible for running axe-core and assigning
   *  the harvest payload. */
  enableA11y?: boolean;
  /** Design-system token config. When present (and `tokens` carries at
   *  least one allowed value), the executor walks the live DOM after the
   *  test body runs and emits `designSystemViolations[]` for any computed
   *  CSS value not in the allowed set. Mirrors the a11y flow. */
  designSystem?: {
    tokens: Partial<Record<'color' | 'border-radius' | 'font-family' | 'font-size' | 'spacing', Array<{ name: string; value: string }>>>;
    ignoredCategories?: Array<'color' | 'border-radius' | 'font-family' | 'font-size' | 'spacing'>;
    maxViolationsPerScreenshot?: number;
  };
  acceptDownloads?: boolean;
  forceVideoRecording?: boolean;
  extractVariables?: Array<{
    name: string;
    targetSelector: string;
    attribute?: 'value' | 'textContent' | 'innerText' | 'innerHTML';
  }>;
  /** Parsed assertions from the host's `parseAssertions(code)`. The runner
   *  uses `(codeLineStart, codeLineEnd)` as a registry to map each runtime
   *  `expect(...)` call to the right parsed `id`, so the host stays the
   *  single source of truth for id computation. */
  assertions?: Array<{
    id: string;
    codeLineStart?: number;
    codeLineEnd?: number;
  }>;
  /** Parsed steps from the host's `parseSteps(body)`. When present, the
   *  runner emits per-step lifecycle events keyed by index so the host can
   *  render a live timeline. Index N maps to the N-th step in this list. */
  steps?: Array<{
    id: number;
    label: string;
    lineStart: number;
    lineEnd: number;
    type: 'action' | 'navigation' | 'assertion' | 'screenshot' | 'wait' | 'variable' | 'log' | 'other';
  }>;
  /** Selector_stats rows for this test, used by `locateWithFallback` to
   *  sort fallback candidates by historical success before iterating. */
  selectorStats?: SelectorStatRow[];
  /** Default per-candidate `waitFor` budget for `locateWithFallback` (ms).
   *  Resolved on the host. Defaults to 3000ms when omitted. */
  selectorTimeoutMs?: number;
  /** When true, capture `document.body.innerText` after each screenshot and
   *  return it alongside `screenshots[]` so the host can run a text-diff
   *  against the prior baseline. */
  textCaptureEnabled?: boolean;
}

/**
 * Remove a named async function definition from a code body by brace-matching.
 */
function removeFunctionDefinition(body: string, funcName: string): { body: string; removed: boolean } {
  const pattern = `async function ${funcName}`;
  if (!body.includes(pattern)) return { body, removed: false };

  const regex = new RegExp(`async function ${funcName}\\s*\\([^)]*\\)\\s*\\{`);
  const startMatch = body.match(regex);
  if (!startMatch || startMatch.index === undefined) return { body, removed: false };

  const startIdx = startMatch.index;
  const braceStart = body.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = braceStart + 1;
  while (depth > 0 && endIdx < body.length) {
    if (body[endIdx] === '{') depth++;
    else if (body[endIdx] === '}') depth--;
    endIdx++;
  }
  return {
    body: body.slice(0, startIdx) + `/* ${funcName} provided by runner */` + body.slice(endIdx),
    removed: true,
  };
}

export class EmbeddedTestExecutor {
  private abortController: AbortController | null = null;
  // Persistent setup contexts — setup stores its BrowserContext here keyed by setupId.
  // Subsequent tests in the same run reuse it (preserves sessionStorage/IndexedDB/
  // in-memory auth that Playwright's storageState() can't capture). We also store
  // a serialized storageState snapshot alongside — if Chromium disposes the live
  // context's target for any reason (observed behavior between tests), subsequent
  // tests can rebuild a fresh context with the same cookies/localStorage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private setupContexts = new Map<string, { context: BrowserContext; createdAt: number; storageState?: any; viewport?: { width: number; height: number } }>();
  private setupContextSweeper: ReturnType<typeof setInterval> | null = null;
  // Live persistent BrowserContext TTL. Must comfortably exceed a full build's
  // wall-clock time (setup + all tests on this worker). Default 60 min; override
  // via EB_SETUP_CONTEXT_TTL_MS env.
  private readonly SETUP_CONTEXT_TTL_MS = parseInt(process.env.EB_SETUP_CONTEXT_TTL_MS || String(60 * 60 * 1000), 10);

  get isRunning(): boolean {
    return this.abortController !== null;
  }

  abort(): boolean {
    if (this.abortController) {
      this.abortController.abort();
      return true;
    }
    return false;
  }

  private ensureSetupContextSweeper() {
    if (this.setupContextSweeper) return;
    this.setupContextSweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.setupContexts) {
        if (now - entry.createdAt > this.SETUP_CONTEXT_TTL_MS) {
          console.log(`  [INFO] Evicting persistent setup context ${id} (TTL exceeded)`);
          entry.context.close().catch(() => {});
          this.setupContexts.delete(id);
        }
      }
      if (this.setupContexts.size === 0) {
        clearInterval(this.setupContextSweeper!);
        this.setupContextSweeper = null;
      }
    }, 60 * 1000);
    if (this.setupContextSweeper.unref) this.setupContextSweeper.unref();
  }

  async releaseSetupContext(setupId: string): Promise<void> {
    const entry = this.setupContexts.get(setupId);
    if (!entry) return;
    this.setupContexts.delete(setupId);
    await entry.context.close().catch(() => {});
  }

  /**
   * Look up a retained setup context by id. Used by the recording path to
   * reuse the live post-setup context (preserves cookies + localStorage +
   * sessionStorage + IndexedDB + in-memory auth — `storageState()` JSON only
   * preserves the first two). Returns `null` when the entry has aged out.
   */
  getRetainedSetupContext(setupId: string): { context: BrowserContext; storageState?: unknown; viewport?: { width: number; height: number } } | null {
    const entry = this.setupContexts.get(setupId);
    if (!entry) return null;
    return { context: entry.context, storageState: entry.storageState, viewport: entry.viewport };
  }

  async runTest(
    browser: Browser,
    command: RunTestPayload,
    callbacks?: {
      onPageCreated?: (page: Page) => Promise<void> | void;
      onBeforePageClose?: () => Promise<void> | void;
      onStepEvent?: (event: {
        stepIndex: number;
        totalSteps: number;
        status: 'started' | 'passed' | 'failed';
        label?: string;
        stepType?: 'action' | 'navigation' | 'assertion' | 'screenshot' | 'wait' | 'variable' | 'log' | 'other';
        durationMs?: number;
        error?: string;
      }) => void;
    },
  ): Promise<EmbeddedTestResult> {
    const abortCtrl = new AbortController();
    this.abortController = abortCtrl;

    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const screenshots: Array<{ filename: string; data: string; width: number; height: number }> = [];
    const texts: Array<{ filename: string; data: string }> = [];
    const softErrors: string[] = [];
    const assertionResults: NonNullable<EmbeddedTestResult['assertionResults']> = [];
    const selectorOutcomes: SelectorOutcome[] = [];
    const consoleErrors: string[] = [];
    let allNetworkRequests: EmbeddedNetworkRequest[] = [];
    const testTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [embedded:${command.testId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };

    // Determine context options based on stabilization settings
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // Parse storageState. "persistent:<setupId>" marker → reuse setup's live context.
    let persistentSetupId: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedStorageState: any;
    if (command.storageState) {
      if (command.storageState.startsWith('persistent:')) {
        persistentSetupId = command.storageState.slice('persistent:'.length);
      } else {
        try {
          parsedStorageState = JSON.parse(command.storageState);
          logFn('info', `Injecting storageState: ${parsedStorageState.cookies?.length ?? 0} cookies, ${parsedStorageState.origins?.length ?? 0} origins`);
        } catch (e) {
          logFn('warn', `Failed to parse storageState: ${e}`);
        }
      }
    }

    // Set up video recording if requested
    const videoEnabled = command.forceVideoRecording;
    const videoDir = videoEnabled ? path.join(os.tmpdir(), `lastest-video-${Date.now()}`) : undefined;
    if (videoDir) {
      fs.mkdirSync(videoDir, { recursive: true });
    }

    // Persistent-context branch: reuse setup's live context; skip storageState serialization.
    // Limitations: per-test video + context-level stabilization overrides can't be applied.
    let testContext: BrowserContext;
    let reusedPersistentContext = false;
    const buildFreshContext = async (state: unknown) => {
      return browser.newContext({
        viewport,
        acceptDownloads: true,
        ...(state ? { storageState: state as Parameters<Browser['newContext']>[0] extends infer T ? T extends { storageState?: infer S } ? S : never : never } : {}),
        ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
        ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
        ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
        ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
        // UA override — bypasses HeadlessChrome-based bot detection (Cloudflare
        // Turnstile, Clerk, several SaaS edge routers). Sourced from
        // playwright_settings.userAgentOverride via the executor command.
        ...(command.userAgentOverride ? { userAgent: command.userAgentOverride } : {}),
      });
    };
    if (persistentSetupId) {
      const entry = this.setupContexts.get(persistentSetupId);
      if (entry) {
        if (videoDir) {
          logFn('warn', 'Per-test video recording not supported in persistent-context mode — disabled');
        }
        testContext = entry.context;
        reusedPersistentContext = true;
        logFn('info', `Reusing persistent setup context (setupId=${persistentSetupId})`);
      } else {
        logFn('warn', `persistent setup context ${persistentSetupId} not found — falling back to fresh context (auth state will be missing)`);
        testContext = await buildFreshContext(undefined);
      }
    } else {
      // Create a fresh context + page per test (mirrors standard runner)
      testContext = await buildFreshContext(parsedStorageState);
    }

    // FALLBACK: Chromium sometimes disposes a persistent BrowserContext's
    // target between tests (observed: test N passes, test N+1 throws "Target
    // has been closed" on newPage). When that happens, rebuild a fresh
    // context using the storageState snapshot we captured during setup, so
    // the test still runs with the right cookies/localStorage even though
    // sessionStorage/IndexedDB/in-memory auth are lost.
    let page;
    try {
      page = await testContext.newPage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (reusedPersistentContext && /Target .*has been closed|has been closed/i.test(msg)) {
        logFn('warn', `Persistent context for ${persistentSetupId} is zombie — rebuilding fresh context from storageState snapshot`);
        const snapshotEntry = this.setupContexts.get(persistentSetupId!);
        const snapshot = snapshotEntry?.storageState;
        // Drop the dead context from the map so other tests don't hit it too.
        this.setupContexts.delete(persistentSetupId!);
        try { await snapshotEntry?.context.close(); } catch { /* already dead */ }
        testContext = await buildFreshContext(snapshot);
        reusedPersistentContext = false;
        page = await testContext.newPage();
      } else {
        throw err;
      }
    }
    if (reusedPersistentContext) {
      try { await page.setViewportSize(viewport); } catch { /* best-effort */ }
    }

    // Self-test bypass: when the EB pod is running Lastest's own e2e suite
    // against its own host, inject SYSTEM_EB_TOKEN as a Bearer header so
    // login POSTs skip the per-IP rate limit. Strict origin guard prevents
    // the token leaking into customer apps the EB renders. Uses the first
    // comma-separated token (provisioner-style) per the SYSTEM_EB_TOKEN
    // split convention.
    //
    // Eligible target origins: LASTEST_URL (internal cluster DNS used for
    // EB→host coordination) plus LASTEST_PUBLIC_URL if set (external URL
    // the self-test repo targets, e.g. https://app.lastest.cloud). On Olares
    // these differ — the internal DNS doesn't match what the test browser
    // navigates to — so both must be allowlisted.
    {
      const systemTokenRaw = process.env.SYSTEM_EB_TOKEN?.split(',')[0]?.trim();
      const allowedOrigins = new Set<string>();
      for (const raw of [process.env.LASTEST_URL, process.env.LASTEST_PUBLIC_URL]) {
        if (!raw) continue;
        try { allowedOrigins.add(new URL(raw).origin); } catch { /* skip malformed */ }
      }
      if (systemTokenRaw && allowedOrigins.size > 0) {
        try {
          const testOrigin = new URL(command.targetUrl).origin;
          if (allowedOrigins.has(testOrigin)) {
            await testContext.setExtraHTTPHeaders({ Authorization: `Bearer ${systemTokenRaw}` });
            logFn('info', `Self-test bypass: injected SYSTEM_EB_TOKEN for ${testOrigin}`);
          }
        } catch { /* malformed URL — skip injection */ }
      }
    }

    // ── Multi-layer comparison capture (v1.13) ──────────────────────────
    // URL trajectory recorder and Web Vitals init script must be installed
    // BEFORE any navigation. The recorder listens to framenavigated; the
    // init script must reach the document before observers can attach.
    const urlTrajectory: UrlTrajectoryStep[] = [];
    const webVitals: WebVitalsSample[] = [];
    let storageStateSnapshot: StorageStateSnapshot | undefined;
    let urlRecorder: UrlTrajectoryRecorder | undefined;
    try {
      urlRecorder = new UrlTrajectoryRecorder(page);
      await testContext.addInitScript({ content: VITALS_INIT_SCRIPT });
    } catch (e) {
      logFn('warn', `Multi-layer capture install failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (callbacks?.onPageCreated) {
      await callbacks.onPageCreated(page);
    }

    let result: EmbeddedTestResult | undefined;
    let reachedStep = -1;
    let stepCount = 0;
    // Hoisted so the outer catch can finalize the in-flight step as failed
    // when the test body throws. Set during step instrumentation.
    let lastFinishStep: ((status: 'passed' | 'failed', error?: string) => void) | undefined;
    // Hoisted for the outer catch's multi-layer capture path — these mirror
    // the inner-scope versions populated during step instrumentation.
    let outerCurrentStepIdx = -1;
    let outerStepDescriptors: NonNullable<RunTestPayload['steps']> = [];
    let domSnapshot: DomSnapshotResult | undefined;
    // Hoisted so the catch path can also try to extract — failed tests still
    // expose values for any extract-mode TestVariables whose selectors resolve.
    let extractedVariables: Record<string, string> | undefined;
    const runExtractions = async () => {
      if (!command.extractVariables || command.extractVariables.length === 0) return;
      if (!page || page.isClosed()) return;
      const out: Record<string, string> = extractedVariables ?? {};
      for (const v of command.extractVariables) {
        if (!v.targetSelector) continue;
        if (out[v.name] !== undefined) continue; // already extracted (success path)
        try {
          const locator = page.locator(v.targetSelector).first();
          let raw: string | null;
          switch (v.attribute) {
            case 'textContent': raw = await locator.textContent({ timeout: 2000 }); break;
            case 'innerText':   raw = await locator.innerText({ timeout: 2000 }); break;
            case 'innerHTML':   raw = await locator.innerHTML({ timeout: 2000 }); break;
            default:            raw = await locator.inputValue({ timeout: 2000 }); break;
          }
          out[v.name] = (raw ?? '').toString().trim();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logFn('warn', `Failed to extract variable "${v.name}" (${v.targetSelector}): ${msg}`);
          out[v.name] = '';
        }
      }
      extractedVariables = out;
    };
    const captureFinalDomSnapshot = async () => {
      if (!page || page.isClosed()) return;
      try {
        domSnapshot = await getAllDomSelectors(page, DEFAULT_DOM_SNAPSHOT_PRIORITY);
      } catch (err) {
        logFn('warn', `DOM snapshot capture failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    try {
      if (abortCtrl.signal.aborted) {
        throw new Error('Test cancelled before starting');
      }

      // Set default timeouts (mirrors standard runner)
      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Intercept File System Access API so blob downloads trigger Playwright's download event.
      // Always inject — native file dialogs hang forever in headless mode.
      await page.addInitScript(() => {
        if (typeof window !== 'undefined') {
          (window as unknown as Record<string, unknown>).showSaveFilePicker = async function (...args: unknown[]) {
            const opts = (args[0] ?? {}) as Record<string, unknown>;
            const suggestedName = (opts.suggestedName as string) || 'download';
            console.log('[lastest-shim] showSaveFilePicker called:', suggestedName);
            const chunks: BlobPart[] = [];
            return {
              createWritable: async () => ({
                write: async (data: BlobPart) => { chunks.push(data); },
                seek: async () => {},
                truncate: async () => {},
                close: async () => {
                  console.log('[lastest-shim] writable.close() — triggering download:', suggestedName, 'chunks:', chunks.length);
                  const blob = new Blob(chunks);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = suggestedName;
                  a.style.display = 'none';
                  document.body.appendChild(a);
                  a.click();
                  console.log('[lastest-shim] <a> clicked, download should fire');
                  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
                },
              }),
              getFile: async () => new File(chunks, suggestedName),
            };
          };
        }
      });

      // Setup freeze scripts (timestamps, random, animations) BEFORE any navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization: freeze timestamps=${command.stabilization.freezeTimestamps}, random=${command.stabilization.freezeRandomValues}, animations=${command.stabilization.freezeAnimations}, crossOS=${command.stabilization.crossOsConsistency}`);
      }

      // Page event listeners — capture console errors and network requests
      // Environmental transient errors (CNI/DNS/NAT bursts when 30 EB pods start
      // near-simultaneously) surface as `ERR_NETWORK_CHANGED` / `ERR_NAME_NOT_RESOLVED`
      // on sub-resource loads fired AFTER the main navigation — unrelated to
      // the test's intent. Keep them out of the failure classification; log as
      // info so they're still traceable.
      const TRANSIENT_NET_CONSOLE_RX = /ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_IO_SUSPENDED/i;
      // Third-party host allowlist applied BEFORE the consoleErrorMode fail gate.
      // Mirrors src/lib/db/schema.ts DEFAULT_CONSOLE_ERROR_IGNORE_HOSTS — kept
      // in sync at the data layer (executor.ts threads command.consoleErrorIgnoreHosts
      // from playwright_settings; this fallback covers commands sent before the
      // setting was added or by older callers). Filter parses the console message's
      // source URL (msg.location().url) AND the message body for in-line URL
      // references (Cloudflare's email-decoder error doesn't always carry a stack).
      const DEFAULT_IGNORE_HOSTS = [
        'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
        'facebook.net', 'fbcdn.net', 'connect.facebook.net',
        'segment.io', 'segment.com',
        'mixpanel.com', 'amplitude.com',
        'hotjar.com', 'fullstory.com', 'logrocket.com',
        'intercom.io', 'intercomcdn.com',
        'stripe.com', 'stripe.network',
        'sentry-cdn.com', 'browser.sentry-cdn.com', 'sentry.io',
        'cdnjs.cloudflare.com',
        'email-decode.min.js',
      ];
      const ignoreHosts: string[] = Array.isArray(command.consoleErrorIgnoreHosts)
        ? command.consoleErrorIgnoreHosts
        : DEFAULT_IGNORE_HOSTS;
      const matchesIgnoredHost = (text: string, sourceUrl: string): boolean => {
        if (!ignoreHosts.length) return false;
        const haystack = `${sourceUrl} ${text}`.toLowerCase();
        return ignoreHosts.some((host) => host && haystack.includes(host.toLowerCase()));
      };
      page.on('console', (msg) => {
        const text = msg.text();
        // Log shim messages to container output for debugging
        if (text.startsWith('[lastest-shim]')) {
          logFn('info', text);
        }
        if (msg.type() === 'error') {
          if (TRANSIENT_NET_CONSOLE_RX.test(text)) {
            logFn('info', `Transient network console error (ignored for classification): ${text}`);
            return;
          }
          const sourceUrl = (() => { try { return msg.location()?.url ?? ''; } catch { return ''; } })();
          if (matchesIgnoredHost(text, sourceUrl)) {
            logFn('info', `Console error from ignored host (ignored for classification): ${text}`);
            return;
          }
          consoleErrors.push(text);
          logFn('warn', `Console error: ${text}`);
        }
      });
      page.on('pageerror', (err) => logFn('warn', `Page error: ${err.message}`));

      // Network request capture (all requests, not just failures)
      const captureNetworkBodies = command.enableNetworkInterception ?? false;
      page.on('request', (req) => {
        allNetworkRequests.push({
          url: req.url(),
          method: req.method(),
          status: 0,
          duration: 0,
          resourceType: req.resourceType(),
          startTime: Date.now(),
          failed: false,
          ...(captureNetworkBodies ? {
            requestHeaders: req.headers(),
            postData: req.postData() ?? undefined,
          } : {}),
        });
        if (allNetworkRequests.length > 500) {
          allNetworkRequests = allNetworkRequests.slice(-500);
        }
      });
      page.on('response', (resp) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === resp.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.status = resp.status();
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
          const contentLength = resp.headers()['content-length'];
          if (contentLength) entry.responseSize = parseInt(contentLength, 10);
          if (captureNetworkBodies) {
            entry.responseHeaders = resp.headers();
            // Capture response body for API calls (fetch/xhr) — cap at 16KB
            const rt = entry.resourceType;
            if (rt === 'fetch' || rt === 'xhr' || rt === 'document') {
              resp.text().then(body => {
                entry.responseBody = body.length > 16384 ? body.slice(0, 16384) + '… (truncated)' : body;
                if (!entry.responseSize) entry.responseSize = body.length;
              }).catch(() => {});
            }
          }
        }
      });
      page.on('requestfailed', (req) => {
        const entry = allNetworkRequests.findLast(
          e => e.url === req.url() && e.status === 0 && !e.failed
        );
        if (entry) {
          entry.failed = true;
          entry.errorText = req.failure()?.errorText;
          entry.duration = entry.startTime ? Date.now() - entry.startTime : 0;
        }
        logFn('warn', `Request failed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
      });

      // Save raw screenshot method BEFORE overriding page.screenshot (prevents infinite recursion)
      const rawScreenshot = page.screenshot.bind(page);
      let screenshotStep = 1;

      // Screenshot helper with stabilization
      const captureScreenshot = async (label: string) => {
        try {
          // Apply pre-screenshot stabilization (network idle, images, fonts, DOM)
          await applyPreScreenshotStabilization(page, command.stabilization);
          const buffer = await rawScreenshot({ fullPage: true });
          const filename = `${command.testRunId}-${command.testId}-${label.replace(/ /g, '_')}.png`;
          const base64 = buffer.toString('base64');
          screenshots.push({ filename, data: base64, width: viewport.width, height: viewport.height });

          // Capture page text alongside the screenshot. Best-effort: failures
          // must not block the screenshot path. Capped at 200KB; longer pages
          // get a "[truncated]" marker so the diff still renders meaningfully.
          if (command.textCaptureEnabled) {
            try {
              const TEXT_CAP_BYTES = 200 * 1024;
              const rawText = await page.evaluate(() => document.body?.innerText ?? '');
              const safeText = typeof rawText === 'string' ? rawText : '';
              const capped = safeText.length > TEXT_CAP_BYTES
                ? safeText.slice(0, TEXT_CAP_BYTES) + '\n\n[truncated — capture exceeded 200KB]'
                : safeText;
              const textFilename = filename.replace(/\.png$/i, '.txt');
              texts.push({ filename: textFilename, data: Buffer.from(capped, 'utf8').toString('base64') });
            } catch (textErr) {
              logFn('warn', `Failed to capture page text for ${label}: ${textErr}`);
            }
          }
          // [Shot] probe: byte size + viewport-content signal to detect blank-render screenshots.
          // bytes << healthy or bodyChildren=0/hasCanvas=false on a canvas app → captured a non-rendered page.
          const probeUrl = page.url();
          const probe = await page.evaluate(() => ({
            bodyChildren: document.body?.childElementCount ?? 0,
            hasCanvas: !!document.querySelector('canvas'),
          })).catch(() => ({ bodyChildren: -1, hasCanvas: false }));
          logFn('info', `[Shot] ${label}: bytes=${buffer.length} url=${probeUrl} bodyChildren=${probe.bodyChildren} hasCanvas=${probe.hasCanvas}`);
          logFn('info', `Captured screenshot: ${filename}`);
          // Disable RAF gating + unfreeze performance.now after screenshot
          /* eslint-disable @typescript-eslint/no-explicit-any */
          await page.evaluate(() => {
            if (typeof (window as any).__disableRAFGating === 'function') {
              (window as any).__disableRAFGating();
            }
            (window as any).__perfNowFrozen = false;
          }).catch(() => {});
          /* eslint-enable @typescript-eslint/no-explicit-any */
        } catch (err) {
          logFn('warn', `Failed to capture screenshot: ${err}`);
        }
      };

      // Override page.screenshot to intercept screenshot calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).screenshot = async (options?: any) => {
        const label = `Step ${screenshotStep++}`;
        await captureScreenshot(label);
        return rawScreenshot(options);
      };

      // Intercept page.goto with logging + retry ladder for transient CNI
      // bursts observed on builds (ERR_NETWORK_CHANGED / DNS flakes from 30 EBs
      // hitting the same target concurrently). Retries at 1s, 2s, 4s = ~7s
      // total; if still failing, throw a tagged error so the upper layer can
      // decide to swap to a fresh EB instead of burning the test.
      //
      // ALSO recovers from sub-resource failures: page.goto returns 200 when
      // the main HTML doc loads, but the JS bundles that mount the app fire
      // afterwards. A bundle that hits ERR_NETWORK_CHANGED leaves the page as
      // a blank shell (bodyChildren > 0, hasCanvas=false) — the test then runs
      // cursor moves on un-mounted UI and the screenshot is ~10× smaller.
      // Smoking-gun example (Test 2: Move Binding Arrow):
      //   Request failed: .../mermaid-to-excalidraw-D-aVQaad.js ERR_NETWORK_CHANGED
      //   Navigation complete: 200
      //   [Nav] post-goto: bodyChildren=5 hasCanvas=false
      //   [Shot] Step 1: bytes=4253 (vs. healthy 44169)
      //
      // Strategy: track CRITICAL sub-resource failures (script + document
      // resourceTypes only — ignore image/font/stylesheet/media so blocked
      // analytics don't trigger spurious reloads) for the goto window AND a
      // 3s grace period after goto resolves (catches lazy chunks). If any
      // fired, page.reload() up to twice. After reloads settle, require
      // networkidle within 5s; otherwise tag __ebNetworkUnhealthy so the
      // dispatcher swaps to a fresh EB instead of producing a blank screenshot.
      const originalGoto = page.goto.bind(page);
      const TRANSIENT_NET_RX = /ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_NETWORK_IO_SUSPENDED/i;
      const CRITICAL_RESOURCE_TYPES = new Set(['script', 'document', 'xhr', 'fetch']);
      const POST_GOTO_TRACK_MS = 3000;
      const MAX_SUBRESOURCE_RELOADS = 2;

      let trackingActive = false;
      let criticalSubresourceFailures: string[] = [];
      page.on('requestfailed', (req) => {
        if (!trackingActive) return;
        if (!CRITICAL_RESOURCE_TYPES.has(req.resourceType())) return;
        const failure = req.failure();
        if (failure && TRANSIENT_NET_RX.test(failure.errorText)) {
          criticalSubresourceFailures.push(`${req.resourceType()} ${req.url()} (${failure.errorText})`);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).goto = async (url: string, options?: any) => {
        logFn('info', `Navigating to ${url}...`);
        const delays = [1000, 2000, 4000];
        let lastErr: unknown;
        let response: Awaited<ReturnType<typeof originalGoto>> | null = null;
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          try {
            criticalSubresourceFailures = [];
            trackingActive = true;
            response = await originalGoto(url, options);
            // Keep tracking for POST_GOTO_TRACK_MS after goto resolves — the
            // mermaid chunk that broke Test 2 fired ~750ms post-goto.
            await new Promise((r) => setTimeout(r, POST_GOTO_TRACK_MS));
            trackingActive = false;
            if (attempt > 0) {
              logFn('info', `Navigation complete (retry ${attempt}): ${response?.status() ?? 'no response'}`);
            } else {
              logFn('info', `Navigation complete: ${response?.status() ?? 'no response'}`);
            }
            try {
              const docState = await page.evaluate(() => ({
                url: location.href,
                readyState: document.readyState,
                bodyChildren: document.body?.childElementCount ?? 0,
                bodyText: (document.body?.innerText || '').slice(0, 80),
                hasCanvas: !!document.querySelector('canvas'),
              }));
              logFn('info', `[Nav] post-goto: url=${docState.url} ready=${docState.readyState} bodyChildren=${docState.bodyChildren} hasCanvas=${docState.hasCanvas} text="${docState.bodyText}"`);
            } catch (e) {
              logFn('warn', `[Nav] post-goto probe failed: ${e}`);
            }
            break;
          } catch (err) {
            trackingActive = false;
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!TRANSIENT_NET_RX.test(msg)) throw err;
            if (attempt === delays.length) break;
            logFn('warn', `Navigation hit transient network error (attempt ${attempt + 1}/${delays.length + 1}), backing off ${delays[attempt]}ms: ${msg}`);
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
        }
        if (!response) {
          // All goto retries exhausted on a transient error — EB network unhealthy.
          const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          const tagged = new Error(`EB network unhealthy after retries: ${finalMsg}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (tagged as any).__ebNetworkUnhealthy = true;
          throw tagged;
        }

        // Sub-resource recovery: goto succeeded but a critical script/doc/xhr
        // hit ERR_NETWORK_CHANGED during or just after navigation → app likely
        // didn't mount. Reload up to MAX_SUBRESOURCE_RELOADS with backoff.
        for (let reloadAttempt = 1; reloadAttempt <= MAX_SUBRESOURCE_RELOADS && criticalSubresourceFailures.length > 0; reloadAttempt++) {
          const sample = criticalSubresourceFailures.slice(0, 2).join('; ');
          logFn('warn', `[Reload] ${criticalSubresourceFailures.length} critical sub-resource failure(s) during navigation — reloading (${reloadAttempt}/${MAX_SUBRESOURCE_RELOADS}). Sample: ${sample}`);
          // Give CNI a moment to settle.
          await new Promise((r) => setTimeout(r, 1000 * reloadAttempt));
          try {
            criticalSubresourceFailures = [];
            trackingActive = true;
            const reloadResp = await page.reload({ waitUntil: options?.waitUntil ?? 'load', timeout: options?.timeout });
            await new Promise((r) => setTimeout(r, POST_GOTO_TRACK_MS));
            trackingActive = false;
            logFn('info', `[Reload] Completed (${reloadAttempt}/${MAX_SUBRESOURCE_RELOADS}): status=${reloadResp?.status() ?? 'none'} remainingFailures=${criticalSubresourceFailures.length}`);
            if (reloadResp) response = reloadResp;
          } catch (err) {
            trackingActive = false;
            const msg = err instanceof Error ? err.message : String(err);
            logFn('warn', `[Reload] threw on attempt ${reloadAttempt}: ${msg}`);
            if (reloadAttempt === MAX_SUBRESOURCE_RELOADS) {
              const tagged = new Error(`EB network unhealthy: sub-resource reloads failed (${reloadAttempt}/${MAX_SUBRESOURCE_RELOADS}): ${msg}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (tagged as any).__ebNetworkUnhealthy = true;
              throw tagged;
            }
          }
        }
        if (criticalSubresourceFailures.length > 0) {
          // Reloads exhausted, sub-resources still flaky — surface as unhealthy
          // so dispatcher's MAX_EB_ATTEMPTS=2 retry kicks in on a fresh EB.
          const tagged = new Error(`EB network unhealthy: ${criticalSubresourceFailures.length} critical sub-resource failure(s) persisted after ${MAX_SUBRESOURCE_RELOADS} reload(s)`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (tagged as any).__ebNetworkUnhealthy = true;
          throw tagged;
        }
        return response;
      };

      // Tiered extractor (shared with remote runner):
      //   1) legacy `export async function test(page, ...) { ... }` (byte-identical)
      //   2) framework `test('name', async ({ page }) => { ... })` (new, additive)
      //   3) whole-code fallback (matches prior fallback)
      const extracted = extractTestBody(command.code);
      let body: string = stripTypeAnnotations(extracted.body);
      if (extracted.shape === 'whole-code') {
        logFn('info', 'No export async function test(...) wrapper found — using code as body');
      } else if (extracted.shape === 'framework-test') {
        logFn('info', 'Extracted body from framework-style test("name", async ({ page }) => { ... })');
      }

      // Strip re-declarations of runner-injected variables (expect, test) from import/require
      // AI-generated code sometimes includes these despite prompt instructions
      body = body.replace(/^\s*(?:const|let|var)\s+\{[^}]*\bexpect\b[^}]*\}\s*=\s*(?:await\s+)?(?:import|require)\s*\([^)]*\);?\s*$/gm, '');
      body = body.replace(/^\s*(?:const|let|var)\s+expect\s*=\s*(?:await\s+)?(?:import|require)\s*\([^)]*\);?\s*$/gm, '');
      body = body.replace(/^\s*import\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');
      body = body.replace(/^\s*import\s+\w+\s+from\s+['"][^'"]*['"];?\s*$/gm, '');
      logFn('info', `Extracted test body: ${body.length} chars`);

      // Remove test-local locateWithFallback (using runner-provided version)
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) {
        body = lwfResult.body;
        logFn('info', 'Removed test-local locateWithFallback (using runner-provided version)');
      }

      // Remove test-local replayCursorPath (using runner-provided speed-aware version)
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) {
        body = rcpResult.body;
        logFn('info', 'Removed test-local replayCursorPath (using runner-provided version)');
      }

      // Patch selectAll (mirrors runner.ts)
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Instrument assertions BEFORE step instrumentation and soft-wrapping.
      // Each `expect(...)` / `await page.waitForLoadState(...)` line gets
      // wrapped with `await __assertion(id, async () => { <stmt> })` so the
      // runner can record structured AssertionResult[] keyed to the host's
      // parsed assertion ids. Lines wrapped here are skipped by the
      // soft-error regex below (they no longer match the bare `expect(`
      // pattern), so each assertion fails through `__assertion` only.
      if (command.assertions && command.assertions.length > 0) {
        const ar = instrumentAssertionTracking(body, command.assertions);
        body = ar.instrumentedBody;
        if (ar.wrappedCount !== command.assertions.length) {
          logFn('warn', `Assertion instrumentation wrapped ${ar.wrappedCount}/${command.assertions.length} assertions — runtime/parser drift`);
        }
      }

      // Instrument step tracking before soft error wrapping
      const instrumentResult = instrumentStepTracking(body);
      body = instrumentResult.instrumentedBody;
      stepCount = instrumentResult.stepCount;
      reachedStep = -1;

      // Live per-step lifecycle events for the host's playback timeline.
      // Bracket steps via __stepReached(N): when N advances, the previous
      // step is implicitly completed as passed. The catch in this method
      // emits a final 'failed' event for the in-flight step.
      const stepDescriptors = command.steps ?? [];
      outerStepDescriptors = stepDescriptors;
      const totalStepsForEvents = stepDescriptors.length || stepCount || 0;
      let currentStepIdx = -1;
      let currentStepStart = 0;
      const onStepEvent = callbacks?.onStepEvent;
      const emitStep: typeof onStepEvent extends undefined ? () => void : NonNullable<typeof onStepEvent> = (event) => {
        if (!onStepEvent) return;
        try { onStepEvent(event); } catch (e) {
          logFn('warn', `onStepEvent threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      const finishCurrentStep = (status: 'passed' | 'failed', error?: string) => {
        if (currentStepIdx < 0) return;
        const desc = stepDescriptors[currentStepIdx];
        emitStep({
          stepIndex: currentStepIdx,
          totalSteps: totalStepsForEvents,
          status,
          label: desc?.label,
          stepType: desc?.type,
          durationMs: Date.now() - currentStepStart,
          error,
        });
      };
      // Expose to the outer try/catch so a thrown error can finalize the
      // in-flight step as failed.
      lastFinishStep = finishCurrentStep;

      const __stepReached = async (n: number) => {
        reachedStep = Math.max(reachedStep, n);
        outerCurrentStepIdx = n;
        if (n === currentStepIdx) return;
        if (currentStepIdx >= 0 && n > currentStepIdx) {
          // Sample URL trajectory + Web Vitals for the step we just finished,
          // BEFORE we advance to step n. This way the sample reflects the
          // page state at the end of step (currentStepIdx) rather than the
          // start of step n.
          if (urlRecorder) {
            try {
              urlTrajectory.push(urlRecorder.sampleAtStep(
                page,
                currentStepIdx,
                stepDescriptors[currentStepIdx]?.label,
                Date.now() - startTime,
              ));
            } catch { /* best-effort */ }
          }
          try {
            const vitals = await sampleWebVitals(page, currentStepIdx, stepDescriptors[currentStepIdx]?.label);
            if (vitals) webVitals.push(vitals);
          } catch { /* best-effort */ }
          finishCurrentStep('passed');
        }
        currentStepIdx = n;
        currentStepStart = Date.now();
        const desc = stepDescriptors[n];
        emitStep({
          stepIndex: n,
          totalSteps: totalStepsForEvents,
          status: 'started',
          label: desc?.label,
          stepType: desc?.type,
        });
      };

      // Per-assertion bookkeeping invoked by lines wrapped by
      // `instrumentAssertionTracking`. Push one row per call (so a loop
      // around an `expect()` records each iteration); the criteria evaluator
      // uses `.find(... status === 'failed')` so any single failure trips
      // the rule — matches the soft-fail semantics we keep at runtime.
      const __assertion = async (id: string, fn: () => Promise<void>) => {
        const start = Date.now();
        try {
          await fn();
          assertionResults.push({ assertionId: id, status: 'passed', durationMs: Date.now() - start });
        } catch (e: unknown) {
          // A real `__hardAssertion` (set on the error) still escapes — host
          // tests rely on that to fail-fast on TypeError / ReferenceError.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (e && (e as any).__hardAssertion) throw e;
          const msg = e instanceof Error ? e.message : String(e);
          assertionResults.push({
            assertionId: id, status: 'failed', errorMessage: msg, durationMs: Date.now() - start,
          });
          // Mirror into softErrors so the legacy steps tab still surfaces the
          // human-readable message — the structured row is what the criteria
          // evaluator actually keys on.
          softErrors.push(msg);
          logFn('warn', `[ASSERTION FAIL] ${msg}`);
        }
      };

      // Soft error wrapping — skip screenshot lines AND navigation lines
      // (mirrors runner.ts). `page.goto` failures must fail the test hard:
      // if a worker can't reach the target URL, subsequent steps would run
      // on about:blank and produce blank-white screenshots recorded as passes.
      // `__assertion(...)` lines are also skipped — they manage their own
      // pass/fail bookkeeping and re-throwing them as soft warnings would
      // double-report into softErrors.
      body = body.replace(/^(\s*)(await\s+.+;)\s*$/gm, (_match, indent, stmt) => {
        if (stmt.includes('.screenshot(')) return `${indent}${stmt}`;
        if (stmt.includes('.goto(')) return `${indent}${stmt}`;
        if (stmt.includes('__assertion(')) return `${indent}${stmt}`;
        return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });
      // Also soft-wrap synchronous expect() calls so assertion failures don't kill the test
      // (only hits expects that the assertion instrumenter didn't claim — e.g. multi-line statements)
      body = body.replace(/^(\s*)(expect\(.+;)\s*$/gm, (_match, indent, stmt) => {
        return `${indent}try { ${stmt} } catch(__softErr) { if (__softErr && __softErr.__hardAssertion) throw __softErr; stepLogger.warn(typeof __softErr === 'object' && __softErr !== null && 'message' in __softErr ? __softErr.message : String(__softErr)); }`;
      });

      // Step logger with softExpect/softAction (matches runner)
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => {
          softErrors.push(msg);
          logFn('warn', `[WARN] ${msg}`);
        },
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
        softAction: async (fn: () => Promise<void>, label?: string) => {
          try {
            await fn();
          } catch (e: unknown) {
            const msg = label || (e instanceof Error ? e.message : String(e));
            softErrors.push(msg);
            logFn('warn', `[SOFT FAIL] ${msg}`);
          }
        },
      };

      // Shared expect shim — superset of the previous inline implementation.
      // Strictly additive: matchers the inline shim shipped behave the same;
      // new matchers (toBeAttached, toHaveValue, toHaveAttribute, full .not
      // chains, …) become available. See packages/shared/src/playwright-expect.ts
      const expect = createExpect();

      // locateWithFallback — supports { type, value } format, ocr-text, role-name, coordinate fallback
      const lwfStats = command.selectorStats ?? [];
      const lwfDefaultTimeoutMs = command.selectorTimeoutMs ?? 3000;
      const lwfSortCache = new Map<string, Array<{ type: string; value: string }>>();
      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        // Normalize selectors to { type, value } format
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            // Legacy format: { selector, css, text }
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        const lwfHash = hashSelectors(validSelectors as SelectorRef[]);
        let ordered = lwfSortCache.get(lwfHash);
        if (!ordered) {
          ordered = lwfStats.length > 0
            ? sortSelectorsByStats(validSelectors, lwfStats.filter((r) => r.hash === lwfHash))
            : validSelectors;
          lwfSortCache.set(lwfHash, ordered);
        }

        logFn('info', `[action] ${action}${value ? ` "${value}"` : ''} (${ordered.length} selectors)`);

        for (const sel of ordered) {
          const attemptStart = Date.now();
          try {
            let locator;
            if (sel.type === 'ocr-text') {
              const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
              locator = pg.getByText(text, { exact: false });
            } else if (sel.type === 'role-name') {
              const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
              if (match) {
                locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
              } else {
                locator = pg.locator(sel.value);
              }
            } else {
              locator = pg.locator(sel.value);
            }

            const target = locator.first();
            const lwfStat = lwfStats.find((r) => r.hash === lwfHash && r.type === sel.type && r.value === sel.value);
            const lwfCandidateTimeout = selectorTimeoutFor(lwfStat, lwfDefaultTimeoutMs);
            await target.waitFor({ timeout: lwfCandidateTimeout });

            logFn('info', `[action] ${action} matched via ${sel.type}`);
            if (action === 'locate') {
              selectorOutcomes.push({ hash: lwfHash, type: sel.type, value: sel.value, success: true, responseTimeMs: Date.now() - attemptStart });
              return target;
            }
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();

            selectorOutcomes.push({ hash: lwfHash, type: sel.type, value: sel.value, success: true, responseTimeMs: Date.now() - attemptStart });
            return target;
          } catch {
            selectorOutcomes.push({ hash: lwfHash, type: sel.type, value: sel.value, success: false });
            continue;
          }
        }

        // Coordinate fallback for clicks
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }

        // Coordinate fallback for fill - click to focus then type
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }

        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      // Speed-aware replayCursorPath — respects cursorPlaybackSpeed setting
      const speed = command.cursorPlaybackSpeed ?? 1;
      const replayCursorPathFn = async (pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await pg.mouse.move(x, y);
          if (delay > 0 && speed > 0) {
            await pg.waitForTimeout(Math.round(delay / speed));
          }
        }
      };

      // Downloads helper — always provided, captures downloads passively + on-demand
      const dlList: Array<{ suggestedFilename: string; path: string }> = [];
      // Passive listener — catches all downloads automatically
      page.on('download', async (download) => {
        const safeName = download.suggestedFilename().replace(/\.\./g, '_');
        logFn('info', `[download] Captured: ${safeName} (url: ${download.url().slice(0, 80)})`);
        if (!dlList.some(d => d.suggestedFilename === safeName)) {
          dlList.push({ suggestedFilename: safeName, path: safeName });
        }
      });
      const downloadsHelper = {
        waitForDownload: async (triggerAction: () => Promise<void>) => {
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            triggerAction(),
          ]);
          const safeName = download.suggestedFilename().replace(/\.\./g, '_');
          if (!dlList.some(d => d.suggestedFilename === safeName)) {
            dlList.push({ suggestedFilename: safeName, path: safeName });
          }
          return { filename: safeName, path: safeName };
        },
        list: () => dlList,
        waitForAny: async (timeoutMs = 5000) => {
          logFn('info', `[download] waitForAny: polling for up to ${timeoutMs}ms (current count: ${dlList.length})`);
          const start = Date.now();
          while (dlList.length === 0 && Date.now() - start < timeoutMs) {
            await page.waitForTimeout(250);
          }
          logFn('info', `[download] waitForAny: done after ${Date.now() - start}ms, downloads: ${dlList.length}`);
        },
      };

      logFn('info', 'Executing test code...');

      // Heartbeat timer — logs every 15s so the user knows the test is still running
      const heartbeatStart = Date.now();
      const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - heartbeatStart) / 1000);
        logFn('info', `Test still running... (${elapsed}s elapsed)`);
      }, 15000);

      // Helpers — parity with the remote runner. fileUpload and network are
      // page-only, so they're always real. clipboard requires a permissions
      // grant the EB command type doesn't yet expose (continue passing null
      // until that field is plumbed). fixtures are passed as an empty map
      // because the EB command type doesn't yet carry a fixtures payload;
      // tests that don't use fixtures are unaffected.
      const fileUploadHelper = createFileUploadHelper(page);
      const clipboardHelper = createClipboardHelper(page, { granted: false });
      const networkHelper = createNetworkHelper(page);
      const { fixturesMap } = decodeFixturesToTmp(undefined, command.testRunId);

      // Execute with timeout — close context to kill in-flight Playwright ops on timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
            const testFn = new AsyncFunction(
              'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'fileUpload', 'clipboard', 'downloads', 'network', 'replayCursorPath', 'fixtures', '__stepReached', '__assertion',
              body
            );
            await testFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, null, locateWithFallback, fileUploadHelper, clipboardHelper, downloadsHelper, networkHelper, replayCursorPathFn, fixturesMap, __stepReached, __assertion);
          })().then(r => { clearTimeout(timeoutTimer); return r; }),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
              // For persistent (reused) contexts, close only the page (other tests still need the context).
              if (reusedPersistentContext) {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing page (keeping persistent context)`);
                page.close().catch(() => {});
              } else {
                logFn('warn', `Timeout fired (${testTimeout}ms) — closing context to kill in-flight operations`);
                testContext.close().catch(() => {});
              }
              reject(new Error(`Test execution timed out after ${testTimeout}ms`));
            }, testTimeout);
            abortCtrl.signal.addEventListener('abort', () => {
              clearTimeout(timeoutTimer);
              if (reusedPersistentContext) {
                logFn('info', 'Abort signal received — closing page (keeping persistent context)');
                page.close().catch(() => {});
              } else {
                logFn('info', 'Abort signal received — closing context');
                testContext.close().catch(() => {});
              }
              reject(new Error('Test cancelled'));
            });
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
        clearInterval(heartbeat);
      }

      logFn('info', 'Test code execution completed');

      // Test body finished cleanly — close out the in-flight step.
      try { lastFinishStep?.('passed'); } catch { /* never break the run on telemetry */ }

      // Extract values from page fields for extract-mode TestVariables.
      // Done before close so locators still resolve. Failures are best-effort
      // (logged + recorded as empty string), never fail the whole test.
      await runExtractions();

      // Check console/network error modes (mirrors runner.ts logic)
      const consoleErrorMode = command.consoleErrorMode || 'fail';
      const networkErrorMode = command.networkErrorMode || 'fail';
      const ignoreExternal = command.ignoreExternalNetworkErrors ?? false;
      let targetOrigin: string | undefined;
      try { targetOrigin = new URL(command.targetUrl).origin; } catch { /* ignore */ }
      const errorParts: string[] = [];

      if (consoleErrors.length > 0 && consoleErrorMode !== 'ignore') {
        const msg = `Console errors detected: ${consoleErrors.join('; ')}`;
        if (consoleErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      const networkFailures = allNetworkRequests.filter(r => {
        if (r.status < 400 && !r.failed) return false;
        if (ignoreExternal && targetOrigin) {
          try { if (new URL(r.url).origin !== targetOrigin) return false; } catch { /* keep */ }
        }
        // Ignore transient network bursts on sub-resource loads (CNI/DNS
        // instability during build startup). Keep real 4xx/5xx.
        // ERR_ABORTED covers SPA navigations that cancel in-flight RSC
        // prefetches (?_rsc=…) — not a real failure, just the framework
        // doing its job. The rest are transient sub-resource bursts during
        // CNI/DNS instability on container startup.
        if (r.failed && r.errorText && /net::ERR_ABORTED|net::ERR_NETWORK_CHANGED|net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION_RESET|net::ERR_CONNECTION_CLOSED|net::ERR_NETWORK_IO_SUSPENDED/i.test(r.errorText)) {
          return false;
        }
        return true;
      });
      if (networkFailures.length > 0 && networkErrorMode !== 'ignore') {
        const failureDetails = networkFailures.map(f => `${f.method} ${f.url} (${f.status})`).join('; ');
        const msg = `Network failures detected: ${failureDetails}`;
        if (networkErrorMode === 'warn') {
          logFn('warn', msg);
        } else {
          errorParts.push(msg);
        }
      }

      if (errorParts.length > 0) {
        throw new Error(errorParts.join(' | '));
      }

      // Take success screenshot if none captured
      if (screenshots.length === 0) {
        await captureScreenshot('success');
      }

      // Capture DOM snapshot after test body ran so it aligns with the final screenshot.
      await captureFinalDomSnapshot();

      // Harvest axe-core results. Two paths share the same `enableA11y`
      // toggle:
      //   1. URL-Diff tests: a synthetic body in `src/lib/url-diff/capture.ts`
      //      has already run axe-core and stamped `window.__urlDiffResult`.
      //      We just read it.
      //   2. Regular recorded tests: the body does nothing a11y-related, so
      //      the EB itself drives `@axe-core/playwright` against the final
      //      page state when the toggle is on. Without this branch, the
      //      Playwright setting "Accessibility Checks" silently no-ops for
      //      everything except URL-Diff captures.
      // Truncate the a11y tree at 512 KB to keep `runner_command_results.payload`
      // JSON sane.
      let a11yViolations: EmbeddedTestResult['a11yViolations'];
      let a11yPassesCount: number | undefined;
      let accessibilityTree: unknown;
      if (command.enableA11y) {
        try {
          const harvested = await page.evaluate(() => {
            const w = window as unknown as { __urlDiffResult?: unknown };
            return w.__urlDiffResult ?? null;
          }) as null | {
            violations?: EmbeddedTestResult['a11yViolations'];
            passes?: number;
            accessibilityTree?: unknown;
          };
          if (harvested && typeof harvested === 'object') {
            a11yViolations = harvested.violations;
            a11yPassesCount = typeof harvested.passes === 'number' ? harvested.passes : undefined;
            const treeRaw = harvested.accessibilityTree;
            if (treeRaw !== undefined && treeRaw !== null) {
              const treeJson = JSON.stringify(treeRaw);
              if (treeJson.length > 512_000) {
                accessibilityTree = { _truncated: true, byteLength: treeJson.length };
              } else {
                accessibilityTree = treeRaw;
              }
            }
          } else {
            // No URL-Diff harvest available. Run axe-core directly against the
            // page so non-URL-Diff tests also get a11y data with the toggle on.
            // Tags match `src/lib/url-diff/capture.ts` (wcag2a + wcag2aa) so
            // baseline vs current comparisons stay apples-to-apples.
            try {
              const mod = await import('@axe-core/playwright');
              const AxeBuilder = (mod as unknown as { default?: unknown; AxeBuilder?: unknown }).default
                ?? (mod as unknown as { AxeBuilder?: unknown }).AxeBuilder
                ?? mod;
              type AxeRawNode = {
                target?: unknown;
                failureSummary?: string;
                html?: string;
              };
              type AxeRawViolation = {
                id: string;
                impact: 'critical' | 'serious' | 'moderate' | 'minor';
                description: string;
                help: string;
                helpUrl: string;
                nodes: AxeRawNode[];
                tags?: string[];
              };
              type AxeBuilderCtor = new (opts: { page: Page }) => {
                withTags(tags: string[]): { analyze(): Promise<{ violations: AxeRawViolation[]; passes: unknown[] }> };
              };
              const builder = new (AxeBuilder as unknown as AxeBuilderCtor)({ page });
              const axeResults = await builder.withTags(['wcag2a', 'wcag2aa']).analyze();
              // axe-core returns `nodes` as an Array<NodeResult>, but our
              // schema (and wcag-score) expect a count. Without this remap
              // `Math.min(array, 3)` coerces to NaN, poisoning the build
              // a11y_score and rejecting the update at the Postgres layer.
              // Mirrors src/lib/url-diff/capture.ts:102. We also keep the
              // first 3 nodes' selector + failureSummary so the build/test
              // a11y drill-in UI can surface a real anchor without making
              // an extra DB column.
              const SAMPLE_NODE_CAP = 3;
              const HTML_CAP = 240;
              const violations: NonNullable<EmbeddedTestResult['a11yViolations']> = Array.isArray(axeResults.violations)
                ? axeResults.violations.map((v) => {
                    const rawNodes = Array.isArray(v.nodes) ? v.nodes : [];
                    const sampleNodes = rawNodes.slice(0, SAMPLE_NODE_CAP).map((n) => ({
                      target: Array.isArray(n.target) ? n.target.map(String) : [],
                      failureSummary: typeof n.failureSummary === 'string' ? n.failureSummary : undefined,
                      html: typeof n.html === 'string' ? n.html.slice(0, HTML_CAP) : undefined,
                    }));
                    return {
                      id: v.id,
                      impact: v.impact,
                      description: v.description,
                      help: v.help,
                      helpUrl: v.helpUrl,
                      nodes: rawNodes.length,
                      tags: v.tags,
                      ...(sampleNodes.length > 0 ? { sampleNodes } : {}),
                    };
                  })
                : [];
              a11yViolations = violations;
              a11yPassesCount = Array.isArray(axeResults.passes) ? axeResults.passes.length : 0;
            } catch (axeErr) {
              logFn('warn', `axe-core run failed: ${axeErr instanceof Error ? axeErr.message : String(axeErr)}`);
              // Leave a11yViolations undefined; verify focus view will show
              // the "not captured" hint with the settings link. This is the
              // correct signal: the toggle is on but the harvest failed, so
              // operators should investigate (network blocked, page closed,
              // axe-core missing from EB image).
            }
          }
        } catch (err) {
          logFn('warn', `a11y harvest failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Harvest design-system violations. Walks the live DOM after the
      // test body completes, samples computed styles per visible element,
      // and reports values not in the allowed-token set. Categories follow
      // the Lastest design-system spec: color (any color property),
      // border-radius, font-family, font-size, and spacing (margin/padding/gap).
      // Same surface model as a11y — collected per-screenshot, aggregated
      // to a build-level score on the host side.
      let designSystemViolations: EmbeddedTestResult['designSystemViolations'];
      let designSystemRulesChecked: number | undefined;
      if (command.designSystem && command.designSystem.tokens) {
        try {
          const tokenSet = command.designSystem.tokens;
          const ignoredSet = new Set(command.designSystem.ignoredCategories ?? []);
          const cap = command.designSystem.maxViolationsPerScreenshot ?? 200;

          // Send the allowed-set into the page so the walker can match
          // computed values without round-tripping per element.
          const harvested = await page.evaluate(
            ({ tokens, ignored, cap: vCap }) => {
              type Cat = 'color' | 'border-radius' | 'font-family' | 'font-size' | 'spacing';
              const ignoredCats = new Set(ignored as Cat[]);

              const allowed: Record<Cat, Map<string, string>> = {
                color: new Map(),
                'border-radius': new Map(),
                'font-family': new Map(),
                'font-size': new Map(),
                spacing: new Map(),
              };
              for (const cat of Object.keys(allowed) as Cat[]) {
                const list = (tokens as Record<Cat, Array<{ name: string; value: string }>>)[cat] ?? [];
                for (const t of list) allowed[cat].set(t.value, t.name);
              }

              // Normalize a CSS color from the browser's getComputedStyle
              // output (always rgb()/rgba() literals) to 6/8-digit lowercase hex.
              const RGB = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/;
              const hh = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
              function normColor(raw: string): string | null {
                const v = raw.trim().toLowerCase();
                if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return '#00000000';
                const m = v.match(RGB);
                if (!m) return null;
                const r = parseInt(m[1], 10);
                const g = parseInt(m[2], 10);
                const b = parseInt(m[3], 10);
                const a = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 255) : null;
                return a === null || a === 255 ? `#${hh(r)}${hh(g)}${hh(b)}` : `#${hh(r)}${hh(g)}${hh(b)}${hh(a)}`;
              }

              function normPx(raw: string): string | null {
                const v = raw.trim().toLowerCase();
                if (v === 'auto' || v === 'normal' || v === '') return null;
                const m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
                if (!m) return null;
                return `${Math.round(parseFloat(m[1]))}px`;
              }

              function normFamily(raw: string): string | null {
                const first = raw.split(',')[0]?.trim();
                if (!first) return null;
                return first.replace(/["']/g, '').toLowerCase();
              }

              // Best-effort selector for a violation sample. data-testid →
              // id → tag.class — matches what the rest of the codebase
              // prefers when surfacing element anchors.
              function makeSelector(el: Element): string {
                const t = el.getAttribute('data-testid');
                if (t) return `[data-testid="${t}"]`;
                if (el.id) return `#${el.id}`;
                const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
                return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
              }

              const violationsByKey = new Map<string, {
                id: string;
                category: Cat;
                property: string;
                actual: string;
                expected?: string;
                expectedName?: string;
                impact: 'critical' | 'serious' | 'moderate' | 'minor';
                nodes: number;
                sampleNodes: Array<{ target: string[]; failureSummary?: string; html?: string }>;
              }>();
              const SAMPLE_CAP = 3;

              const record = (
                category: Cat,
                property: string,
                actual: string,
                el: Element,
              ) => {
                if (ignoredCats.has(category)) return;
                const allow = allowed[category];
                if (!allow || allow.size === 0) return;
                if (allow.has(actual)) return;
                if (violationsByKey.size >= vCap && !violationsByKey.has(`${category}:${actual}`)) return;
                const key = `${category}:${actual}`;
                const impact: 'critical' | 'serious' | 'moderate' | 'minor' =
                  category === 'color' || category === 'font-family' ? 'serious'
                  : category === 'border-radius' ? 'moderate'
                  : 'minor';

                let row = violationsByKey.get(key);
                if (!row) {
                  // Compute nearest-allowed only for the first occurrence —
                  // saves work in the per-element hot loop. For colors we
                  // pick by RGB distance; for px values by absolute delta;
                  // font-family has no useful "nearest".
                  let expected: string | undefined;
                  let expectedName: string | undefined;
                  if (category === 'color') {
                    const a = actual.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/);
                    if (a) {
                      const ar = parseInt(a[1], 16), ag = parseInt(a[2], 16), ab = parseInt(a[3], 16);
                      let best: { v: string; n: string; d: number } | null = null;
                      for (const [v, n] of allow) {
                        const m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/);
                        if (!m) continue;
                        const dr = ar - parseInt(m[1], 16);
                        const dg = ag - parseInt(m[2], 16);
                        const db = ab - parseInt(m[3], 16);
                        const d = dr * dr + dg * dg + db * db;
                        if (!best || d < best.d) best = { v, n, d };
                      }
                      if (best) { expected = best.v; expectedName = best.n; }
                    }
                  } else if (category === 'border-radius' || category === 'font-size' || category === 'spacing') {
                    const a = parseFloat(actual);
                    if (!Number.isNaN(a)) {
                      let best: { v: string; n: string; d: number } | null = null;
                      for (const [v, n] of allow) {
                        const m = parseFloat(v);
                        if (Number.isNaN(m)) continue;
                        const d = Math.abs(m - a);
                        if (!best || d < best.d) best = { v, n, d };
                      }
                      if (best) { expected = best.v; expectedName = best.n; }
                    }
                  }
                  row = {
                    id: key,
                    category,
                    property,
                    actual,
                    expected,
                    expectedName,
                    impact,
                    nodes: 0,
                    sampleNodes: [],
                  };
                  violationsByKey.set(key, row);
                }
                row.nodes += 1;
                if (row.sampleNodes.length < SAMPLE_CAP) {
                  row.sampleNodes.push({
                    target: [makeSelector(el)],
                    failureSummary: row.expectedName
                      ? `Expected ${row.expectedName} (${row.expected}); got ${actual}`
                      : `Off-token ${category} value: ${actual}`,
                    html: el.outerHTML?.slice(0, 240),
                  });
                }
              };

              // Walk every visible element. Cap at 5000 to keep the in-page
              // budget bounded on huge SPAs.
              const all = Array.from(document.body.querySelectorAll('*')).slice(0, 5000);
              let rulesChecked = 0;
              for (const el of all) {
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none') continue;

                // Color properties. background-color is only sampled when
                // not transparent (sentinel hex above).
                if (!ignoredCats.has('color')) {
                  const colorProps: Array<[string, string]> = [
                    ['color', cs.color],
                    ['background-color', cs.backgroundColor],
                    ['border-top-color', cs.borderTopColor],
                    ['border-bottom-color', cs.borderBottomColor],
                    ['border-left-color', cs.borderLeftColor],
                    ['border-right-color', cs.borderRightColor],
                  ];
                  for (const [prop, raw] of colorProps) {
                    const norm = normColor(raw);
                    if (!norm) continue;
                    if (norm === '#00000000') continue; // skip fully transparent
                    rulesChecked++;
                    record('color', prop, norm, el);
                  }
                }

                if (!ignoredCats.has('border-radius')) {
                  for (const prop of ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'] as const) {
                    const raw = cs.getPropertyValue(prop);
                    const norm = normPx(raw);
                    if (norm === null || norm === '0px') continue;
                    rulesChecked++;
                    record('border-radius', prop, norm, el);
                  }
                }

                if (!ignoredCats.has('font-family')) {
                  const norm = normFamily(cs.fontFamily);
                  if (norm) {
                    rulesChecked++;
                    record('font-family', 'font-family', norm, el);
                  }
                }

                if (!ignoredCats.has('font-size')) {
                  const norm = normPx(cs.fontSize);
                  if (norm) {
                    rulesChecked++;
                    record('font-size', 'font-size', norm, el);
                  }
                }

                if (!ignoredCats.has('spacing')) {
                  for (const prop of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const) {
                    const raw = cs.getPropertyValue(prop);
                    const norm = normPx(raw);
                    if (norm === null || norm === '0px') continue;
                    rulesChecked++;
                    record('spacing', prop, norm, el);
                  }
                }
              }

              return {
                violations: Array.from(violationsByKey.values()),
                rulesChecked,
              };
            },
            { tokens: tokenSet, ignored: Array.from(ignoredSet), cap },
          );
          designSystemViolations = harvested.violations;
          designSystemRulesChecked = harvested.rulesChecked;
          logFn('info', `design-system harvest: ${designSystemViolations?.length ?? 0} violations / ${designSystemRulesChecked} rules checked`);
        } catch (err) {
          logFn('warn', `design-system harvest failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Final URL trajectory + Web Vitals sample for the last step (which
      // never triggers a finishCurrentStep advance because nothing followed it).
      if (urlRecorder && currentStepIdx >= 0) {
        try {
          urlTrajectory.push(urlRecorder.sampleAtStep(
            page,
            currentStepIdx,
            stepDescriptors[currentStepIdx]?.label,
            Date.now() - startTime,
          ));
        } catch { /* best-effort */ }
      }
      try {
        const vitals = await sampleWebVitals(
          page,
          currentStepIdx >= 0 ? currentStepIdx : undefined,
          currentStepIdx >= 0 ? stepDescriptors[currentStepIdx]?.label : undefined,
        );
        if (vitals) webVitals.push(vitals);
      } catch { /* best-effort */ }
      // Storage state snapshot — token-shaped values are redacted in-helper.
      try {
        storageStateSnapshot = await captureStorageStateSnapshot(testContext, page);
      } catch { /* best-effort */ }

      const durationMs = Date.now() - startTime;
      logFn('info', `Test passed in ${durationMs}ms (${screenshots.length} screenshots)`);

      result = {
        status: 'passed' as const,
        durationMs,
        logs,
        screenshots,
        texts: texts.length > 0 ? texts : undefined,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
        networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
        softErrors: softErrors.length > 0 ? softErrors : undefined,
        assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
        lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
        totalSteps: stepCount > 0 ? stepCount : undefined,
        domSnapshot,
        a11yViolations,
        a11yPassesCount,
        accessibilityTree,
        designSystemViolations,
        designSystemRulesChecked,
        extractedVariables,
        selectorOutcomes: selectorOutcomes.length > 0 ? selectorOutcomes : undefined,
        urlTrajectory: urlTrajectory.length > 0 ? urlTrajectory : undefined,
        webVitals: webVitals.length > 0 ? webVitals : undefined,
        storageStateSnapshot,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const isCancelled = errorMessage.includes('cancelled') || abortCtrl.signal.aborted;

      // Mark the in-flight step as failed (or cancelled-as-failed) so the
      // live timeline halts on the exact step that threw.
      try { lastFinishStep?.('failed', errorMessage); } catch { /* telemetry */ }

      if (isCancelled) {
        logFn('info', 'Test cancelled');
        result = {
          status: 'cancelled' as const, durationMs, logs, screenshots,
          texts: texts.length > 0 ? texts : undefined,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
          domSnapshot,
          selectorOutcomes: selectorOutcomes.length > 0 ? selectorOutcomes : undefined,
          urlTrajectory: urlTrajectory.length > 0 ? urlTrajectory : undefined,
          webVitals: webVitals.length > 0 ? webVitals : undefined,
        };
      } else {
        const isTimeout = errorMessage.includes('timed out');
        logFn('error', `Test ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

        // Try to capture error screenshot + DOM snapshot (skip on timeout — context is closed)
        let errorScreenshot: string | undefined;
        if (!isTimeout) {
          try {
            const buffer = await page.screenshot();
            errorScreenshot = buffer.toString('base64');
          } catch { /* ignore */ }
          await captureFinalDomSnapshot();
          // Extract whatever's still readable on the page so the Vars-tab
          // "Last run" column reflects state at the failure point.
          await runExtractions();
        }

        // Try a final URL trajectory + Web Vitals sample (skip on timeout — page is dead).
        // Use the outer-scope mirrors of currentStepIdx/stepDescriptors because the
        // inner-scope versions are out of reach from this catch.
        if (!isTimeout && urlRecorder && outerCurrentStepIdx >= 0) {
          try {
            urlTrajectory.push(urlRecorder.sampleAtStep(
              page,
              outerCurrentStepIdx,
              outerStepDescriptors[outerCurrentStepIdx]?.label,
              Date.now() - startTime,
            ));
          } catch { /* best-effort */ }
        }
        if (!isTimeout) {
          try {
            const vitals = await sampleWebVitals(
              page,
              outerCurrentStepIdx >= 0 ? outerCurrentStepIdx : undefined,
              outerCurrentStepIdx >= 0 ? outerStepDescriptors[outerCurrentStepIdx]?.label : undefined,
            );
            if (vitals) webVitals.push(vitals);
          } catch { /* best-effort */ }
          try {
            storageStateSnapshot = await captureStorageStateSnapshot(testContext, page);
          } catch { /* best-effort */ }
        }

        result = {
          status: (isTimeout ? 'timeout' : 'failed') as 'timeout' | 'failed',
          durationMs,
          error: { message: errorMessage, stack: errorStack, screenshot: errorScreenshot },
          logs,
          screenshots,
          texts: texts.length > 0 ? texts : undefined,
          consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
          networkRequests: allNetworkRequests.length > 0 ? allNetworkRequests : undefined,
          softErrors: softErrors.length > 0 ? softErrors : undefined,
          assertionResults: assertionResults.length > 0 ? assertionResults : undefined,
          lastReachedStep: reachedStep >= 0 ? reachedStep : undefined,
          totalSteps: stepCount > 0 ? stepCount : undefined,
          domSnapshot,
          extractedVariables,
          selectorOutcomes: selectorOutcomes.length > 0 ? selectorOutcomes : undefined,
          urlTrajectory: urlTrajectory.length > 0 ? urlTrajectory : undefined,
          webVitals: webVitals.length > 0 ? webVitals : undefined,
          storageStateSnapshot,
        };
      }
    } finally {
      this.abortController = null;
      // Capture video before closing context (video is finalized on close)
      const video = page?.video();
      // Stop screencast before closing page so CDP session doesn't die unexpectedly
      if (callbacks?.onBeforePageClose) {
        try { await callbacks.onBeforePageClose(); } catch { /* ignore */ }
      }
      // Close the per-test page + context (no state leaks between tests).
      // For reused persistent contexts, keep the context alive for sibling tests.
      await page.close().catch(() => {});
      if (!reusedPersistentContext) {
        await testContext.close().catch(() => {});
      }

      // After context close, video file is finalized — read and base64 encode it
      if (video && videoDir && result) {
        try {
          const videoFilename = `${command.testRunId}-${command.testId}.webm`;
          const tempDest = path.join(videoDir, videoFilename);
          await video.saveAs(tempDest);
          await video.delete();
          await watermarkVideo(tempDest);
          const videoBuffer = fs.readFileSync(tempDest);
          result.videoData = videoBuffer.toString('base64');
          result.videoFilename = videoFilename;
          logFn('info', `Video captured: ${videoFilename} (${Math.round(videoBuffer.length / 1024)}KB)`);
          // Clean up temp dir
          fs.rmSync(videoDir, { recursive: true, force: true });
        } catch {
          // Video capture is best-effort
        }
      }
    }

    return result!
  }

  async runSetup(
    browser: Browser,
    command: RunSetupPayload,
    callbacks?: {
      onPageCreated?: (page: Page) => Promise<void> | void;
    },
  ): Promise<EmbeddedSetupResult> {
    const startTime = Date.now();
    const logs: Array<{ timestamp: number; level: string; message: string }> = [];
    const setupTimeout = Math.max(command.timeout || 120000, 30000);

    const logFn = (level: string, message: string) => {
      logs.push({ timestamp: Date.now(), level, message });
      console.log(`  [${level.toUpperCase()}] [setup:${command.setupId}] ${message}`);
    };

    const viewport = command.viewport || { width: 1280, height: 720 };
    const needsStabilizedContext = command.stabilization?.crossOsConsistency || command.stabilization?.freezeAnimations;

    // No storageState injection — this IS the setup that creates the session
    const setupContext = await browser.newContext({
      viewport,
      ...(needsStabilizedContext ? { deviceScaleFactor: 1 } : {}),
      ...(needsStabilizedContext ? { locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' as const } : {}),
      ...(command.stabilization?.freezeAnimations ? { reducedMotion: 'reduce' as const } : {}),
      // UA override — auth handshakes are exactly where Cloudflare Turnstile /
      // Clerk reject HeadlessChrome fingerprints; setup must use the same UA
      // as the downstream test contexts.
      ...(command.userAgentOverride ? { userAgent: command.userAgentOverride } : {}),
    });
    const page = await setupContext.newPage();
    // On success, we transfer ownership of setupContext to this.setupContexts
    // for reuse by subsequent tests; finally block must not close it in that case.
    let setupPageClosed = false;
    let retainContext = false;

    try {
      // Give the caller a chance to attach live-stream infra (CDP screencast) to
      // the setup page before navigation begins. Used by debug mode so the user
      // can watch setup run.
      if (callbacks?.onPageCreated) {
        try {
          await callbacks.onPageCreated(page);
        } catch (cbErr) {
          logFn('warn', `onPageCreated callback failed: ${cbErr instanceof Error ? cbErr.message : String(cbErr)}`);
        }
      }

      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      // Setup freeze scripts BEFORE navigation
      if (command.stabilization) {
        await setupFreezeScripts(page, command.stabilization);
        logFn('info', `Stabilization applied`);
      }

      // Extract function body (same tiered extractor as runTest)
      const extracted = extractTestBody(command.code, { allowSetup: true });
      let body: string = stripTypeAnnotations(extracted.body);

      // Remove test-local function definitions
      const lwfResult = removeFunctionDefinition(body, 'locateWithFallback');
      if (lwfResult.removed) body = lwfResult.body;
      const rcpResult = removeFunctionDefinition(body, 'replayCursorPath');
      if (rcpResult.removed) body = rcpResult.body;

      // Patch selectAll
      body = body.replace(/page\.keyboard\.selectAll\(\)/g, "page.keyboard.press('Control+a')");

      // Noop screenshot/stepLogger for setup
      const _noopScreenshot = async () => {};
      const stepLogger = {
        log: (msg: string) => logFn('info', `Step: ${msg}`),
        warn: (msg: string) => logFn('warn', `[WARN] ${msg}`),
        error: (msg: string) => logFn('error', `Step error: ${msg}`),
        softExpect: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
        softAction: async (fn: () => Promise<void>) => { try { await fn(); } catch { /* soft */ } },
      };

      // Setup-script expect — same shared shim the test path uses. Per the
      // approved plan, setup-script *arg list* parity (#5 in the parity
      // report) is out of scope; only the matcher surface is upgraded here.
      const expect = createExpect();

      const locateWithFallback = async (
        pg: Page,
        selectors: Array<{ type: string; value: string } | string | { selector?: string; css?: string; text?: string }>,
        action: string,
        value?: string | null,
        coords?: { x: number; y: number } | null,
        options?: Record<string, unknown> | null
      ) => {
        const validSelectors = selectors
          .map((sel) => {
            if (typeof sel === 'string') return { type: 'css', value: sel };
            if ('type' in sel && 'value' in sel) return sel as { type: string; value: string };
            const legacy = sel as { selector?: string; css?: string; text?: string };
            return { type: 'css', value: legacy.selector || legacy.css || legacy.text || '' };
          })
          .filter((s) => s.value && s.value.trim() && !s.value.includes('undefined'));

        logFn('info', `[setup action] ${action}${value ? ` "${value}"` : ''} (${validSelectors.length} selectors)`);

        for (const sel of validSelectors) {
          try {
            let locator;
            if (sel.type === 'ocr-text') {
              const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');
              locator = pg.getByText(text, { exact: false });
            } else if (sel.type === 'role-name') {
              const match = sel.value.match(/^role=(\w+)\[name="(.+)"\]$/);
              if (match) locator = pg.getByRole(match[1] as 'button' | 'link' | 'heading', { name: match[2] });
              else locator = pg.locator(sel.value);
            } else {
              locator = pg.locator(sel.value);
            }
            const target = locator.first();
            await target.waitFor({ timeout: 3000 });
            logFn('info', `[setup action] ${action} matched via ${sel.type}`);
            if (action === 'locate') return target;
            if (action === 'click') await target.click(options || {});
            else if (action === 'fill') await target.fill(value || '');
            else if (action === 'selectOption') await target.selectOption(value || '');
            else if (action === 'check') await target.check();
            else if (action === 'uncheck') await target.uncheck();
            return target;
          } catch {
            continue;
          }
        }
        if (action === 'click' && coords) {
          logFn('info', `Falling back to coordinate click at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y, options || {});
          return;
        }
        if (action === 'fill' && coords) {
          logFn('info', `Falling back to coordinate fill at (${coords.x}, ${coords.y})`);
          await pg.mouse.click(coords.x, coords.y);
          await pg.keyboard.press('Control+a');
          await pg.keyboard.type(value || '');
          return;
        }
        throw new Error('No selector matched: ' + JSON.stringify(validSelectors));
      };

      const replayCursorPathFn = async (_pg: Page, moves: [number, number, number][]) => {
        for (const [x, y, delay] of moves) {
          await page.mouse.move(x, y);
          if (delay > 0) await page.waitForTimeout(delay);
        }
      };

      logFn('info', 'Executing setup code...');

      // Execute with timeout
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        (async () => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const setupFn = new AsyncFunction(
            'page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', 'appState', 'locateWithFallback', 'replayCursorPath',
            body
          );
          await setupFn(page, command.targetUrl.replace(/\/+$/, ''), 'screenshot.png', stepLogger, expect, null, locateWithFallback, replayCursorPathFn);
        })().then(r => { clearTimeout(timeoutTimer); return r; }),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            logFn('warn', `Setup timeout fired (${setupTimeout}ms)`);
            setupContext.close().catch(() => {});
            reject(new Error(`Setup timed out after ${setupTimeout}ms`));
          }, setupTimeout);
        }),
      ]);

      logFn('info', 'Setup code executed successfully');

      // Wait for post-setup navigation (e.g., login redirect)
      const setupPageUrl = page.url();
      try {
        await page.waitForURL(
          (url: URL) => url.toString() !== setupPageUrl,
          { timeout: 10000, waitUntil: 'networkidle' }
        );
        logFn('info', `Post-setup navigation: ${setupPageUrl} → ${page.url()}`);
      } catch {
        logFn('info', 'No post-setup navigation detected (URL unchanged)');
      }

      // Poll for session cookies
      try {
        const ctx = page.context();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const cookies = await ctx.cookies();
          const hasSession = cookies.some(c =>
            c.name.includes('session') || c.name.includes('auth') || c.name.includes('token')
          );
          if (hasSession) {
            logFn('info', `Session cookie found after setup (${cookies.length} total cookies)`);
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      } catch {
        // Cookie polling failed — continue anyway
      }

      // Capture storageState snapshot. Used as a fallback: if Chromium
      // disposes the live context's target between tests (observed behavior),
      // we rebuild a fresh context with these cookies + localStorage + IndexedDB
      // instead of failing the test with "Target has been closed".
      // `indexedDB: true` (Playwright v1.51+) carries Firebase Auth / Clerk DB /
      // Supabase-v2 session tokens that previously fell out silently — see
      // project_playwright_v151_indexeddb_opt_in.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let storageStateSnapshot: any = undefined;
      try {
        storageStateSnapshot = await setupContext.storageState({ indexedDB: true });
        logFn('info', `Captured storageState snapshot: ${storageStateSnapshot.cookies.length} cookies, ${storageStateSnapshot.origins.length} origins`);
      } catch (e) {
        logFn('warn', `Failed to capture storageState snapshot: ${e}`);
      }

      // Persist the setup's BrowserContext — tests in this run reuse it,
      // preserving sessionStorage/IndexedDB/in-memory auth that storageState drops.
      //
      // KEEPALIVE PAGE: we intentionally keep the setup page OPEN. Chromium
      // disposes a BrowserContext's target when it has 0 pages for a short
      // while — keeping one navigated-but-idle page alive anchors the target
      // so tests can open and close their own pages freely alongside it.
      setupPageClosed = true; // prevent the finally block from closing it
      this.setupContexts.set(command.setupId, {
        context: setupContext,
        createdAt: Date.now(),
        storageState: storageStateSnapshot,
        viewport,
      });
      this.ensureSetupContextSweeper();
      retainContext = true;
      logFn('info', `Persistent setup context retained with keepalive page (setupId=${command.setupId}) — tests in this run will reuse it`);

      return {
        status: 'passed',
        storageState: `persistent:${command.setupId}`,
        storageStateJson: storageStateSnapshot ? JSON.stringify(storageStateSnapshot) : undefined,
        durationMs: Date.now() - startTime,
        logs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('timed out');
      logFn('error', `Setup ${isTimeout ? 'timed out' : 'failed'}: ${errorMessage}`);

      return {
        status: isTimeout ? 'timeout' : 'failed',
        durationMs: Date.now() - startTime,
        error: errorMessage,
        logs,
      };
    } finally {
      if (!setupPageClosed) await page.close().catch(() => {});
      if (!retainContext) await setupContext.close().catch(() => {});
    }
  }

  async captureScreenshot(page: Page): Promise<{ data: string; width: number; height: number } | null> {
    try {
      const buffer = await page.screenshot({ fullPage: true });
      const viewport = page.viewportSize() || { width: 1280, height: 720 };
      return {
        data: buffer.toString('base64'),
        width: viewport.width,
        height: viewport.height,
      };
    } catch {
      return null;
    }
  }
}
