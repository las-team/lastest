'use server';

import { getRecorder } from '@/lib/playwright/recorder';
import { createTest, createFunctionalArea, getFunctionalAreas } from '@/lib/db/queries';
import { v4 as uuid } from 'uuid';
import { revalidatePath } from 'next/cache';

export async function startRecording(url: string): Promise<{ sessionId?: string; error?: string }> {
  const recorder = getRecorder();

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

export async function stopRecording() {
  const recorder = getRecorder();
  const session = await recorder.stopRecording();

  return session;
}

export async function captureScreenshot() {
  const recorder = getRecorder();
  const screenshotPath = await recorder.takeScreenshot();

  return { screenshotPath };
}

export async function getRecordingStatus() {
  const recorder = getRecorder();
  const session = recorder.getSession();
  const lastCompleted = recorder.getLastCompletedSession();

  return {
    isRecording: recorder.isActive(),
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

export async function clearLastCompletedSession() {
  const recorder = getRecorder();
  recorder.clearLastCompletedSession();
}

export async function saveRecordedTest(data: {
  name: string;
  functionalAreaId: string | null;
  pathType: 'happy' | 'unhappy';
  targetUrl: string;
  code: string;
}) {
  const test = await createTest({
    name: data.name,
    functionalAreaId: data.functionalAreaId,
    pathType: data.pathType,
    targetUrl: data.targetUrl,
    code: data.code,
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
