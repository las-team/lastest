/**
 * Per-rule a11y violation drill-in for a single test result. Mirrors
 * the build-level endpoint at /api/builds/[buildId]/a11y-violations
 * but scoped to one test_results row, so an external system can ask
 * for the same shape the Verify focus pane shows when a reviewer
 * clicks a single failing test. Accepts session cookie OR API key
 * `Bearer <token>`. Returns 404 when the result has no captured a11y
 * data (distinct from "0 violations", which returns an empty array).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import * as queries from '@/lib/db/queries';

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
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.team) {
    return NextResponse.json({ error: 'No team' }, { status: 403 });
  }

  const { id } = await params;
  const result = await queries.getTestResultById(id);
  if (!result) {
    return NextResponse.json({ error: 'Test result not found' }, { status: 404 });
  }
  if (!result.testRunId) {
    return NextResponse.json({ error: 'Test result has no run' }, { status: 404 });
  }
  const run = await queries.getTestRun(result.testRunId);
  if (!run?.repositoryId) {
    return NextResponse.json({ error: 'Test result has no repo binding' }, { status: 404 });
  }
  const repo = await queries.getRepository(run.repositoryId);
  if (!repo || repo.teamId !== session.team.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const violations = await queries.getTestResultA11yViolations(id);
  if (violations === null) {
    return NextResponse.json(
      { error: 'No a11y data captured', testResultId: id, violations: null },
      { status: 404 },
    );
  }
  return NextResponse.json({ testResultId: id, violations });
}
