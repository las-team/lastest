import { NextRequest, NextResponse } from 'next/server';
import { getAgentSession, getAIPromptLog } from '@/lib/db/queries';
import { getCurrentSession } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; logId: string }> },
) {
  const auth = await getCurrentSession();
  if (!auth?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, logId } = await params;
  const session = await getAgentSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.teamId && session.teamId !== auth.team.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const log = await getAIPromptLog(logId);
  if (!log) {
    return NextResponse.json({ error: 'Log not found' }, { status: 404 });
  }

  return NextResponse.json({
    systemPrompt: log.systemPrompt,
    userPrompt: log.userPrompt,
    response: log.response,
    errorMessage: log.errorMessage,
    durationMs: log.durationMs,
    status: log.status,
    provider: log.provider,
    model: log.model,
  });
}
