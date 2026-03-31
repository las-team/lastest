/**
 * SSE Endpoint for Runner Status Updates
 *
 * GET /api/runners/status - Server-Sent Events stream for real-time runner status
 *
 * This replaces UI polling with push-based updates.
 * The UI subscribes to this endpoint and receives events when:
 * - A runner comes online
 * - A runner goes offline
 * - A runner becomes busy/idle
 */

import { NextRequest } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { runners } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { subscribeToRunnerStatus, type RunnerStatusEvent } from '@/lib/ws/runner-events';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Authenticate the request
  const session = await getCurrentSession();

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Get user's team ID
  const teamId = session.team?.id;
  if (!teamId) {
    return new Response('No team', { status: 403 });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial runner states
      (async () => {
        try {
          const teamRunners = await db
            .select()
            .from(runners)
            .where(eq(runners.teamId, teamId))
            .all();

          const initialData = {
            type: 'init',
            runners: teamRunners.map((r) => ({
              id: r.id,
              name: r.name,
              status: r.status,
              lastSeen: r.lastSeen?.toISOString(),
            })),
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));
        } catch (error) {
          console.error('[SSE] Failed to send initial state:', error);
        }
      })();

      // Subscribe to status changes
      unsubscribe = subscribeToRunnerStatus((event: RunnerStatusEvent) => {
        // Only send events for this team's runners
        if (event.teamId !== teamId) return;

        try {
          const data = {
            type: 'status',
            runnerId: event.runnerId,
            status: event.status,
            previousStatus: event.previousStatus,
            timestamp: event.timestamp,
          };

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (error) {
          // Stream might be closed
          console.error('[SSE] Failed to send event:', error);
        }
      });

      // Send keepalive every 8 seconds (must be under envoy's 10s idle_timeout)
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
