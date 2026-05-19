import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import { getEmbeddedSession } from '@/server/actions/embedded-sessions';
import { toProxyStreamUrl, probeStreamUrlAlive } from '@/lib/eb/stream-url';

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
    // B4 diagnostics — see /api/embedded/stream/route.ts for context.
    const h = await headers();
    const hasCookie = Boolean(h.get('cookie'));
    const hasBearer = h.get('authorization')?.startsWith('Bearer ');
    const { sessionId: sid } = await params;
    console.warn(
      `[stream/${sid}] 401 Unauthorized — cookie=${hasCookie ? 'present' : 'missing'} bearer=${hasBearer ? 'present' : 'missing'}`,
    );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const session = await getEmbeddedSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const streamAuthToken = process.env.STREAM_AUTH_TOKEN || null;
    // Suppress the streamUrl once the session has been released or is shutting
    // down — even if the DB row still has the old URL (e.g. EB crashed before
    // releasePoolEB could clear it), handing it back would lead the client to
    // a dead pod IP and a silent WebSocket failure. The TCP probe extends that
    // guard to the racey case where the DB still says ready/busy but the pod
    // was already reaped.
    const isLive = session.status !== 'stopped' && session.status !== 'stopping';
    const probedAlive = isLive && !!session.streamUrl && (await probeStreamUrlAlive(session.streamUrl));
    if (isLive && !probedAlive && session.streamUrl) {
      console.warn(
        `[stream/${session.id.slice(0, 8)}] EB unreachable, hiding streamUrl runner=${session.runnerId?.slice(0, 8) ?? 'none'} status=${session.status} url=${session.streamUrl}`,
      );
    }
    return NextResponse.json({
      sessionId: session.id,
      runnerId: session.runnerId,
      status: session.status,
      streamUrl: isLive && probedAlive ? toProxyStreamUrl(session.streamUrl) : null,
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
