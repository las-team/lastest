import { NextResponse } from 'next/server';
import { getBuildSummary } from '@/server/actions/builds';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ buildId: string }> }
) {
  const { buildId } = await params;
  const build = await getBuildSummary(buildId);

  if (!build) {
    return NextResponse.json({ error: 'Build not found' }, { status: 404 });
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
