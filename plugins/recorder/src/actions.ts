"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuid } from "uuid";
import { createMessage } from "@lastest/eb-protocol";
import type {
  StartRecordingCommand,
  StopRecordingCommand,
  CaptureScreenshotCommand,
  CreateAssertionCommand,
  CreateWaitCommand,
  FlagDownloadCommand,
  InsertTimestampCommand,
  PromoteSelectorCommand,
} from "@lastest/eb-protocol";
import { eventsToCodeLines } from "@lastest/recording-codegen/event-to-code";

import {
  analyzeHtmlForSelectors,
  recommendPriorityFromAnalysis,
  isMeaningful,
} from "./selector-analysis";
import type { AssertionType, SelectorConfig, WaitParams } from "./types";
import type { RecordingEvent } from "./host";
import { recorderHost } from "./wiring";

/**
 * Recorder's server actions.
 *
 * A `"use server"` module inside a `transpilePackages` workspace package
 * produces real, dispatchable action ids (spike S1), so these live in the
 * package with no codegen and no shim. Every function here is a plain async
 * export — no `export { x } from …` re-export (compiles to zero exports)
 * and no bare `export type` (compiles to a runtime action export that fails
 * the production build — recipe §6, `gamification`'s trap).
 *
 * Every action opens with `host.requireRecordingAccess()`, mirroring exactly
 * where the pre-plugin `src/server/actions/recording.ts` called
 * `requireCapability("recording:write")`. See `host.ts` for why that guard
 * lives on the host rather than baked into each session primitive.
 */

export async function startRecording(
  url: string,
  repositoryId?: string | null,
  runnerId?: string,
  setupOptions?: {
    testId?: string | null;
    scriptId?: string | null;
    steps?: Array<{
      stepType: "test" | "script" | "storage_state";
      testId?: string | null;
      scriptId?: string | null;
      storageStateId?: string | null;
    }>;
    rerecordTestId?: string | null;
  },
): Promise<{ sessionId?: string; resolvedRunnerId?: string; error?: string }> {
  const host = recorderHost();
  await host.requireRecordingAccess();

  try {
    new URL(url);
  } catch {
    return {
      error:
        "Invalid URL format. Please enter a valid URL (e.g., https://example.com)",
    };
  }

  const sessionId = uuid();
  const settings = await host.getPlaywrightSettings(repositoryId);
  const selectorPriority = settings.selectorPriority;

  if (runnerId === "auto") {
    const claimed = await host.claimRunner();
    if (!claimed) {
      return { error: "All browsers are busy. Please try again later." };
    }
    runnerId = claimed.runnerId;
  }

  if (!runnerId || runnerId === "local") {
    return {
      error: "Please select a runner or embedded browser for recording.",
    };
  }

  // Reconnecting to the same runner should always be allowed.
  const existingSession = host.getSession(repositoryId);
  if (existingSession) {
    await host.clearSession(repositoryId);
  }

  host.createSession({
    sessionId,
    runnerId,
    repositoryId: repositoryId ?? null,
    targetUrl: url,
    selectorPriority,
  });

  // Resolve setup steps to code (runners have no DB access). Precedence
  // mirrors `setup-orchestrator.ts:runTestSetup` — see `host.ts`'s
  // `resolveSetupSteps` doc for the exact chain. Explicit steps from the
  // client win; otherwise the host falls back to `rerecordTestId`'s existing
  // chain, then the repo's defaults.
  const explicitSteps = setupOptions?.steps?.length
    ? setupOptions.steps
    : setupOptions?.testId || setupOptions?.scriptId
      ? [
          {
            stepType: setupOptions.testId
              ? ("test" as const)
              : ("script" as const),
            testId: setupOptions.testId ?? null,
            scriptId: setupOptions.scriptId ?? null,
          },
        ]
      : undefined;

  const resolvedSetupSteps = await host.resolveSetupSteps({
    steps: explicitSteps,
    rerecordTestId: setupOptions?.rerecordTestId,
    repositoryId,
  });

  const ocrEnabled =
    selectorPriority.find((s) => s.type === "ocr-text")?.enabled ?? false;
  // Wake the OCR backend now so the first ocr-text capture during the
  // recording doesn't pay Tesseract init latency (fire-and-forget; the
  // backend auto-sleeps on idle if the recording never uses it).
  if (ocrEnabled) host.ocrWarmup();

  const command = createMessage<StartRecordingCommand>(
    "command:start_recording",
    {
      sessionId,
      targetUrl: url,
      viewport: {
        width: settings.viewportWidth ?? 1280,
        height: settings.viewportHeight ?? 720,
      },
      browser:
        (settings.browser as "chromium" | "firefox" | "webkit") ?? "chromium",
      selectorPriority,
      ocrEnabled,
      pointerGestures: settings.pointerGestures ?? false,
      cursorFPS: settings.cursorFPS ?? 30,
      setupSteps: resolvedSetupSteps,
    },
  );
  await host.sendCommand(runnerId, command);

  return { sessionId, resolvedRunnerId: runnerId };
}

export interface AnalyzeUrlSelectorsResult {
  recommendedPriority?: SelectorConfig[];
  topStrategies?: Array<{ type: string; count: number; unique: number }>;
  ambiguousStrategies?: Array<{ type: string; count: number }>;
  interactiveElements?: number;
  meaningful?: boolean;
  changed?: boolean;
  error?: string;
}

/**
 * Fetch the target URL and recommend a selector priority based on what the
 * page actually exposes. Read-only: it returns a recommendation; persisting
 * it is the caller's job (the recording UI applies it to the Playwright
 * settings, which auto-saves).
 */
export async function analyzeUrlForSelectors(
  url: string,
  repositoryId?: string | null,
): Promise<AnalyzeUrlSelectorsResult> {
  const host = recorderHost();
  await host.requireRecordingAccess();

  try {
    new URL(url);
  } catch {
    return {
      error:
        "Invalid URL format. Please enter a valid URL (e.g., https://example.com)",
    };
  }

  const settings = await host.getPlaywrightSettings(repositoryId);
  const current = settings.selectorPriority;

  const res = await host.fetchGuarded(url, {
    timeoutMs: 10000,
    maxRedirects: 5,
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    return {
      error: res.blocked
        ? "That URL points to a private or internal address and can't be analyzed."
        : res.error,
    };
  }
  if (
    res.contentType &&
    !/(text\/html|application\/xhtml)/i.test(res.contentType)
  ) {
    return {
      error: `Page is not HTML (${res.contentType.split(";")[0]}). Selector analysis needs an HTML page.`,
    };
  }

  const coverage = analyzeHtmlForSelectors(res.text, {
    customAttributeName: settings.customAttributeName ?? undefined,
  });
  const recommendedPriority = recommendPriorityFromAnalysis(current, coverage);
  const meaningful = isMeaningful(coverage);

  const SUMMARY_SKIP = new Set(["css-path", "coords", "text", "ocr-text"]);
  const topStrategies = (
    Object.keys(coverage.uniqueCounts) as Array<
      keyof typeof coverage.uniqueCounts
    >
  )
    .filter(
      (type) => !SUMMARY_SKIP.has(type) && coverage.uniqueCounts[type] > 0,
    )
    .map((type) => ({
      type,
      count: coverage.counts[type],
      unique: coverage.uniqueCounts[type],
    }))
    .sort((a, b) => b.unique - a.unique || b.count - a.count)
    .slice(0, 4);

  const ambiguousStrategies = (
    Object.keys(coverage.uniqueCounts) as Array<
      keyof typeof coverage.uniqueCounts
    >
  )
    .filter(
      (type) =>
        !SUMMARY_SKIP.has(type) &&
        coverage.uniqueCounts[type] === 1 &&
        coverage.counts[type] > 1,
    )
    .map((type) => ({ type, count: coverage.counts[type] }));

  const changed =
    JSON.stringify(recommendedPriority) !== JSON.stringify(current);

  return {
    recommendedPriority,
    topStrategies,
    ambiguousStrategies,
    interactiveElements: coverage.interactiveElements,
    meaningful,
    changed,
  };
}

/**
 * Recording-time OCR: convert each event's `data.ocrCrop` (base64 PNG of the
 * clicked element) into an `ocr-text="…"` fallback selector. Crops are always
 * stripped; extraction is best-effort. Returns the events whose `data` was
 * mutated, so the caller can write them back via `host.updateEventData`.
 */
async function applyOcrTextSelectors(
  host: ReturnType<typeof recorderHost>,
  events: RecordingEvent[],
  selectorPriority: SelectorConfig[],
): Promise<RecordingEvent[]> {
  const ocrEnabled =
    selectorPriority.find((s) => s.type === "ocr-text")?.enabled ?? false;
  const targets = events.filter(
    (e) => typeof e.data?.ocrCrop === "string" && e.data.ocrCrop,
  );
  if (targets.length === 0) return [];
  if (!ocrEnabled) {
    for (const event of targets) delete event.data.ocrCrop;
    return targets;
  }
  await Promise.allSettled(
    targets.map(async (event) => {
      const crop = event.data.ocrCrop as string;
      delete event.data.ocrCrop;
      const raw = await host.extractOcrText(Buffer.from(crop, "base64"));
      const text = raw
        ?.replace(/\s+/g, " ")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
        .trim();
      if (!text || text.length > 80) return;
      const selectors = Array.isArray(event.data.selectors)
        ? (event.data.selectors as Array<{ type: string; value: string }>)
        : (event.data.selectors = []);
      selectors.push({ type: "ocr-text", value: `ocr-text="${text}"` });
    }),
  );
  return targets;
}

function generateCodeFromRemoteEvents(
  events: RecordingEvent[],
  selectorPriority: SelectorConfig[],
  targetUrl: string,
  selectorTimeoutMs = 3000,
): string {
  const baseOrigin = new URL(targetUrl).origin;
  const coordsEnabled =
    selectorPriority.find((s) => s.type === "coords")?.enabled ?? true;
  const hasCursorEvents = events.some((e) => e.type === "cursor-move");
  const recordedTimeoutMs =
    Number.isFinite(selectorTimeoutMs) && selectorTimeoutMs > 0
      ? Math.floor(selectorTimeoutMs)
      : 3000;

  const lines: string[] = [
    `import { Page } from 'playwright';`,
    "",
    `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {`,
    `  // Per-candidate waitFor budget for locateWithFallback, baked at record time`,
    `  const __SELECTOR_TIMEOUT_MS = ${recordedTimeoutMs};`,
    ``,
    `  function buildUrl(base, path) {`,
    `    if (/^https?:\\/\\//i.test(path)) return path;`,
    `    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;`,
    `    const cleanPath = path.startsWith('/') ? path : '/' + path;`,
    `    return cleanBase + cleanPath;`,
    `  }`,
    ``,
    `  function urlMatch(base, path) {`,
    `    return new RegExp("^" + buildUrl(base, path).replace(/[.*+?()|[{}^\\]\\\\$]/g, "\\\\$&"));`,
    `  }`,
    ``,
    `  let screenshotStep = 0;`,
    `  function getScreenshotPath() {`,
    `    screenshotStep++;`,
    `    const ext = screenshotPath.lastIndexOf('.');`,
    `    if (ext > 0) {`,
    `      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);`,
    `    }`,
    `    return screenshotPath + '-step' + screenshotStep;`,
    `  }`,
    ``,
    `  async function locateWithFallback(page, selectors, action, value, coords, options) {`,
    `    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !/(^|[^\\w-])undefined($|[^\\w-])/.test(sel.value));`,
    `    for (const sel of validSelectors) {`,
    `      try {`,
    `        let locator;`,
    `        if (sel.type === 'ocr-text') {`,
    `          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');`,
    `          locator = page.getByText(text, { exact: false });`,
    `        } else if (sel.type === 'label') {`,
    `          locator = page.getByLabel(sel.value.replace(/^label="/, '').replace(/"$/, ''));`,
    `        } else if (sel.type === 'alt-text') {`,
    `          locator = page.getByAltText(sel.value.replace(/^alt-text="/, '').replace(/"$/, ''));`,
    `        } else if (sel.type === 'title') {`,
    `          locator = page.getByTitle(sel.value.replace(/^title="/, '').replace(/"$/, ''));`,
    `        } else if (sel.type === 'role-name') {`,
    `          const match = sel.value.match(/^role=(\\w+)\\[name="(.+)"\\]$/);`,
    `          if (match) {`,
    `            locator = page.getByRole(match[1], { name: match[2] });`,
    `          } else {`,
    `            locator = page.locator(sel.value);`,
    `          }`,
    `        } else {`,
    `          locator = page.locator(sel.value);`,
    `        }`,
    `        const target = locator.first();`,
    `        await target.waitFor({ timeout: __SELECTOR_TIMEOUT_MS });`,
    `        await target.scrollIntoViewIfNeeded().catch(() => {});`,
    `        if (action === 'locate') return target;`,
    `        if (action === 'click') await target.click(options || {});`,
    `        else if (action === 'fill') await target.fill(value || '');`,
    `        else if (action === 'selectOption') await target.selectOption(value || '');`,
    `        return target;`,
    `      } catch { continue; }`,
    `    }`,
    ...(coordsEnabled
      ? [
          `    if (action === 'click' && coords) {`,
          `      console.log('Falling back to coordinate click at', coords.x, coords.y);`,
          `      await page.mouse.click(coords.x, coords.y, options || {});`,
          `      return;`,
          `    }`,
          `    if (action === 'fill' && coords) {`,
          `      console.log('Falling back to coordinate fill at', coords.x, coords.y);`,
          `      await page.mouse.click(coords.x, coords.y);`,
          `      await page.keyboard.press('Control+a');`,
          `      await page.keyboard.type(value || '');`,
          `      return;`,
          `    }`,
        ]
      : []),
    `    throw new Error('No selector matched: ' + JSON.stringify(validSelectors));`,
    `  }`,
    ``,
  ];

  if (hasCursorEvents) {
    lines.push(
      `  async function replayCursorPath(page, moves) {`,
      `    for (const [x, y, delay] of moves) {`,
      `      await page.mouse.move(x, y);`,
      `      if (delay > 0) await page.waitForTimeout(delay);`,
      `    }`,
      `  }`,
      ``,
    );
  }

  const bodyLines = eventsToCodeLines(events, baseOrigin, coordsEnabled, {
    indent: "  ",
    includeCursorReplay: hasCursorEvents,
  });
  lines.push(...bodyLines);

  lines.push("}", "");
  return lines.join("\n");
}

export async function stopRecording(repositoryId?: string | null) {
  const host = recorderHost();
  await host.requireRecordingAccess();

  const remoteSession = host.getSession(repositoryId);
  if (!remoteSession?.isRecording) return null;

  const command = createMessage<StopRecordingCommand>(
    "command:stop_recording",
    { sessionId: remoteSession.sessionId },
  );
  await host.sendCommand(remoteSession.runnerId, command);

  // Wait for the runner to confirm stop (poll for up to 10 seconds).
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const session = host.getSession(repositoryId);
    if (!session?.isRecording) break;
  }

  const allEvents = await host.getEvents(repositoryId);
  const ocrTouched = await applyOcrTextSelectors(
    host,
    allEvents,
    remoteSession.selectorPriority,
  );
  await host.updateEventData(
    remoteSession.sessionId,
    ocrTouched.map((e) => ({ sequence: e.sequence, data: e.data })),
  );
  const recordingSettings = await host.getPlaywrightSettings(repositoryId);
  const generatedCode = generateCodeFromRemoteEvents(
    allEvents,
    remoteSession.selectorPriority,
    remoteSession.targetUrl,
    recordingSettings.selectorTimeoutMs ?? 3000,
  );
  host.completeSession(repositoryId, generatedCode);

  await host.releaseRunner(remoteSession.runnerId);

  // Recording done — let the OCR backend sleep (fire-and-forget; both
  // backends also auto-sleep after their idle timeout).
  void host.ocrSleep().catch(() => {});

  return {
    id: remoteSession.sessionId,
    url: remoteSession.targetUrl,
    startedAt: remoteSession.startedAt,
    events: allEvents,
    generatedCode,
    requiredCapabilities: undefined,
    capturedStorageState: null as string | null,
    domSnapshot: remoteSession.domSnapshot,
  };
}

export async function captureScreenshot(repositoryId?: string | null) {
  const host = recorderHost();
  await host.requireRecordingAccess();
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<CaptureScreenshotCommand>(
      "command:capture_screenshot",
      { sessionId: remoteSession.sessionId },
    );
    await host.sendCommand(remoteSession.runnerId, command);
  }
  // The screenshot event comes back through recording events; the UI gets
  // the actual screenshot through event polling.
  return { screenshotPath: null };
}

export async function createAssertion(
  type: AssertionType,
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  const host = recorderHost();
  await host.requireRecordingAccess();
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<CreateAssertionCommand>(
      "command:create_assertion",
      { sessionId: remoteSession.sessionId, assertionType: type },
    );
    await host.sendCommand(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false };
}

export async function createWait(
  params: WaitParams,
  repositoryId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const host = recorderHost();
  await host.requireRecordingAccess();

  if (params.waitType === "duration") {
    if (
      typeof params.durationMs !== "number" ||
      params.durationMs < 0 ||
      !Number.isFinite(params.durationMs)
    ) {
      return {
        success: false,
        error: "durationMs must be a non-negative finite number",
      };
    }
  } else if (params.waitType === "selector") {
    const hasSelector =
      (params.selector && params.selector.trim().length > 0) ||
      (params.selectors &&
        params.selectors.some((s) => s.value && s.value.trim()));
    if (!hasSelector) {
      return {
        success: false,
        error: "selector or selectors must be provided",
      };
    }
    if (
      params.condition &&
      params.condition !== "visible" &&
      params.condition !== "hidden"
    ) {
      return {
        success: false,
        error: "condition must be 'visible' or 'hidden'",
      };
    }
    if (
      params.timeoutMs !== undefined &&
      (!Number.isFinite(params.timeoutMs) || params.timeoutMs < 0)
    ) {
      return {
        success: false,
        error: "timeoutMs must be a non-negative finite number",
      };
    }
  } else {
    return {
      success: false,
      error: "waitType must be 'duration' or 'selector'",
    };
  }

  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<CreateWaitCommand>("command:create_wait", {
      sessionId: remoteSession.sessionId,
      waitType: params.waitType,
      durationMs: params.durationMs,
      selector: params.selector,
      selectors: params.selectors,
      condition: params.condition,
      timeoutMs: params.timeoutMs,
    });
    await host.sendCommand(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false, error: "No active recording session" };
}

export async function insertTimestamp(
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  const host = recorderHost();
  await host.requireRecordingAccess();
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<InsertTimestampCommand>(
      "command:insert_timestamp",
      { sessionId: remoteSession.sessionId },
    );
    await host.sendCommand(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false };
}

export async function promoteSelector(
  actionId: string,
  selectorValue: string,
  repositoryId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  const host = recorderHost();
  await host.requireRecordingAccess();
  if (!actionId || !selectorValue) {
    return { success: false, error: "actionId and selectorValue are required" };
  }
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<PromoteSelectorCommand>(
      "command:promote_selector",
      { sessionId: remoteSession.sessionId, actionId, selectorValue },
    );
    await host.sendCommand(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false, error: "No active recording session" };
}

export async function flagDownload(
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  const host = recorderHost();
  await host.requireRecordingAccess();
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<FlagDownloadCommand>(
      "command:flag_download",
      { sessionId: remoteSession.sessionId },
    );
    await host.sendCommand(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false };
}

export async function togglePauseRecording(
  _repositoryId?: string | null,
): Promise<{ paused: boolean; error?: string }> {
  const host = recorderHost();
  await host.requireRecordingAccess();
  return {
    paused: false,
    error: "Pause is not supported for remote recording sessions",
  };
}

export async function getRecordingStatus(
  repositoryId?: string | null,
  sinceSequence?: number,
  // Optional client hints — let any pod confirm an active recording even
  // when the in-process session map is empty on this pod (Olares runs two
  // app pods that share DB but not memory).
  hint?: { sessionId?: string; runnerId?: string },
) {
  const host = recorderHost();
  await host.requireRecordingAccess();

  const remoteSession = host.getSession(repositoryId);
  if (remoteSession) {
    const events = await host.getEvents(repositoryId, sinceSequence);
    const allCount = remoteSession.events.length;
    const lastSequence =
      events.length > 0
        ? events[events.length - 1]!.sequence
        : (remoteSession.events.at(-1)?.sequence ?? sinceSequence ?? 0);

    const isCompleted =
      !remoteSession.isRecording && remoteSession.generatedCode;

    const verificationUpdates = remoteSession.pendingEventUpdates ?? [];

    return {
      isRecording: remoteSession.isRecording,
      events,
      lastSequence,
      verificationUpdates,
      session: remoteSession.isRecording
        ? {
            id: remoteSession.sessionId,
            url: remoteSession.targetUrl,
            startedAt: remoteSession.startedAt,
            eventsCount: allCount,
          }
        : null,
      lastCompletedSession: isCompleted
        ? {
            id: remoteSession.sessionId,
            generatedCode: remoteSession.generatedCode!,
          }
        : null,
      errorMessage: remoteSession.errorMessage ?? null,
    };
  }

  // No in-memory session on this pod — check whether a peer pod still has
  // it live before reporting "stopped" (which would unmount the viewer).
  if (hint?.runnerId) {
    const { stillBusy, events: dbEvents } = await host.checkRunnerStillBusy(
      hint.runnerId,
      hint.sessionId,
      sinceSequence,
    );
    if (stillBusy) {
      const lastSequence =
        dbEvents.length > 0
          ? dbEvents[dbEvents.length - 1]!.sequence
          : (sinceSequence ?? 0);
      return {
        isRecording: true,
        events: dbEvents,
        lastSequence,
        verificationUpdates: [],
        session: hint.sessionId
          ? {
              id: hint.sessionId,
              url: "",
              startedAt: new Date(),
              eventsCount: dbEvents.length,
            }
          : null,
        lastCompletedSession: null,
        errorMessage: null,
      };
    }
  }

  return {
    isRecording: false,
    events: [],
    lastSequence: 0,
    verificationUpdates: [],
    session: null,
    lastCompletedSession: null,
    errorMessage: null,
  };
}

export async function clearLastCompletedSession(repositoryId?: string | null) {
  const host = recorderHost();
  await host.requireRecordingAccess();
  const remoteSession = host.getSession(repositoryId);
  if (remoteSession && !remoteSession.isRecording) {
    await host.clearSession(repositoryId);
  }
}

export async function saveRecordedTest(data: {
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
}) {
  const host = recorderHost();
  // `saveRecordedTest` carries its own guard (repo `tests:write`) rather than
  // `requireRecordingAccess` — see `host.ts`.
  const created = await host.saveRecordedTest(data);
  revalidatePath("/tests");
  revalidatePath("/");
  return created;
}

export async function updateRerecordedTest(data: {
  testId: string;
  code: string;
  targetUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}) {
  const host = recorderHost();
  // `updateRerecordedTest` carries its own guard (test ownership) — see `host.ts`.
  const result = await host.updateRerecordedTest(data);
  revalidatePath("/tests");
  revalidatePath(`/tests/${data.testId}`);
  return result;
}

export async function getOrCreateFunctionalArea(
  name: string,
  repositoryId?: string | null,
) {
  const host = recorderHost();
  await host.requireRecordingAccess();
  return host.getOrCreateFunctionalArea(name, repositoryId);
}
