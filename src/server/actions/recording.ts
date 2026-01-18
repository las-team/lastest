'use server';

import { getRecorder } from '@/lib/playwright/recorder';
import { createTest, createFunctionalArea, getFunctionalAreas } from '@/lib/db/queries';
import { v4 as uuid } from 'uuid';
import { revalidatePath } from 'next/cache';

export async function startRecording(url: string) {
  const recorder = getRecorder();

  if (recorder.isActive()) {
    throw new Error('Recording already in progress');
  }

  const sessionId = uuid();
  await recorder.startRecording(url, sessionId);

  return { sessionId };
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

  return {
    isRecording: recorder.isActive(),
    session: session ? {
      id: session.id,
      url: session.url,
      startedAt: session.startedAt,
      eventsCount: session.events.length,
    } : null,
  };
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
