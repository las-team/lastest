/**
 * SSE Endpoint for Test Events (VSCode Extension)
 *
 * GET /api/v1/events - Server-Sent Events stream for real-time test updates
 *
 * Events:
 * - test:start - Test execution started
 * - test:progress - Test execution progress update
 * - test:complete - Test execution completed
 * - build:complete - Build completed with final status
 */

import { NextRequest } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import { subscribeToTestEvents, type TestEvent } from '@/lib/ws/test-events';

export const dynamic = 'force-dynamic';

// Helper to verify API auth (session or Bearer token)
async function verifyAuth(request: NextRequest) {
  // Try session first
  const session = await getCurrentSession();
  if (session) {
    return session;
  }

  // Try API token auth (Bearer token)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyBearerToken(token);
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await verifyAuth(request);

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const teamId = session.team?.id;
  if (!teamId) {
    return new Response('No team', { status: 403 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send connected event
      const connectedData = {
        type: 'connected',
        timestamp: Date.now(),
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(connectedData)}\n\n`));

      // Subscribe to test events
      unsubscribe = subscribeToTestEvents((event: TestEvent) => {
        // Only send events for this team
        if (event.teamId !== teamId) return;

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (error) {
          // Stream might be closed
          console.error('[SSE] Failed to send event:', error);
        }
      });

      // Send keepalive every 8 seconds (must be under envoy's 10s idle_timeout on Olares)
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 8000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
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
    },
  });
}
