'use server';

import type { AssertionType } from '@/lib/playwright/types';
import { eventsToCodeLines } from '@/lib/playwright/event-to-code';
import { createTest, createFunctionalArea, getFunctionalAreas, getPlaywrightSettings, getTest, getSetupScript } from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { DEFAULT_SELECTOR_PRIORITY } from '@/lib/db/schema';
import { v4 as uuid } from 'uuid';
import { revalidatePath } from 'next/cache';
import { createMessage } from '@/lib/ws/protocol';
import type { StartRecordingCommand, StopRecordingCommand, CaptureScreenshotCommand, CreateAssertionCommand, FlagDownloadCommand, InsertTimestampCommand } from '@/lib/ws/protocol';
import { claimPoolEB, releasePoolEB } from '@/server/actions/embedded-sessions';
import {
  queueCommandToDB,
  createRemoteRecordingSession,
  getRemoteRecordingSession,
  completeRemoteRecordingSession,
  clearRemoteRecordingSession,
  type RemoteRecordingEvent,
} from '@/app/api/ws/runner/route';

export async function startRecording(
  url: string,
  repositoryId?: string | null,
  runnerId?: string,
  setupOptions?: { testId?: string | null; scriptId?: string | null; steps?: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }> },
  storageStateId?: string,
): Promise<{ sessionId?: string; resolvedRunnerId?: string; error?: string }> {
  await requireTeamAccess();
  // Validate URL format
  try {
    new URL(url);
  } catch {
    return { error: 'Invalid URL format. Please enter a valid URL (e.g., https://example.com)' };
  }

  const sessionId = uuid();
  const settings = await getPlaywrightSettings(repositoryId);
  const selectorPriority = settings.selectorPriority ?? DEFAULT_SELECTOR_PRIORITY;

  // Resolve 'auto' to a pool-managed system EB (atomic claim)
  if (runnerId === 'auto') {
    const poolEB = await claimPoolEB();
    if (!poolEB) {
      return { error: 'All browsers are busy. Please try again later.' };
    }
    runnerId = poolEB.runnerId;
  }

  // Require a runner or EB — local recording is not supported
  if (!runnerId || runnerId === 'local') {
    return { error: 'Please select a runner or embedded browser for recording.' };
  }

  // Clear any existing remote session for this repository —
  // reconnecting to the same runner should always be allowed
  const existingSession = getRemoteRecordingSession(repositoryId);
  if (existingSession) {
    clearRemoteRecordingSession(repositoryId);
  }

  // Create the remote recording session on the server
  createRemoteRecordingSession(sessionId, runnerId, repositoryId ?? null, url, selectorPriority);

  // Resolve setup steps to code (runners have no DB access)
  let resolvedSetupSteps: Array<{ code: string; codeHash: string }> | undefined;
  if (setupOptions?.steps?.length) {
    resolvedSetupSteps = [];
    for (const step of setupOptions.steps) {
      const id = step.stepType === 'test' ? step.testId : step.scriptId;
      if (!id) continue;
      const record = step.stepType === 'test' ? await getTest(id) : await getSetupScript(id);
      if (record?.code) {
        const hash = (record as Record<string, unknown>).codeHash;
        resolvedSetupSteps.push({ code: record.code, codeHash: typeof hash === 'string' ? hash : '' });
      }
    }
  } else if (setupOptions?.testId || setupOptions?.scriptId) {
    const id = setupOptions.testId || setupOptions.scriptId;
    const record = setupOptions.testId ? await getTest(id!) : await getSetupScript(id!);
    if (record?.code) {
      const hash = (record as Record<string, unknown>).codeHash;
      resolvedSetupSteps = [{ code: record.code, codeHash: typeof hash === 'string' ? hash : '' }];
    }
  }

  // Queue start_recording command to the runner
  const command = createMessage<StartRecordingCommand>('command:start_recording', {
    sessionId,
    targetUrl: url,
    viewport: {
      width: settings.viewportWidth ?? 1280,
      height: settings.viewportHeight ?? 720,
    },
    browser: (settings.browser as 'chromium' | 'firefox' | 'webkit') ?? 'chromium',
    selectorPriority,
    ocrEnabled: selectorPriority.find(s => s.type === 'ocr-text')?.enabled ?? false,
    pointerGestures: settings.pointerGestures ?? false,
    cursorFPS: settings.cursorFPS ?? 30,
    setupSteps: resolvedSetupSteps,
  });
  await queueCommandToDB(runnerId, command);

  console.log(`[Recording] Dispatched recording to runner ${runnerId}, session ${sessionId}`);
  return { sessionId, resolvedRunnerId: runnerId };
}

export async function stopRecording(repositoryId?: string | null) {
  await requireTeamAccess();
  // Check for remote recording session first
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    // Queue stop command to the runner
    const command = createMessage<StopRecordingCommand>('command:stop_recording', {
      sessionId: remoteSession.sessionId,
    });
    await queueCommandToDB(remoteSession.runnerId, command);

    // Wait for the runner to confirm stop (poll for up to 10 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const session = getRemoteRecordingSession(repositoryId);
      if (!session?.isRecording) break;
    }

    // Generate code from the stored events
    const generatedCode = generateCodeFromRemoteEvents(
      remoteSession.events,
      remoteSession.selectorPriority,
      remoteSession.targetUrl
    );
    completeRemoteRecordingSession(repositoryId, generatedCode);

    // Release the EB back to the pool
    await releasePoolEB(remoteSession.runnerId);

    return {
      id: remoteSession.sessionId,
      url: remoteSession.targetUrl,
      startedAt: remoteSession.startedAt,
      events: remoteSession.events,
      generatedCode,
      requiredCapabilities: undefined,
      capturedStorageState: null as string | null,
      domSnapshot: undefined as import('@/lib/db/schema').DomSnapshotData | undefined,
    };
  }

  // No active remote session
  return null;
}

export async function captureScreenshot(repositoryId?: string | null) {
  await requireTeamAccess();
  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    // Queue screenshot command to the runner
    const command = createMessage<CaptureScreenshotCommand>('command:capture_screenshot', {
      sessionId: remoteSession.sessionId,
    });
    await queueCommandToDB(remoteSession.runnerId, command);

    // The screenshot event will come back through recording events
    // Return a placeholder - the UI will get the actual screenshot through event polling
    return { screenshotPath: null };
  }

  return { screenshotPath: null };
}

export async function createAssertion(type: AssertionType, repositoryId?: string | null): Promise<{ success: boolean }> {
  await requireTeamAccess();

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<CreateAssertionCommand>('command:create_assertion', {
      sessionId: remoteSession.sessionId,
      assertionType: type,
    });
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function insertTimestamp(repositoryId?: string | null): Promise<{ success: boolean }> {
  await requireTeamAccess();

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    const command = createMessage<InsertTimestampCommand>('command:insert_timestamp', {
      sessionId: remoteSession.sessionId,
    });
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function flagDownload(repositoryId?: string | null): Promise<{ success: boolean }> {
  await requireTeamAccess();

  // Check for remote recording session
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession?.isRecording) {
    console.log(`[flagDownload] Dispatching to remote runner ${remoteSession.runnerId}`);
    const command = createMessage<FlagDownloadCommand>('command:flag_download', {
      sessionId: remoteSession.sessionId,
    });
    await queueCommandToDB(remoteSession.runnerId, command);
    return { success: true };
  }

  return { success: false };
}

export async function togglePauseRecording(repositoryId?: string | null): Promise<{ paused: boolean; error?: string }> {
  await requireTeamAccess();
  return { paused: false, error: 'Pause is not supported for remote recording sessions' };
}

export async function getRecordingStatus(repositoryId?: string | null, sinceSequence?: number) {
  await requireTeamAccess();
  // Check for remote recording session first
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession) {
    const allEvents = remoteSession.events;
    const events = sinceSequence !== undefined
      ? allEvents.filter(e => e.sequence > sinceSequence)
      : allEvents;
    const lastSequence = allEvents.at(-1)?.sequence ?? 0;

    // If recording stopped and we have generated code, return as completed session
    const isCompleted = !remoteSession.isRecording && remoteSession.generatedCode;

    return {
      isRecording: remoteSession.isRecording,
      events,
      lastSequence,
      verificationUpdates: [] as Array<{ actionId: string; verified: boolean }>,
      session: remoteSession.isRecording ? {
        id: remoteSession.sessionId,
        url: remoteSession.targetUrl,
        startedAt: remoteSession.startedAt,
        eventsCount: allEvents.length,
      } : null,
      lastCompletedSession: isCompleted ? {
        id: remoteSession.sessionId,
        generatedCode: remoteSession.generatedCode!,
      } : null,
    };
  }

  // No active session
  return {
    isRecording: false,
    events: [],
    lastSequence: 0,
    verificationUpdates: [] as Array<{ actionId: string; verified: boolean }>,
    session: null,
    lastCompletedSession: null,
  };
}

export async function clearLastCompletedSession(repositoryId?: string | null) {
  await requireTeamAccess();
  // Clear remote session if it exists and is completed
  const remoteSession = getRemoteRecordingSession(repositoryId);
  if (remoteSession && !remoteSession.isRecording) {
    clearRemoteRecordingSession(repositoryId);
  }
}

export async function saveRecordedTest(data: {
  name: string;
  functionalAreaId: string | null;
  targetUrl: string;
  code: string;
  repositoryId?: string | null;
  requiredCapabilities?: { fileUpload?: boolean; clipboard?: boolean; networkInterception?: boolean; downloads?: boolean } | null;
  viewportWidth?: number;
  viewportHeight?: number;
  extraSetupSteps?: Array<{ stepType: 'test' | 'script'; testId?: string | null; scriptId?: string | null }>;
  skippedDefaultStepIds?: string[];
  domSnapshot?: import('@/lib/db/schema').DomSnapshotData | null;
}) {
  if (data.repositoryId) await requireRepoAccess(data.repositoryId);
  else await requireTeamAccess();
  const test = await createTest({
    name: data.name,
    functionalAreaId: data.functionalAreaId,
    targetUrl: data.targetUrl,
    code: data.code,
    repositoryId: data.repositoryId ?? null,
    requiredCapabilities: data.requiredCapabilities ?? undefined,
    domSnapshot: data.domSnapshot ?? undefined,
  }, null, data.viewportWidth ? { width: data.viewportWidth, height: data.viewportHeight } : null);

  // Auto-enable Playwright settings for detected capabilities
  if (data.requiredCapabilities && data.repositoryId) {
    const { upsertPlaywrightSettings } = await import('@/lib/db/queries');
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

  // Update environment config baseUrl from the recording target URL
  if (data.targetUrl) {
    try {
      const origin = new URL(data.targetUrl).origin;
      const { upsertEnvironmentConfig } = await import('@/lib/db/queries');
      await upsertEnvironmentConfig(data.repositoryId ?? null, { baseUrl: origin });
    } catch {
      // Invalid URL — skip baseUrl update
    }
  }

  // Persist setup overrides (skipped defaults and/or extra steps)
  const hasSkipped = data.skippedDefaultStepIds && data.skippedDefaultStepIds.length > 0;
  const hasExtra = data.extraSetupSteps && data.extraSetupSteps.length > 0;
  if (hasSkipped || hasExtra) {
    const { updateTestSetupOverrides } = await import('@/lib/db/queries');
    await updateTestSetupOverrides(test.id, {
      skippedDefaultStepIds: data.skippedDefaultStepIds ?? [],
      extraSteps: (data.extraSetupSteps ?? []).map(s => ({
        stepType: s.stepType,
        testId: s.testId ?? null,
        scriptId: s.scriptId ?? null,
      })),
    });
  }

  revalidatePath('/tests');
  revalidatePath('/');

  return test;
}

export async function updateRerecordedTest(data: {
  testId: string;
  code: string;
  targetUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}) {
  await requireTeamAccess();
  const { updateTestWithVersion, getTest } = await import('@/lib/db/queries');
  const { getCurrentBranchForRepo } = await import('@/lib/git-utils');

  const { updateTest } = await import('@/lib/db/queries');

  const test = await getTest(data.testId);
  const branch = await getCurrentBranchForRepo(test?.repositoryId);

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
    'rerecorded',
    branch ?? undefined,
    viewport
  );

  // Clear placeholder flag after re-recording
  await updateTest(data.testId, { isPlaceholder: false });

  revalidatePath('/tests');
  revalidatePath(`/tests/${data.testId}`);

  return { id: data.testId };
}

export async function getOrCreateFunctionalArea(name: string) {
  await requireTeamAccess();
  const areas = await getFunctionalAreas();
  const existing = areas.find(a => a.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    return existing;
  }

  return createFunctionalArea({ name });
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
  targetUrl: string
): string {
  const baseOrigin = new URL(targetUrl).origin;
  const coordsEnabled = selectorPriority.find(s => s.type === 'coords')?.enabled ?? true;
  const hasCursorEvents = events.some(e => e.type === 'cursor-move');

  const lines: string[] = [
    `import { Page } from 'playwright';`,
    '',
    `export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {`,
    `  // Helper to build URLs safely (handles trailing/leading slashes)`,
    `  function buildUrl(base, path) {`,
    `    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;`,
    `    const cleanPath = path.startsWith('/') ? path : '/' + path;`,
    `    return cleanBase + cleanPath;`,
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
    `    const validSelectors = selectors.filter(sel => sel.value && sel.value.trim() && !sel.value.includes('undefined'));`,
    `    for (const sel of validSelectors) {`,
    `      try {`,
    `        let locator;`,
    `        if (sel.type === 'ocr-text') {`,
    `          const text = sel.value.replace(/^ocr-text="/, '').replace(/"$/, '');`,
    `          locator = page.getByText(text, { exact: false });`,
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
    `        await target.waitFor({ timeout: 3000 });`,
    `        await target.scrollIntoViewIfNeeded().catch(() => {});`,
    `        if (action === 'locate') return target;`,
    `        if (action === 'click') await target.click(options || {});`,
    `        else if (action === 'fill') await target.fill(value || '');`,
    `        else if (action === 'selectOption') await target.selectOption(value || '');`,
    `        return target;`,
    `      } catch { continue; }`,
    `    }`,
    ...(coordsEnabled ? [
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
    ] : []),
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
    indent: '  ',
    includeCursorReplay: hasCursorEvents,
  });
  lines.push(...bodyLines);

  lines.push('}', '');
  return lines.join('\n');
}
