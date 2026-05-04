/**
 * SSE Endpoint for Activity Feed
 *
 * GET /api/activity-feed - Server-Sent Events stream for real-time agent & MCP activity
 *
 * Query params:
 * - repo: filter by repositoryId
 * - source: filter by sourceType (play_agent | mcp_server)
 */

import { NextRequest } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import { subscribeToActivityFeed, type ActivityFeedEvent } from '@/lib/ws/activity-events';

export const dynamic = 'force-dynamic';

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7));
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await verifyAuth(request);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const teamId = session.team?.id;
  if (!teamId) return new Response('No team', { status: 403 });

  const { searchParams } = new URL(request.url);
  const repoFilter = searchParams.get('repo');
  const sourceFilter = searchParams.get('source');

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`),
      );

      unsubscribe = subscribeToActivityFeed((event: ActivityFeedEvent) => {
        if (event.teamId !== teamId) return;
        if (repoFilter && event.repositoryId !== repoFilter) return;
        if (sourceFilter && event.sourceType !== sourceFilter) return;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 5000);

      // Cloudflare 524 prevention — close at 90s; EventSource auto-reconnects.
      const lifetimeCap = setTimeout(() => {
        try {
          controller.enqueue(encoder.encode('event: reconnect\ndata: {"reason":"lifetime-cap"}\n\n'));
          controller.close();
        } catch {
          // already closed
        }
      }, 90_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        clearTimeout(lifetimeCap);
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
