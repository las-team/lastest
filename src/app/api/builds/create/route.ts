import { NextResponse } from 'next/server';
import { createAndRunBuild } from '@/server/actions/builds';
import { validateRunnerToken } from '@/server/actions/runners';

export async function POST(request: Request) {
  try {
    // Verify authentication via runner token
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const runner = await validateRunnerToken(token);
    if (!runner) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { repositoryId, runnerId, teamId, triggerType } = body;

    if (!repositoryId) {
      return NextResponse.json({ error: 'repositoryId is required' }, { status: 400 });
    }

    // Verify team matches runner's team
    if (teamId && runner.teamId !== teamId) {
      return NextResponse.json({ error: 'Team ID mismatch' }, { status: 403 });
    }

    // Create and start the build
    const result = await createAndRunBuild(
      triggerType || 'ci',
      undefined, // testIds - run all tests
      repositoryId,
      runnerId
    );

    return NextResponse.json({
      buildId: result.buildId,
      testRunId: result.testRunId,
      testCount: result.testCount,
      queued: 'queued' in result ? result.queued : false,
    });
  } catch (error) {
    console.error('Failed to create build:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create build' },
      { status: 500 }
    );
  }
}
