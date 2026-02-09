/**
 * WebSocket API Endpoint for Runner Connections
 *
 * Note: Next.js App Router doesn't natively support WebSocket upgrades.
 * This endpoint provides a fallback HTTP API for runner communication.
 * For full WebSocket support, use a custom server or deploy with a
 * WebSocket-capable runtime (e.g., Node.js server, not Vercel serverless).
 *
 * In production, consider using:
 * - A separate WebSocket server
 * - Socket.io with custom server
 * - Pusher/Ably for managed WebSocket
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateRunnerToken, updateRunnerStatus, markStaleRunnersOffline } from '@/server/actions/runners';
// runnerRegistry is used for WebSocket mode (not polling mode)
// import { runnerRegistry } from '@/lib/ws/runner-registry';
import type { Message, HeartbeatMessage, TestResultResponse, ScreenshotUploadResponse } from '@/lib/ws/protocol';
import fs from 'fs/promises';
import path from 'path';

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
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '');
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

// Track active polling sessions by runner ID
// Use globalThis to ensure shared state across Next.js module contexts
const globalSessionState = globalThis as typeof globalThis & {
  __runnerActiveSessions?: Map<string, { lastPoll: number; sessionId: string }>;
};
if (!globalSessionState.__runnerActiveSessions) {
  globalSessionState.__runnerActiveSessions = new Map<string, { lastPoll: number; sessionId: string }>();
}
const activeRunnerSessions = globalSessionState.__runnerActiveSessions;

// Session timeout in milliseconds (90 seconds = 3x heartbeat interval)
// Allows for 2 missed heartbeats before marking offline
const SESSION_TIMEOUT_MS = 90_000;

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

  // Start cleanup interval to remove stale sessions and mark runners offline
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
            status = 'busy';
            break;
          case 'recording':
            status = 'busy'; // Recording is a form of busy
            break;
          default:
            status = 'online';
        }
        await updateRunnerStatus(runner.id, status);

        // Return any pending commands for this runner
        const pendingCommands = getPendingCommands(runner.id);
        if (pendingCommands.length > 0) {
          console.log(`[Runner ${runner.id}] Returning ${pendingCommands.length} pending commands:`, pendingCommands.map(c => c.type));
        }
        return NextResponse.json({
          ok: true,
          commands: pendingCommands,
        });
      }

      case 'response:test_result': {
        const result = message as TestResultResponse;
        // Store test result - will be handled by the test runner
        storeTestResult(runner.id, result);
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

          // Save to disk immediately (to repository folder if provided)
          const savedPath = await saveScreenshotToDisk(payload.data, safeFilename, safeRepoId);
          console.log(`[Screenshot] Saved to disk: ${savedPath}`);

          // Also store in memory for backward compatibility (with sanitized data)
          storeScreenshot(runner.id, message);
        } catch (error) {
          console.error(`[Screenshot] Validation or save failed:`, error);
          return NextResponse.json({ error: 'Screenshot upload failed' }, { status: 400 });
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
          existingSessionId: existingSession.sessionId,
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

    // Note: Runner status is only set to 'online' when heartbeat is received (POST)
    // This ensures the runner is actually polling and not just connecting once

    // Return runner info and any pending commands
    const pendingCommands = getPendingCommands(runner.id);

    return NextResponse.json({
      runnerId: runner.id,
      teamId: runner.teamId,
      capabilities: runner.capabilities,
      commands: pendingCommands,
      sessionId,
    });
  } catch (error) {
    // Log detailed error server-side only (never expose to client)
    console.error('Runner API error:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'N/A');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// In-memory command queue (for polling mode)
// In production, use Redis or database
// Use globalThis to ensure shared state across Next.js module contexts
const globalState = globalThis as typeof globalThis & {
  __runnerPendingCommands?: Map<string, Message[]>;
  __runnerTestResults?: Map<string, TestResultResponse[]>;
  __runnerScreenshots?: Map<string, Message[]>;
};

if (!globalState.__runnerPendingCommands) {
  globalState.__runnerPendingCommands = new Map<string, Message[]>();
}
if (!globalState.__runnerTestResults) {
  globalState.__runnerTestResults = new Map<string, TestResultResponse[]>();
}
if (!globalState.__runnerScreenshots) {
  globalState.__runnerScreenshots = new Map<string, Message[]>();
}

const pendingCommandsMap = globalState.__runnerPendingCommands;
const testResultsMap = globalState.__runnerTestResults;
const screenshotsMap = globalState.__runnerScreenshots;

function getPendingCommands(runnerId: string): Message[] {
  const commands = pendingCommandsMap.get(runnerId) || [];
  pendingCommandsMap.set(runnerId, []); // Clear after fetching
  return commands;
}

function storeTestResult(runnerId: string, result: TestResultResponse) {
  const results = testResultsMap.get(runnerId) || [];
  results.push(result);
  testResultsMap.set(runnerId, results);
}

function storeScreenshot(runnerId: string, screenshot: Message) {
  const screenshots = screenshotsMap.get(runnerId) || [];
  screenshots.push(screenshot);
  screenshotsMap.set(runnerId, screenshots);
  console.log(`[storeScreenshot] Stored screenshot for runner ${runnerId}, total: ${screenshots.length}`);
}

/**
 * Save screenshot directly to disk from base64 data.
 * This ensures screenshots are persisted even if in-memory state is lost.
 */
async function saveScreenshotToDisk(base64Data: string, filename: string, repositoryId?: string): Promise<string> {
  const baseDir = './public/screenshots';
  const dir = repositoryId ? path.join(baseDir, repositoryId) : baseDir;

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.writeFile(filePath, buffer);

  return repositoryId ? `/screenshots/${repositoryId}/${filename}` : `/screenshots/${filename}`;
}

/**
 * Queue a command for a runner (called by test runner)
 */
export function queueCommand(runnerId: string, command: Message): void {
  console.log(`[queueCommand] Queuing ${command.type} for runner ${runnerId}`);
  const commands = pendingCommandsMap.get(runnerId) || [];
  commands.push(command);
  pendingCommandsMap.set(runnerId, commands);
  console.log(`[queueCommand] Runner ${runnerId} now has ${commands.length} pending commands`);
}

/**
 * Queue a cancel command for a runner
 */
export function queueCancelCommand(runnerId: string, testRunId: string, reason: string): void {
  const command: Message = {
    id: crypto.randomUUID(),
    type: 'command:cancel_test',
    timestamp: Date.now(),
    payload: {
      testRunId,
      reason,
    },
  } as Message;
  queueCommand(runnerId, command);
}

/**
 * Get test results for a runner (called by test runner)
 */
export function getTestResults(runnerId: string): TestResultResponse[] {
  const results = testResultsMap.get(runnerId) || [];
  testResultsMap.set(runnerId, []); // Clear after fetching
  return results;
}

/**
 * Get screenshots for a runner (called by test runner)
 */
export function getScreenshots(runnerId: string): Message[] {
  const screenshots = screenshotsMap.get(runnerId) || [];
  if (screenshots.length > 0) {
    console.log(`[getScreenshots] Retrieved ${screenshots.length} screenshots for runner ${runnerId}`);
  }
  screenshotsMap.set(runnerId, []); // Clear after fetching
  return screenshots;
}
