import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listEmbeddedSessions, listSystemEmbeddedSessions } from '@/server/actions/embedded-sessions';

/**
 * GET /api/embedded/stream
 *
 * Returns all embedded sessions for the authenticated team plus system sessions.
 * Each session includes the streamUrl for direct WebSocket connection.
 */
export async function GET() {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [teamSessions, systemSessions] = await Promise.all([
      listEmbeddedSessions(),
      listSystemEmbeddedSessions(),
    ]);

    // Merge, deduplicating by id (in case system runners are in the user's team)
    const seen = new Set<string>();
    const allSessions = [...teamSessions, ...systemSessions].filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;

    return NextResponse.json({
      sessions: allSessions.map((s) => ({
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
