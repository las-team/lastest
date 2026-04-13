/**
 * REST API v1 for VSCode Extension + MCP Server
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
 *   GET  /api/v1/repos/:id/coverage - Get test coverage stats for repo
 *   GET  /api/v1/functional-areas/:id - Get functional area
 *   GET  /api/v1/functional-areas/:id/tests - Get tests by functional area
 *   GET  /api/v1/tests/:id - Get single test
 *   GET  /api/v1/runs/:id - Get test run
 *   GET  /api/v1/builds/:id - Get build
 *   GET  /api/v1/diffs/:id - Get single visual diff
 *   GET  /api/v1/jobs/active - List active background jobs
 *   GET  /api/v1/jobs/:id - Get background job status
 *   POST /api/v1/runs - Create and run tests
 *   POST /api/v1/diffs/approve - Batch approve visual diffs
 *   POST /api/v1/diffs/reject - Batch reject visual diffs
 *   POST /api/v1/diffs/:id/approve - Approve single visual diff
 *   POST /api/v1/diffs/:id/reject - Reject single visual diff
 *   POST /api/v1/builds/:id/approve-all - Approve all diffs in a build
 *   POST /api/v1/repos/:id/import - Import tests + functional areas (migration)
 *   POST /api/v1/functional-areas - Create functional area
 *   POST /api/v1/tests/create - Create test via AI
 *   POST /api/v1/tests/:id/heal - Heal a failing test via AI
 *   PUT  /api/v1/tests/:id - Update a test
 *   DELETE /api/v1/tests/:id - Soft-delete a test
 */

import { NextRequest, NextResponse } from 'next/server';
import * as queries from '@/lib/db/queries';
import { createAndRunBuildCore } from '@/server/actions/builds';
import { batchApproveDiffsCore, batchRejectDiffsCore, approveDiffCore, rejectDiffCore, approveAllDiffsCore, getDiffCore } from '@/server/actions/diffs';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';

// Helper to verify API auth (session or Bearer token)
async function verifyAuth(request: NextRequest) {
  // Try session first
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

// Helper to parse slug (supports up to 4 levels: resource/id/subResource/action)
function parseSlug(slug: string[]): { resource: string; id?: string; subResource?: string; action?: string } {
  const [resource, id, subResource, action] = slug;
  return { resource, id, subResource, action };
}

// Helper to verify a repository belongs to the session's team
async function verifyRepoOwnership(repoId: string, session: { team?: { id: string } | null }) {
  const repo = await queries.getRepository(repoId);
  if (!repo || repo.teamId !== session.team?.id) return false;
  return true;
}

// Helper to verify a build belongs to the session's team (via test run → repo)
async function verifyBuildOwnership(buildId: string, session: { team?: { id: string } | null }) {
  const build = await queries.getBuild(buildId);
  if (!build) return false;
  if (build.testRunId) {
    const testRun = await queries.getTestRun(build.testRunId);
    if (testRun?.repositoryId) {
      return verifyRepoOwnership(testRun.repositoryId, session);
    }
  }
  return false;
}

// Helper to verify a visual diff belongs to the session's team (via build)
async function verifyDiffOwnership(diffId: string, session: { team?: { id: string } | null }) {
  const diff = await queries.getVisualDiff(diffId);
  if (!diff) return false;
  return verifyBuildOwnership(diff.buildId, session);
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
        const rawLimit = parseInt(request.nextUrl.searchParams.get('limit') || '10');
        const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 10 : rawLimit, 1), 100);
        const builds = await queries.getBuildsByRepo(id, limit);
        return NextResponse.json(builds);
      }

      if (subResource === 'coverage') {
        const routeCoverage = await queries.getRouteCoverageStats(id);
        const areas = await queries.getFunctionalAreasByRepo(id);
        const tests = await queries.getTestsByRepo(id);
        const testedAreaIds = new Set(tests.filter(t => t.functionalAreaId).map(t => t.functionalAreaId));
        const areaCoverage = {
          total: areas.length,
          tested: areas.filter(a => testedAreaIds.has(a.id)).length,
          percentage: areas.length > 0 ? Math.round((areas.filter(a => testedAreaIds.has(a.id)).length / areas.length) * 100) : 0,
        };
        return NextResponse.json({ routeCoverage, areaCoverage });
      }

      return NextResponse.json(repo);
    }

    // Functional areas
    if (resource === 'functional-areas' && id) {
      const area = await queries.getFunctionalArea(id);
      if (!area) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Verify team ownership via repository
      if (area.repositoryId) {
        const areaRepo = await queries.getRepository(area.repositoryId);
        if (!areaRepo || areaRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      if (subResource === 'tests') {
        const tests = await queries.getTestsByFunctionalArea(id);
        const enrichedTests = await enrichTestsWithStatus(tests);
        return NextResponse.json(enrichedTests);
      }
      return NextResponse.json(area);
    }

    // Tests
    if (resource === 'tests' && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Verify team ownership via repository
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      const [enriched] = await enrichTestsWithStatus([test]);
      return NextResponse.json(enriched);
    }

    // Test runs
    if (resource === 'runs' && id) {
      const run = await queries.getTestRun(id);
      if (!run) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Verify team ownership via repository
      if (run.repositoryId) {
        const runRepo = await queries.getRepository(run.repositoryId);
        if (!runRepo || runRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      const results = await queries.getTestResultsByRun(id);
      return NextResponse.json({ run, results });
    }

    // Visual diffs
    if (resource === 'diffs' && id && !subResource) {
      // Verify team ownership via diff → build → test run → repo
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const diff = await getDiffCore(id);
      if (!diff) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(diff);
    }

    // Background jobs — filter to jobs belonging to the session's team
    if (resource === 'jobs') {
      if (!id || id === 'active') {
        const activeJobs = await queries.getActiveBackgroundJobs() as Array<Record<string, unknown>>;
        const teamRepos = session.team ? await queries.getRepositoriesByTeam(session.team.id) : [];
        const teamRepoIds = new Set(teamRepos.map(r => r.id));
        const filtered = activeJobs.filter(j => !j.repositoryId || teamRepoIds.has(j.repositoryId as string));
        return NextResponse.json(filtered);
      }
      const job = await queries.getBackgroundJob(id) as Record<string, unknown> | null;
      if (!job) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      // Verify team ownership if job has a repositoryId
      if (job.repositoryId) {
        if (!(await verifyRepoOwnership(job.repositoryId as string, session))) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      return NextResponse.json(job);
    }

    // Builds
    if (resource === 'builds' && id) {
      const build = await queries.getBuild(id);
      if (!build) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const testRun = build.testRunId ? await queries.getTestRun(build.testRunId) : null;
      // Verify team ownership via repository on the test run
      if (testRun?.repositoryId) {
        const buildRepo = await queries.getRepository(testRun.repositoryId);
        if (!buildRepo || buildRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
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
      { error: 'Internal server error' },
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
  const { resource, id, subResource } = parseSlug(slug);

  try {
    // Create test run
    if (resource === 'runs' && !id) {
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

      // Use build system for visual diff tracking (auth already verified above)
      const result = await createAndRunBuildCore('manual', testIdsToRun, repositoryId);

      return NextResponse.json(result);
    }

    // Batch approve diffs
    if (resource === 'diffs' && slug[1] === 'approve') {
      const body = await request.json();
      const { diffIds } = body;
      if (!diffIds || !Array.isArray(diffIds) || diffIds.length === 0) {
        return NextResponse.json({ error: 'diffIds array required' }, { status: 400 });
      }
      // Verify team ownership for all diffs
      for (const did of diffIds) {
        if (!(await verifyDiffOwnership(did, session))) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      const result = await batchApproveDiffsCore(diffIds);
      return NextResponse.json(result);
    }

    // Batch reject diffs
    if (resource === 'diffs' && slug[1] === 'reject') {
      const body = await request.json();
      const { diffIds } = body;
      if (!diffIds || !Array.isArray(diffIds) || diffIds.length === 0) {
        return NextResponse.json({ error: 'diffIds array required' }, { status: 400 });
      }
      // Verify team ownership for all diffs
      for (const did of diffIds) {
        if (!(await verifyDiffOwnership(did, session))) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      const result = await batchRejectDiffsCore(diffIds);
      return NextResponse.json(result);
    }

    // Create test via AI
    if (resource === 'tests' && slug[1] === 'create' && !slug[2]) {
      const body = await request.json();
      const { repositoryId, url, prompt, functionalAreaId } = body;
      if (!repositoryId) {
        return NextResponse.json({ error: 'repositoryId required' }, { status: 400 });
      }
      // Dynamic import to avoid pulling in heavy AI deps at route level
      const { createTest } = await import('@/server/actions/ai');
      const result = await createTest(repositoryId, {
        targetUrl: url,
        userPrompt: prompt,
        functionalAreaId,
      });
      return NextResponse.json(result);
    }

    // Heal a failing test via AI
    if (resource === 'tests' && slug[2] === 'heal') {
      const testId = slug[1];
      if (!testId) {
        return NextResponse.json({ error: 'testId required' }, { status: 400 });
      }
      const test = await queries.getTest(testId);
      if (!test) {
        return NextResponse.json({ error: 'Test not found' }, { status: 404 });
      }
      // Verify team ownership via repository
      if (test.repositoryId) {
        if (!(await verifyRepoOwnership(test.repositoryId, session))) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      // Dynamic import to avoid pulling in heavy AI deps at route level
      const { agentHealTestCore } = await import('@/lib/playwright/healer-agent');
      const result = await agentHealTestCore(test.repositoryId!, testId);
      return NextResponse.json(result);
    }

    // Approve single diff: POST /api/v1/diffs/:id/approve
    if (resource === 'diffs' && id && subResource === 'approve') {
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await approveDiffCore(id, 'mcp-agent');
      return NextResponse.json({ success: true });
    }

    // Reject single diff: POST /api/v1/diffs/:id/reject
    if (resource === 'diffs' && id && subResource === 'reject') {
      if (!(await verifyDiffOwnership(id, session))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await rejectDiffCore(id);
      return NextResponse.json({ success: true });
    }

    // Approve all diffs in a build: POST /api/v1/builds/:id/approve-all
    if (resource === 'builds' && id && subResource === 'approve-all') {
      if (!(await verifyBuildOwnership(id, session))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await approveAllDiffsCore(id, 'mcp-agent');
      return NextResponse.json({ success: true });
    }

    // Import tests + functional areas: POST /api/v1/repos/:id/import
    if (resource === 'repos' && id && subResource === 'import') {
      if (!(await verifyRepoOwnership(id, session))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const body = await request.json();
      const { functionalAreas = [], tests: importTests = [] } = body;

      let areasCreated = 0;
      let areasUpdated = 0;
      let testsCreated = 0;
      let testsUpdated = 0;
      const errors: string[] = [];
      const nameToAreaId = new Map<string, string>();

      // Pass 1: upsert all functional areas (without parent relationships)
      for (const area of functionalAreas) {
        try {
          const existing = (await queries.getFunctionalAreasByRepo(id)).find(
            (a) => a.name.toLowerCase() === area.name.toLowerCase()
          );
          if (existing) {
            await queries.updateFunctionalArea(existing.id, {
              description: area.description ?? existing.description,
              orderIndex: area.orderIndex ?? existing.orderIndex,
              isRouteFolder: area.isRouteFolder ?? existing.isRouteFolder,
              agentPlan: area.agentPlan ?? existing.agentPlan,
            });
            nameToAreaId.set(area.name.toLowerCase(), existing.id);
            areasUpdated++;
          } else {
            const created = await queries.createFunctionalArea({
              repositoryId: id,
              name: area.name,
              description: area.description ?? null,
              parentId: null,
              orderIndex: area.orderIndex ?? 0,
              isRouteFolder: area.isRouteFolder ?? false,
              agentPlan: area.agentPlan ?? null,
            });
            nameToAreaId.set(area.name.toLowerCase(), created.id);
            areasCreated++;
          }
        } catch (err) {
          errors.push(`Area "${area.name}": ${(err as Error).message}`);
        }
      }

      // Pass 2: set parent relationships
      for (const area of functionalAreas) {
        if (!area.parentName) continue;
        const areaId = nameToAreaId.get(area.name.toLowerCase());
        const parentId = nameToAreaId.get(area.parentName.toLowerCase());
        if (areaId && parentId) {
          try {
            await queries.updateFunctionalArea(areaId, { parentId });
          } catch (err) {
            errors.push(`Area "${area.name}" parent link: ${(err as Error).message}`);
          }
        }
      }

      // Pass 3: upsert tests
      const repoTests = await queries.getTestsByRepo(id);
      for (const t of importTests) {
        try {
          const functionalAreaId = t.functionalAreaName
            ? nameToAreaId.get(t.functionalAreaName.toLowerCase()) ?? null
            : null;

          // Find existing test by name + area
          const existing = repoTests.find(
            (et) =>
              et.name.toLowerCase() === t.name.toLowerCase() &&
              et.functionalAreaId === functionalAreaId
          );

          const testData = {
            repositoryId: id,
            name: t.name,
            code: t.code,
            description: t.description ?? null,
            targetUrl: t.targetUrl ?? null,
            functionalAreaId,
            assertions: t.assertions ?? null,
            executionMode: t.executionMode ?? 'procedural',
            agentPrompt: t.agentPrompt ?? null,
            setupOverrides: t.setupOverrides ?? null,
            teardownOverrides: t.teardownOverrides ?? null,
            stabilizationOverrides: t.stabilizationOverrides ?? null,
            viewportOverride: t.viewportOverride ?? null,
            diffOverrides: t.diffOverrides ?? null,
            playwrightOverrides: t.playwrightOverrides ?? null,
            requiredCapabilities: t.requiredCapabilities ?? null,
            quarantined: t.quarantined ?? false,
            isPlaceholder: t.isPlaceholder ?? false,
          };

          if (existing) {
            await queries.updateTestWithVersion(existing.id, testData, 'migration_import');
            testsUpdated++;
          } else {
            await queries.createTest(testData);
            testsCreated++;
          }
        } catch (err) {
          errors.push(`Test "${t.name}": ${(err as Error).message}`);
        }
      }

      return NextResponse.json({
        success: errors.length === 0,
        areasCreated,
        areasUpdated,
        testsCreated,
        testsUpdated,
        errors,
      });
    }

    // Create functional area: POST /api/v1/functional-areas
    if (resource === 'functional-areas' && !id) {
      const body = await request.json();
      const { name, repositoryId, parentId } = body;
      if (!name) {
        return NextResponse.json({ error: 'name required' }, { status: 400 });
      }
      // Verify team ownership of the target repository
      if (repositoryId) {
        if (!(await verifyRepoOwnership(repositoryId, session))) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }
      const result = await queries.createFunctionalArea({
        repositoryId: repositoryId ?? null,
        name,
        description: null,
        parentId: parentId ?? null,
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API v1] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT handler
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id } = parseSlug(slug);

  try {
    // Update test: PUT /api/v1/tests/:id
    if (resource === 'tests' && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }

      const body = await request.json();
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.code !== undefined) updates.code = body.code;
      if (body.targetUrl !== undefined) updates.targetUrl = body.targetUrl;
      if (body.functionalAreaId !== undefined) updates.functionalAreaId = body.functionalAreaId;

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      await queries.updateTestWithVersion(id, updates, 'mcp_edit');
      const updated = await queries.getTest(id);
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API v1] PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE handler
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await verifyAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;
  const { resource, id } = parseSlug(slug);

  try {
    // Soft-delete test: DELETE /api/v1/tests/:id
    if (resource === 'tests' && id) {
      const test = await queries.getTest(id);
      if (!test) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (test.repositoryId) {
        const testRepo = await queries.getRepository(test.repositoryId);
        if (!testRepo || testRepo.teamId !== session.team?.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      }

      await queries.softDeleteTest(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    console.error('[API v1] DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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
