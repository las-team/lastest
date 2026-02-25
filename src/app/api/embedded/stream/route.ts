import { NextResponse } from 'next/server';
import { listEmbeddedSessions } from '@/server/actions/embedded-sessions';

/**
 * GET /api/embedded/stream
 *
 * Returns all embedded sessions for the authenticated team.
 * Used by the UI to discover available embedded browser sessions.
 */
export async function GET() {
  try {
    const sessions = await listEmbeddedSessions();
    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}
