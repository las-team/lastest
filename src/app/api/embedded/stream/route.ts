import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listEmbeddedSessions } from '@/server/actions/embedded-sessions';

/**
 * GET /api/embedded/stream
 *
 * Returns all embedded sessions for the authenticated team.
 * Each session includes the streamUrl for direct WebSocket connection.
 * The client connects directly to the container's stream server (Option A).
 */
export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sessions = await listEmbeddedSessions();
    const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        runnerId: s.runnerId,
        status: s.status,
        streamUrl: s.streamUrl,
        viewport: s.viewport,
        currentUrl: s.currentUrl,
        userId: s.userId,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
      })),
      streamAuthToken,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}
