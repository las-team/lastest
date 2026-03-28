import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LastestClient, type ToolResponse } from './client.js';

export function createServer(client: LastestClient): McpServer {
  const server = new McpServer({
    name: 'lastest2',
    version: '0.1.0',
  });

  // --- lastest2_run_tests ---
  server.tool(
    'lastest2_run_tests',
    'Trigger a test build and return structured results. Can run all tests in a repo or specific test IDs.',
    {
      repositoryId: z.string().optional().describe('Repository ID to run tests for. If omitted, uses the default repo.'),
      testIds: z.array(z.string()).optional().describe('Specific test IDs to run. If omitted, runs all tests.'),
      gitBranch: z.string().optional().describe('Git branch override'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.createBuild({
        repositoryId: params.repositoryId,
        testIds: params.testIds,
        gitBranch: params.gitBranch,
        triggerType: 'manual',
      });

      const response: ToolResponse = {
        status: 'build_started',
        summary: `Build started: ${result.testCount} test(s) queued. Build ID: ${result.buildId}`,
        actionRequired: [
          `Poll build status with lastest2_get_build_status using buildId: ${result.buildId}`,
        ],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest2_get_build_status ---
  server.tool(
    'lastest2_get_build_status',
    'Get the current status and results of a build. Use after lastest2_run_tests to check progress.',
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
        actionRequired.push(`Review ${changes} visual change(s) — use lastest2_get_visual_diff to inspect`);
      }
      if (status === 'blocked') {
        actionRequired.push('Build is blocked — review failed tests and rejected diffs');
      }
      if (failed > 0) {
        actionRequired.push(`${failed} test(s) failed — use lastest2_list_failing_tests to see details`);
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

  // --- lastest2_list_tests ---
  server.tool(
    'lastest2_list_tests',
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

  // --- lastest2_list_failing_tests ---
  server.tool(
    'lastest2_list_failing_tests',
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
          ? ['Use lastest2_heal_test to auto-fix failing tests']
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

  // --- lastest2_get_visual_diff ---
  server.tool(
    'lastest2_get_visual_diff',
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
          `${pending.length} diff(s) need review. Use lastest2_approve_baseline or lastest2_reject_baseline with diffIds: [${pending.map(d => `"${d.id}"`).join(', ')}]`,
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

  // --- lastest2_approve_baseline ---
  server.tool(
    'lastest2_approve_baseline',
    'Approve visual changes, updating baselines. Accepts one or more diff IDs.',
    {
      diffIds: z.array(z.string()).describe('Array of visual diff IDs to approve'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.approveDiffs(params.diffIds);

      const response: ToolResponse = {
        status: 'approved',
        summary: `Approved ${result.approvedCount} visual diff(s). Baselines updated.`,
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest2_reject_baseline ---
  server.tool(
    'lastest2_reject_baseline',
    'Reject visual changes, marking them as regressions. Accepts one or more diff IDs.',
    {
      diffIds: z.array(z.string()).describe('Array of visual diff IDs to reject'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = await client.rejectDiffs(params.diffIds);

      const response: ToolResponse = {
        status: 'rejected',
        summary: `Rejected ${result.rejectedCount} visual diff(s). Build may be blocked.`,
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest2_create_test ---
  server.tool(
    'lastest2_create_test',
    'Create a new test using AI. Provide a URL to test, a natural language prompt, or both.',
    {
      repositoryId: z.string().describe('Repository ID to create the test in'),
      url: z.string().optional().describe('URL to generate a test for'),
      prompt: z.string().optional().describe('Natural language description of what to test'),
      functionalAreaId: z.string().optional().describe('Functional area to assign the test to'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = (await client.createTest({
        repositoryId: params.repositoryId,
        url: params.url,
        prompt: params.prompt,
        functionalAreaId: params.functionalAreaId,
      })) as Record<string, unknown>;

      const response: ToolResponse = {
        status: 'test_created',
        summary: `Test created successfully${result.testId ? ` (ID: ${result.testId})` : ''}. Use lastest2_run_tests to execute it.`,
        actionRequired: ['Run the test with lastest2_run_tests to verify it works'],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest2_get_coverage ---
  server.tool(
    'lastest2_get_coverage',
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
          ? ['Coverage is below 80% — consider generating tests for uncovered routes with lastest2_create_test']
          : undefined,
        details: coverage,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest2_heal_test ---
  server.tool(
    'lastest2_heal_test',
    'Trigger the AI healer agent to automatically fix a failing test by inspecting the live UI and updating selectors/assertions.',
    {
      testId: z.string().describe('ID of the failing test to heal'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const result = (await client.healTest(params.testId)) as Record<string, unknown>;

      const response: ToolResponse = {
        status: result.success ? 'healed' : 'heal_failed',
        summary: result.success
          ? `Test ${params.testId} healed successfully. Run lastest2_run_tests to verify the fix.`
          : `Healing failed for test ${params.testId}. Manual intervention may be needed.`,
        actionRequired: result.success
          ? ['Re-run the test with lastest2_run_tests to confirm the fix']
          : ['Review the test manually or check error details'],
        details: result,
      };

      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  return server;
}
