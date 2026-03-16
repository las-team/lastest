import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEmbeddedSession } from '@/server/actions/embedded-sessions';

/**
 * Convert a direct ws:// streamUrl to a proxy path so the browser connects
 * through the main app's WS proxy instead of directly to the container IP.
 */
function toProxyStreamUrl(streamUrl: string | null): string | null {
  if (!streamUrl) return null;
  try {
    const url = new URL(streamUrl);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      const target = `${url.hostname}:${url.port || '9223'}`;
      return `/api/embedded/stream/ws?target=${encodeURIComponent(target)}`;
    }
  } catch {
    // not a valid URL — return as-is
  }
  return streamUrl;
}

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
