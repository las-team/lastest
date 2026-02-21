import { NextRequest, NextResponse } from 'next/server';
import { getAgentSession } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await getCurrentSession();
  if (!auth?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const session = await getAgentSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Verify team ownership
  if (session.teamId && session.teamId !== auth.team.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(session);
}
