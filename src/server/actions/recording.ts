'use server';

import { getRecorder, type AssertionType } from '@/lib/playwright/recorder';
import {
  launchInspector,
  isInspectorRunning,
  getInspectorOutput,
  cancelInspector,
  cleanupSession,
  getSessionInfo,
} from '@/lib/playwright/inspector-manager';
import { transformPlaywrightCode } from '@/lib/playwright/code-transformer';
import { createTest, createFunctionalArea, getFunctionalAreas, getPlaywrightSettings } from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { revalidatePath } from 'next/cache';
import { chromium, firefox, webkit } from 'playwright';

export interface PlaywrightAvailability {
  available: boolean;
  browser: string;
  error?: string;
  installCommand?: string;
}

export async function checkPlaywrightAvailability(repositoryId?: string | null): Promise<PlaywrightAvailability> {
  const settings = await getPlaywrightSettings(repositoryId);
  const browserType = (settings.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium';

  const browsers = { chromium, firefox, webkit };
  const launcher = browsers[browserType];

  try {
    const browser = await launcher.launch({
      headless: true,
      timeout: 5000,
    });
    await browser.close();
    return { available: true, browser: browserType };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Playwright ${browserType} check failed:`, message);

    // Check for missing browser executable
    if (message.includes("Executable doesn't exist") || message.includes('browserType.launch')) {
      return {
        available: false,
        browser: browserType,
        error: `${browserType} browser is not installed`,
        installCommand: `npx playwright install ${browserType}`,
      };
    }

    return {
      available: false,
      browser: browserType,
      error: message,
    };
  }
}

export async function startRecording(
  url: string,
  repositoryId?: string | null,
  runnerId?: string,
  setupOptions?: { testId?: string | null; scriptId?: string | null; steps?: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }> }
): Promise<{ sessionId?: string; error?: string }> {
  const recorder = getRecorder(repositoryId);

  if (recorder.isActive()) {
    return { error: 'Recording already in progress' };
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return { error: 'Invalid URL format. Please enter a valid URL (e.g., https://example.com)' };
  }

  const sessionId = uuid();

  // Fetch settings and pass cursor tracking config to recorder
  const settings = await getPlaywrightSettings(repositoryId);
  recorder.setSettings({
    pointerGestures: settings.pointerGestures ?? false,
    cursorFPS: settings.cursorFPS ?? 30,
  });

  // Check if OCR is enabled in selector priority settings
  const selectorPriority = settings.selectorPriority ?? DEFAULT_SELECTOR_PRIORITY;
  const ocrConfig = selectorPriority.find(s => s.type === 'ocr-text');
  recorder.setOcrEnabled(ocrConfig?.enabled ?? false);

  // Pass selector priority to recorder for filtering/ordering
  recorder.setSelectorPriority(selectorPriority);

  // Set viewport from settings
  recorder.setViewport(settings.viewportWidth ?? 1280, settings.viewportHeight ?? 720);

  // Set browser type (headless is always false for recording - user needs to see the browser)
  recorder.setBrowserType((settings.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium');

  try {
    await recorder.startRecording(url, sessionId, setupOptions);
    return { sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start recording';

    // Parse common Playwright errors
    if (message.includes('ERR_NAME_NOT_RESOLVED')) {
      return { error: `Could not resolve hostname. Please check the URL: ${url}` };
    }
    if (message.includes('ERR_CONNECTION_REFUSED')) {
      return { error: `Connection refused. Make sure the server is running at: ${url}` };
    }
    if (message.includes('ERR_CONNECTION_TIMED_OUT')) {
      return { error: `Connection timed out for: ${url}` };
    }

    return { error: message };
  }
}

export async function stopRecording(repositoryId?: string | null) {
  const recorder = getRecorder(repositoryId);
  const session = await recorder.stopRecording();

  return session;
}

export async function captureScreenshot(repositoryId?: string | null) {
  const recorder = getRecorder(repositoryId);
  const screenshotPath = await recorder.takeScreenshot();

  return { screenshotPath };
}

export async function createAssertion(type: AssertionType): Promise<{ success: boolean }> {
  const recorder = getRecorder();
  const success = await recorder.createAssertion(type);

  return { success };
}

export async function getRecordingStatus(repositoryId?: string | null, sinceSequence?: number) {
  const recorder = getRecorder(repositoryId);
  const session = recorder.getSession();
  const lastCompleted = recorder.getLastCompletedSession();

  // Get events since the specified sequence number
  const allEvents = session?.events ?? [];
  const events = sinceSequence !== undefined
    ? allEvents.filter(e => e.sequence > sinceSequence)
    : allEvents;
  const lastSequence = allEvents.at(-1)?.sequence ?? 0;

  // Get verification updates (DOM verification results)
  const verificationUpdates = recorder.getVerificationUpdates();

  return {
    isRecording: recorder.isActive(),
    events,
    lastSequence,
    verificationUpdates,
    session: session ? {
      id: session.id,
      url: session.url,
      startedAt: session.startedAt,
      eventsCount: session.events.length,
    } : null,
    lastCompletedSession: lastCompleted ? {
      id: lastCompleted.id,
      generatedCode: lastCompleted.generatedCode,
    } : null,
  };
}

export async function clearLastCompletedSession(repositoryId?: string | null) {
  const recorder = getRecorder(repositoryId);
  recorder.clearLastCompletedSession();
}

export async function saveRecordedTest(data: {
  name: string;
  functionalAreaId: string | null;
  targetUrl: string;
  code: string;
  repositoryId?: string | null;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const test = await createTest({
    name: data.name,
    functionalAreaId: data.functionalAreaId,
    targetUrl: data.targetUrl,
    code: data.code,
    repositoryId: data.repositoryId ?? null,
  });

  revalidatePath('/tests');
  revalidatePath('/');

  return test;
}

export async function updateRerecordedTest(data: {
  testId: string;
  code: string;
  targetUrl?: string;
}) {
  await requireTeamAccess();
  const { updateTestWithVersion } = await import('@/lib/db/queries');

  const { updateTest } = await import('@/lib/db/queries');

  await updateTestWithVersion(
    data.testId,
    {
      code: data.code,
      ...(data.targetUrl && { targetUrl: data.targetUrl }),
    },
    'rerecorded'
  );

  // Clear placeholder flag after re-recording
  await updateTest(data.testId, { isPlaceholder: false });

  revalidatePath('/tests');
  revalidatePath(`/tests/${data.testId}`);

  return { id: data.testId };
}

export async function getOrCreateFunctionalArea(name: string) {
  const areas = await getFunctionalAreas();
  const existing = areas.find(a => a.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    return existing;
  }

  return createFunctionalArea({ name });
}

// ============================================
// Playwright Inspector Recording Actions
// ============================================

export async function startPlaywrightInspector(
  url: string,
  repositoryId?: string | null
): Promise<{ sessionId?: string; error?: string }> {
  // Validate URL format
  try {
    new URL(url);
  } catch {
    return { error: 'Invalid URL format. Please enter a valid URL (e.g., https://example.com)' };
  }

  const sessionId = uuid();

  // Get settings for browser/viewport config
  const settings = await getPlaywrightSettings(repositoryId);

  const result = await launchInspector(sessionId, url, {
    browser: (settings.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium',
    viewport: {
      width: settings.viewportWidth ?? 1280,
      height: settings.viewportHeight ?? 720,
    },
  });

  if (!result.success) {
    return { error: result.error };
  }

  return { sessionId };
}

export interface InspectorStatus {
  isRunning: boolean;
  code?: string;
  transformedCode?: string;
  error?: string;
  startedAt?: Date;
  url?: string;
}

export async function getInspectorStatus(sessionId: string): Promise<InspectorStatus> {
  const info = getSessionInfo(sessionId);

  if (!info.exists) {
    return { isRunning: false, error: 'Session not found' };
  }

  const running = info.isRunning;

  // Get the output code
  const output = getInspectorOutput(sessionId);

  // Transform the code if we have any
  let transformedCode: string | undefined;
  if (output.code) {
    transformedCode = transformPlaywrightCode(output.code, info.url);
  }

  return {
    isRunning: running,
    code: output.code ?? undefined,
    transformedCode,
    startedAt: info.startedAt,
    url: info.url,
  };
}

export async function cancelPlaywrightInspector(sessionId: string): Promise<{ success: boolean; error?: string }> {
  return cancelInspector(sessionId);
}

export async function finalizeInspectorSession(sessionId: string): Promise<{
  success: boolean;
  code?: string;
  error?: string;
}> {
  const info = getSessionInfo(sessionId);

  if (!info.exists) {
    return { success: false, error: 'Session not found' };
  }

  // Get the final output
  const output = getInspectorOutput(sessionId);

  if (!output.code) {
    cleanupSession(sessionId);
    return { success: false, error: 'No code was generated' };
  }

  // Transform to runner format
  const transformedCode = transformPlaywrightCode(output.code, info.url);

  // Clean up the session
  cleanupSession(sessionId);

  return { success: true, code: transformedCode };
}
