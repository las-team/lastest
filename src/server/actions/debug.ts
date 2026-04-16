'use server';

import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import type { DebugState, DebugCommand } from '@/lib/playwright/types';
import { getTest, getPlaywrightSettings, getEnvironmentConfig } from '@/lib/db/queries';
import { extractTestBody, removeInlineLocateWithFallback, removeInlineReplayCursorPath, parseSteps } from '@/lib/playwright/debug-parser';
import { stripTypeAnnotations } from '@/lib/playwright/types';
import { queueCommandToDB } from '@/app/api/ws/runner/route';
import { createRemoteDebugSession, getRemoteDebugSession, clearRemoteDebugSession } from '@/app/api/ws/runner/route';
import { resolveSetupCodeForRunner } from '@/lib/execution/setup-capture';
import { executeSetupViaRunner } from '@/lib/execution/executor';
import { getAvailableSystemRunner } from '@/server/actions/runners';
import type { Message } from '@/lib/ws/protocol';

export async function startDebugSession(
  testId: string,
  repositoryId?: string | null,
  runnerId?: string | null
): Promise<{ sessionId: string; error?: string }> {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();

  const test = await getTest(testId);
  if (!test) {
    return { sessionId: '', error: 'Test not found' };
  }

  const repoId = repositoryId || test.repositoryId;
  const settings = await getPlaywrightSettings(repoId);
  const envConfig = await getEnvironmentConfig(repoId);

  // Resolve 'auto' to an available system runner
  if (runnerId === 'auto') {
    const systemRunner = await getAvailableSystemRunner();
    if (!systemRunner) {
      return { sessionId: '', error: 'No system browsers available. Please try again later.' };
    }
    runnerId = systemRunner.id;
  }

  // Require a runner or EB — local debug is not supported
  if (!runnerId || runnerId === 'local') {
    return { sessionId: '', error: 'Please select a runner or embedded browser for debugging.' };
  }

  const code = test.code || '';
  const body = extractTestBody(code);
  if (!body) {
    return { sessionId: '', error: 'Could not parse test function body' };
  }

  const cleanBody = removeInlineReplayCursorPath(
    removeInlineLocateWithFallback(stripTypeAnnotations(body))
  );
  const steps = parseSteps(cleanBody);
  const sessionId = crypto.randomUUID();

  createRemoteDebugSession(sessionId, runnerId, repoId || null, testId);

  const targetUrl = envConfig?.baseUrl || 'about:blank';
  const viewport = settings?.viewportWidth && settings?.viewportHeight
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
      );
      storageState = setupResult.storageState;
      setupVariables = setupResult.variables;
    } catch (err) {
      clearRemoteDebugSession(sessionId);
      return { sessionId: '', error: `Setup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  await queueCommandToDB(runnerId, {
    id: crypto.randomUUID(),
    type: 'command:start_debug',
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
    },
  } as unknown as Message);

  return { sessionId };
}

export async function getDebugState(
  sessionId: string
): Promise<DebugState | null> {
  // Check remote session
  const remoteSession = getRemoteDebugSession(sessionId);
  if (remoteSession) {
    if (!remoteSession.state) {
      // Session exists but no state yet — return initializing placeholder
      return {
        sessionId,
        testId: remoteSession.testId,
        status: 'initializing',
        currentStepIndex: -1,
        steps: [],
        stepResults: [],
        code: '',
        networkEntries: [],
        consoleEntries: [],
        codeVersion: 0,
        isRecording: false,
        recordedEventCount: 0,
      } as DebugState;
    }
    // Convert to DebugState format (add empty network/console/trace fields)
    return {
      ...remoteSession.state,
      networkEntries: [],
      consoleEntries: [],
      traceUrl: undefined,
      isRecording: false,
      recordedEventCount: 0,
    } as DebugState;
  }

  return null;
}

export async function sendDebugCommand(
  sessionId: string,
  command: DebugCommand
): Promise<{ ok: boolean; error?: string }> {

  // Check remote session
  const remoteSession = getRemoteDebugSession(sessionId);
  if (remoteSession) {
    if (command.type === 'update_code' && 'code' in command) {
      // Re-parse steps on server
      const body = extractTestBody(command.code);
      const cleanBody = body
        ? removeInlineReplayCursorPath(removeInlineLocateWithFallback(stripTypeAnnotations(body)))
        : '';
      const steps = cleanBody ? parseSteps(cleanBody) : [];

      await queueCommandToDB(remoteSession.runnerId, {
        id: crypto.randomUUID(),
        type: 'command:debug_action',
        timestamp: Date.now(),
        payload: {
          sessionId,
          action: 'update_code',
          code: command.code,
          cleanBody,
          steps,
        },
      } as unknown as Message);
    } else {
      await queueCommandToDB(remoteSession.runnerId, {
        id: crypto.randomUUID(),
        type: 'command:debug_action',
        timestamp: Date.now(),
        payload: {
          sessionId,
          action: command.type,
          ...('stepIndex' in command ? { stepIndex: command.stepIndex } : {}),
        },
      } as unknown as Message);
    }
    return { ok: true };
  }

  return { ok: false, error: 'Session not found' };
}

export async function stopDebugSession(
  sessionId: string
): Promise<void> {
  // Check remote session
  const remoteSession = getRemoteDebugSession(sessionId);
  if (remoteSession) {
    await queueCommandToDB(remoteSession.runnerId, {
      id: crypto.randomUUID(),
      type: 'command:stop_debug',
      timestamp: Date.now(),
      payload: { sessionId },
    } as unknown as Message);
    clearRemoteDebugSession(sessionId);
    return;
  }
}

export async function flushDebugTrace(
  _sessionId: string
): Promise<{ url: string | null }> {
  return { url: null };
}
