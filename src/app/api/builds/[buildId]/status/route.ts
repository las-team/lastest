import { NextResponse } from 'next/server';
import { getBuildSummary } from '@/server/actions/builds';
import { getCurrentSession } from '@/lib/auth';
import { validateRunnerToken } from '@/server/actions/runners';
import * as queries from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ buildId: string }> }
) {
  // Auth: session cookie OR runner Bearer token
  let teamId: string | null = null;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const runner = await validateRunnerToken(authHeader.slice(7));
    if (!runner) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    teamId = runner.teamId;
  } else {
    const session = await getCurrentSession();
    if (!session?.team) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    teamId = session.team.id;
  }

  const { buildId } = await params;
  const build = await getBuildSummary(buildId);

  if (!build) {
    return NextResponse.json({ error: 'Build not found' }, { status: 404 });
  }

  // Verify the build's repo belongs to the authenticated team
  const buildRecord = await queries.getBuild(buildId);
  if (buildRecord?.testRunId) {
    const run = await queries.getTestRun(buildRecord.testRunId);
    if (run?.repositoryId) {
      const repo = await queries.getRepository(run.repositoryId);
      if (repo && repo.teamId !== teamId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  return NextResponse.json({
    id: build.id,
    overallStatus: build.overallStatus,
    totalTests: build.totalTests,
    passedCount: build.passedCount,
    failedCount: build.failedCount,
    changesDetected: build.changesDetected,
    flakyCount: build.flakyCount,
    completedAt: build.completedAt,
    elapsedMs: build.elapsedMs,
    comparisonMode: build.comparisonMode,
    diffs: build.diffs,
  });
}
