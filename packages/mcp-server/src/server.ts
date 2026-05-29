import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LastestClient, type ToolResponse } from './client.js';
import { redactSecrets } from './redact.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

function withActivityReporting(
  client: LastestClient,
  toolName: string,
  handler: ToolHandler,
): ToolHandler {
  return async (params) => {
    const start = Date.now();
    // Tool params can carry caller-side secrets (auth headers, tokens
    // accidentally passed as a string field). Redact before they reach
    // the activity feed where any team member can view them.
    client.reportActivity({
      eventType: 'mcp:tool_call',
      summary: `MCP: ${toolName}`,
      detail: { params: redactSecrets(params) },
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
    version: '0.3.7',
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
    'Create a new local repository in the current team. Use this when you need a fresh workspace for tests without connecting to GitHub/GitLab. Pass `baseUrl` to point the repo at an external app (e.g. https://staging.example.com) so generated tests target the right origin instead of localhost:3000.',
    {
      name: z.string().describe('Repository name (e.g. "my-app")'),
      baseUrl: z.string().url().optional().describe('Base URL passed to `test(page, baseUrl, ...)` for this repo (e.g. https://staging.example.com). Defaults to http://localhost:3000.'),
    },
    withActivityReporting(client, 'lastest_create_repo', async (params) => {
      const repo = await client.createRepo(params.name as string, {
        baseUrl: params.baseUrl as string | undefined,
      });
      const response: ToolResponse = {
        status: 'created',
        summary: `Repository "${repo.name}" created (ID: ${repo.id}${repo.baseUrl ? `, baseUrl: ${repo.baseUrl}` : ''})`,
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
    'Update a repository\'s name, default branch, selected branch, or base URL. `baseUrl` is the value passed to `test(page, baseUrl, ...)` — set it to point a repo at an external app instead of the default http://localhost:3000.',
    {
      repositoryId: z.string().describe('Repository ID to update'),
      name: z.string().optional().describe('New repository name'),
      defaultBranch: z.string().optional().describe('New default branch name'),
      selectedBranch: z.string().optional().describe('Branch selected for test runs'),
      baseUrl: z.string().url().optional().describe('Base URL for tests in this repo (e.g. https://staging.example.com).'),
    },
    withActivityReporting(client, 'lastest_update_repo', async (params) => {
      const { repositoryId, ...rest } = params;
      const cleanUpdates = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      ) as { name?: string; defaultBranch?: string; selectedBranch?: string; baseUrl?: string };
      const result = (await client.updateRepo(repositoryId as string, cleanUpdates)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Repository ${repositoryId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_get_playwright_settings ---
  server.tool(
    'lastest_get_playwright_settings',
    'Get the repo-level Playwright settings (browser, viewport, timeouts, error modes, stabilization, parallelism caps, etc.). Falls back to the global row + built-in defaults when no per-repo row exists.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const settings = (await client.getPlaywrightSettings(params.repositoryId as string)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `Playwright settings for repo ${params.repositoryId} (browser=${settings.browser}, viewport=${settings.viewportWidth}x${settings.viewportHeight}, parallel=${settings.maxParallelTests})`,
        details: settings,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_update_playwright_settings ---
  server.tool(
    'lastest_update_playwright_settings',
    'Upsert repo-level Playwright settings. Pass any subset of fields — unknown keys are rejected, unspecified ones stay at their current value. Use this when the demo skill needs to retarget a repo at a different browser, viewport, or error policy without touching every test individually.',
    {
      repositoryId: z.string().describe('Repository ID'),
      browser: z.enum(['chromium', 'firefox', 'webkit']).optional().describe('Default browser for tests in this repo'),
      headlessMode: z.enum(['true', 'false', 'shell']).optional().describe('Headless mode'),
      viewportWidth: z.number().positive().optional().describe('Default viewport width'),
      viewportHeight: z.number().positive().optional().describe('Default viewport height'),
      lockViewportToRecording: z.boolean().optional(),
      navigationTimeout: z.number().nonnegative().optional().describe('Default navigation timeout in ms'),
      actionTimeout: z.number().nonnegative().optional().describe('Default action timeout in ms'),
      selectorTimeoutMs: z.number().nonnegative().optional().describe('Per-candidate waitFor budget for locateWithFallback'),
      screenshotDelay: z.number().nonnegative().optional(),
      maxParallelTests: z.number().nonnegative().optional().describe('Max tests to run in parallel'),
      autoRetryCount: z.number().nonnegative().optional().describe('0-3: how many times to retry a failing test'),
      cursorFPS: z.number().nonnegative().optional(),
      cursorPlaybackSpeed: z.number().nonnegative().optional(),
      networkErrorMode: z.enum(['fail', 'warn', 'ignore']).optional(),
      consoleErrorMode: z.enum(['fail', 'warn', 'ignore']).optional(),
      ignoreExternalNetworkErrors: z.boolean().optional(),
      acceptAnyCertificate: z.boolean().optional().describe('Ignore HTTPS/SSL cert errors'),
      grantClipboardAccess: z.boolean().optional(),
      acceptDownloads: z.boolean().optional(),
      enableNetworkInterception: z.boolean().optional(),
      enableDomDiff: z.boolean().optional(),
      enableA11y: z.boolean().optional().describe('Enable WCAG accessibility checks with axe-core'),
      enableVideoRecording: z.boolean().optional().describe('Record test runs as WebM video by default'),
      pointerGestures: z.boolean().optional(),
      freezeAnimations: z.boolean().optional(),
      customAttributeName: z.string().nullable().optional().describe('App-specific test-id attribute (e.g. data-automation-id). Pass null to clear.'),
      browsers: z.array(z.enum(['chromium', 'firefox', 'webkit'])).optional().describe('Browsers to use for build execution'),
      enabledRecordingEngines: z.array(z.enum(['lastest', 'playwright-inspector'])).optional(),
      defaultRecordingEngine: z.enum(['lastest', 'playwright-inspector']).optional(),
      stabilization: z.record(z.unknown()).nullable().optional().describe('StabilizationSettings object (waitForNetworkIdle, freezeTimestamps, mask patterns, etc.). Pass null to clear.'),
      selectorPriority: z.array(z.unknown()).optional().describe('SelectorConfig[] ordering — leave unset to use the global default.'),
    },
    withActivityReporting(client, 'lastest_update_playwright_settings', async (params) => {
      const { repositoryId, ...rest } = params;
      const cleanUpdates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) {
        throw new Error('No fields to update');
      }
      const result = (await client.updatePlaywrightSettings(repositoryId as string, cleanUpdates)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Playwright settings for repo ${repositoryId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
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
  const setupStepSchema = z.object({
    stepType: z.enum(['test', 'script', 'storage_state']),
    testId: z.string().nullable().optional(),
    scriptId: z.string().nullable().optional(),
    storageStateId: z.string().nullable().optional(),
  });
  const overridesSchema = z.object({
    skippedDefaultStepIds: z.array(z.string()).optional(),
    extraSteps: z.array(setupStepSchema).optional(),
  });
  const playwrightOverridesSchema = z.object({
    browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
    navigationTimeout: z.number().nonnegative().optional(),
    actionTimeout: z.number().nonnegative().optional(),
    screenshotDelay: z.number().nonnegative().optional(),
    networkErrorMode: z.enum(['fail', 'warn', 'ignore']).optional(),
    consoleErrorMode: z.enum(['fail', 'warn', 'ignore']).optional(),
    acceptAnyCertificate: z.boolean().optional(),
    maxParallelTests: z.number().nonnegative().optional(),
    baseUrl: z.string().optional(),
    cursorPlaybackSpeed: z.number().nonnegative().optional(),
    selectorTimeoutMs: z.number().nonnegative().optional(),
  });
  server.tool(
    'lastest_update_test',
    'Update a test\'s name, code, URL, functional area, setup wiring, or runtime overrides. Pass `setupTestId` to point this test at another test for setup (the most common pattern when two tests share a login), or `setupScriptId` to point at a saved setup script — these two are mutually exclusive. Use `setupOverrides` / `teardownOverrides` to skip specific default steps or inject extra ones (test / script / storage-state) just for this test. `playwrightOverrides` lets the test self-configure runtime knobs (browser, timeouts, error modes, baseUrl) without touching the repo-wide settings. `diffOverrides` and `stabilizationOverrides` accept partial blocks that fall through to repo defaults. Pass `null` for any override block to clear it.',
    {
      testId: z.string().describe('Test ID to update'),
      name: z.string().optional().describe('New test name'),
      code: z.string().optional().describe('New Playwright test code'),
      targetUrl: z.string().optional().describe('New target URL'),
      functionalAreaId: z.string().optional().describe('New functional area ID'),
      quarantined: z.boolean().optional().describe('Quarantine the test so it runs but does not block builds.'),
      executionMode: z.enum(['procedural', 'agent']).optional().describe('Execution mode'),
      viewportOverride: z.object({ width: z.number().positive(), height: z.number().positive() }).nullable().optional().describe('Override the recording viewport for this test. Pass null to clear.'),
      playwrightOverrides: playwrightOverridesSchema.nullable().optional().describe('Per-test Playwright runtime overrides. Unset fields fall back to the repo playwright settings, then the global defaults. Pass null to clear.'),
      diffOverrides: z.record(z.unknown()).nullable().optional().describe('Per-test diff overrides (thresholds, anti-aliasing, diff engine, text-region tuning). Pass null to clear.'),
      stabilizationOverrides: z.record(z.unknown()).nullable().optional().describe('Per-test stabilization overrides (wait strategies, content freezing, etc.). Pass null to clear.'),
      setupTestId: z.string().nullable().optional().describe('Use another test as setup (takes precedence over setupScriptId). Pass null/empty to clear.'),
      setupScriptId: z.string().nullable().optional().describe('Use a saved setup script as setup. Pass null/empty to clear. Mutually exclusive with setupTestId.'),
      setupOverrides: overridesSchema.nullable().optional().describe('Per-test setup override block: `skippedDefaultStepIds` lists default_setup_steps to skip, `extraSteps` lists test/script/storage_state ids to inject after defaults. Pass null to clear.'),
      teardownOverrides: overridesSchema.nullable().optional().describe('Same shape as setupOverrides, applied to teardown. Pass null to clear.'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const { testId, ...rest } = params;
      const cleanUpdates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const result = (await client.updateTest(testId as string, cleanUpdates as Parameters<typeof client.updateTest>[1])) as Record<string, unknown>;
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

  // --- lastest_publish_share ---
  server.tool(
    'lastest_publish_share',
    'Publish a public-share link for a build (or a single test within it). Returns a `/r/<slug>` URL anyone can view without logging in. Use after a build completes so demos and outreach messages can link directly to the visual result. Pass `scopedTestId` to scope the share to one test instead of the whole build.',
    {
      buildId: z.string().describe('Build ID to publish a share for'),
      scopedTestId: z.string().optional().describe('Optional — restrict the share to a single test within the build'),
    },
    withActivityReporting(client, 'lastest_publish_share', async (params) => {
      const result = await client.publishShare(params.buildId as string, {
        scopedTestId: params.scopedTestId as string | undefined,
      });
      const response: ToolResponse = {
        status: 'share_published',
        summary: params.scopedTestId
          ? `Test share published: ${result.url}`
          : `Build share published: ${result.url}`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_list_build_shares ---
  server.tool(
    'lastest_list_build_shares',
    'List public shares anchored on a build (includes revoked ones — check `status`). Use to find an existing share before publishing a duplicate, or to grab a slug for revoke.',
    {
      buildId: z.string().describe('Build ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const shares = (await client.listBuildShares(params.buildId as string)) as Array<Record<string, unknown>>;
      const active = shares.filter(s => s.status === 'public');
      const response: ToolResponse = {
        status: 'ok',
        summary: `${shares.length} share(s) for build ${params.buildId} (${active.length} active)`,
        details: {
          count: shares.length,
          shares: shares.map(s => ({ id: s.id, slug: s.slug, status: s.status, testId: s.testId, createdAt: s.createdAt })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_list_test_shares ---
  server.tool(
    'lastest_list_test_shares',
    'List public shares anchored on a single test.',
    {
      testId: z.string().describe('Test ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const shares = (await client.listTestShares(params.testId as string)) as Array<Record<string, unknown>>;
      const active = shares.filter(s => s.status === 'public');
      const response: ToolResponse = {
        status: 'ok',
        summary: `${shares.length} share(s) for test ${params.testId} (${active.length} active)`,
        details: {
          count: shares.length,
          shares: shares.map(s => ({ id: s.id, slug: s.slug, status: s.status, buildId: s.buildId, createdAt: s.createdAt })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_revoke_share ---
  server.tool(
    'lastest_revoke_share',
    'Revoke a public share by its share ID. The `/r/<slug>` URL stops resolving immediately. Find share IDs via lastest_list_build_shares or lastest_list_test_shares.',
    {
      shareId: z.string().describe('Share ID to revoke (NOT the slug — call lastest_list_build_shares to find it)'),
    },
    withActivityReporting(client, 'lastest_revoke_share', async (params) => {
      const result = await client.revokeShare(params.shareId as string);
      const response: ToolResponse = {
        status: 'revoked',
        summary: `Share ${params.shareId} revoked. The /r/<slug> URL is now dead.`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
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
    'Trigger a test build and return structured results. Can run all tests in a repo, all tests inside one functional area, or specific test IDs. Pass `forceVideoRecording: true` when you intend to publish a share that should include the video player (the share page renders the embedded clip only when the build has video).',
    {
      repositoryId: z.string().optional().describe('Repository ID to run tests for. If omitted, uses the default repo.'),
      testIds: z.array(z.string()).optional().describe('Specific test IDs to run. Takes precedence over functionalAreaId.'),
      functionalAreaId: z.string().optional().describe('Run every test inside this functional area (ignored if testIds is set).'),
      gitBranch: z.string().optional().describe('Git branch override'),
      forceVideoRecording: z.boolean().optional().describe('Force-enable per-test video recording for this build. Required for demo-style shares that should render the video player. Disabled by default to keep build storage small.'),
    },
    withActivityReporting(client, 'lastest_run_tests', async (params) => {
      const result = await client.createBuild({
        repositoryId: params.repositoryId as string | undefined,
        testIds: params.testIds as string[] | undefined,
        functionalAreaId: params.functionalAreaId as string | undefined,
        gitBranch: params.gitBranch as string | undefined,
        forceVideoRecording: params.forceVideoRecording as boolean | undefined,
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
    'Get the current status and results of a build. Use after lastest_run_tests to check progress. Returns slim build scalars + slim diff index — drill into a specific diff with lastest_get_visual_diff (or pass `includeDiffs: "full"` if you really need the joined a11y/network/AI payloads).',
    {
      buildId: z.string().describe('The build ID to check status for'),
      includeDiffs: z
        .enum(['slim', 'full'])
        .optional()
        .describe('"slim" (default) returns only id/testId/stepLabel/status/classification/pct per diff. "full" returns every joined column (heavy — can be 100KB+ for builds with many diffs).'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const includeDiffs = (params.includeDiffs as string | undefined) ?? 'slim';
      // Slim is the default. The API now slims server-side too so the wire
      // payload stays small unless `full` is explicitly requested.
      const build = (await client.getBuild(params.buildId, { full: includeDiffs === 'full' })) as Record<string, unknown>;

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

      // Slim the response by default. The REST API joins a11yViolations,
      // consoleErrors, networkRequests, aiAnalysis, and diff metadata onto
      // every diff — for builds with N diffs that can easily clear 100KB and
      // saturate an agent's context. Most callers only need the diff index;
      // they fetch heavy payloads per-diff via lastest_get_visual_diff.
      const rawDiffs = Array.isArray(build.diffs) ? (build.diffs as Array<Record<string, unknown>>) : [];
      const slimDiffs = rawDiffs.map((d) => ({
        id: d.id,
        testId: d.testId,
        testName: d.testName,
        stepLabel: d.stepLabel,
        status: d.status,
        classification: d.classification,
        percentageDifference: d.percentageDifference,
        pixelDifference: d.pixelDifference,
        testResultStatus: d.testResultStatus,
        browser: d.browser,
        aiRecommendation: d.aiRecommendation,
      }));
      const { diffs: _omitDiffs, ...buildScalars } = build;
      const details =
        includeDiffs === 'full'
          ? { ...buildScalars, diffs: rawDiffs }
          : { ...buildScalars, diffs: slimDiffs, diffsTrimmed: true, diffsCount: rawDiffs.length };

      const response: ToolResponse = {
        status,
        summary: `Build ${params.buildId}: ${passed}/${total} passed, ${failed} failed, ${changes} visual changes, ${flaky} flaky. Status: ${status}`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details,
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
      // This tool surfaces aiAnalysis (LLM commentary on each diff) which is
      // stripped from the slim build payload — fetch full so it's available.
      const build = (await client.getBuild(params.buildId, { full: true })) as Record<string, unknown>;
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

      let result: Record<string, unknown>;
      try {
        result = (await client.createTest({
          repositoryId,
          url: params.url as string | undefined,
          prompt: params.prompt as string | undefined,
          functionalAreaId,
        })) as Record<string, unknown>;
      } catch (err) {
        // The API maps provider failures to 502/503/422 with a JSON body
        // containing { error, retryable, fallback }. Surface that as a
        // structured tool response rather than a raw thrown Error so the
        // agent can see the recovery hint.
        const message = err instanceof Error ? err.message : String(err);
        const match = message.match(/Lastest API error (\d+): (.*)$/s);
        const httpStatus = match ? Number(match[1]) : null;
        let parsedBody: { error?: string; retryable?: boolean; fallback?: string } = {};
        if (match) {
          try { parsedBody = JSON.parse(match[2]); } catch { parsedBody = { error: match[2] }; }
        }
        const retryable = parsedBody.retryable ?? (httpStatus === 502 || httpStatus === 429);
        const failResponse: ToolResponse = {
          status: 'ai_generation_failed',
          summary: `AI test generation failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${parsedBody.error ?? message}`,
          actionRequired: [
            retryable
              ? 'Provider is overloaded or rate-limited — retry lastest_create_test in a few seconds.'
              : 'AI provider is not configured or rejected the request — check Settings → AI in Lastest.',
            parsedBody.fallback ?? 'Fallback: call lastest_create_test in direct mode with { name, code } using a Playwright snapshot you generate yourself.',
          ],
          details: {
            httpStatus,
            retryable,
            error: parsedBody.error ?? message,
          },
        };
        return { content: [{ type: 'text', text: JSON.stringify(failResponse, null, 2) }] };
      }

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

  // ===== Storage States (saved Playwright auth blobs) =====

  // --- lastest_list_storage_states ---
  server.tool(
    'lastest_list_storage_states',
    'List storage states (saved Playwright `storageState()` blobs — cookies + localStorage) for a repository. Returns metadata only; the raw JSON is omitted because it contains live auth tokens. Use these IDs when wiring `setupOverrides.extraSteps` on a test via lastest_update_test.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const states = (await client.listStorageStates(params.repositoryId as string)) as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `${states.length} storage state(s)`,
        details: {
          count: states.length,
          storageStates: states.map(s => ({
            id: s.id,
            name: s.name,
            cookieCount: s.cookieCount,
            originCount: s.originCount,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_create_storage_state ---
  server.tool(
    'lastest_create_storage_state',
    'Create a new storage state for a repo from a Playwright `storageState()` JSON string. The JSON should be the output of `await context.storageState()` — an object with `cookies` and `origins` arrays. Use this to share a logged-in session across tests instead of re-logging in. Treat the raw JSON like a password: only call this with tokens you intend Lastest to use.',
    {
      repositoryId: z.string().describe('Repository ID'),
      name: z.string().describe('Display name (e.g. "Admin login (staging)")'),
      storageStateJson: z.string().describe('Playwright storageState JSON string — `{ "cookies": [...], "origins": [...] }`'),
    },
    withActivityReporting(client, 'lastest_create_storage_state', async (params) => {
      const result = (await client.createStorageState(params.repositoryId as string, {
        name: params.name as string,
        storageStateJson: params.storageStateJson as string,
      })) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'created',
        summary: `Storage state "${result.name}" created (ID: ${result.id}, cookies: ${result.cookieCount ?? 0}, origins: ${result.originCount ?? 0})`,
        actionRequired: [
          'Wire it into a test by calling lastest_update_test with setupOverrides.extraSteps = [{ stepType: "storage_state", storageStateId: "<this id>" }]',
        ],
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_delete_storage_state ---
  server.tool(
    'lastest_delete_storage_state',
    'Delete a storage state. Tests referencing it via setupOverrides.extraSteps will lose that step — review usage before deleting.',
    {
      storageStateId: z.string().describe('Storage state ID to delete'),
    },
    withActivityReporting(client, 'lastest_delete_storage_state', async (params) => {
      const result = await client.deleteStorageState(params.storageStateId as string);
      const response: ToolResponse = {
        status: 'deleted',
        summary: `Storage state ${params.storageStateId} deleted`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // ===== Setup Scripts (reusable Playwright/API setup blocks) =====

  // --- lastest_list_setup_scripts ---
  server.tool(
    'lastest_list_setup_scripts',
    'List setup scripts for a repository. Each entry includes id, name, type (`playwright` or `api`), and code so you can pick one to attach to a test via setupScriptId.',
    {
      repositoryId: z.string().describe('Repository ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const scripts = (await client.listSetupScripts(params.repositoryId as string)) as Array<Record<string, unknown>>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `${scripts.length} setup script(s)`,
        details: {
          count: scripts.length,
          setupScripts: scripts.map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            description: s.description,
          })),
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_get_setup_script ---
  server.tool(
    'lastest_get_setup_script',
    'Get a setup script including its code.',
    {
      setupScriptId: z.string().describe('Setup script ID'),
    },
    async (params): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      const script = (await client.getSetupScript(params.setupScriptId as string)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'ok',
        summary: `Setup script: ${script.name}`,
        details: script,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    },
  );

  // --- lastest_create_setup_script ---
  server.tool(
    'lastest_create_setup_script',
    'Create a reusable setup script for a repository. Two types: `playwright` (async function with page+context) and `api` (HTTP seeding). Attach the returned ID to a test via lastest_update_test with `setupScriptId`.',
    {
      repositoryId: z.string().describe('Repository ID'),
      name: z.string().describe('Script name'),
      type: z.enum(['playwright', 'api']).describe('Script type'),
      code: z.string().describe('Script source code'),
      description: z.string().optional().describe('Optional description'),
    },
    withActivityReporting(client, 'lastest_create_setup_script', async (params) => {
      const result = (await client.createSetupScript(params.repositoryId as string, {
        name: params.name as string,
        type: params.type as 'playwright' | 'api',
        code: params.code as string,
        description: params.description as string | undefined,
      })) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'created',
        summary: `Setup script "${result.name}" created (ID: ${result.id}, type: ${result.type})`,
        actionRequired: [
          'Attach to a test with lastest_update_test setting setupScriptId to this ID',
        ],
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_update_setup_script ---
  server.tool(
    'lastest_update_setup_script',
    'Update a setup script\'s name, type, code, or description.',
    {
      setupScriptId: z.string().describe('Setup script ID to update'),
      name: z.string().optional().describe('New name'),
      type: z.enum(['playwright', 'api']).optional().describe('New type'),
      code: z.string().optional().describe('New code'),
      description: z.string().optional().describe('New description'),
    },
    withActivityReporting(client, 'lastest_update_setup_script', async (params) => {
      const { setupScriptId, ...rest } = params;
      const cleanUpdates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      const result = (await client.updateSetupScript(setupScriptId as string, cleanUpdates as Parameters<typeof client.updateSetupScript>[1])) as Record<string, unknown>;
      const response: ToolResponse = {
        status: 'updated',
        summary: `Setup script ${setupScriptId} updated (fields: ${Object.keys(cleanUpdates).join(', ')})`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_delete_setup_script ---
  server.tool(
    'lastest_delete_setup_script',
    'Delete a setup script. Refused with 409 if any test still references it via setupScriptId — the response lists the blocking tests.',
    {
      setupScriptId: z.string().describe('Setup script ID to delete'),
    },
    withActivityReporting(client, 'lastest_delete_setup_script', async (params) => {
      const result = await client.deleteSetupScript(params.setupScriptId as string);
      const response: ToolResponse = {
        status: 'deleted',
        summary: `Setup script ${params.setupScriptId} deleted`,
        details: result,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // ===== Verify phase (v1.14+) =====

  // --- lastest_get_change_map ---
  server.tool(
    'lastest_get_change_map',
    'Get the build-level Change Map (4-signal area ranking + AI intent/risk summary) for a build.',
    {
      buildId: z.string().describe('Build ID'),
    },
    withActivityReporting(client, 'lastest_get_change_map', async (params) => {
      const result = await client.getChangeMap(params.buildId as string);
      const response: ToolResponse = {
        status: 'ok',
        summary: 'Change Map retrieved.',
        details: result as Record<string, unknown>,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_verify_build ---
  server.tool(
    'lastest_verify_build',
    'Get the full verify-build view: Change Map + step comparisons grouped by regression vs intent gate. Includes `visualUrlsByDiffId` (clickable /api/media URLs for baseline/current/diff PNGs per visual diff — same bearer token works) and `testsByTestId` (test name/code/targetUrl + setupTestId/setupScriptId/storageStateId hints) so the agent can read source and screenshots without a follow-up chain.',
    {
      buildId: z.string().describe('Build ID'),
    },
    withActivityReporting(client, 'lastest_verify_build', async (params) => {
      const result = await client.verifyBuild(params.buildId as string);
      const response: ToolResponse = {
        status: 'ok',
        summary: 'Verify view retrieved.',
        details: result as Record<string, unknown>,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // ===== QuickStart agent =====

  // --- lastest_quickstart ---
  server.tool(
    'lastest_quickstart',
    'Productized form of /gtm-lastest-saas-demo. Spins up a 2-test demo (auth setup + app walkthrough) on a repo whose baseUrl is set, runs it with video, and writes build_demo_notes. Gated by team early-adopter mode + repo baseUrl. Returns a sessionId to poll with lastest_quickstart_status.',
    {
      repositoryId: z.string().describe('Repository ID — must have baseUrl set and team must have early-adopter mode enabled'),
      emailTemplate: z
        .string()
        .optional()
        .describe('Optional override for the demo email template (must contain {slug} and {stamp} tokens). Persisted on the team for next time.'),
    },
    withActivityReporting(client, 'lastest_quickstart', async (params) => {
      try {
        const result = await client.startQuickstart(params.repositoryId as string, {
          emailTemplate: params.emailTemplate as string | undefined,
        });
        const response: ToolResponse = {
          status: 'started',
          summary: `QuickStart session started: ${result.sessionId}`,
          actionRequired: [
            `Poll lastest_quickstart_status with sessionId: ${result.sessionId}`,
            'Status flips to "completed" when the build finishes and demo notes are written.',
          ],
          details: result as unknown as Record<string, unknown>,
        };
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const match = message.match(/Lastest API error (\d+): (.*)$/s);
        let parsedBody: Record<string, unknown> = {};
        if (match) {
          try { parsedBody = JSON.parse(match[2]); } catch { /* ignore */ }
        }
        const isDisabled = parsedBody.error === 'quickstart_disabled';
        const failResponse: ToolResponse = {
          status: isDisabled ? 'disabled' : 'error',
          summary: isDisabled
            ? `QuickStart is disabled for this repo: ${String(parsedBody.reason ?? 'unknown')}`
            : `Failed to start QuickStart: ${message}`,
          actionRequired: isDisabled
            ? [String(parsedBody.hint ?? 'Check team early-adopter mode and repo baseUrl.')]
            : ['Inspect the error and retry; check that the repo has baseUrl set and AI provider configured.'],
          details: parsedBody,
        };
        return { content: [{ type: 'text', text: JSON.stringify(failResponse, null, 2) }] };
      }
    }),
  );

  // --- lastest_quickstart_status ---
  server.tool(
    'lastest_quickstart_status',
    'Poll a QuickStart session by ID. Returns step-by-step status, the auth-setup outcome, the walkthrough test ID, the build ID, and whether demo notes were written.',
    {
      sessionId: z.string().describe('QuickStart session ID returned by lastest_quickstart'),
    },
    withActivityReporting(client, 'lastest_quickstart_status', async (params) => {
      const result = await client.getQuickstartStatus(params.sessionId as string);
      const completed = result.status === 'completed';
      const failed = result.status === 'failed';
      const cancelled = result.status === 'cancelled';
      const summaryBits: string[] = [`status: ${result.status}`];
      if (result.currentStepId) summaryBits.push(`current: ${result.currentStepId}`);
      const buildId = (result.metadata?.buildId as string | undefined) ?? null;
      const walkthroughTestId = (result.metadata?.walkthroughTestId as string | undefined) ?? null;
      if (walkthroughTestId) summaryBits.push(`walkthroughTestId: ${walkthroughTestId}`);
      if (buildId) summaryBits.push(`buildId: ${buildId}`);

      const actionRequired: string[] = [];
      if (!completed && !failed && !cancelled) {
        actionRequired.push('Poll again in a few seconds.');
      }
      if (completed && buildId) {
        actionRequired.push(`Open the build: /builds/${buildId}`);
        actionRequired.push(`Publish a share via POST /api/v1/builds/${buildId}/share { scopedTestId: "${walkthroughTestId ?? '...'}" }`);
      }
      if (failed) {
        actionRequired.push('Inspect the failed step in `steps[]`. The `error` and `result` fields contain the cause.');
      }

      const response: ToolResponse = {
        status: result.status,
        summary: summaryBits.join(' · '),
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: result as unknown as Record<string, unknown>,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  // --- lastest_approve_layer ---
  server.tool(
    'lastest_approve_layer',
    'Per-layer feedback on a step comparison: approve (Mark expected → write baseline), reject (Needs fix → create todo), or snooze (suppress for this build only).',
    {
      stepComparisonId: z.string().describe('Step comparison ID'),
      buildId: z.string().describe('Build ID'),
      layer: z.enum(['visual', 'dom', 'a11y', 'network', 'console', 'url', 'perf', 'variable']).describe('Layer name'),
      status: z.enum(['approved', 'rejected', 'snoozed']).describe('approved=Mark expected; rejected=Needs fix; snoozed=Suppress for this build'),
      note: z.string().optional().describe('Optional note attached to the decision'),
    },
    withActivityReporting(client, 'lastest_approve_layer', async (params) => {
      const result = await client.approveLayer({
        stepComparisonId: params.stepComparisonId as string,
        buildId: params.buildId as string,
        layer: params.layer as string,
        status: params.status as 'approved' | 'rejected' | 'snoozed',
        note: params.note as string | undefined,
      });
      const response: ToolResponse = {
        status: 'ok',
        summary: `Layer ${params.layer} ${params.status}.`,
        details: result as Record<string, unknown>,
      };
      return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
    }),
  );

  return server;
}
