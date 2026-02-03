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
import { validateRunnerToken, updateRunnerStatus } from '@/server/actions/runners';
// runnerRegistry is used for WebSocket mode (not polling mode)
// import { runnerRegistry } from '@/lib/ws/runner-registry';
import type { Message, HeartbeatMessage, TestResultResponse } from '@/lib/ws/protocol';

// Track active polling sessions by runner ID
const activeRunnerSessions = new Map<string, {
  lastPoll: number;
  sessionId: string;
}>();

// Session timeout in milliseconds (30 seconds)
const SESSION_TIMEOUT_MS = 30_000;

// Cleanup interval (60 seconds)
const CLEANUP_INTERVAL_MS = 60_000;

// Start cleanup interval to remove stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [runnerId, session] of activeRunnerSessions) {
    if (now - session.lastPoll > SESSION_TIMEOUT_MS) {
      activeRunnerSessions.delete(runnerId);
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * POST /api/ws/runner
 * Polling endpoint for runners when WebSocket is not available
 * Runners poll this endpoint to receive commands and send responses
 */
export async function POST(request: NextRequest) {
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

    // Update runner status on each message
    await updateRunnerStatus(runner.id, 'online', new Date());

    // Handle different message types
    switch (message.type) {
      case 'status:heartbeat': {
        const heartbeat = message as HeartbeatMessage;
        const status = heartbeat.payload.status === 'idle' ? 'online' : heartbeat.payload.status;
        await updateRunnerStatus(runner.id, status as 'online' | 'offline' | 'busy');

        // Return any pending commands for this runner
        const pendingCommands = getPendingCommands(runner.id);
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
        // Handle screenshot upload
        storeScreenshot(runner.id, message);
        return NextResponse.json({ ok: true });
      }

      case 'response:pong': {
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown message type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Runner API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ws/runner
 * Runner connects and polls for commands
 */
export async function GET(request: NextRequest) {
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

    // Update last seen
    await updateRunnerStatus(runner.id, 'online', new Date());

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
    console.error('Runner API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// In-memory command queue (for polling mode)
// In production, use Redis or database
const pendingCommandsMap = new Map<string, Message[]>();
const testResultsMap = new Map<string, TestResultResponse[]>();
const screenshotsMap = new Map<string, Message[]>();

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
}

/**
 * Queue a command for a runner (called by test runner)
 */
export function queueCommand(runnerId: string, command: Message): void {
  const commands = pendingCommandsMap.get(runnerId) || [];
  commands.push(command);
  pendingCommandsMap.set(runnerId, commands);
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
  screenshotsMap.set(runnerId, []); // Clear after fetching
  return screenshots;
}
