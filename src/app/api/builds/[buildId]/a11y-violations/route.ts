/**
 * Per-rule a11y violation drill-in for a build. Same data the
 * BuildA11yViolationsCard renders in the UI, exposed for programmatic
 * access (CI pipelines, dashboards, custom reports). Accepts a session
 * cookie OR an API key `Bearer <token>` so it mirrors the rest of the
 * /api/jobs|/api/builds surface.
 *
 * Query params:
 *   ?format=json  (default) → JSON array of BuildA11yViolationRow
 *   ?format=csv            → CSV with one row per (rule × sample test)
 *                            and a `text/csv` Content-Disposition so
 *                            curl -OJ writes a sane filename.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import * as queries from '@/lib/db/queries';
import { downloadBuildA11yViolationsCsv } from '@/server/actions/builds';

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7));
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ buildId: string }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.team) {
    return NextResponse.json({ error: 'No team' }, { status: 403 });
  }

  const { buildId } = await params;
  const build = await queries.getBuild(buildId);
  if (!build) {
    return NextResponse.json({ error: 'Build not found' }, { status: 404 });
  }
  if (!build.testRunId) {
    return NextResponse.json({ error: 'Build has no run' }, { status: 404 });
  }
  const run = await queries.getTestRun(build.testRunId);
  if (!run?.repositoryId) {
    return NextResponse.json({ error: 'Build has no repo binding' }, { status: 404 });
  }
  const repo = await queries.getRepository(run.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const format = new URL(request.url).searchParams.get('format');
  if (format === 'csv') {
    const csv = await downloadBuildA11yViolationsCsv(buildId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="build-${buildId}-a11y-violations.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const violations = await queries.getBuildA11yViolations(buildId);
  return NextResponse.json({ buildId, violations });
}
