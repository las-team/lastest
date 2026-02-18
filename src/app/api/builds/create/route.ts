import { NextResponse } from 'next/server';
import { createAndRunBuildFromCI } from '@/server/actions/builds';
import { validateRunnerToken } from '@/server/actions/runners';
import { db } from '@/lib/db';
import { repositories } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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
    const { repositoryId, githubRepo, triggerType, gitBranch, gitCommit } = body;

    // Resolve repository: by ID (legacy) or by GitHub full name (e.g. "owner/repo")
    let resolvedRepoId = repositoryId;
    if (!resolvedRepoId && githubRepo) {
      const repo = await db
        .select()
        .from(repositories)
        .where(
          and(
            eq(repositories.fullName, githubRepo),
            eq(repositories.teamId, runner.teamId)
          )
        )
        .get();

      if (!repo) {
        return NextResponse.json(
          { error: `Repository "${githubRepo}" not found for this team` },
          { status: 404 }
        );
      }
      resolvedRepoId = repo.id;
    }

    if (!resolvedRepoId) {
      return NextResponse.json(
        { error: 'Either repositoryId or githubRepo is required' },
        { status: 400 }
      );
    }

    // Verify repo belongs to runner's team
    const repo = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, resolvedRepoId))
      .get();

    if (!repo || repo.teamId !== runner.teamId) {
      return NextResponse.json({ error: 'Repository does not belong to runner\'s team' }, { status: 403 });
    }

    // Create and start the build (bypasses session auth — already token-verified)
    const result = await createAndRunBuildFromCI({
      triggerType: triggerType || 'ci',
      repositoryId: resolvedRepoId,
      runnerId: runner.id,
      gitBranch,
      gitCommit,
    });

    return NextResponse.json({
      buildId: result.buildId,
      testRunId: result.testRunId,
      testCount: result.testCount,
      queued: 'queued' in result ? result.queued : false,
    });
  } catch (error) {
    console.error('Failed to create build:', error);
    return NextResponse.json(
      { error: 'Failed to create build' },
      { status: 500 }
    );
  }
}
