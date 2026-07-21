"use server";

import type { AssertionType, WaitParams } from "@/lib/playwright/types";
import { eventsToCodeLines } from "@/lib/playwright/event-to-code";
import {
  createTest,
  createFunctionalArea,
  getFunctionalAreas,
  getPlaywrightSettings,
  getTest,
  getSetupScript,
  getRepository,
  getStorageState,
  getDefaultSetupSteps,
} from "@/lib/db/queries";
import { requireCapability, requireRepoCapability } from "@/lib/auth";
import { ocrSleep, ocrWarmup } from "@/lib/ocr";
import {
  safeOutboundFetch,
  SsrfBlockedError,
} from "@/lib/security/outbound-url";
import { DEFAULT_SELECTOR_PRIORITY } from "@/lib/db/schema";
import type { SelectorConfig } from "@/lib/db/schema";
import {
  analyzeHtmlForSelectors,
  recommendPriorityFromAnalysis,
  isMeaningful,
} from "@/lib/playwright/selector-analysis";
import { v4 as uuid } from "uuid";
import { revalidatePath } from "next/cache";
import { createMessage } from "@/lib/ws/protocol";
import type {
  StartRecordingCommand,
  StopRecordingCommand,
  CaptureScreenshotCommand,
  CreateAssertionCommand,
  CreateWaitCommand,
  FlagDownloadCommand,
  InsertTimestampCommand,
  PromoteSelectorCommand,
} from "@/lib/ws/protocol";
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";
import {
  queueCommandToDB,
  createRemoteRecordingSession,
  getRemoteRecordingSession,
  getRemoteRecordingEvents,
  completeRemoteRecordingSession,
  clearRemoteRecordingSession,
  type RemoteRecordingEvent,
  type RemoteRecordingEventUpdate,
} from "@/app/api/ws/runner/route";

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
  _storageStateId?: string,
): Promise<{ sessionId?: string; resolvedRunnerId?: string; error?: string }> {
  const session = await requireCapability("recording:write");
  // Validate URL format
  try {
    new URL(url);
  } catch {
    return {
      error:
        "Invalid URL format. Please enter a valid URL (e.g., https://example.com)",
    };
  }

  const sessionId = uuid();
  const settings = await getPlaywrightSettings(repositoryId);
  const selectorPriority =
    settings.selectorPriority ?? DEFAULT_SELECTOR_PRIORITY;

  // Tag every claim attempt with team+user+repo so a user-reported "disconnected"
  // can be traced to a specific runner (or to "no EB available") without
  // grepping a sea of anonymous `[Pool] Claimed EB ...` lines.
  const traceTag = `team=${session.team.id} user=${session.user.id} repo=${repositoryId ?? "none"}`;

  // Resolve 'auto' to a pool-managed system EB (atomic claim, with on-demand
  // provisioning when EB_PROVISIONER=kubernetes and no idle EB is available).
  if (runnerId === "auto") {
    const poolEB = await claimOrProvisionPoolEB();
    if (!poolEB) {
      console.warn(
        `[Recording] No EB available (claimOrProvisionPoolEB → null) ${traceTag} url=${url}`,
      );
      return { error: "All browsers are busy. Please try again later." };
    }
    console.log(
      `[Recording] EB claimed runner=${poolEB.runnerId.slice(0, 8)} ${traceTag} url=${url}`,
    );
    runnerId = poolEB.runnerId;
  } else {
    console.log(
      `[Recording] Recording on explicit runner=${runnerId?.slice(0, 8) ?? "none"} ${traceTag} url=${url}`,
    );
  }

  // Require a runner or EB — local recording is not supported
  if (!runnerId || runnerId === "local") {
    return {
      error: "Please select a runner or embedded browser for recording.",
    };
  }

  // Clear any existing remote session for this repository —
  // reconnecting to the same runner should always be allowed
  const existingSession = getRemoteRecordingSession(repositoryId);
  if (existingSession) {
    await clearRemoteRecordingSession(repositoryId);
  }

  // Create the remote recording session on the server
  createRemoteRecordingSession(
    sessionId,
    runnerId,
    repositoryId ?? null,
    url,
    selectorPriority,
  );

  // Resolve setup steps to code (runners have no DB access).
  //
  // Mirrors `setup-orchestrator.ts:runTestSetup` so recording sees the same
  // chain as test execution. Order of precedence:
  //   1. Steps explicitly provided by the client (recording UI)
  //   2. When re-recording: the existing test's setupOverrides on top of
  //      `defaultSetupSteps`, falling back to its legacy setupTestId/setupScriptId
  //   3. Repo `defaultSetupSteps` (multi-step) for fresh recordings
  //   4. Legacy `repo.defaultSetupTestId` / `defaultSetupScriptId`
  //
  // Storage-state steps are realised as a synthesized cookie-injection setup
  // script — matches the orchestrator's `context.addCookies` behaviour without
  // requiring a protocol change.
  type ChainStep = {
    stepType: "test" | "script" | "storage_state";
    testId?: string | null;
    scriptId?: string | null;
    storageStateId?: string | null;
  };
  const stepsToResolve: ChainStep[] = [];

  if (setupOptions?.steps?.length) {
    stepsToResolve.push(...setupOptions.steps);
  } else if (setupOptions?.testId || setupOptions?.scriptId) {
    stepsToResolve.push({
      stepType: setupOptions.testId ? "test" : "script",
      testId: setupOptions.testId ?? null,
      scriptId: setupOptions.scriptId ?? null,
    });
  } else if (setupOptions?.rerecordTestId) {
    // Re-record: resolve the existing test's chain (defaults + overrides, or legacy)
    const existing = await getTest(setupOptions.rerecordTestId);
    if (existing?.repositoryId) {
      const defaults = await getDefaultSetupSteps(existing.repositoryId);
      if (defaults.length > 0) {
        const overrides = existing.setupOverrides;
        const skipped = new Set(overrides?.skippedDefaultStepIds ?? []);
        for (const d of defaults) {
          if (skipped.has(d.id)) continue;
          stepsToResolve.push({
            stepType: d.stepType as ChainStep["stepType"],
            testId: d.testId,
            scriptId: d.scriptId,
            storageStateId: d.storageStateId,
          });
        }
        for (const e of overrides?.extraSteps ?? []) {
          stepsToResolve.push({
            stepType: e.stepType as ChainStep["stepType"],
            testId: e.testId ?? null,
            scriptId: e.scriptId ?? null,
            storageStateId:
              (e as { storageStateId?: string | null }).storageStateId ?? null,
          });
        }
      } else if (existing.setupTestId) {
        stepsToResolve.push({ stepType: "test", testId: existing.setupTestId });
      } else if (existing.setupScriptId) {
        stepsToResolve.push({
          stepType: "script",
          scriptId: existing.setupScriptId,
        });
      }
    }
  } else if (repositoryId) {
    // Fresh recording: pick up whatever the repo declares as the default chain
    const defaults = await getDefaultSetupSteps(repositoryId);
    if (defaults.length > 0) {
      for (const d of defaults) {
        stepsToResolve.push({
          stepType: d.stepType as ChainStep["stepType"],
          testId: d.testId,
          scriptId: d.scriptId,
          storageStateId: d.storageStateId,
        });
      }
    } else {
      const repo = await getRepository(repositoryId);
      if (repo?.defaultSetupTestId) {
        stepsToResolve.push({
          stepType: "test",
          testId: repo.defaultSetupTestId,
        });
      } else if (repo?.defaultSetupScriptId) {
        stepsToResolve.push({
          stepType: "script",
          scriptId: repo.defaultSetupScriptId,
        });
      }
    }
  }

  let resolvedSetupSteps: Array<{ code: string; codeHash: string }> | undefined;
  if (stepsToResolve.length > 0) {
    resolvedSetupSteps = [];
    for (const step of stepsToResolve) {
      if (step.stepType === "storage_state") {
        if (!step.storageStateId) continue;
        const ss = await getStorageState(step.storageStateId);
        if (!ss?.storageStateJson) continue;
        try {
          const parsed = JSON.parse(ss.storageStateJson);
          const cookies = Array.isArray(parsed.cookies) ? parsed.cookies : [];
          if (cookies.length === 0) continue;
          // Synthesize a one-line setup script that re-uses the orchestrator
          // contract: `export async function setup(page)` with `page.context().addCookies`.
          const code = `export async function setup(page) { await page.context().addCookies(${JSON.stringify(cookies)}); }`;
          resolvedSetupSteps.push({ code, codeHash: "" });
        } catch (err) {
          console.warn(
            `[Recording] Failed to parse storage state ${step.storageStateId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }
      const id = step.stepType === "test" ? step.testId : step.scriptId;
      if (!id) continue;
      const record =
        step.stepType === "test" ? await getTest(id) : await getSetupScript(id);
      if (record?.code) {
        const hash = (record as Record<string, unknown>).codeHash;
        resolvedSetupSteps.push({
          code: record.code,
          codeHash: typeof hash === "string" ? hash : "",
        });
      }
    }
    if (resolvedSetupSteps.length === 0) resolvedSetupSteps = undefined;
  }

  console.log(
    `[Recording] Setup chain: ${stepsToResolve.length} step(s) declared, ${resolvedSetupSteps?.length ?? 0} resolved with code ${traceTag}`,
  );

  const ocrEnabled =
    selectorPriority.find((s) => s.type === "ocr-text")?.enabled ?? false;
  // Wake the OCR backend now so the first ocr-text capture during the
  // recording doesn't pay Tesseract init latency (fire-and-forget; the
  // backend auto-sleeps on idle if the recording never uses it).
  if (ocrEnabled) ocrWarmup();

  // Queue start_recording command to the runner
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
  await queueCommandToDB(runnerId, command);

  console.log(
    `[Recording] Dispatched recording to runner ${runnerId}, session ${sessionId}`,
  );
  return { sessionId, resolvedRunnerId: runnerId };
}

export interface AnalyzeUrlSelectorsResult {
  recommendedPriority?: SelectorConfig[];
  /**
   * Per-strategy candidate stats found in the initial HTML, ranked by
   * distinct-value count (most uniquely-addressable strategies first).
   * `count` is raw occurrences; `unique` is the number of distinct values.
   */
  topStrategies?: Array<{ type: string; count: number; unique: number }>;
  /**
   * Strategies that appear on the page but resolve to a single repeated
   * value (e.g. 12 buttons all with the same aria-label) — flagged so the
   * user can see why a seemingly-present strategy was downranked.
   */
  ambiguousStrategies?: Array<{ type: string; count: number }>;
  interactiveElements?: number;
  /** False when the page looks client-rendered — recommendation is the current config. */
  meaningful?: boolean;
  changed?: boolean;
  error?: string;
}

/**
 * Fetch the target URL and recommend a selector priority based on what the
 * page actually exposes (data-testid coverage, aria-labels, ids, roles, …).
 *
 * Read-only: it returns a recommendation; persisting it is the caller's job
 * (the recording UI applies it to the Playwright settings, which auto-saves).
 */
export async function analyzeUrlForSelectors(
  url: string,
  repositoryId?: string | null,
): Promise<AnalyzeUrlSelectorsResult> {
  await requireCapability("recording:write");

  try {
    new URL(url);
  } catch {
    return {
      error:
        "Invalid URL format. Please enter a valid URL (e.g., https://example.com)",
    };
  }

  const settings = await getPlaywrightSettings(repositoryId);
  const current = settings.selectorPriority ?? DEFAULT_SELECTOR_PRIORITY;

  let html: string;
  try {
    // SSRF guard: validate the target and re-validate every redirect hop so a
    // public URL can't bounce the server fetch to localhost / cloud metadata.
    const res = await safeOutboundFetch(
      url,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          // Present as a real browser so servers return the full document.
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      { maxRedirects: 5 },
    );
    if (!res.ok) {
      return {
        error: `Could not load page (HTTP ${res.status}). Check the URL and try again.`,
      };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/(text\/html|application\/xhtml)/i.test(contentType)) {
      return {
        error: `Page is not HTML (${contentType.split(";")[0]}). Selector analysis needs an HTML page.`,
      };
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return {
        error:
          "That URL points to a private or internal address and can't be analyzed.",
      };
    }
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "timed out"
        : "failed";
    return {
      error: `Request to the URL ${reason}. The page may be unreachable from the server.`,
    };
  }

  const coverage = analyzeHtmlForSelectors(html, {
    customAttributeName: settings.customAttributeName,
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

  // Strategies that are present but ambiguous (single repeated value across
  // many occurrences) — the misleading case we explicitly downrank.
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

export async function stopRecording(repositoryId?: string | null) {
  await requireCapability("recording:write");
  // Check for remote recording session first
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    // Queue stop command to the runner
    const command = createMessage<StopRecordingCommand>(
      "command:stop_recording",
      {
        sessionId: remoteSession.sessionId,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);

    // Wait for the runner to confirm stop (poll for up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const session = getRemoteRecordingSession(repositoryId);
      if (!session?.isRecording) break;
    }

    // Generate code from the stored events (merged in-memory + DB-forwarded)
    const allEvents = await getRemoteRecordingEvents(repositoryId);
    // The EB attaches a screencast-frame crop of each clicked element when
    // ocr-text is enabled; extract the text here (in-process Tesseract or the
    // OCR_SERVICE_URL container) and turn it into ocr-text fallback selectors
    // before codegen. The EB never talks to the OCR backend itself. Touched
    // events are written back so the DB rows match what codegen used (selector
    // added, crop stripped) — the timeline UI and any cross-pod reader would
    // otherwise still show these clicks as coords-only.
    const ocrTouched = await applyOcrTextSelectors(
      allEvents,
      remoteSession.selectorPriority,
    );
    await persistOcrEventUpdates(remoteSession.sessionId, ocrTouched);
    const recordingSettings = await getPlaywrightSettings(repositoryId);
    const generatedCode = generateCodeFromRemoteEvents(
      allEvents,
      remoteSession.selectorPriority,
      remoteSession.targetUrl,
      recordingSettings.selectorTimeoutMs ?? 3000,
    );
    completeRemoteRecordingSession(repositoryId, generatedCode);

    // Release the EB back to the pool
    await releasePoolEB(remoteSession.runnerId);

    // Recording done — let the OCR backend sleep (fire-and-forget; both
    // backends also auto-sleep after their idle timeout).
    void ocrSleep().catch(() => {});

    return {
      id: remoteSession.sessionId,
      url: remoteSession.targetUrl,
      startedAt: remoteSession.startedAt,
      events: allEvents,
      generatedCode,
      requiredCapabilities: undefined,
      capturedStorageState: null as string | null,
      // Captured by the EB on `command:stop_recording` and forwarded via
      // `response:recording_stopped`; mutation on the in-memory session is
      // visible here because both handlers share the same Map entry.
      domSnapshot: remoteSession.domSnapshot,
    };
  }

  // No active remote session
  return null;
}

export async function captureScreenshot(repositoryId?: string | null) {
  await requireCapability("recording:write");
  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    // Queue screenshot command to the runner
    const command = createMessage<CaptureScreenshotCommand>(
      "command:capture_screenshot",
      {
        sessionId: remoteSession.sessionId,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);

    // The screenshot event will come back through recording events
    // Return a placeholder - the UI will get the actual screenshot through event polling
    return { screenshotPath: null };
  }

  return { screenshotPath: null };
}

export async function createAssertion(
  type: AssertionType,
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  await requireCapability("recording:write");

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<CreateAssertionCommand>(
      "command:create_assertion",
      {
        sessionId: remoteSession.sessionId,
        assertionType: type,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function createWait(
  params: WaitParams,
  repositoryId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  await requireCapability("recording:write");

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

  const remoteSession = getRemoteRecordingSession(repositoryId);
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
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false, error: "No active recording session" };
}

export async function insertTimestamp(
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  await requireCapability("recording:write");

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<InsertTimestampCommand>(
      "command:insert_timestamp",
      {
        sessionId: remoteSession.sessionId,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function promoteSelector(
  actionId: string,
  selectorValue: string,
  repositoryId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  await requireCapability("recording:write");
  if (!actionId || !selectorValue) {
    return { success: false, error: "actionId and selectorValue are required" };
  }
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<PromoteSelectorCommand>(
      "command:promote_selector",
      {
        sessionId: remoteSession.sessionId,
        actionId,
        selectorValue,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }
  return { success: false, error: "No active recording session" };
}

export async function flagDownload(
  repositoryId?: string | null,
): Promise<{ success: boolean }> {
  await requireCapability("recording:write");

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    console.log(
      `[flagDownload] Dispatching to remote runner ${remoteSession.runnerId}`,
    );
    const command = createMessage<FlagDownloadCommand>(
      "command:flag_download",
      {
        sessionId: remoteSession.sessionId,
      },
    );
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function togglePauseRecording(
  _repositoryId?: string | null,
): Promise<{ paused: boolean; error?: string }> {
  await requireCapability("recording:write");
  return {
    paused: false,
    error: "Pause is not supported for remote recording sessions",
  };
}

export async function getRecordingStatus(
  repositoryId?: string | null,
  sinceSequence?: number,
  // Optional client hints — let any pod confirm an active recording even when
  // the in-process `remoteRecordingSessionsMap` is empty on this pod (Olares
  // runs two app pods that share DB but not memory). Without these, polls
  // that round-robin to the "wrong" pod report isRecording=false and the UI
  // tears down the BrowserViewer mid-recording.
  hint?: { sessionId?: string; runnerId?: string },
) {
  await requireCapability("recording:write");
  // Check for remote recording session first
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession) {
    // Pull events from the merged view (in-memory + DB-forwarded from
    // cross-pod recording_event POSTs).
    const events = await getRemoteRecordingEvents(repositoryId, sinceSequence);
    const allCount = remoteSession.events.length; // for legacy eventsCount; DB-merged may differ but in-memory is fine here
    const lastSequence =
      events.length > 0
        ? events[events.length - 1]!.sequence
        : (remoteSession.events.at(-1)?.sequence ?? sinceSequence ?? 0);

    // If recording stopped and we have generated code, return as completed session
    const isCompleted =
      !remoteSession.isRecording && remoteSession.generatedCode;

    // Drain late updates (verification settled, thumbnails arrived,
    // autorepair fired) for events whose sequence the UI already polled
    // past. The UI reconciles them by actionId.
    const verificationUpdates = remoteSession.pendingEventUpdates ?? [];
    if (verificationUpdates.length > 0) {
      remoteSession.pendingEventUpdates = [];
    }

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

  // No in-memory session on this pod. Before reporting "stopped", check the
  // DB for evidence the recording is still alive on a peer pod: if the runner
  // is busy and its embedded_sessions row is busy, the recording is active —
  // we just don't have local mirror state. Returning isRecording=false here
  // would unmount the BrowserViewer mid-recording (canvas disappears).
  if (hint?.runnerId) {
    const { db } = await import("@/lib/db");
    const { runners, embeddedSessions, remoteRecordingEvents } =
      await import("@/lib/db/schema");
    const { and: andOp, eq: eqOp, gt: gtOp } = await import("drizzle-orm");
    const [runnerRow] = await db
      .select({
        runnerStatus: runners.status,
        sessionStatus: embeddedSessions.status,
      })
      .from(runners)
      .leftJoin(embeddedSessions, eqOp(embeddedSessions.runnerId, runners.id))
      .where(eqOp(runners.id, hint.runnerId))
      .limit(1);

    const stillBusy =
      !!runnerRow &&
      runnerRow.runnerStatus === "busy" &&
      (runnerRow.sessionStatus === null || runnerRow.sessionStatus === "busy");

    if (stillBusy) {
      // Pull DB-forwarded events for this sessionId so the UI continues to
      // grow the timeline even when polls bounce to the wrong pod.
      let dbEvents: RemoteRecordingEvent[] = [];
      if (hint.sessionId) {
        const where =
          sinceSequence !== undefined
            ? andOp(
                eqOp(remoteRecordingEvents.sessionId, hint.sessionId),
                gtOp(remoteRecordingEvents.sequence, sinceSequence),
              )
            : eqOp(remoteRecordingEvents.sessionId, hint.sessionId);
        const rows = await db
          .select()
          .from(remoteRecordingEvents)
          .where(where)
          .orderBy(remoteRecordingEvents.sequence);
        dbEvents = rows.map((r) => ({
          type: r.type,
          timestamp: r.timestamp,
          sequence: r.sequence,
          status: r.status as "preview" | "committed",
          verification: (r.verification ??
            undefined) as RemoteRecordingEvent["verification"],
          data: (r.data ?? {}) as Record<string, unknown>,
        }));
      }
      const lastSequence =
        dbEvents.length > 0
          ? dbEvents[dbEvents.length - 1]!.sequence
          : (sinceSequence ?? 0);
      return {
        isRecording: true,
        events: dbEvents,
        lastSequence,
        verificationUpdates: [] as RemoteRecordingEventUpdate[],
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

  // No active session
  return {
    isRecording: false,
    events: [],
    lastSequence: 0,
    verificationUpdates: [] as RemoteRecordingEventUpdate[],
    session: null,
    lastCompletedSession: null,
    errorMessage: null,
  };
}

export async function clearLastCompletedSession(repositoryId?: string | null) {
  await requireCapability("recording:write");
  // Clear remote session if it exists and is completed
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession && !remoteSession.isRecording) {
    await clearRemoteRecordingSession(repositoryId);
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
  domSnapshot?: import("@/lib/db/schema").DomSnapshotData | null;
}) {
  if (data.repositoryId)
    await requireRepoCapability(data.repositoryId, "tests:write");
  else await requireCapability("tests:write");
  const test = await createTest(
    {
      name: data.name,
      functionalAreaId: data.functionalAreaId,
      targetUrl: data.targetUrl,
      code: data.code,
      repositoryId: data.repositoryId ?? null,
      requiredCapabilities: data.requiredCapabilities ?? undefined,
      domSnapshot: data.domSnapshot ?? undefined,
    },
    null,
    data.viewportWidth
      ? { width: data.viewportWidth, height: data.viewportHeight }
      : null,
  );

  // Auto-enable Playwright settings for detected capabilities
  if (data.requiredCapabilities && data.repositoryId) {
    const { upsertPlaywrightSettings } = await import("@/lib/db/queries");
    const updates: Record<string, boolean> = {};
    if (data.requiredCapabilities.fileUpload) {
      // fileUpload always works (no setting needed), but it's good to track
    }
    if (data.requiredCapabilities.clipboard) {
      updates.grantClipboardAccess = true;
    }
    if (data.requiredCapabilities.networkInterception) {
      updates.enableNetworkInterception = true;
    }
    if (data.requiredCapabilities.downloads) {
      updates.acceptDownloads = true;
    }
    if (Object.keys(updates).length > 0) {
      await upsertPlaywrightSettings(data.repositoryId, updates);
    }
  }

  // Update environment config baseUrl from the recording target URL.
  // Skip when there's no repo: env config is repository-scoped only.
  if (data.targetUrl && data.repositoryId) {
    try {
      const origin = new URL(data.targetUrl).origin;
      const { upsertEnvironmentConfig } = await import("@/lib/db/queries");
      await upsertEnvironmentConfig(data.repositoryId, { baseUrl: origin });
    } catch {
      // Invalid URL — skip baseUrl update
    }
  }

  // Persist setup overrides (skipped defaults and/or extra steps)
  const hasSkipped =
    data.skippedDefaultStepIds && data.skippedDefaultStepIds.length > 0;
  const hasExtra = data.extraSetupSteps && data.extraSetupSteps.length > 0;
  if (hasSkipped || hasExtra) {
    const { updateTestSetupOverrides } = await import("@/lib/db/queries");
    await updateTestSetupOverrides(test.id, {
      skippedDefaultStepIds: data.skippedDefaultStepIds ?? [],
      extraSteps: (data.extraSetupSteps ?? []).map((s) => ({
        stepType: s.stepType,
        testId: s.testId ?? null,
        scriptId: s.scriptId ?? null,
      })),
    });
  }

  revalidatePath("/tests");
  revalidatePath("/");

  return test;
}

export async function updateRerecordedTest(data: {
  testId: string;
  code: string;
  targetUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}) {
  const { requireTestOwnership } = await import("@/lib/auth/ownership");
  const { test } = await requireTestOwnership(data.testId);

  const { updateTestWithVersion, updateTest } =
    await import("@/lib/db/queries");
  const { getCurrentBranchForRepo } = await import("@/lib/git-utils");

  const branch = await getCurrentBranchForRepo(test.repositoryId);

  // Use passed viewport or null
  const viewport = data.viewportWidth
    ? { width: data.viewportWidth, height: data.viewportHeight }
    : null;

  await updateTestWithVersion(
    data.testId,
    {
      code: data.code,
      ...(data.targetUrl && { targetUrl: data.targetUrl }),
    },
    "rerecorded",
    branch ?? undefined,
    viewport,
  );

  // Clear placeholder flag after re-recording
  await updateTest(data.testId, { isPlaceholder: false });

  revalidatePath("/tests");
  revalidatePath(`/tests/${data.testId}`);

  return { id: data.testId };
}

export async function getOrCreateFunctionalArea(name: string) {
  await requireCapability("recording:write");
  const areas = await getFunctionalAreas();
  const existing = areas.find(
    (a) => a.name.toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    return existing;
  }

  return createFunctionalArea({ name });
}

/**
 * Recording-time OCR: convert each event's `data.ocrCrop` (base64 PNG of the
 * clicked element, cropped by the EB from the live screencast frame) into an
 * `ocr-text="…"` fallback selector appended to `data.selectors`. Crops are
 * always stripped, extraction is best-effort, and events without a crop are
 * untouched — so coordinate-only clicks gain a text fallback when possible
 * and nothing regresses when OCR fails or is disabled.
 *
 * Returns the events whose `data` was mutated (crop stripped and/or selector
 * added) so the caller can write them back to the DB.
 */
async function applyOcrTextSelectors(
  events: RemoteRecordingEvent[],
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>,
): Promise<RemoteRecordingEvent[]> {
  const ocrEnabled =
    selectorPriority.find((s) => s.type === "ocr-text")?.enabled ?? false;
  const targets = events.filter(
    (e) => typeof e.data?.ocrCrop === "string" && e.data.ocrCrop,
  );
  if (targets.length === 0) return [];
  if (!ocrEnabled) {
    // Setting flipped mid-recording — drop the crops, don't OCR them.
    for (const event of targets) delete event.data.ocrCrop;
    return targets;
  }
  const { extractText } = await import("@/lib/playwright/ocr");
  await Promise.allSettled(
    targets.map(async (event) => {
      const crop = event.data.ocrCrop as string;
      delete event.data.ocrCrop;
      const raw = await extractText(Buffer.from(crop, "base64"));
      // Playwright's getByText normalizes whitespace, so collapse runs — a
      // wrapped button label OCRs with a newline that would never match. Also
      // strip leading/trailing symbol junk: icons next to labels OCR as
      // stray glyphs ('© Verify' for an icon+text nav item), and getByText
      // needs the whole string present in the DOM to match.
      const text = raw
        ?.replace(/\s+/g, " ")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
        .trim();
      if (!text) return;
      // A label longer than this isn't a label — it's a container crop that
      // slipped through (getByText needs the whole string in one element, so
      // an over-long value can only ever fail at replay).
      if (text.length > 80) return;
      const selectors = Array.isArray(event.data.selectors)
        ? (event.data.selectors as Array<{ type: string; value: string }>)
        : (event.data.selectors = []);
      selectors.push({ type: "ocr-text", value: `ocr-text="${text}"` });
    }),
  );
  return targets;
}

/**
 * Write OCR-touched events back to `remote_recording_events` so the persisted
 * rows carry the appended ocr-text selectors (and lose the crop payload).
 * Best-effort: codegen already ran on the in-memory copies.
 */
async function persistOcrEventUpdates(
  sessionId: string,
  events: RemoteRecordingEvent[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    const { db } = await import("@/lib/db");
    const { remoteRecordingEvents } = await import("@/lib/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await Promise.all(
      events.map((event) =>
        db
          .update(remoteRecordingEvents)
          .set({ data: event.data as Record<string, unknown> })
          .where(
            and(
              eq(remoteRecordingEvents.sessionId, sessionId),
              eq(remoteRecordingEvents.sequence, event.sequence),
            ),
          ),
      ),
    );
  } catch (err) {
    console.warn(
      `[Recording] Failed to persist OCR selector updates for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ============================================
// Code Generation from Remote Recording Events
// ============================================

/**
 * Generates Playwright test code from remote recording events.
 * This mirrors PlaywrightRecorder.generateCode() but works with serialized events.
 */
function generateCodeFromRemoteEvents(
  events: RemoteRecordingEvent[],
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>,
  targetUrl: string,
  selectorTimeoutMs = 3000,
): string {
  const baseOrigin = new URL(targetUrl).origin;
  const coordsEnabled =
    selectorPriority.find((s) => s.type === "coords")?.enabled ?? true;
  const hasCursorEvents = events.some((e) => e.type === "cursor-move");
  // Baked into the recorded test so plain `npx playwright test` runs respect
  // the user's selector-timeout setting at record time. When the runner /
  // EB executes the test, both strip this inline `locateWithFallback` and
  // substitute their own helper which reads the live setting from the run
  // command — so changes after recording still apply via the runtime path.
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
    `  // Helper to build URLs safely (handles trailing/leading slashes)`,
    `  function buildUrl(base, path) {`,
    `    // 'path' may already be a full absolute URL — e.g. a cross-origin nav,`,
    `    // or a same-host redirect where the recorded base scheme (http) differs`,
    `    // from the live one (https), so getRelativePath could not strip it. In`,
    `    // that case it is already complete; concatenating it onto base would`,
    `    // produce a doubled "http://base/https://host/path".`,
    `    if (/^https?:\\/\\//i.test(path)) return path;`,
    `    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;`,
    `    const cleanPath = path.startsWith('/') ? path : '/' + path;`,
    `    return cleanBase + cleanPath;`,
    `  }`,
    ``,
    `  // Helper to match a URL as an anchored prefix — tolerates dynamic trailing`,
    `  // segments / per-run ids (e.g. /verify -> /verify/<buildId>). Builds on`,
    `  // buildUrl so it inherits the same absolute-URL handling.`,
    `  function urlMatch(base, path) {`,
    `    return new RegExp("^" + buildUrl(base, path).replace(/[.*+?()|[{}^\\]\\\\$]/g, "\\\\$&"));`,
    `  }`,
    ``,
    `  // Helper to generate unique screenshot paths`,
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
    `  // Multi-selector fallback helper with coordinate fallback for clicks`,
    `  async function locateWithFallback(page, selectors, action, value, coords, options) {`,
    `    // Drop candidates where a JS undefined leaked through interpolation ('#undefined',`,
    `    // '[data-id="undefined"]') without losing identifiers that merely contain the substring.`,
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

  // Use shared event-to-code conversion for the body
  const bodyLines = eventsToCodeLines(events, baseOrigin, coordsEnabled, {
    indent: "  ",
    includeCursorReplay: hasCursorEvents,
  });
  lines.push(...bodyLines);

  lines.push("}", "");
  return lines.join("\n");
}
