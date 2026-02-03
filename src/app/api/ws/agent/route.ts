/**
 * WebSocket API Endpoint for Agent Connections
 *
 * Note: Next.js App Router doesn't natively support WebSocket upgrades.
 * This endpoint provides a fallback HTTP API for agent communication.
 * For full WebSocket support, use a custom server or deploy with a
 * WebSocket-capable runtime (e.g., Node.js server, not Vercel serverless).
 *
 * In production, consider using:
 * - A separate WebSocket server
 * - Socket.io with custom server
 * - Pusher/Ably for managed WebSocket
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAgentToken, updateAgentStatus } from '@/server/actions/agents';
// agentRegistry is used for WebSocket mode (not polling mode)
// import { agentRegistry } from '@/lib/ws/agent-registry';
import type { Message, HeartbeatMessage, TestResultResponse } from '@/lib/ws/protocol';

/**
 * POST /api/ws/agent
 * Polling endpoint for agents when WebSocket is not available
 * Agents poll this endpoint to receive commands and send responses
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const agent = await validateAgentToken(token);

    if (!agent) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await request.json();
    const message = body as Message;

    // Update agent status on each message
    await updateAgentStatus(agent.id, 'online', new Date());

    // Handle different message types
    switch (message.type) {
      case 'status:heartbeat': {
        const heartbeat = message as HeartbeatMessage;
        const status = heartbeat.payload.status === 'idle' ? 'online' : heartbeat.payload.status;
        await updateAgentStatus(agent.id, status as 'online' | 'offline' | 'busy');

        // Return any pending commands for this agent
        const pendingCommands = getPendingCommands(agent.id);
        return NextResponse.json({
          ok: true,
          commands: pendingCommands,
        });
      }

      case 'response:test_result': {
        const result = message as TestResultResponse;
        // Store test result - will be handled by the test runner
        storeTestResult(agent.id, result);
        return NextResponse.json({ ok: true });
      }

      case 'response:screenshot': {
        // Handle screenshot upload
        storeScreenshot(agent.id, message);
        return NextResponse.json({ ok: true });
      }

      case 'response:pong': {
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown message type' }, { status: 400 });
    }
  } catch (error) {
    console.error('Agent API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ws/agent
 * Agent connects and polls for commands
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const agent = await validateAgentToken(token);

    if (!agent) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Update last seen
    await updateAgentStatus(agent.id, 'online', new Date());

    // Return agent info and any pending commands
    const pendingCommands = getPendingCommands(agent.id);

    return NextResponse.json({
      agentId: agent.id,
      teamId: agent.teamId,
      capabilities: agent.capabilities,
      commands: pendingCommands,
    });
  } catch (error) {
    console.error('Agent API error:', error);
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

function getPendingCommands(agentId: string): Message[] {
  const commands = pendingCommandsMap.get(agentId) || [];
  pendingCommandsMap.set(agentId, []); // Clear after fetching
  return commands;
}

function storeTestResult(agentId: string, result: TestResultResponse) {
  const results = testResultsMap.get(agentId) || [];
  results.push(result);
  testResultsMap.set(agentId, results);
}

function storeScreenshot(agentId: string, screenshot: Message) {
  const screenshots = screenshotsMap.get(agentId) || [];
  screenshots.push(screenshot);
  screenshotsMap.set(agentId, screenshots);
}

/**
 * Queue a command for an agent (called by test runner)
 */
export function queueCommand(agentId: string, command: Message): void {
  const commands = pendingCommandsMap.get(agentId) || [];
  commands.push(command);
  pendingCommandsMap.set(agentId, commands);
}

/**
 * Get test results for an agent (called by test runner)
 */
export function getTestResults(agentId: string): TestResultResponse[] {
  const results = testResultsMap.get(agentId) || [];
  testResultsMap.set(agentId, []); // Clear after fetching
  return results;
}

/**
 * Get screenshots for an agent (called by test runner)
 */
export function getScreenshots(agentId: string): Message[] {
  const screenshots = screenshotsMap.get(agentId) || [];
  screenshotsMap.set(agentId, []); // Clear after fetching
  return screenshots;
}
