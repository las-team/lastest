import { NextResponse } from 'next/server';
import { getBuildSummary } from '@/server/actions/builds';
import { getCurrentSession } from '@/lib/auth';
import * as queries from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ buildId: string }> }
) {
  const session = await getCurrentSession();
  if (!session?.team) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { buildId } = await params;
  const build = await getBuildSummary(buildId);

  if (!build) {
    return NextResponse.json({ error: 'Build not found' }, { status: 404 });
  }

  // Verify the build's repo belongs to the user's team
  const buildRecord = await queries.getBuild(buildId);
  if (buildRecord?.testRunId) {
    const run = await queries.getTestRun(buildRecord.testRunId);
    if (run?.repositoryId) {
      const repo = await queries.getRepository(run.repositoryId);
      if (repo && repo.teamId !== session.team.id) {
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
    diffs: build.diffs,
  });
}
