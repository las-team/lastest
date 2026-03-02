import { NextResponse } from 'next/server';
import { validateRunnerToken } from '@/server/actions/runners';
import { upsertEmbeddedSession } from '@/server/actions/embedded-sessions';

/**
 * POST /api/embedded/register
 *
 * Called by the embedded browser container on startup to register
 * itself as an embedded session linked to its runner.
 */
export async function POST(request: Request) {
  // Authenticate via runner token
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authorization' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const runner = await validateRunnerToken(token);
  if (!runner) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // Parse body
  let body: {
    streamUrl: string;
    containerUrl: string;
    viewport?: { width: number; height: number };
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.streamUrl || !body.containerUrl) {
    return NextResponse.json({ error: 'streamUrl and containerUrl are required' }, { status: 400 });
  }

  // Upsert embedded session (1 per runner)
  const session = await upsertEmbeddedSession({
    teamId: runner.teamId,
    runnerId: runner.id,
    streamUrl: body.streamUrl,
    containerUrl: body.containerUrl,
    viewport: body.viewport,
  });

  return NextResponse.json({
    sessionId: session.id,
    runnerId: runner.id,
  });
}
