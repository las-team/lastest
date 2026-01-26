'use server';

import { getRecorder, type AssertionType } from '@/lib/playwright/recorder';
import { createTest, createFunctionalArea, getFunctionalAreas, getPlaywrightSettings } from '@/lib/db/queries';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { revalidatePath } from 'next/cache';

export async function startRecording(url: string, repositoryId?: string | null): Promise<{ sessionId?: string; error?: string }> {
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

  // Set browser type and headless mode
  recorder.setBrowserType((settings.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium');
  recorder.setHeadless(settings.headless ?? false);

  try {
    await recorder.startRecording(url, sessionId);
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

  return {
    isRecording: recorder.isActive(),
    events,
    lastSequence,
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

export async function getOrCreateFunctionalArea(name: string) {
  const areas = await getFunctionalAreas();
  const existing = areas.find(a => a.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    return existing;
  }

  return createFunctionalArea({ name });
}
