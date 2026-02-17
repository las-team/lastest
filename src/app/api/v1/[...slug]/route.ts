/**
 * REST API v1 for VSCode Extension
 *
 * Provides authenticated HTTP endpoints wrapping server actions.
 *
 * Endpoints:
 *   GET  /api/v1/health - Health check
 *   GET  /api/v1/repos - List repositories
 *   GET  /api/v1/repos/:id - Get repository by ID
 *   GET  /api/v1/repos/:id/functional-areas - Get functional areas for repo
 *   GET  /api/v1/repos/:id/tests - Get tests for repo
 *   GET  /api/v1/repos/:id/builds - Get builds for repo
 *   GET  /api/v1/functional-areas/:id/tests - Get tests by functional area
 *   GET  /api/v1/tests/:id - Get single test
 *   GET  /api/v1/runs/:id - Get test run
 *   GET  /api/v1/builds/:id - Get build
 *   POST /api/v1/runs - Create and run tests
 */

import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { createAndRunBuild } from '@/server/actions/builds';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';

// Helper to verify API auth (Clerk session or Bearer token)
async function verifyAuth(request: NextRequest) {
  // Try Clerk session first
  const session = await getCurrentSession();
  if (session) {
    return session;
  }

  // Try API token auth (Bearer token)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyBearerToken(token);
  }

  return null;
}

// Helper to parse slug
function parseSlug(slug: string[]): { resource: string; id?: string; subResource?: string } {
  const [resource, id, subResource] = slug;
  return { resource, id, subResource };
}

// GET handler
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id, subResource } = parseSlug(slug);

  try {
    // Health check
    if (resource === 'health') {
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
    }

    // Repositories
    if (resource === 'repos') {
      if (!id) {
        // GET /api/v1/repos - List all repos
        if (!session.team) {
          return NextResponse.json({ error: 'No team access' }, { status: 403 });
        }
        const repos = await queries.getRepositoriesByTeam(session.team.id);
        return NextResponse.json(repos);
      }

      // GET /api/v1/repos/:id
      const repo = await queries.getRepository(id);
      if (!repo || repo.teamId !== session.team?.id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      // Sub-resources
      if (subResource === 'functional-areas') {
        const areas = await queries.getFunctionalAreasByRepo(id);
        return NextResponse.json(areas);
      }

      if (subResource === 'tests') {
        const tests = await queries.getTestsByRepo(id);
        // Enrich with last run status
        const enrichedTests = await enrichTestsWithStatus(tests);
        return NextResponse.json(enrichedTests);
      }

      if (subResource === 'builds') {
        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10');
        const builds = await queries.getBuildsByRepo(id, limit);
        return NextResponse.json(builds);
      }

      return NextResponse.json(repo);
    }

    // Functional areas
    if (resource === 'functional-areas' && id) {
      if (subResource === 'tests') {
        const tests = await queries.getTestsByFunctionalArea(id);
        const enrichedTests = await enrichTestsWithStatus(tests);
        return NextResponse.json(enrichedTests);
      }

      const area = await queries.getFunctionalArea(id);
      if (!area) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(area);
    }

    // Tests
    if (resource === 'tests' && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Enrich with last run status
      const [enriched] = await enrichTestsWithStatus([test]);
      return NextResponse.json(enriched);
    }

    // Test runs
    if (resource === 'runs' && id) {
      const run = await queries.getTestRun(id);
      if (!run) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const results = await queries.getTestResultsByRun(id);
      return NextResponse.json({ run, results });
    }

    // Builds
    if (resource === 'builds' && id) {
      const build = await queries.getBuild(id);
      if (!build) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
      const diffs = await queries.getVisualDiffsWithTestStatus(id);
      return NextResponse.json({
        ...build,
        gitBranch: testRun?.gitBranch,
        gitCommit: testRun?.gitCommit,
        diffs,
      });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API v1] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// POST handler
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const { resource } = parseSlug(slug);

  try {
    // Create test run
    if (resource === 'runs') {
      const body = await request.json();
      const { testIds, functionalAreaId, repositoryId } = body;

      let testIdsToRun: string[] = [];

      if (testIds && testIds.length > 0) {
        testIdsToRun = testIds;
      } else if (functionalAreaId) {
        const tests = await queries.getTestsByFunctionalArea(functionalAreaId);
        testIdsToRun = tests.map((t) => t.id);
      } else if (repositoryId) {
        const tests = await queries.getTestsByRepo(repositoryId);
        testIdsToRun = tests.map((t) => t.id);
      }

      if (testIdsToRun.length === 0) {
        return NextResponse.json({ error: 'No tests to run' }, { status: 400 });
      }

      // Use build system for visual diff tracking
      const result = await createAndRunBuild('manual', testIdsToRun, repositoryId);

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API v1] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// Helper to enrich tests with last run status
async function enrichTestsWithStatus(
  tests: { id: string; name: string; functionalAreaId: string | null; targetUrl: string | null; code: string }[]
) {
  const enriched = await Promise.all(
    tests.map(async (test) => {
      // Get most recent test result for this test
      const results = await queries.getTestResultsByTest(test.id);
      const latestResult = results[0];

      return {
        id: test.id,
        name: test.name,
        functionalAreaId: test.functionalAreaId,
        targetUrl: test.targetUrl,
        code: test.code,
        lastRunStatus: latestResult?.status || null,
        lastRunAt: latestResult ? (await queries.getTestRun(latestResult.testRunId!))?.startedAt?.toISOString() : null,
      };
    })
  );

  return enriched;
}
