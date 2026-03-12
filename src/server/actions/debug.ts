'use server';

import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import { getDebugRunner, type DebugState, type DebugCommand } from '@/lib/playwright/debug-runner';
import { getTest, getPlaywrightSettings, getEnvironmentConfig } from '@/lib/db/queries';
import { extractTestBody, removeInlineLocateWithFallback, removeInlineReplayCursorPath, parseSteps } from '@/lib/playwright/debug-parser';
import { stripTypeAnnotations } from '@/lib/playwright/runner';
import { queueCommandToDB } from '@/app/api/ws/runner/route';
import { createRemoteDebugSession, getRemoteDebugSession, clearRemoteDebugSession } from '@/app/api/ws/runner/route';
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

  // Remote debug: route to embedded browser runner
  if (runnerId && runnerId !== 'local') {
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
        viewport: settings?.viewportWidth && settings?.viewportHeight
          ? { width: settings.viewportWidth, height: settings.viewportHeight }
          : undefined,
        stabilization: settings?.stabilization ?? undefined,
      },
    } as unknown as Message);

    return { sessionId };
  }

  // Local debug: use existing debug runner
  const runner = getDebugRunner(repoId);
  const sessionId = await runner.start(test, settings, envConfig, repoId || null);

  return { sessionId };
}

export async function getDebugState(
  sessionId: string
): Promise<DebugState | null> {
  // Check remote session first
  const remoteSession = getRemoteDebugSession(sessionId);
  if (remoteSession && remoteSession.state) {
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

  // Local debug runner
  const runner = getDebugRunner();
  const state = runner.getState();
  if (!state || state.sessionId !== sessionId) return null;
  return state;
}

export async function sendDebugCommand(
  sessionId: string,
  command: DebugCommand
): Promise<{ ok: boolean; error?: string }> {
  // Check remote session first
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

  // Local debug runner
  const runner = getDebugRunner();
  const state = runner.getState();
  if (!state || state.sessionId !== sessionId) {
    return { ok: false, error: 'Session not found' };
  }

  const ok = runner.sendCommand(command);
  return { ok, error: ok ? undefined : 'Command not accepted (session may not be paused)' };
}

export async function stopDebugSession(
  sessionId: string
): Promise<void> {
  // Check remote session first
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

  // Local debug runner
  const runner = getDebugRunner();
  const state = runner.getState();
  if (state && state.sessionId === sessionId) {
    await runner.stop();
  }
}

export async function flushDebugTrace(
  sessionId: string
): Promise<{ url: string | null }> {
  // Remote: no trace in MVP
  const remoteSession = getRemoteDebugSession(sessionId);
  if (remoteSession) {
    return { url: null };
  }

  // Local debug runner
  const runner = getDebugRunner();
  const state = runner.getState();
  if (!state || state.sessionId !== sessionId) {
    return { url: null };
  }
  const url = await runner.flushTrace();
  return { url };
}
