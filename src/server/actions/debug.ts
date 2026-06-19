"use server";

import { revalidatePath } from "next/cache";
import { requireRepoAccess, requireTeamAccess } from "@/lib/auth";
import type { DebugState, DebugCommand } from "@/lib/playwright/types";
import {
  getTest,
  getPlaywrightSettings,
  getEnvironmentConfig,
  getRepository,
} from "@/lib/db/queries";
import { DEFAULT_SELECTOR_PRIORITY } from "@/lib/db/schema";
import {
  extractTestBody,
  removeInlineLocateWithFallback,
  removeInlineReplayCursorPath,
  parseSteps,
  spliceRecordedSteps,
} from "@/lib/playwright/debug-parser";
import { eventsToCodeLines } from "@/lib/playwright/event-to-code";
import { stripTypeAnnotations } from "@/lib/playwright/types";
import { queueCommandToDB } from "@/app/api/ws/runner/route";
import {
  createRemoteDebugSession,
  getRemoteDebugSession,
  clearRemoteDebugSession,
} from "@/app/api/ws/runner/route";
import { resolveSetupCodeForRunner } from "@/lib/execution/setup-capture";
import { executeSetupViaRunner } from "@/lib/execution/executor";
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";
import type { Message } from "@/lib/ws/protocol";

// Confirm the debug session's repository belongs to the caller's team. Used
// to gate getDebugState / sendDebugCommand / stopDebugSession against
// cross-team session-ID guesses.
async function assertDebugSessionAccess(remoteSession: {
  repositoryId: string | null;
  testId: string;
}) {
  const session = await requireTeamAccess();
  let repoId = remoteSession.repositoryId;
  if (!repoId) {
    // Fall back to test → repo lookup for sessions stored before repoId was
    // populated (or for tests whose repo binding is the only available link).
    const test = await getTest(remoteSession.testId);
    repoId = test?.repositoryId ?? null;
  }
  if (!repoId)
    throw new Error("Forbidden: debug session has no repository binding");
  const repo = await getRepository(repoId);
  if (!repo || repo.teamId !== session.team.id) {
    throw new Error("Forbidden: debug session does not belong to your team");
  }
}

export async function startDebugSession(
  testId: string,
  repositoryId?: string | null,
  runnerId?: string | null,
): Promise<{ sessionId: string; error?: string; actualRunnerId?: string }> {
  const session = repositoryId
    ? await requireRepoAccess(repositoryId)
    : await requireTeamAccess();

  const test = await getTest(testId);
  if (!test) {
    return { sessionId: "", error: "Test not found" };
  }

  // Must verify the test belongs to the caller's team. Without this, an
  // attacker can pass their own repositoryId + a victim's testId, and the
  // function will load the victim's test code into the debug session.
  if (!test.repositoryId) {
    return {
      sessionId: "",
      error: "Forbidden: test has no repository binding",
    };
  }
  if (repositoryId && test.repositoryId !== repositoryId) {
    return {
      sessionId: "",
      error: "Forbidden: test does not belong to that repository",
    };
  }
  const testRepo = await getRepository(test.repositoryId);
  if (!testRepo || testRepo.teamId !== session.team.id) {
    return {
      sessionId: "",
      error: "Forbidden: test does not belong to your team",
    };
  }

  const repoId = repositoryId || test.repositoryId;
  const settings = await getPlaywrightSettings(repoId);
  const envConfig = await getEnvironmentConfig(repoId);

  // Resolve 'auto' to a pool-managed system EB (claim idle or provision fresh
  // when EB_PROVISIONER=kubernetes and the pool has room).
  if (runnerId === "auto") {
    const poolEB = await claimOrProvisionPoolEB();
    if (!poolEB) {
      return {
        sessionId: "",
        error: "All browsers are busy. Please try again later.",
      };
    }
    runnerId = poolEB.runnerId;
  }

  // Require a runner or EB — local debug is not supported
  if (!runnerId || runnerId === "local") {
    return {
      sessionId: "",
      error: "Please select a runner or embedded browser for debugging.",
    };
  }

  const code = test.code || "";
  const body = extractTestBody(code);
  if (!body) {
    return { sessionId: "", error: "Could not parse test function body" };
  }

  const cleanBody = removeInlineReplayCursorPath(
    removeInlineLocateWithFallback(stripTypeAnnotations(body)),
  );
  const steps = parseSteps(cleanBody);
  const sessionId = crypto.randomUUID();

  await createRemoteDebugSession(sessionId, runnerId, repoId || null, testId);

  const targetUrl = envConfig?.baseUrl || "about:blank";
  const viewport =
    settings?.viewportWidth && settings?.viewportHeight
      ? { width: settings.viewportWidth, height: settings.viewportHeight }
      : undefined;

  // Run setup on the remote runner if needed (get storageState for auth)
  let storageState: string | undefined;
  let setupVariables: Record<string, unknown> | undefined;
  const setupInfo = await resolveSetupCodeForRunner([test]);
  if (setupInfo) {
    try {
      const setupResult = await executeSetupViaRunner(
        setupInfo.code,
        setupInfo.setupId,
        runnerId,
        targetUrl,
        viewport,
        settings?.navigationTimeout ?? undefined,
        settings,
        undefined,
        // headed: keep screencast attached to the setup page so the user can
        // watch setup (login flow, OAuth redirects) live in the debug stream.
        true,
      );
      // Prefer the serialized JSON snapshot over the `persistent:<id>` marker —
      // debug-executor creates its own BrowserContext and can't reach the
      // test-executor's in-process setupContexts map, so the marker would be
      // silently dropped by the JSON.parse/catch in createContextAndPage.
      storageState = setupResult.storageStateJson ?? setupResult.storageState;
      setupVariables = setupResult.variables;
    } catch (err) {
      await clearRemoteDebugSession(sessionId);
      await releasePoolEB(runnerId);
      return {
        sessionId: "",
        error: `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  await queueCommandToDB(runnerId, {
    id: crypto.randomUUID(),
    type: "command:start_debug",
    timestamp: Date.now(),
    payload: {
      sessionId,
      testId,
      code,
      cleanBody,
      steps,
      targetUrl,
      viewport,
      storageState,
      setupVariables,
      stabilization: settings?.stabilization ?? undefined,
      // Forwarded so "Record from here" can attach the recorder with the
      // same selector-priority/pointer-gesture settings the full /record
      // flow uses — settings is already loaded above for stabilization.
      selectorPriority: settings?.selectorPriority ?? undefined,
      pointerGestures: settings?.pointerGestures ?? undefined,
      cursorFPS: settings?.cursorFPS ?? undefined,
    },
  } as unknown as Message);

  return { sessionId, actualRunnerId: runnerId };
}

export async function getDebugState(
  sessionId: string,
): Promise<DebugState | null> {
  // Check remote session
  const remoteSession = await getRemoteDebugSession(sessionId);
  if (remoteSession) {
    await assertDebugSessionAccess(remoteSession);
    if (!remoteSession.state) {
      // Session exists but no state yet — return initializing placeholder
      return {
        sessionId,
        testId: remoteSession.testId,
        status: "initializing",
        currentStepIndex: -1,
        steps: [],
        stepResults: [],
        code: "",
        networkEntries: [],
        consoleEntries: [],
        codeVersion: 0,
        isRecording: false,
        recordedEventCount: 0,
      } as DebugState;
    }
    // Convert to DebugState format (add empty network/console/trace fields).
    // isRecording/recordedEventCount/recordingAnchor*/spliceMode/targetUrl
    // are real fields on the runner's payload now — the ?? fallback only
    // guards against in-flight sessions whose state blob predates this.
    return {
      ...remoteSession.state,
      networkEntries: [],
      consoleEntries: [],
      traceUrl: undefined,
      isRecording: remoteSession.state.isRecording ?? false,
      recordedEventCount: remoteSession.state.recordedEventCount ?? 0,
    } as DebugState;
  }

  return null;
}

export async function sendDebugCommand(
  sessionId: string,
  command: DebugCommand,
): Promise<{ ok: boolean; error?: string }> {
  // Check remote session
  const remoteSession = await getRemoteDebugSession(sessionId);
  if (remoteSession) {
    await assertDebugSessionAccess(remoteSession);
    if (command.type === "update_code" && "code" in command) {
      // Re-parse steps on server
      const body = extractTestBody(command.code);
      const cleanBody = body
        ? removeInlineReplayCursorPath(
            removeInlineLocateWithFallback(stripTypeAnnotations(body)),
          )
        : "";
      const steps = cleanBody ? parseSteps(cleanBody) : [];

      await queueCommandToDB(remoteSession.runnerId, {
        id: crypto.randomUUID(),
        type: "command:debug_action",
        timestamp: Date.now(),
        payload: {
          sessionId,
          action: "update_code",
          code: command.code,
          cleanBody,
          steps,
        },
      } as unknown as Message);
    } else {
      await queueCommandToDB(remoteSession.runnerId, {
        id: crypto.randomUUID(),
        type: "command:debug_action",
        timestamp: Date.now(),
        payload: {
          sessionId,
          action: command.type,
          ...("stepIndex" in command ? { stepIndex: command.stepIndex } : {}),
          ...("spliceMode" in command
            ? { spliceMode: command.spliceMode }
            : {}),
        },
      } as unknown as Message);
    }
    return { ok: true };
  }

  return { ok: false, error: "Session not found" };
}

/**
 * Poll after sending a "stop_recording" command. The stop only enqueues a
 * runner command — the runner's response:debug_state tick that actually
 * carries the captured events back arrives later, asynchronously. Once
 * `pendingRecordingEvents` shows up on the session's state, this splices the
 * recorded code into the test body, re-parses, and pushes the result back to
 * the runner via the existing `update_code` action (no new runner-side
 * splice logic — same path `update_code` already takes for manual edits).
 *
 * Returns `{ ok: true, spliced: false }` while the runner hasn't reported
 * the events yet — the caller should keep polling.
 */
export async function consumeStopRecording(
  sessionId: string,
): Promise<{ ok: boolean; error?: string; spliced?: boolean }> {
  const remoteSession = await getRemoteDebugSession(sessionId);
  if (!remoteSession) return { ok: false, error: "Session not found" };
  await assertDebugSessionAccess(remoteSession);

  const state = remoteSession.state;
  if (!state?.pendingRecordingEvents?.length) {
    return { ok: true, spliced: false };
  }

  if (!state.targetUrl) {
    return { ok: false, error: "Recording session is missing a target URL" };
  }
  const spliceMode = state.spliceMode ?? "insert";

  const settings = await getPlaywrightSettings(remoteSession.repositoryId);
  const selectorPriority =
    settings?.selectorPriority ?? DEFAULT_SELECTOR_PRIORITY;
  const coordsEnabled =
    selectorPriority.find((s) => s.type === "coords")?.enabled ?? true;
  const baseOrigin = new URL(state.targetUrl).origin;

  const newBodyLines = eventsToCodeLines(
    state.pendingRecordingEvents,
    baseOrigin,
    coordsEnabled,
    { indent: "  " },
  );

  const anchorIndex = state.recordingAnchorIndex ?? state.currentStepIndex;
  const result = spliceRecordedSteps(
    state.code,
    anchorIndex,
    newBodyLines,
    spliceMode,
  );
  if (!result) {
    return { ok: false, error: "Failed to splice recorded code" };
  }

  await queueCommandToDB(remoteSession.runnerId, {
    id: crypto.randomUUID(),
    type: "command:debug_action",
    timestamp: Date.now(),
    payload: {
      sessionId,
      action: "update_code",
      code: result.code,
      cleanBody: result.cleanBody,
      steps: result.steps,
    },
  } as unknown as Message);

  return { ok: true, spliced: true };
}

/**
 * Persist the debug session's current code as a new test version. Modeled
 * on updateRerecordedTest (src/server/actions/recording.ts) — the
 * established pattern for "write a recording-session's code into a new
 * testVersions row." Debug has no other save-back-to-test path; update_code
 * only mutates the in-memory runner session until this is called.
 */
export async function saveDebugSessionCode(
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const remoteSession = await getRemoteDebugSession(sessionId);
  if (!remoteSession) return { ok: false, error: "Session not found" };
  await assertDebugSessionAccess(remoteSession);

  const code = remoteSession.state?.code;
  if (!code) return { ok: false, error: "No code to save" };

  const { requireTestOwnership } = await import("@/lib/auth/ownership");
  const { test } = await requireTestOwnership(remoteSession.testId);

  const { updateTestWithVersion } = await import("@/lib/db/queries");
  const { getCurrentBranchForRepo } = await import("@/lib/git-utils");
  const branch = await getCurrentBranchForRepo(test.repositoryId);

  await updateTestWithVersion(
    remoteSession.testId,
    { code },
    "debug_rerecord",
    branch ?? undefined,
  );

  revalidatePath("/tests");
  revalidatePath(`/tests/${remoteSession.testId}`);
  return { ok: true };
}

export async function stopDebugSession(sessionId: string): Promise<void> {
  // Check remote session
  const remoteSession = await getRemoteDebugSession(sessionId);
  if (remoteSession) {
    await assertDebugSessionAccess(remoteSession);
    await queueCommandToDB(remoteSession.runnerId, {
      id: crypto.randomUUID(),
      type: "command:stop_debug",
      timestamp: Date.now(),
      payload: { sessionId },
    } as unknown as Message);

    // Release the EB back to the pool
    await releasePoolEB(remoteSession.runnerId);

    await clearRemoteDebugSession(sessionId);
    return;
  }
}

export async function flushDebugTrace(
  _sessionId: string,
): Promise<{ url: string | null }> {
  return { url: null };
}
