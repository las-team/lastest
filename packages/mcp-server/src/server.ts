import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LastestClient, type ToolResponse } from './client.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

function withActivityReporting(
  client: LastestClient,
  toolName: string,
  handler: ToolHandler,
): ToolHandler {
  return async (params) => {
    const start = Date.now();
    client.reportActivity({
      eventType: 'mcp:tool_call',
      summary: `MCP: ${toolName}`,
      detail: { params },
      toolName,
    });
    try {
      const result = await handler(params);
      client.reportActivity({
        eventType: 'mcp:tool_result',
        summary: `MCP: ${toolName} completed`,
        durationMs: Date.now() - start,
        toolName,
      });
      return result;
    } catch (err) {
      client.reportActivity({
        eventType: 'mcp:tool_error',
        summary: `MCP: ${toolName} failed — ${String(err)}`,
        durationMs: Date.now() - start,
        toolName,
      });
      throw err;
    }
  };
}

export function createServer(client: LastestClient): McpServer {
  const server = new McpServer({
    name: 'lastest',
    version: '0.3.0',
  });

  // ===== Health & Status =====

  // --- lastest_health_check ---
  server.tool(
    'lastest_health_check',
    'Check connectivity to the Lastest instance.',
    {},
    async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.health();
      const response: ToolResponse = {
        status: result.ok ? 'healthy' : 'unhealthy',
        summary: result.ok ? 'Lastest is reachable and healthy' : 'Lastest health check failed',
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_list_active_jobs ---
  server.tool(
    'lastest_list_active_jobs',
    'List currently active background jobs (builds, AI operations, etc.).',
    {},
    async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const jobs = await client.getActiveJobs() as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: jobs.length > 0 ? 'has_active_jobs' : 'idle',
        summary: jobs.length > 0
          ? `${jobs.length} active job(s) running`
          : 'No active background jobs',
        details: { count: jobs.length, jobs },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_get_job_status ---
  server.tool(
    'lastest_get_job_status',
    'Get the status and progress of a specific background job.',
    {
      jobId: z.string().describe('Background job ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const job = (await client.getJob(params.jobId)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: job.status as string,
        summary: `Job ${params.jobId}: ${job.status}${job.progress ? ` (${job.progress}%)` : ''}`,
        details: job,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Repositories =====

  // --- lastest_list_repos ---
  server.tool(
    'lastest_list_repos',
    'List all repositories accessible to the current team.',
    {},
    async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const repos = await client.listRepos() as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `${repos.length} repository(ies) found`,
        details: {
          count: repos.length,
          repos: repos.map(r => ({ id: r.id, name: r.name, url: r.url })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_get_repo ---
  server.tool(
    'lastest_get_repo',
    'Get details about a specific repository.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const repo = (await client.getRepo(params.repositoryId)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `Repository: ${repo.name}`,
        details: repo,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_create_repo ---
  server.tool(
    'lastest_create_repo',
    'Create a new local repository in the current team. Use this when you need a fresh workspace for tests without connecting to GitHub/GitLab.',
    {
      name: z.string().describe('Repository name (e.g. "my-app")'),
    },
    withActivityReporting(client, 'lastest_create_repo', async (params) => {
      const repo = await client.createRepo(params.name as string);
      const response: ToolResponse = {
        status: 'created',
        summary: `Repository "${repo.name}" created (ID: ${repo.id})`,
        actionRequired: [
          'Create functional areas with lastest_create_area',
          'Add tests with lastest_create_test',
        ],
        details: repo,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_update_repo ---
  server.tool(
    'lastest_update_repo',
    'Update a repository\'s name, default branch, or selected branch.',
    {
      repositoryId: z.string().describe('Repository ID to update'),
      name: z.string().optional().describe('New repository name'),
      defaultBranch: z.string().optional().describe('New default branch name'),
      selectedBranch: z.string().optional().describe('Branch selected for test runs'),
    },
    withActivityReporting(client, 'lastest_update_repo', async (params) => {
      const { repositoryId, ...rest } = params;
      const cleanUpdates = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      ) as { name?: string; defaultBranch?: string; selectedBranch?: string };
      const result = (await client.updateRepo(repositoryId as string, cleanUpdates)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Repository ${repositoryId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // ===== Functional Areas =====

  // --- lastest_list_areas ---
  server.tool(
    'lastest_list_areas',
    'List functional areas (test groupings) for a repository.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const areas = await client.listAreas(params.repositoryId) as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `${areas.length} functional area(s)`,
        details: {
          count: areas.length,
          areas: areas.map(a => ({ id: a.id, name: a.name, parentId: a.parentId })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_create_area ---
  server.tool(
    'lastest_create_area',
    'Create a new functional area for organizing tests.',
    {
      name: z.string().describe('Name of the functional area'),
      repositoryId: z.string().optional().describe('Repository ID to associate with'),
      parentId: z.string().optional().describe('Parent area ID for nesting'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = (await client.createArea({
        name: params.name,
        repositoryId: params.repositoryId,
        parentId: params.parentId,
      })) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'created',
        summary: `Functional area "${params.name}" created${result.id ? ` (ID: ${result.id})` : ''}`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_update_area ---
  server.tool(
    'lastest_update_area',
    'Update a functional area\'s name, description, or parent.',
    {
      functionalAreaId: z.string().describe('Functional area ID to update'),
      name: z.string().optional().describe('New name'),
      description: z.string().optional().describe('New description'),
      parentId: z.string().optional().describe('New parent area ID (pass empty string to clear)'),
    },
    withActivityReporting(client, 'lastest_update_area', async (params) => {
      const { functionalAreaId, ...rest } = params;
      const cleanUpdates: { name?: string; description?: string; parentId?: string | null } = {};
      if (rest.name !== undefined) cleanUpdates.name = rest.name as string;
      if (rest.description !== undefined) cleanUpdates.description = rest.description as string;
      if (rest.parentId !== undefined) cleanUpdates.parentId = (rest.parentId as string) || null;
      const result = (await client.updateArea(functionalAreaId as string, cleanUpdates)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Functional area ${functionalAreaId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_delete_area ---
  server.tool(
    'lastest_delete_area',
    'Soft-delete a functional area. Tests remain but become unassigned.',
    {
      functionalAreaId: z.string().describe('Functional area ID to delete'),
    },
    withActivityReporting(client, 'lastest_delete_area', async (params) => {
      const result = await client.deleteArea(params.functionalAreaId as string);
      const response: ToolResponse = {
        status: 'deleted',
        summary: `Functional area ${params.functionalAreaId} soft-deleted`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_list_tests_by_area ---
  server.tool(
    'lastest_list_tests_by_area',
    'List tests within a specific functional area.',
    {
      functionalAreaId: z.string().describe('Functional area ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const tests = await client.listTestsByArea(params.functionalAreaId) as Array<Record<string, unknown>>;
      const passing = tests.filter(t => t.lastRunStatus === 'passed').length;
      const failing = tests.filter(t => t.lastRunStatus === 'failed').length;
      const response: ToolResponse = {
        status: failing > 0 ? 'has_failures' : 'all_passing',
        summary: `${tests.length} test(s) in area: ${passing} passing, ${failing} failing`,
        details: {
          total: tests.length,
          passing,
          failing,
          tests: tests.map(t => ({ id: t.id, name: t.name, status: t.lastRunStatus ?? 'not_run' })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Test Details & Mutations =====

  // --- lastest_get_test ---
  server.tool(
    'lastest_get_test',
    'Get full details of a single test including code, URL, and last run status.',
    {
      testId: z.string().describe('Test ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const test = (await client.getTest(params.testId)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `Test "${test.name}": ${test.lastRunStatus ?? 'not_run'}`,
        details: test,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_update_test ---
  server.tool(
    'lastest_update_test',
    'Update a test\'s name, code, URL, or functional area assignment.',
    {
      testId: z.string().describe('Test ID to update'),
      name: z.string().optional().describe('New test name'),
      code: z.string().optional().describe('New Playwright test code'),
      targetUrl: z.string().optional().describe('New target URL'),
      functionalAreaId: z.string().optional().describe('New functional area ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const { testId, ...updates } = params;
      // Filter out undefined values
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      const result = (await client.updateTest(testId, cleanUpdates)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Test ${testId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_delete_test ---
  server.tool(
    'lastest_delete_test',
    'Soft-delete a test (can be restored). Does not permanently remove test data.',
    {
      testId: z.string().describe('Test ID to delete'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.deleteTest(params.testId);
      const response: ToolResponse = {
        status: 'deleted',
        summary: `Test ${params.testId} soft-deleted`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Test Runs =====

  // --- lastest_get_test_run ---
  server.tool(
    'lastest_get_test_run',
    'Get detailed results for a specific test run, including individual test results, errors, and durations.',
    {
      runId: z.string().describe('Test run ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const data = (await client.getTestRun(params.runId)) as Record<string, unknown>;
      const run = data.run as Record<string, unknown>;
      const results = (data.results ?? []) as Array<Record<string, unknown>>;
      const passed = results.filter(r => r.status === 'passed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const response: ToolResponse = {
        status: run.status as string,
        summary: `Run ${params.runId}: ${passed}/${results.length} passed, ${failed} failed`,
        details: data,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Builds =====

  // --- lastest_list_builds ---
  server.tool(
    'lastest_list_builds',
    'List recent builds for a repository with status and test counts.',
    {
      repositoryId: z.string().describe('Repository ID'),
      limit: z.number().optional().describe('Number of builds to return (default 10, max 100)'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const builds = await client.listBuilds(params.repositoryId, params.limit) as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `${builds.length} build(s) for repository`,
        details: {
          count: builds.length,
          builds: builds.map(b => ({
            id: b.id,
            status: b.overallStatus,
            createdAt: b.createdAt,
            totalTests: b.totalTests,
          })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Individual Diff Operations =====

  // --- lastest_get_diff ---
  server.tool(
    'lastest_get_diff',
    'Get full details of a single visual diff including pixel data, AI analysis, and test info.',
    {
      diffId: z.string().describe('Visual diff ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const diff = (await client.getDiff(params.diffId)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: diff.status as string,
        summary: `Diff ${params.diffId}: ${diff.status} (${diff.percentageDifference ?? 0}% changed)`,
        details: diff,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_approve_diff ---
  server.tool(
    'lastest_approve_diff',
    'Approve a single visual diff, accepting the current screenshot as the new baseline.',
    {
      diffId: z.string().describe('Visual diff ID to approve'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.approveDiff(params.diffId);
      const response: ToolResponse = {
        status: 'approved',
        summary: `Diff ${params.diffId} approved. Baseline updated.`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_reject_diff ---
  server.tool(
    'lastest_reject_diff',
    'Reject a single visual diff, marking it as a regression.',
    {
      diffId: z.string().describe('Visual diff ID to reject'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.rejectDiff(params.diffId);
      const response: ToolResponse = {
        status: 'rejected',
        summary: `Diff ${params.diffId} rejected. Marked as regression.`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_approve_all_diffs ---
  server.tool(
    'lastest_approve_all_diffs',
    'Approve all pending visual diffs in a build at once.',
    {
      buildId: z.string().describe('Build ID to approve all diffs for'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.approveAllDiffs(params.buildId);
      const response: ToolResponse = {
        status: 'approved',
        summary: `All diffs in build ${params.buildId} approved.`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Composite QA Workflows =====

  // --- lastest_review_build ---
  server.tool(
    'lastest_review_build',
    'Comprehensive build review: fetches build details, visual diffs, and failed tests into a structured QA summary with action items.',
    {
      buildId: z.string().describe('Build ID to review'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const build = (await client.getBuild(params.buildId)) as Record<string, unknown>;
      const diffs = ((build.diffs ?? []) as Array<Record<string, unknown>>);

      const pending = diffs.filter(d => d.status === 'pending');
      const approved = diffs.filter(d => d.status === 'approved');
      const rejected = diffs.filter(d => d.status === 'rejected');
      const changed = diffs.filter(d => d.classification === 'changed' || (d.percentageDifference as number) > 0);

      const status = build.overallStatus as string;
      const passed = build.passedCount as number ?? 0;
      const failed = build.failedCount as number ?? 0;
      const total = build.totalTests as number ?? 0;

      const executorError = build.executorError as string | null | undefined;
      const executorFailedAt = build.executorFailedAt as string | Date | null | undefined;

      const actionRequired: string[] = [];
      if (status === 'executor_failed') {
        actionRequired.push(
          `Executor crashed before any test ran — inspect executorError and runner/EB pod logs (build won't recover by retry)`,
        );
      }
      if (pending.length > 0) {
        actionRequired.push(`Review ${pending.length} pending diff(s) — use lastest_get_diff, lastest_approve_diff, or lastest_reject_diff`);
      }
      if (failed > 0) {
        actionRequired.push(`${failed} test(s) failed — use lastest_list_failing_tests or lastest_heal_test`);
      }

      const response: ToolResponse = {
        status,
        summary: status === 'executor_failed'
          ? `Build ${params.buildId}: EXECUTOR FAILED. ${passed}/${total} tests ran (executor crashed before completion). ${executorError ? executorError.split('\n')[0] : ''}`
          : `Build ${params.buildId}: ${status}. ${passed}/${total} passed. ${diffs.length} diffs (${pending.length} pending, ${approved.length} approved, ${rejected.length} rejected).`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: {
          build: {
            id: build.id,
            status,
            gitBranch: build.gitBranch,
            gitCommit: build.gitCommit,
            passed,
            failed,
            total,
            ...(executorError ? { executorError } : {}),
            ...(executorFailedAt ? { executorFailedAt } : {}),
          },
          diffs: {
            total: diffs.length,
            pending: pending.length,
            approved: approved.length,
            rejected: rejected.length,
            changed: changed.length,
            pendingDiffs: pending.map(d => ({
              id: d.id,
              testName: d.testName,
              classification: d.classification,
              percentageDifference: d.percentageDifference,
              aiRecommendation: d.aiRecommendation,
            })),
          },
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_qa_summary ---
  server.tool(
    'lastest_qa_summary',
    'Get a comprehensive QA overview for a repository: test health, recent builds, and action items.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const [tests, builds] = await Promise.all([
        client.listTests(params.repositoryId) as Promise<Array<Record<string, unknown>>>,
        client.listBuilds(params.repositoryId, 5) as Promise<Array<Record<string, unknown>>>,
      ]);

      const passing = tests.filter(t => t.lastRunStatus === 'passed').length;
      const failing = tests.filter(t => t.lastRunStatus === 'failed').length;
      const neverRun = tests.filter(t => !t.lastRunStatus).length;
      const passRate = tests.length > 0 ? Math.round((passing / tests.length) * 100) : 0;

      const buildsNeedingReview = builds.filter(b => b.overallStatus === 'review_required');

      const actionRequired: string[] = [];
      if (failing > 0) {
        actionRequired.push(`${failing} test(s) currently failing — use lastest_list_failing_tests`);
      }
      if (buildsNeedingReview.length > 0) {
        actionRequired.push(`${buildsNeedingReview.length} build(s) need review — use lastest_review_build`);
      }
      if (neverRun > 0) {
        actionRequired.push(`${neverRun} test(s) never run — use lastest_run_tests`);
      }

      const response: ToolResponse = {
        status: failing > 0 || buildsNeedingReview.length > 0 ? 'action_required' : 'healthy',
        summary: `QA Summary: ${tests.length} tests (${passRate}% pass rate), ${builds.length} recent builds, ${buildsNeedingReview.length} needing review`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: {
          testHealth: { total: tests.length, passing, failing, neverRun, passRate },
          recentBuilds: builds.map(b => ({
            id: b.id,
            status: b.overallStatus,
            createdAt: b.createdAt,
          })),
          buildsNeedingReview: buildsNeedingReview.map(b => b.id),
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ===== Original Tools =====

  // --- lastest_run_tests ---
  server.tool(
    'lastest_run_tests',
    'Trigger a test build and return structured results. Can run all tests in a repo or specific test IDs.',
    {
      repositoryId: z.string().optional().describe('Repository ID to run tests for. If omitted, uses the default repo.'),
      testIds: z.array(z.string()).optional().describe('Specific test IDs to run. If omitted, runs all tests.'),
      gitBranch: z.string().optional().describe('Git branch override'),
    },
    withActivityReporting(client, 'lastest_run_tests', async (params) => {
      const result = await client.createBuild({
        repositoryId: params.repositoryId as string | undefined,
        testIds: params.testIds as string[] | undefined,
        gitBranch: params.gitBranch as string | undefined,
        triggerType: 'manual',
      });

      const response: ToolResponse = {
        status: 'build_started',
        summary: `Build started: ${result.testCount} test(s) queued. Build ID: ${result.buildId}`,
        actionRequired: [
          `Poll build status with lastest_get_build_status using buildId: ${result.buildId}`,
        ],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_get_build_status ---
  server.tool(
    'lastest_get_build_status',
    'Get the current status and results of a build. Use after lastest_run_tests to check progress.',
    {
      buildId: z.string().describe('The build ID to check status for'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const build = (await client.getBuild(params.buildId)) as Record<string, unknown>;

      const status = build.overallStatus as string;
      const passed = build.passedCount as number;
      const failed = build.failedCount as number;
      const total = build.totalTests as number;
      const changes = build.changesDetected as number;
      const flaky = build.flakyCount as number;

      const actionRequired: string[] = [];
      if (status === 'review_required') {
        actionRequired.push(`Review ${changes} visual change(s) — use lastest_get_visual_diff to inspect`);
      }
      if (status === 'blocked') {
        actionRequired.push('Build is blocked — review failed tests and rejected diffs');
      }
      if (failed > 0) {
        actionRequired.push(`${failed} test(s) failed — use lastest_list_failing_tests to see details`);
      }

      const response: ToolResponse = {
        status,
        summary: `Build ${params.buildId}: ${passed}/${total} passed, ${failed} failed, ${changes} visual changes, ${flaky} flaky. Status: ${status}`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: build,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_list_tests ---
  server.tool(
    'lastest_list_tests',
    'List all tests in a repository with their latest pass/fail status.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const tests = (await client.listTests(params.repositoryId)) as Array<Record<string, unknown>>;

      const passing = tests.filter(t => t.lastRunStatus === 'passed').length;
      const failing = tests.filter(t => t.lastRunStatus === 'failed').length;
      const noRuns = tests.filter(t => !t.lastRunStatus).length;

      const response: ToolResponse = {
        status: failing > 0 ? 'has_failures' : 'all_passing',
        summary: `${tests.length} tests: ${passing} passing, ${failing} failing, ${noRuns} not yet run`,
        details: {
          total: tests.length,
          passing,
          failing,
          notRun: noRuns,
          tests: tests.map(t => ({
            id: t.id,
            name: t.name,
            status: t.lastRunStatus ?? 'not_run',
            functionalAreaId: t.functionalAreaId,
          })),
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_list_failing_tests ---
  server.tool(
    'lastest_list_failing_tests',
    'List tests that are currently failing, with error details.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const tests = (await client.listTests(params.repositoryId)) as Array<Record<string, unknown>>;
      const failing = tests.filter(t => t.lastRunStatus === 'failed');

      const response: ToolResponse = {
        status: failing.length > 0 ? 'has_failures' : 'all_passing',
        summary: failing.length > 0
          ? `${failing.length} failing test(s): ${failing.map(t => t.name).join(', ')}`
          : 'All tests are passing',
        actionRequired: failing.length > 0
          ? ['Use lastest_heal_test to auto-fix failing tests']
          : undefined,
        details: {
          failingCount: failing.length,
          tests: failing.map(t => ({
            id: t.id,
            name: t.name,
            errorMessage: t.lastErrorMessage,
            functionalAreaId: t.functionalAreaId,
          })),
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_get_visual_diff ---
  server.tool(
    'lastest_get_visual_diff',
    'Get visual diff details for a build, including AI classification and confidence scores.',
    {
      buildId: z.string().describe('Build ID to get visual diffs for'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const build = (await client.getBuild(params.buildId)) as Record<string, unknown>;
      const diffs = (build.diffs ?? []) as Array<Record<string, unknown>>;

      const pending = diffs.filter(d => d.status === 'pending');
      const approved = diffs.filter(d => d.status === 'approved');
      const rejected = diffs.filter(d => d.status === 'rejected');

      const actionRequired: string[] = [];
      if (pending.length > 0) {
        actionRequired.push(
          `${pending.length} diff(s) need review. Use lastest_approve_baseline or lastest_reject_baseline with diffIds: [${pending.map(d => `"${d.id}"`).join(', ')}]`,
        );
      }

      const response: ToolResponse = {
        status: pending.length > 0 ? 'needs_review' : 'all_reviewed',
        summary: `${diffs.length} visual diff(s): ${approved.length} approved, ${rejected.length} rejected, ${pending.length} pending review`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: {
          total: diffs.length,
          pendingCount: pending.length,
          approvedCount: approved.length,
          rejectedCount: rejected.length,
          diffs: diffs.map(d => ({
            id: d.id,
            testName: d.testName,
            status: d.status,
            classification: d.classification,
            percentageDifference: d.percentageDifference,
            aiRecommendation: d.aiRecommendation,
            aiAnalysis: d.aiAnalysis,
            stepLabel: d.stepLabel,
          })),
        },
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_approve_baseline ---
  server.tool(
    'lastest_approve_baseline',
    'Approve visual changes, updating baselines. Accepts one or more diff IDs.',
    {
      diffIds: z.array(z.string()).describe('Array of visual diff IDs to approve'),
    },
    withActivityReporting(client, 'lastest_approve_baseline', async (params) => {
      const result = await client.approveDiffs(params.diffIds as string[]);

      const response: ToolResponse = {
        status: 'approved',
        summary: `Approved ${result.approvedCount} visual diff(s). Baselines updated.`,
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_reject_baseline ---
  server.tool(
    'lastest_reject_baseline',
    'Reject visual changes, marking them as regressions. Accepts one or more diff IDs.',
    {
      diffIds: z.array(z.string()).describe('Array of visual diff IDs to reject'),
    },
    withActivityReporting(client, 'lastest_reject_baseline', async (params) => {
      const result = await client.rejectDiffs(params.diffIds as string[]);

      const response: ToolResponse = {
        status: 'rejected',
        summary: `Rejected ${result.rejectedCount} visual diff(s). Build may be blocked.`,
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_create_test ---
  server.tool(
    'lastest_create_test',
    'Create a test. Two modes: (1) **direct** — pass { name, code } to insert ready-made Playwright code. (2) **AI** — pass { url } and/or { prompt } to have the Lastest AI agent generate the test. Direct mode returns immediately with a test ID; AI mode may take longer and returns the generated code.',
    {
      repositoryId: z.string().describe('Repository ID to create the test in'),
      name: z.string().optional().describe('Test name (required for direct mode)'),
      code: z.string().optional().describe('Playwright test code (required for direct mode). Expected signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)`'),
      url: z.string().optional().describe('URL to generate a test for (AI mode)'),
      prompt: z.string().optional().describe('Natural language description of what to test (AI mode)'),
      functionalAreaId: z.string().optional().describe('Functional area to assign the test to'),
      targetUrl: z.string().optional().describe('Target URL for the test (direct mode)'),
      description: z.string().optional().describe('Test description (direct mode)'),
    },
    withActivityReporting(client, 'lastest_create_test', async (params) => {
      const repositoryId = params.repositoryId as string;
      const name = params.name as string | undefined;
      const code = params.code as string | undefined;
      const functionalAreaId = params.functionalAreaId as string | undefined;

      // Direct mode: name + code provided → insert as-is, skip AI
      if (name && code) {
        const result = await client.createTestDirect({
          repositoryId,
          name,
          code,
          functionalAreaId,
          targetUrl: params.targetUrl as string | undefined,
          description: params.description as string | undefined,
        });
        const response: ToolResponse = {
          status: 'test_created',
          summary: `Test "${result.name}" created from supplied code (ID: ${result.id}). Use lastest_run_tests to execute it.`,
          actionRequired: ['Run the test with lastest_run_tests to verify it works'],
          details: result,
        };
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      }

      // AI mode: require at least url or prompt
      if (!params.url && !params.prompt) {
        throw new Error('Provide either { name, code } for direct creation, or { url } and/or { prompt } for AI generation.');
      }

      const result = (await client.createTest({
        repositoryId,
        url: params.url as string | undefined,
        prompt: params.prompt as string | undefined,
        functionalAreaId,
      })) as Record<string, unknown>;

      const response: ToolResponse = {
        status: 'test_created',
        summary: `Test created via AI${result.testId ? ` (ID: ${result.testId})` : ''}. Use lastest_run_tests to execute it.`,
        actionRequired: ['Run the test with lastest_run_tests to verify it works'],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_get_coverage ---
  server.tool(
    'lastest_get_coverage',
    'Get test coverage statistics by functional area and route.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const coverage = (await client.getCoverage(params.repositoryId)) as Record<string, unknown>;

      const routeCoverage = coverage.routeCoverage as Record<string, unknown> | undefined;
      const areaCoverage = coverage.areaCoverage as Record<string, unknown> | undefined;

      const routePct = routeCoverage?.percentage as number | undefined;
      const areaTotal = areaCoverage?.total as number | undefined;
      const areaTested = areaCoverage?.tested as number | undefined;

      const response: ToolResponse = {
        status: 'coverage_retrieved',
        summary: `Route coverage: ${routePct ?? 'N/A'}%. Areas: ${areaTested ?? '?'}/${areaTotal ?? '?'} have tests.`,
        actionRequired: routePct !== undefined && routePct < 80
          ? ['Coverage is below 80% — consider generating tests for uncovered routes with lastest_create_test']
          : undefined,
        details: coverage,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_heal_test ---
  server.tool(
    'lastest_heal_test',
    'Trigger the AI healer agent to automatically fix a failing test by inspecting the live UI and updating selectors/assertions.',
    {
      testId: z.string().describe('ID of the failing test to heal'),
    },
    withActivityReporting(client, 'lastest_heal_test', async (params) => {
      const result = (await client.healTest(params.testId as string)) as Record<string, unknown>;

      const response: ToolResponse = {
        status: result.success ? 'healed' : 'heal_failed',
        summary: result.success
          ? `Test ${params.testId} healed successfully. Run lastest_run_tests to verify the fix.`
          : `Healing failed for test ${params.testId}. Manual intervention may be needed.`,
        actionRequired: result.success
          ? ['Re-run the test with lastest_run_tests to confirm the fix']
          : ['Review the test manually or check error details'],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  return server;
}
