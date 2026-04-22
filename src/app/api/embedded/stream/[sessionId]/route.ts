import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmbeddedSession } from '@/server/actions/embedded-sessions';
import { toProxyStreamUrl } from '@/lib/eb/stream-url';

/**
 * GET /api/embedded/stream/[sessionId]
 *
 * Returns stream connection info for a specific embedded session.
 * The streamUrl is proxied through the main app's WS proxy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    await requireAuth();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const session = await getEmbeddedSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;

    return NextResponse.json({
      sessionId: session.id,
      runnerId: session.runnerId,
      status: session.status,
      streamUrl: toProxyStreamUrl(session.streamUrl),
      viewport: session.viewport,
      currentUrl: session.currentUrl,
      streamAuthToken,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}
