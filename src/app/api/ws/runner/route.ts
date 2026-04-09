/**
 * WebSocket API Endpoint for Runner Connections
 *
 * Note: Next.js App Router doesn't natively support WebSocket upgrades.
 * This endpoint provides a fallback HTTP API for runner communication.
 *
 * Command queue and results are persisted in SQLite (runner_commands /
 * runner_command_results tables).  In-memory Maps are used only for
 * duplicate-session detection and real-time recording sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateRunnerToken, updateRunnerStatus, markStaleRunnersOffline, deleteStaleSystemRunners } from '@/server/actions/runners';
import type { Message, HeartbeatMessage, TestResultResponse, SetupResultResponse, ScreenshotUploadResponse, RecordingEventResponse, RecordingStoppedResponse } from '@/lib/ws/protocol';
import { waitForCommandQueued, notifyCommandQueued } from '@/lib/ws/runner-events';
import fs from 'fs/promises';
import path from 'path';
import { STORAGE_DIRS } from '@/lib/storage/paths';
import {
  claimPendingCommands,
  completeRunnerCommand,
  insertCommandResult,
  cleanupOldCommands,
  timeoutStaleCommands,
  createRunnerCommand,
  cancelPendingCommandsByTestRun,
} from '@/lib/db/queries';

// ============================================
// Security Validation Functions
// ============================================

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10MB limit

/**
 * Sanitize filename to prevent path traversal attacks.
 * Only allows alphanumeric characters, dots, hyphens, and underscores.
 * Must end with valid image extension.
 */
function sanitizeFilename(filename: string): string {
  // Remove null bytes
  let safe = filename.replace(/\0/g, '');
  // Extract only the filename (no path components)
  safe = safe.split(/[/\\]/).pop() || '';
  // Remove any .. sequences
  safe = safe.replace(/\.\./g, '');
  // Only allow safe characters
  safe = safe.replace(/[^a-zA-Z0-9_.-]/g, '');
  // Validate extension and length
  if (!/\.(png|jpg|jpeg)$/i.test(safe) || safe.length > 255 || !safe) {
    throw new Error('Invalid filename');
  }
  return safe;
}

/**
 * Validate repository ID format (UUID only).
 */
function validateRepositoryId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid repository ID format');
  }
  return id;
}

/**
 * Validate screenshot size to prevent DoS via massive uploads.
 */
function validateScreenshotSize(base64Data: string): void {
  // Base64 encoded data is ~4/3 the size of binary
  const estimatedBytes = (base64Data.length * 3) / 4;
  if (estimatedBytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot exceeds ${MAX_SCREENSHOT_BYTES / (1024 * 1024)}MB limit`);
  }
}

// Track active polling sessions by runner ID (in-memory is fine — duplicate detection only)
const globalSessionState = globalThis as typeof globalThis & {
  __runnerActiveSessions?: Map<string, { lastPoll: number; sessionId: string }>;
};
if (!globalSessionState.__runnerActiveSessions) {
  globalSessionState.__runnerActiveSessions = new Map<string, { lastPoll: number; sessionId: string }>();
}
const activeRunnerSessions = globalSessionState.__runnerActiveSessions;

// Session timeout in milliseconds (60s — held long-poll connections prove liveness)
const SESSION_TIMEOUT_MS = 60_000;

// Cleanup interval (60 seconds)
const CLEANUP_INTERVAL_MS = 60_000;

// Lazy initialization guard — defers DB calls until first request
// so that `next build` can import this module without hitting the database.
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  // Mark stale runners offline on first request
  markStaleRunnersOffline(SESSION_TIMEOUT_MS).then((count) => {
    if (count > 0) {
      console.log(`[Startup] Marked ${count} stale runner(s) as offline`);
    }
  }).catch((error) => {
    console.error('[Startup] Failed to mark stale runners offline:', error);
  });

  // Start cleanup interval to remove stale sessions, mark runners offline, and GC old commands
  setInterval(async () => {
    const now = Date.now();
    for (const [runnerId, session] of activeRunnerSessions) {
      if (now - session.lastPoll > SESSION_TIMEOUT_MS) {
        activeRunnerSessions.delete(runnerId);
        try {
          await updateRunnerStatus(runnerId, 'offline');
          console.log(`[Cleanup] Runner ${runnerId} marked offline (no heartbeat for ${SESSION_TIMEOUT_MS}ms)`);
        } catch (error) {
          console.error(`[Cleanup] Failed to mark runner ${runnerId} offline:`, error);
        }
      }
    }

    try {
      await markStaleRunnersOffline(SESSION_TIMEOUT_MS);
    } catch (error) {
      console.error('[Cleanup] Failed to mark stale runners offline:', error);
    }

    try {
      const deleted = await deleteStaleSystemRunners(5 * 60 * 1000);
      if (deleted > 0) {
        console.log(`[GC] Deleted ${deleted} stale system runners`);
      }
    } catch (error) {
      console.error('[GC] Failed to delete stale system runners:', error);
    }

    // Garbage collection: delete old completed commands (24h)
    try {
      const cleaned = await cleanupOldCommands(24 * 60 * 60 * 1000);
      if (cleaned > 0) {
        console.log(`[GC] Cleaned up ${cleaned} old runner commands`);
      }
    } catch (error) {
      console.error('[GC] Failed to clean old commands:', error);
    }

    // Timeout stale commands: pending > 30min, claimed > 10min
    try {
      await timeoutStaleCommands(30 * 60 * 1000, 10 * 60 * 1000);
    } catch (error) {
      console.error('[GC] Failed to timeout stale commands:', error);
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * POST /api/ws/runner
 * Polling endpoint for runners when WebSocket is not available
 * Runners poll this endpoint to receive commands and send responses
 */
export async function POST(request: NextRequest) {
  ensureInitialized();
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);

    if (!runner) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Validate session ID for heartbeat requests
    const sessionId = request.headers.get('x-session-id');
    const activeSession = activeRunnerSessions.get(runner.id);

    if (activeSession && sessionId !== activeSession.sessionId) {
      return NextResponse.json(
        { error: 'Session conflict: another runner instance is connected with this token' },
        { status: 409 }
      );
    }

    // Update last poll timestamp if session is valid
    if (activeSession && sessionId === activeSession.sessionId) {
      activeSession.lastPoll = Date.now();
    }

    const body = await request.json();
    const message = body as Message;

    // Handle different message types
    switch (message.type) {
      case 'status:heartbeat': {
        const heartbeat = message as HeartbeatMessage;

        // Handle graceful disconnect
        if (heartbeat.payload.disconnect) {
          await updateRunnerStatus(runner.id, 'offline');
          activeRunnerSessions.delete(runner.id);
          return NextResponse.json({ ok: true, goodbye: true });
        }

        // Map all heartbeat statuses to valid runner statuses
        let status: 'online' | 'offline' | 'busy';
        switch (heartbeat.payload.status) {
          case 'busy':
          case 'recording':
          case 'debugging':
            status = 'busy';
            break;
          default:
            status = 'online';
        }
        await updateRunnerStatus(runner.id, status);

        // Claim pending commands from DB (limit to maxParallelTests to prevent bulk execution)
        let claimed = await claimPendingCommands(runner.id, runner.maxParallelTests ?? undefined);

        // Long-poll: if no commands, wait up to 25s for a command to be queued
        if (claimed.length === 0) {
          const notified = await waitForCommandQueued(runner.id, 25_000);
          if (notified) {
            claimed = await claimPendingCommands(runner.id, runner.maxParallelTests ?? undefined);
          }
        }

        // Reconstruct Message objects from stored commands
        const commands: Message[] = claimed.map(cmd => ({
          id: cmd.id,
          type: cmd.type,
          timestamp: cmd.createdAt ? cmd.createdAt.getTime() : Date.now(),
          payload: cmd.payload,
        } as unknown as Message));

        if (commands.length > 0) {
          console.log(`[Runner ${runner.id}] Returning ${commands.length} claimed commands:`, commands.map(c => c.type));
        }
        return NextResponse.json({
          ok: true,
          commands,
        });
      }

      case 'response:test_result': {
        const result = message as TestResultResponse;
        const commandId = result.payload.correlationId;

        // Drop video data — it's saved separately
        const payload = { ...result.payload } as Record<string, unknown>;
        delete payload.videoData;

        // Store result in DB and mark command completed
        const resultStatus = result.payload.status === 'passed' ? 'completed' : 'failed';
        try {
          await insertCommandResult({
            commandId,
            runnerId: runner.id,
            type: 'response:test_result',
            payload,
          });
        } catch (err) {
          console.error(`[Runner] Failed to insert test result for command ${commandId}:`, err);
          // Still mark command completed so the executor doesn't hang
        }
        await completeRunnerCommand(commandId, resultStatus as 'completed' | 'failed');

        return NextResponse.json({ ok: true });
      }

      case 'response:setup_result': {
        const result = message as SetupResultResponse;
        const commandId = result.payload.correlationId;

        // Store result in DB and mark command completed
        const setupStatus = result.payload.status === 'passed' ? 'completed' : 'failed';
        await insertCommandResult({
          commandId,
          runnerId: runner.id,
          type: 'response:setup_result',
          payload: result.payload as unknown as Record<string, unknown>,
        });
        await completeRunnerCommand(commandId, setupStatus as 'completed' | 'failed');

        return NextResponse.json({ ok: true });
      }

      case 'response:screenshot': {
        // Handle screenshot upload - save directly to disk
        const screenshotMsg = message as ScreenshotUploadResponse;
        const payload = screenshotMsg.payload;

        try {
          // Validate inputs to prevent path traversal and DoS attacks
          const safeFilename = sanitizeFilename(payload.filename);
          const safeRepoId = validateRepositoryId(payload.repositoryId);
          validateScreenshotSize(payload.data);

          console.log(`[Screenshot] Received screenshot from runner ${runner.id}: ${safeFilename}`);

          // Save to disk immediately
          const savedPath = await saveScreenshotToDisk(payload.data, safeFilename, safeRepoId);
          console.log(`[Screenshot] Saved to disk: ${savedPath}`);

          // Store metadata in DB (no base64 data — just path info)
          const commandId = payload.correlationId;
          if (commandId) {
            await insertCommandResult({
              commandId,
              runnerId: runner.id,
              type: 'response:screenshot',
              payload: {
                filename: safeFilename,
                path: savedPath,
                repositoryId: safeRepoId,
                testRunId: payload.testRunId,
                width: payload.width,
                height: payload.height,
                capturedAt: payload.capturedAt,
              },
            });
          }
        } catch (error) {
          console.error(`[Screenshot] Validation or save failed:`, error);
          return NextResponse.json({ error: 'Screenshot upload failed' }, { status: 400 });
        }

        return NextResponse.json({ ok: true });
      }

      case 'response:network_bodies': {
        const payload = message.payload as Record<string, unknown>;
        const commandId = payload.correlationId as string;
        const testId = payload.testId as string;
        const testRunId = payload.testRunId as string;
        const repositoryId = payload.repositoryId as string | undefined;
        const networkRequests = payload.networkRequests;

        if (!commandId || !networkRequests) {
          return NextResponse.json({ error: 'Missing correlationId or networkRequests' }, { status: 400 });
        }

        try {
          const dir = path.join(STORAGE_DIRS['network-bodies'], repositoryId || 'default');
          await fs.mkdir(dir, { recursive: true });
          const filename = `${testRunId}-${testId}.json`;
          const filePath = path.join(dir, filename);
          await fs.writeFile(filePath, JSON.stringify(networkRequests));
          const relativePath = `/network-bodies/${repositoryId || 'default'}/${filename}`;

          await insertCommandResult({
            commandId,
            runnerId: runner.id,
            type: 'response:network_bodies',
            payload: { path: relativePath },
          });
        } catch (error) {
          console.error(`[NetworkBodies] Failed to save for test ${testId}:`, error);
          // Non-blocking — test result is already stored
        }

        return NextResponse.json({ ok: true });
      }

      case 'response:pong': {
        return NextResponse.json({ ok: true });
      }

      case 'response:test_progress': {
        // Progress updates are informational, just acknowledge
        return NextResponse.json({ ok: true });
      }

      case 'response:recording_event': {
        const recordingMsg = message as RecordingEventResponse;
        const { sessionId: recSessionId, events } = recordingMsg.payload;

        // Find the remote recording session
        const session = findRemoteSessionBySessionId(recSessionId);
        if (session) {
          // Append events to the session
          for (const event of events) {
            session.events.push(event as RemoteRecordingEvent);
          }
        } else {
          console.warn(`[Recording] Received events for unknown session: ${recSessionId}`);
        }

        return NextResponse.json({ ok: true });
      }

      case 'response:recording_stopped': {
        const stoppedMsg = message as RecordingStoppedResponse;
        const { sessionId: stoppedSessionId } = stoppedMsg.payload;

        const session = findRemoteSessionBySessionId(stoppedSessionId);
        if (session) {
          session.isRecording = false;
          console.log(`[Recording] Session ${stoppedSessionId} stopped, ${session.events.length} events`);
        }

        return NextResponse.json({ ok: true });
      }

      case 'response:debug_state': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const debugPayload = (message as any).payload as DebugStateResponsePayload;
        const debugSession = findRemoteDebugBySessionId(debugPayload.sessionId);
        if (debugSession) {
          debugSession.state = debugPayload;
        }
        return NextResponse.json({ ok: true });
      }

      default:
        console.warn('Unknown message type:', message.type);
        return NextResponse.json({ error: 'Unknown message type', type: message.type }, { status: 400 });
    }
  } catch (error) {
    // Log detailed error server-side only (never expose to client)
    console.error('Runner API error:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/ws/runner
 * Runner connects and polls for commands
 */
export async function GET(request: NextRequest) {
  ensureInitialized();
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);

    if (!runner) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Check for existing active session (duplicate detection)
    const existingSession = activeRunnerSessions.get(runner.id);
    const now = Date.now();

    if (existingSession && now - existingSession.lastPoll < SESSION_TIMEOUT_MS) {
      return NextResponse.json(
        {
          error: 'Duplicate connection: another runner instance is already connected with this token',
        },
        { status: 409 }
      );
    }

    // Generate new session ID
    const sessionId = crypto.randomUUID();

    // Register this session
    activeRunnerSessions.set(runner.id, {
      lastPoll: now,
      sessionId,
    });

    // Set runner to 'online' immediately on connect so stale 'busy' status
    // from a previous crashed session doesn't block task assignment
    await updateRunnerStatus(runner.id, 'online');

    // Claim any pending commands from DB (limit to maxParallelTests)
    const claimed = await claimPendingCommands(runner.id, runner.maxParallelTests ?? undefined);
    const commands: Message[] = claimed.map(cmd => ({
      id: cmd.id,
      type: cmd.type,
      timestamp: cmd.createdAt ? cmd.createdAt.getTime() : Date.now(),
      payload: cmd.payload,
    } as unknown as Message));

    return NextResponse.json({
      runnerId: runner.id,
      teamId: runner.teamId,
      capabilities: runner.capabilities,
      commands,
      sessionId,
    });
  } catch (error) {
    // Log detailed error server-side only (never expose to client)
    console.error('Runner API error:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Save screenshot directly to disk from base64 data.
 */
async function saveScreenshotToDisk(base64Data: string, filename: string, repositoryId?: string): Promise<string> {
  const baseDir = STORAGE_DIRS.screenshots;
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.writeFile(filePath, buffer);

  return repositoryId ? `/screenshots/${repositoryId}/${filename}` : `/screenshots/${filename}`;
}

// ============================================
// DB-backed command queue exports
// ============================================

/**
 * Queue a command for a runner via DB (called by executor and server actions).
 */
export async function queueCommandToDB(runnerId: string, command: Message): Promise<void> {
  console.log(`[queueCommandToDB] Queuing ${command.type} for runner ${runnerId}`);
  const payload = 'payload' in command ? (command as unknown as { payload: Record<string, unknown> }).payload : {};
  await createRunnerCommand({
    id: command.id,
    runnerId,
    type: command.type,
    status: 'pending',
    payload,
    testId: (payload as Record<string, unknown>).testId as string | undefined,
    testRunId: (payload as Record<string, unknown>).testRunId as string | undefined,
  });
  notifyCommandQueued(runnerId);
}

/**
 * Queue a cancel command for a runner via DB.
 */
export async function queueCancelCommandToDB(runnerId: string, testRunId: string, reason: string): Promise<void> {
  const command: Message = {
    id: crypto.randomUUID(),
    type: 'command:cancel_test',
    timestamp: Date.now(),
    payload: {
      testRunId,
      reason,
    },
  } as Message;
  await queueCommandToDB(runnerId, command);
  // Also cancel any unclaimed run commands for this test run
  await cancelPendingCommandsByTestRun(testRunId);
}

// ============================================
// Remote Recording Session Management (in-memory — real-time, acceptable)
// ============================================

const globalRecordingState = globalThis as typeof globalThis & {
  __remoteRecordingSessions?: Map<string, RemoteRecordingSession>;
};
if (!globalRecordingState.__remoteRecordingSessions) {
  globalRecordingState.__remoteRecordingSessions = new Map<string, RemoteRecordingSession>();
}
const remoteRecordingSessionsMap = globalRecordingState.__remoteRecordingSessions;

// Remote recording session state
export interface RemoteRecordingEvent {
  type: string;
  timestamp: number;
  sequence: number;
  status: 'preview' | 'committed';
  verification?: {
    syntaxValid: boolean;
    domVerified?: boolean;
    lastChecked?: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface RemoteRecordingSession {
  sessionId: string;
  runnerId: string;
  repositoryId: string | null;
  targetUrl: string;
  isRecording: boolean;
  events: RemoteRecordingEvent[];
  generatedCode: string | null;
  startedAt: Date;
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>;
}

function findRemoteSessionBySessionId(sessionId: string): RemoteRecordingSession | undefined {
  for (const session of remoteRecordingSessionsMap.values()) {
    if (session.sessionId === sessionId) return session;
  }
  return undefined;
}

/**
 * Create a new remote recording session (called by recording action)
 */
export function createRemoteRecordingSession(
  sessionId: string,
  runnerId: string,
  repositoryId: string | null,
  targetUrl: string,
  selectorPriority: Array<{ type: string; enabled: boolean; priority: number }>
): void {
  const session: RemoteRecordingSession = {
    sessionId,
    runnerId,
    repositoryId,
    targetUrl,
    isRecording: true,
    events: [],
    generatedCode: null,
    startedAt: new Date(),
    selectorPriority,
  };
  // Key by repositoryId so getRecordingStatus can find it
  const key = repositoryId ?? '__no_repo__';
  remoteRecordingSessionsMap.set(key, session);
  console.log(`[Recording] Created remote session ${sessionId} for runner ${runnerId}`);
}

/**
 * Get the active remote recording session for a repository
 */
export function getRemoteRecordingSession(repositoryId?: string | null): RemoteRecordingSession | null {
  const key = repositoryId ?? '__no_repo__';
  const session = remoteRecordingSessionsMap.get(key);
  return session ?? null;
}

/**
 * Get events from a remote recording session since a given sequence number
 */
export function getRemoteRecordingEvents(repositoryId?: string | null, sinceSequence?: number): RemoteRecordingEvent[] {
  const session = getRemoteRecordingSession(repositoryId);
  if (!session) return [];

  if (sinceSequence !== undefined) {
    return session.events.filter(e => e.sequence > sinceSequence);
  }
  return session.events;
}

/**
 * Mark a remote recording session as stopped and store generated code
 */
export function completeRemoteRecordingSession(repositoryId?: string | null, generatedCode?: string): void {
  const session = getRemoteRecordingSession(repositoryId);
  if (session) {
    session.isRecording = false;
    if (generatedCode) {
      session.generatedCode = generatedCode;
    }
  }
}

/**
 * Remove a remote recording session
 */
export function clearRemoteRecordingSession(repositoryId?: string | null): void {
  const key = repositoryId ?? '__no_repo__';
  remoteRecordingSessionsMap.delete(key);
}

// ============================================
// Remote Debug Session Management (in-memory — real-time, acceptable)
// ============================================

import type { DebugStateResponsePayload } from '@/lib/ws/protocol';

export interface RemoteDebugSession {
  sessionId: string;
  runnerId: string;
  repositoryId: string | null;
  testId: string;
  state: DebugStateResponsePayload | null;
  startedAt: Date;
}

const globalDebugState = globalThis as typeof globalThis & {
  __remoteDebugSessions?: Map<string, RemoteDebugSession>;
};
if (!globalDebugState.__remoteDebugSessions) {
  globalDebugState.__remoteDebugSessions = new Map<string, RemoteDebugSession>();
}
const remoteDebugSessionsMap = globalDebugState.__remoteDebugSessions;

function findRemoteDebugBySessionId(sessionId: string): RemoteDebugSession | undefined {
  for (const session of remoteDebugSessionsMap.values()) {
    if (session.sessionId === sessionId) return session;
  }
  return undefined;
}

export function createRemoteDebugSession(
  sessionId: string,
  runnerId: string,
  repositoryId: string | null,
  testId: string
): void {
  remoteDebugSessionsMap.set(sessionId, {
    sessionId,
    runnerId,
    repositoryId,
    testId,
    state: null,
    startedAt: new Date(),
  });
  console.log(`[Debug] Created remote session ${sessionId} for runner ${runnerId}`);
}

export function getRemoteDebugSession(sessionId: string): RemoteDebugSession | null {
  return remoteDebugSessionsMap.get(sessionId) ?? findRemoteDebugBySessionId(sessionId) ?? null;
}

export function clearRemoteDebugSession(sessionId: string): void {
  remoteDebugSessionsMap.delete(sessionId);
}
