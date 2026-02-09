'use server';

import { requireRepoAccess, requireTeamAccess } from '@/lib/auth';
import { getDebugRunner, type DebugState, type DebugCommand } from '@/lib/playwright/debug-runner';
import { getTest, getPlaywrightSettings, getEnvironmentConfig } from '@/lib/db/queries';

export async function startDebugSession(
  testId: string,
  repositoryId?: string | null
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

  const runner = getDebugRunner(repoId);
  const sessionId = await runner.start(test, settings, envConfig, repoId || null);

  return { sessionId };
}

export async function getDebugState(
  sessionId: string
): Promise<DebugState | null> {
  // No auth check needed — sessionId is the authorization token
  const runner = getDebugRunner();
  const state = runner.getState();
  if (!state || state.sessionId !== sessionId) return null;
  return state;
}

export async function sendDebugCommand(
  sessionId: string,
  command: DebugCommand
): Promise<{ ok: boolean; error?: string }> {
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
  const runner = getDebugRunner();
  const state = runner.getState();
  if (state && state.sessionId === sessionId) {
    await runner.stop();
  }
}

export async function flushDebugTrace(
  sessionId: string
): Promise<{ url: string | null }> {
  const runner = getDebugRunner();
  const state = runner.getState();
  if (!state || state.sessionId !== sessionId) {
    return { url: null };
  }
  const url = await runner.flushTrace();
  return { url };
}
