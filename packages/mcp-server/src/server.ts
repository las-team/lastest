/**
 * Lastest MCP server.
 *
 * AUTHENTICATION: this server holds no auth logic of its own and exposes no
 * privileged surface. Every tool delegates to `LastestClient`, which calls the
 * Lastest REST API v1 with `Authorization: Bearer <apiKey>` (the per-user/team
 * token configured for the MCP process). The v1 route authenticates that token
 * on every request via `getCurrentSession` → `verifyBearerToken` and enforces
 * team ownership per resource (401/403/404). So a tool call can only ever touch
 * data the bearer token's team already owns — there is no ambient access. The
 * token is the credential; protect it like any other secret.
 */
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LastestClient, type ToolResponse } from "./client.js";
import { redactSecrets } from "./redact.js";
import {
  AUTHORING_CONTRACT,
  buildRepoAuthoringGuide,
} from "./authoring-guide.js";

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

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
      eventType: "mcp:tool_call",
      summary: `MCP: ${toolName}`,
      detail: { params: redactSecrets(params) },
      toolName,
    });
    try {
      const result = await handler(params);
      client.reportActivity({
        eventType: "mcp:tool_result",
        summary: `MCP: ${toolName} completed`,
        durationMs: Date.now() - start,
        toolName,
      });
      return result;
    } catch (err) {
      client.reportActivity({
        eventType: "mcp:tool_error",
        summary: `MCP: ${toolName} failed — ${String(err)}`,
        durationMs: Date.now() - start,
        toolName,
      });
      throw err;
    }
  };
}

/** Throw a clear error when a required param for the chosen action is absent. */
function requireParam<T>(
  value: T | undefined | null,
  name: string,
  action: string,
): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`'${name}' is required when action is '${action}'`);
  }
  return value;
}

export function createServer(client: LastestClient): McpServer {
  const server = new McpServer({
    name: "lastest",
    version: "0.5.0",
  });

  // ===== lastest_status (health, jobs, job) =====
  // Replaces lastest_health_check, lastest_list_active_jobs, lastest_get_job_status.
  server.tool(
    "lastest_status",
    'Instance & background-job status. `action`: "health" (check connectivity to the Lastest instance), "jobs" (list currently active background jobs — builds, AI operations, etc.), "job" (get status/progress of a specific background job — requires `jobId`).',
    {
      action: z
        .enum(["health", "jobs", "job"])
        .describe(
          '"health" = connectivity check; "jobs" = list active jobs; "job" = single job status (needs jobId)',
        ),
      jobId: z
        .string()
        .optional()
        .describe('Background job ID — required when action is "job"'),
    },
    async (
      params,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const action = params.action as "health" | "jobs" | "job";
      if (action === "health") {
        const result = await client.health();
        const response: ToolResponse = {
          status: result.ok ? "healthy" : "unhealthy",
          summary: result.ok
            ? "Lastest is reachable and healthy"
            : "Lastest health check failed",
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
      if (action === "jobs") {
        const jobs = (await client.getActiveJobs()) as Array<
          Record<string, unknown>
        >;
        const response: ToolResponse = {
          status: jobs.length > 0 ? "has_active_jobs" : "idle",
          summary:
            jobs.length > 0
              ? `${jobs.length} active job(s) running`
              : "No active background jobs",
          details: { count: jobs.length, jobs },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
      // action === 'job'
      const jobId = requireParam(
        params.jobId as string | undefined,
        "jobId",
        "job",
      );
      const job = (await client.getJob(jobId)) as Record<string, unknown>;
      const response: ToolResponse = {
        status: job.status as string,
        summary: `Job ${jobId}: ${job.status}${job.progress ? ` (${job.progress}%)` : ""}`,
        details: job,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // ===== lastest_repo (list, get, create, update, get_settings, update_settings) =====
  // Replaces lastest_list_repos, lastest_get_repo, lastest_create_repo, lastest_update_repo,
  // lastest_get_playwright_settings, lastest_update_playwright_settings.
  server.tool(
    "lastest_repo",
    'Repository resource. `action`: "list" (all repos for the team), "get" (one repo — needs repositoryId), "create" (new local repo — needs name; optional baseUrl points the repo at an external app so generated tests target the right origin), "update" (rename / branches / baseUrl — needs repositoryId), "get_settings" (repo-level Playwright settings — needs repositoryId), "update_settings" (upsert repo-level Playwright settings — needs repositoryId + at least one field).',
    {
      action: z
        .enum([
          "list",
          "get",
          "create",
          "update",
          "get_settings",
          "update_settings",
        ])
        .describe("Repo operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe(
          "Repository ID — required for get/update/get_settings/update_settings",
        ),
      // create
      name: z
        .string()
        .optional()
        .describe(
          "Repository name (required for create; optional new name for update)",
        ),
      // create + update
      baseUrl: z
        .string()
        .url()
        .optional()
        .describe(
          "Base URL passed to `test(page, baseUrl, ...)` (e.g. https://staging.example.com). Defaults to http://localhost:3000.",
        ),
      // update
      defaultBranch: z
        .string()
        .optional()
        .describe("New default branch name (update)"),
      selectedBranch: z
        .string()
        .optional()
        .describe("Branch selected for test runs (update)"),
      // update_settings (Playwright settings — pass any subset)
      browser: z
        .enum(["chromium", "firefox", "webkit"])
        .optional()
        .describe("Default browser for tests in this repo"),
      headlessMode: z
        .enum(["true", "false", "shell"])
        .optional()
        .describe("Headless mode"),
      viewportWidth: z
        .number()
        .positive()
        .optional()
        .describe("Default viewport width"),
      viewportHeight: z
        .number()
        .positive()
        .optional()
        .describe("Default viewport height"),
      lockViewportToRecording: z.boolean().optional(),
      navigationTimeout: z
        .number()
        .nonnegative()
        .optional()
        .describe("Default navigation timeout in ms"),
      actionTimeout: z
        .number()
        .nonnegative()
        .optional()
        .describe("Default action timeout in ms"),
      selectorTimeoutMs: z
        .number()
        .nonnegative()
        .optional()
        .describe("Per-candidate waitFor budget for locateWithFallback"),
      screenshotDelay: z.number().nonnegative().optional(),
      maxParallelTests: z
        .number()
        .nonnegative()
        .optional()
        .describe("Max tests to run in parallel"),
      autoRetryCount: z
        .number()
        .nonnegative()
        .optional()
        .describe("0-3: how many times to retry a failing test"),
      cursorFPS: z.number().nonnegative().optional(),
      cursorPlaybackSpeed: z.number().nonnegative().optional(),
      networkErrorMode: z.enum(["fail", "warn", "ignore"]).optional(),
      consoleErrorMode: z.enum(["fail", "warn", "ignore"]).optional(),
      ignoreExternalNetworkErrors: z.boolean().optional(),
      acceptAnyCertificate: z
        .boolean()
        .optional()
        .describe("Ignore HTTPS/SSL cert errors"),
      grantClipboardAccess: z.boolean().optional(),
      acceptDownloads: z.boolean().optional(),
      enableNetworkInterception: z.boolean().optional(),
      enableDomDiff: z.boolean().optional(),
      enableA11y: z
        .boolean()
        .optional()
        .describe("Enable WCAG accessibility checks with axe-core"),
      enableVideoRecording: z
        .boolean()
        .optional()
        .describe("Record test runs as WebM video by default"),
      pointerGestures: z.boolean().optional(),
      freezeAnimations: z.boolean().optional(),
      customAttributeName: z
        .string()
        .nullable()
        .optional()
        .describe(
          "App-specific test-id attribute (e.g. data-automation-id). Pass null to clear.",
        ),
      browsers: z
        .array(z.enum(["chromium", "firefox", "webkit"]))
        .optional()
        .describe("Browsers to use for build execution"),
      enabledRecordingEngines: z
        .array(z.enum(["lastest", "playwright-inspector"]))
        .optional(),
      defaultRecordingEngine: z
        .enum(["lastest", "playwright-inspector"])
        .optional(),
      stabilization: z
        .record(z.unknown())
        .nullable()
        .optional()
        .describe(
          "StabilizationSettings object (waitForNetworkIdle, freezeTimestamps, mask patterns, etc.). Pass null to clear.",
        ),
      selectorPriority: z
        .array(z.unknown())
        .optional()
        .describe(
          "SelectorConfig[] ordering — leave unset to use the global default.",
        ),
    },
    withActivityReporting(client, "lastest_repo", async (params) => {
      const action = params.action as
        | "list"
        | "get"
        | "create"
        | "update"
        | "get_settings"
        | "update_settings";

      if (action === "list") {
        const repos = (await client.listRepos()) as Array<
          Record<string, unknown>
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `${repos.length} repository(ies) found`,
          details: {
            count: repos.length,
            repos: repos.map((r) => ({ id: r.id, name: r.name, url: r.url })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "get") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "get",
        );
        const repo = (await client.getRepo(repositoryId)) as Record<
          string,
          unknown
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `Repository: ${repo.name}`,
          details: repo,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "create") {
        const name = requireParam(
          params.name as string | undefined,
          "name",
          "create",
        );
        const repo = await client.createRepo(name, {
          baseUrl: params.baseUrl as string | undefined,
        });
        const response: ToolResponse = {
          status: "created",
          summary: `Repository "${repo.name}" created (ID: ${repo.id}${repo.baseUrl ? `, baseUrl: ${repo.baseUrl}` : ""})`,
          actionRequired: [
            "Create functional areas with lastest_area action:'create'",
            "Add tests with lastest_create_test",
          ],
          details: repo,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "update") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "update",
        );
        const cleanUpdates = Object.fromEntries(
          (["name", "defaultBranch", "selectedBranch", "baseUrl"] as const)
            .map((k) => [k, params[k]])
            .filter(([, v]) => v !== undefined),
        ) as {
          name?: string;
          defaultBranch?: string;
          selectedBranch?: string;
          baseUrl?: string;
        };
        const result = (await client.updateRepo(
          repositoryId,
          cleanUpdates,
        )) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "updated",
          summary: `Repository ${repositoryId} updated (fields: ${Object.keys(cleanUpdates).join(", ")})`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "get_settings") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "get_settings",
        );
        const settings = (await client.getPlaywrightSettings(
          repositoryId,
        )) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "ok",
          summary: `Playwright settings for repo ${repositoryId} (browser=${settings.browser}, viewport=${settings.viewportWidth}x${settings.viewportHeight}, parallel=${settings.maxParallelTests})`,
          details: settings,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'update_settings'
      const repositoryId = requireParam(
        params.repositoryId as string | undefined,
        "repositoryId",
        "update_settings",
      );
      const settingsKeys = [
        "browser",
        "headlessMode",
        "viewportWidth",
        "viewportHeight",
        "lockViewportToRecording",
        "navigationTimeout",
        "actionTimeout",
        "selectorTimeoutMs",
        "screenshotDelay",
        "maxParallelTests",
        "autoRetryCount",
        "cursorFPS",
        "cursorPlaybackSpeed",
        "networkErrorMode",
        "consoleErrorMode",
        "ignoreExternalNetworkErrors",
        "acceptAnyCertificate",
        "grantClipboardAccess",
        "acceptDownloads",
        "enableNetworkInterception",
        "enableDomDiff",
        "enableA11y",
        "enableVideoRecording",
        "pointerGestures",
        "freezeAnimations",
        "customAttributeName",
        "browsers",
        "enabledRecordingEngines",
        "defaultRecordingEngine",
        "stabilization",
        "selectorPriority",
      ] as const;
      const cleanUpdates = Object.fromEntries(
        settingsKeys
          .map((k) => [k, params[k]])
          .filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cleanUpdates).length === 0) {
        throw new Error("No fields to update");
      }
      const result = (await client.updatePlaywrightSettings(
        repositoryId,
        cleanUpdates,
      )) as Record<string, unknown>;
      const response: ToolResponse = {
        status: "updated",
        summary: `Playwright settings for repo ${repositoryId} updated (fields: ${Object.keys(cleanUpdates).join(", ")})`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_area (list, create, update, delete, list_tests) =====
  // Replaces lastest_list_areas, lastest_create_area, lastest_update_area, lastest_delete_area,
  // lastest_list_tests_by_area.
  server.tool(
    "lastest_area",
    'Functional-area resource (test groupings). `action`: "list" (areas for a repo — needs repositoryId), "create" (new area — needs name; optional repositoryId/parentId), "update" (rename/describe/reparent — needs functionalAreaId), "delete" (soft-delete; tests become unassigned — needs functionalAreaId), "list_tests" (tests within an area — needs functionalAreaId).',
    {
      action: z
        .enum(["list", "create", "update", "delete", "list_tests"])
        .describe("Area operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe('Repository ID — required for "list"; optional for "create"'),
      functionalAreaId: z
        .string()
        .optional()
        .describe("Functional area ID — required for update/delete/list_tests"),
      name: z
        .string()
        .optional()
        .describe(
          "Area name (required for create; optional new name for update)",
        ),
      description: z.string().optional().describe("New description (update)"),
      parentId: z
        .string()
        .optional()
        .describe(
          "Parent area ID for nesting (create) / new parent (update — pass empty string to clear)",
        ),
    },
    withActivityReporting(client, "lastest_area", async (params) => {
      const action = params.action as
        | "list"
        | "create"
        | "update"
        | "delete"
        | "list_tests";

      if (action === "list") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "list",
        );
        const areas = (await client.listAreas(repositoryId)) as Array<
          Record<string, unknown>
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `${areas.length} functional area(s)`,
          details: {
            count: areas.length,
            areas: areas.map((a) => ({
              id: a.id,
              name: a.name,
              parentId: a.parentId,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "create") {
        const name = requireParam(
          params.name as string | undefined,
          "name",
          "create",
        );
        const result = (await client.createArea({
          name,
          repositoryId: params.repositoryId as string | undefined,
          parentId: params.parentId as string | undefined,
        })) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "created",
          summary: `Functional area "${name}" created${result.id ? ` (ID: ${result.id})` : ""}`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "update") {
        const functionalAreaId = requireParam(
          params.functionalAreaId as string | undefined,
          "functionalAreaId",
          "update",
        );
        const cleanUpdates: {
          name?: string;
          description?: string;
          parentId?: string | null;
        } = {};
        if (params.name !== undefined)
          cleanUpdates.name = params.name as string;
        if (params.description !== undefined)
          cleanUpdates.description = params.description as string;
        if (params.parentId !== undefined)
          cleanUpdates.parentId = (params.parentId as string) || null;
        const result = (await client.updateArea(
          functionalAreaId,
          cleanUpdates,
        )) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "updated",
          summary: `Functional area ${functionalAreaId} updated (fields: ${Object.keys(cleanUpdates).join(", ")})`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "delete") {
        const functionalAreaId = requireParam(
          params.functionalAreaId as string | undefined,
          "functionalAreaId",
          "delete",
        );
        const result = await client.deleteArea(functionalAreaId);
        const response: ToolResponse = {
          status: "deleted",
          summary: `Functional area ${functionalAreaId} soft-deleted`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'list_tests'
      const functionalAreaId = requireParam(
        params.functionalAreaId as string | undefined,
        "functionalAreaId",
        "list_tests",
      );
      const tests = (await client.listTestsByArea(functionalAreaId)) as Array<
        Record<string, unknown>
      >;
      const passing = tests.filter((t) => t.lastRunStatus === "passed").length;
      const failing = tests.filter((t) => t.lastRunStatus === "failed").length;
      const response: ToolResponse = {
        status: failing > 0 ? "has_failures" : "all_passing",
        summary: `${tests.length} test(s) in area: ${passing} passing, ${failing} failing`,
        details: {
          total: tests.length,
          passing,
          failing,
          tests: tests.map((t) => ({
            id: t.id,
            name: t.name,
            status: t.lastRunStatus ?? "not_run",
          })),
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_test (list, get, update, delete) =====
  // Replaces lastest_list_tests, lastest_list_failing_tests, lastest_get_test, lastest_update_test,
  // lastest_delete_test. (Creation is lastest_create_test; healing is lastest_heal_test — both standalone.)
  const setupStepSchema = z.object({
    stepType: z.enum(["test", "script", "storage_state"]),
    testId: z.string().nullable().optional(),
    scriptId: z.string().nullable().optional(),
    storageStateId: z.string().nullable().optional(),
  });
  const overridesSchema = z.object({
    skippedDefaultStepIds: z.array(z.string()).optional(),
    extraSteps: z.array(setupStepSchema).optional(),
  });
  const playwrightOverridesSchema = z.object({
    browser: z.enum(["chromium", "firefox", "webkit"]).optional(),
    navigationTimeout: z.number().nonnegative().optional(),
    actionTimeout: z.number().nonnegative().optional(),
    screenshotDelay: z.number().nonnegative().optional(),
    networkErrorMode: z.enum(["fail", "warn", "ignore"]).optional(),
    consoleErrorMode: z.enum(["fail", "warn", "ignore"]).optional(),
    acceptAnyCertificate: z.boolean().optional(),
    maxParallelTests: z.number().nonnegative().optional(),
    baseUrl: z.string().optional(),
    cursorPlaybackSpeed: z.number().nonnegative().optional(),
    selectorTimeoutMs: z.number().nonnegative().optional(),
  });
  server.tool(
    "lastest_test",
    'Test resource (read/update/delete). `action`: "list" (all tests in a repo with pass/fail status — needs repositoryId; pass filter:"failing" to return only failing tests with error details), "get" (full details of one test incl. code/URL/last run — needs testId), "update" (name/code/URL/area/setup wiring/runtime overrides — needs testId), "delete" (soft-delete, restorable — needs testId). To create a test use lastest_create_test; to auto-fix a failing test use lastest_heal_test. For update, pass `setupTestId` to point this test at another test for setup, or `setupScriptId` to point at a saved setup script (mutually exclusive). Use `setupOverrides`/`teardownOverrides` to skip default steps or inject extra ones. `playwrightOverrides` self-configures runtime knobs without touching repo settings. Pass `null` for any override block to clear it.',
    {
      action: z
        .enum(["list", "get", "update", "delete"])
        .describe("Test operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe('Repository ID — required for "list"'),
      filter: z
        .enum(["all", "failing"])
        .optional()
        .describe(
          'For "list": "all" (default) lists every test; "failing" returns only currently-failing tests with error details.',
        ),
      testId: z
        .string()
        .optional()
        .describe("Test ID — required for get/update/delete"),
      // update fields
      name: z.string().optional().describe("New test name (update)"),
      code: z
        .string()
        .optional()
        .describe(
          "New Playwright test code (update). Expected signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)`",
        ),
      targetUrl: z.string().optional().describe("New target URL (update)"),
      functionalAreaId: z
        .string()
        .optional()
        .describe("New functional area ID (update)"),
      quarantined: z
        .boolean()
        .optional()
        .describe("Quarantine the test so it runs but does not block builds."),
      executionMode: z
        .enum(["procedural", "agent"])
        .optional()
        .describe("Execution mode"),
      viewportOverride: z
        .object({ width: z.number().positive(), height: z.number().positive() })
        .nullable()
        .optional()
        .describe(
          "Override the recording viewport for this test. Pass null to clear.",
        ),
      playwrightOverrides: playwrightOverridesSchema
        .nullable()
        .optional()
        .describe(
          "Per-test Playwright runtime overrides. Unset fields fall back to the repo playwright settings, then the global defaults. Pass null to clear.",
        ),
      diffOverrides: z
        .record(z.unknown())
        .nullable()
        .optional()
        .describe(
          "Per-test diff overrides (thresholds, anti-aliasing, diff engine, text-region tuning). Pass null to clear.",
        ),
      stabilizationOverrides: z
        .record(z.unknown())
        .nullable()
        .optional()
        .describe(
          "Per-test stabilization overrides (wait strategies, content freezing, etc.). Pass null to clear.",
        ),
      setupTestId: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Use another test as setup (takes precedence over setupScriptId). Pass null/empty to clear.",
        ),
      setupScriptId: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Use a saved setup script as setup. Pass null/empty to clear. Mutually exclusive with setupTestId.",
        ),
      setupOverrides: overridesSchema
        .nullable()
        .optional()
        .describe(
          "Per-test setup override block: `skippedDefaultStepIds` lists default_setup_steps to skip, `extraSteps` lists test/script/storage_state ids to inject after defaults. Pass null to clear.",
        ),
      teardownOverrides: overridesSchema
        .nullable()
        .optional()
        .describe(
          "Same shape as setupOverrides, applied to teardown. Pass null to clear.",
        ),
      apiDefinition: z
        .record(z.unknown())
        .optional()
        .describe(
          "For api-type tests (update): the request + assertion definition { method, url, headers?, query?, body?, auth?, assertions[] }. The code column is re-synced from this automatically.",
        ),
    },
    withActivityReporting(client, "lastest_test", async (params) => {
      const action = params.action as "list" | "get" | "update" | "delete";

      if (action === "list") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "list",
        );
        const filter =
          (params.filter as "all" | "failing" | undefined) ?? "all";
        const tests = (await client.listTests(repositoryId)) as Array<
          Record<string, unknown>
        >;

        if (filter === "failing") {
          const failing = tests.filter((t) => t.lastRunStatus === "failed");
          const response: ToolResponse = {
            status: failing.length > 0 ? "has_failures" : "all_passing",
            summary:
              failing.length > 0
                ? `${failing.length} failing test(s): ${failing.map((t) => t.name).join(", ")}`
                : "All tests are passing",
            actionRequired:
              failing.length > 0
                ? ["Use lastest_heal_test to auto-fix failing tests"]
                : undefined,
            details: {
              failingCount: failing.length,
              tests: failing.map((t) => ({
                id: t.id,
                name: t.name,
                errorMessage: t.lastErrorMessage,
                functionalAreaId: t.functionalAreaId,
              })),
            },
          };
          return {
            content: [
              { type: "text", text: JSON.stringify(response, null, 2) },
            ],
          };
        }

        const passing = tests.filter(
          (t) => t.lastRunStatus === "passed",
        ).length;
        const failing = tests.filter(
          (t) => t.lastRunStatus === "failed",
        ).length;
        const noRuns = tests.filter((t) => !t.lastRunStatus).length;
        const response: ToolResponse = {
          status: failing > 0 ? "has_failures" : "all_passing",
          summary: `${tests.length} tests: ${passing} passing, ${failing} failing, ${noRuns} not yet run`,
          details: {
            total: tests.length,
            passing,
            failing,
            notRun: noRuns,
            tests: tests.map((t) => ({
              id: t.id,
              name: t.name,
              status: t.lastRunStatus ?? "not_run",
              functionalAreaId: t.functionalAreaId,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "get") {
        const testId = requireParam(
          params.testId as string | undefined,
          "testId",
          "get",
        );
        const test = (await client.getTest(testId)) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "ok",
          summary: `Test "${test.name}": ${test.lastRunStatus ?? "not_run"}`,
          details: test,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "update") {
        const testId = requireParam(
          params.testId as string | undefined,
          "testId",
          "update",
        );
        const updateKeys = [
          "name",
          "code",
          "targetUrl",
          "functionalAreaId",
          "quarantined",
          "executionMode",
          "viewportOverride",
          "playwrightOverrides",
          "diffOverrides",
          "stabilizationOverrides",
          "setupTestId",
          "setupScriptId",
          "setupOverrides",
          "teardownOverrides",
          "apiDefinition",
        ] as const;
        const cleanUpdates = Object.fromEntries(
          updateKeys
            .map((k) => [k, params[k]])
            .filter(([, v]) => v !== undefined),
        );
        const result = (await client.updateTest(
          testId,
          cleanUpdates as Parameters<typeof client.updateTest>[1],
        )) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "updated",
          summary: `Test ${testId} updated (fields: ${Object.keys(cleanUpdates).join(", ")})`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'delete'
      const testId = requireParam(
        params.testId as string | undefined,
        "testId",
        "delete",
      );
      const result = await client.deleteTest(testId);
      const response: ToolResponse = {
        status: "deleted",
        summary: `Test ${testId} soft-deleted`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_storage_state (list, create, delete) =====
  // Replaces lastest_list_storage_states, lastest_create_storage_state, lastest_delete_storage_state.
  server.tool(
    "lastest_storage_state",
    'Storage-state resource — saved Playwright `storageState()` blobs (cookies + localStorage). `action`: "list" (metadata only for a repo; raw JSON omitted because it holds live auth tokens — needs repositoryId), "create" (save a new state from a storageState() JSON string — needs repositoryId + name + storageStateJson), "delete" (remove a state — needs storageStateId). Wire a state into a test with lastest_test action:"update" using setupOverrides.extraSteps.',
    {
      action: z
        .enum(["list", "create", "delete"])
        .describe("Storage-state operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe("Repository ID — required for list/create"),
      storageStateId: z
        .string()
        .optional()
        .describe('Storage state ID — required for "delete"'),
      name: z
        .string()
        .optional()
        .describe(
          'Display name (required for create; e.g. "Admin login (staging)")',
        ),
      storageStateJson: z
        .string()
        .optional()
        .describe(
          'Playwright storageState JSON string — `{ "cookies": [...], "origins": [...] }` (required for create). Include `indexedDB` per-origin entries when the source app stores tokens there (Firebase Auth, Clerk, Supabase v2).',
        ),
      authFlavor: z
        .string()
        .optional()
        .describe(
          "Hint at the auth library so future runs pick the right recapture strategy. Suggested values: firebase | supabase | clerk | next-auth | better-auth | cookie | unknown",
        ),
      tokenLocations: z
        .array(z.string())
        .optional()
        .describe(
          "Where the session token lives. Subset of: cookie | localStorage | sessionStorage | indexedDB.",
        ),
      firebaseApiKey: z
        .string()
        .optional()
        .describe(
          "When authFlavor=firebase, the project Web API key (public, not a secret) so the documented PW #35302/#35504 IndexedDB workaround can target the right `firebase:authUser:<apiKey>:[DEFAULT]` record.",
        ),
      expiresAt: z
        .string()
        .optional()
        .describe("Best-effort capture-validity hint (ISO date string)."),
    },
    withActivityReporting(client, "lastest_storage_state", async (params) => {
      const action = params.action as "list" | "create" | "delete";

      if (action === "list") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "list",
        );
        const states = (await client.listStorageStates(repositoryId)) as Array<
          Record<string, unknown>
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `${states.length} storage state(s)`,
          details: {
            count: states.length,
            storageStates: states.map((s) => ({
              id: s.id,
              name: s.name,
              cookieCount: s.cookieCount,
              originCount: s.originCount,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "create") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "create",
        );
        const name = requireParam(
          params.name as string | undefined,
          "name",
          "create",
        );
        const storageStateJson = requireParam(
          params.storageStateJson as string | undefined,
          "storageStateJson",
          "create",
        );
        const result = (await client.createStorageState(repositoryId, {
          name,
          storageStateJson,
          authFlavor: (params.authFlavor as string | undefined) ?? null,
          tokenLocations:
            (params.tokenLocations as string[] | undefined) ?? null,
          firebaseApiKey: (params.firebaseApiKey as string | undefined) ?? null,
          expiresAt: (params.expiresAt as string | undefined) ?? null,
        })) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "created",
          summary: `Storage state "${result.name}" created (ID: ${result.id}, cookies: ${result.cookieCount ?? 0}, origins: ${result.originCount ?? 0}, indexedDB: ${result.includesIndexedDB ? "yes" : "no"})`,
          actionRequired: [
            'Wire it into a test by calling lastest_test action:"update" with setupOverrides.extraSteps = [{ stepType: "storage_state", storageStateId: "<this id>" }]',
          ],
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'delete'
      const storageStateId = requireParam(
        params.storageStateId as string | undefined,
        "storageStateId",
        "delete",
      );
      const result = await client.deleteStorageState(storageStateId);
      const response: ToolResponse = {
        status: "deleted",
        summary: `Storage state ${storageStateId} deleted`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_setup_script (list, get, create, update, delete) =====
  // Replaces the 5 setup-script tools.
  server.tool(
    "lastest_setup_script",
    'Setup-script resource — reusable Playwright/API setup blocks. `action`: "list" (scripts for a repo with id/name/type/code — needs repositoryId), "get" (one script incl. code — needs setupScriptId), "create" (new script — needs repositoryId + name + type + code), "update" (name/type/code/description — needs setupScriptId), "delete" (remove; 409 if a test still references it — needs setupScriptId). Attach a script to a test via lastest_test action:"update" with setupScriptId.',
    {
      action: z
        .enum(["list", "get", "create", "update", "delete"])
        .describe("Setup-script operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe("Repository ID — required for list/create"),
      setupScriptId: z
        .string()
        .optional()
        .describe("Setup script ID — required for get/update/delete"),
      name: z
        .string()
        .optional()
        .describe("Script name (required for create; optional for update)"),
      type: z
        .enum(["playwright", "api"])
        .optional()
        .describe(
          "Script type: `playwright` (async fn with page+context) or `api` (HTTP seeding). Required for create.",
        ),
      code: z
        .string()
        .optional()
        .describe(
          "Script source code (required for create; optional for update)",
        ),
      description: z.string().optional().describe("Optional description"),
    },
    withActivityReporting(client, "lastest_setup_script", async (params) => {
      const action = params.action as
        | "list"
        | "get"
        | "create"
        | "update"
        | "delete";

      if (action === "list") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "list",
        );
        const scripts = (await client.listSetupScripts(repositoryId)) as Array<
          Record<string, unknown>
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `${scripts.length} setup script(s)`,
          details: {
            count: scripts.length,
            setupScripts: scripts.map((s) => ({
              id: s.id,
              name: s.name,
              type: s.type,
              description: s.description,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "get") {
        const setupScriptId = requireParam(
          params.setupScriptId as string | undefined,
          "setupScriptId",
          "get",
        );
        const script = (await client.getSetupScript(setupScriptId)) as Record<
          string,
          unknown
        >;
        const response: ToolResponse = {
          status: "ok",
          summary: `Setup script: ${script.name}`,
          details: script,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "create") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "create",
        );
        const name = requireParam(
          params.name as string | undefined,
          "name",
          "create",
        );
        const type = requireParam(
          params.type as "playwright" | "api" | undefined,
          "type",
          "create",
        );
        const code = requireParam(
          params.code as string | undefined,
          "code",
          "create",
        );
        const result = (await client.createSetupScript(repositoryId, {
          name,
          type,
          code,
          description: params.description as string | undefined,
        })) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "created",
          summary: `Setup script "${result.name}" created (ID: ${result.id}, type: ${result.type})`,
          actionRequired: [
            'Attach to a test with lastest_test action:"update" setting setupScriptId to this ID',
          ],
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "update") {
        const setupScriptId = requireParam(
          params.setupScriptId as string | undefined,
          "setupScriptId",
          "update",
        );
        const cleanUpdates = Object.fromEntries(
          (["name", "type", "code", "description"] as const)
            .map((k) => [k, params[k]])
            .filter(([, v]) => v !== undefined),
        );
        const result = (await client.updateSetupScript(
          setupScriptId,
          cleanUpdates as Parameters<typeof client.updateSetupScript>[1],
        )) as Record<string, unknown>;
        const response: ToolResponse = {
          status: "updated",
          summary: `Setup script ${setupScriptId} updated (fields: ${Object.keys(cleanUpdates).join(", ")})`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'delete'
      const setupScriptId = requireParam(
        params.setupScriptId as string | undefined,
        "setupScriptId",
        "delete",
      );
      const result = await client.deleteSetupScript(setupScriptId);
      const response: ToolResponse = {
        status: "deleted",
        summary: `Setup script ${setupScriptId} deleted`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_get_diffs (scope: single | build) =====
  // Replaces lastest_get_diff, lastest_get_visual_diff.
  server.tool(
    "lastest_get_diffs",
    'Read visual diffs. `scope`: "single" (full details of one visual diff incl. pixel data, AI analysis, test info — needs diffId), "build" (all visual diffs for a build with AI classification/confidence + aiAnalysis commentary — needs buildId). For "build", pass `full: true` only if you also need the heavy joined payloads.',
    {
      scope: z
        .enum(["single", "build"])
        .describe(
          '"single" = one diff by diffId; "build" = all diffs for a buildId',
        ),
      diffId: z
        .string()
        .optional()
        .describe('Visual diff ID — required when scope is "single"'),
      buildId: z
        .string()
        .optional()
        .describe('Build ID — required when scope is "build"'),
      full: z
        .boolean()
        .optional()
        .describe(
          'Reserved for "build" scope; the build fetch always uses the full payload so aiAnalysis is available.',
        ),
    },
    async (
      params,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const scope = params.scope as "single" | "build";

      if (scope === "single") {
        const diffId = requireParam(
          params.diffId as string | undefined,
          "diffId",
          "single",
        );
        const diff = (await client.getDiff(diffId)) as Record<string, unknown>;
        const response: ToolResponse = {
          status: diff.status as string,
          summary: `Diff ${diffId}: ${diff.status} (${diff.percentageDifference ?? 0}% changed)`,
          details: diff,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // scope === 'build'
      const buildId = requireParam(
        params.buildId as string | undefined,
        "buildId",
        "build",
      );
      // This surfaces aiAnalysis (LLM commentary on each diff) which is
      // stripped from the slim build payload — fetch full so it's available.
      const build = (await client.getBuild(buildId, { full: true })) as Record<
        string,
        unknown
      >;
      const diffs = (build.diffs ?? []) as Array<Record<string, unknown>>;

      const pending = diffs.filter((d) => d.status === "pending");
      const approved = diffs.filter((d) => d.status === "approved");
      const rejected = diffs.filter((d) => d.status === "rejected");

      const actionRequired: string[] = [];
      if (pending.length > 0) {
        actionRequired.push(
          `${pending.length} diff(s) need review. Use lastest_decide_diff with action:"approve" or "reject" and diffIds: [${pending.map((d) => `"${d.id}"`).join(", ")}]`,
        );
      }

      const response: ToolResponse = {
        status: pending.length > 0 ? "needs_review" : "all_reviewed",
        summary: `${diffs.length} visual diff(s): ${approved.length} approved, ${rejected.length} rejected, ${pending.length} pending review`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: {
          total: diffs.length,
          pendingCount: pending.length,
          approvedCount: approved.length,
          rejectedCount: rejected.length,
          diffs: diffs.map((d) => ({
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
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    },
  );

  // ===== lastest_decide_diff (approve | reject) =====
  // Replaces lastest_approve_diff, lastest_reject_diff, lastest_approve_all_diffs,
  // lastest_approve_baseline, lastest_reject_baseline.
  server.tool(
    "lastest_decide_diff",
    'Approve or reject visual diffs (updates baselines / marks regressions). `action`: "approve" or "reject". Provide either `diffIds` (a batch of one or more diff IDs to approve/reject) OR, for action:"approve", a `buildId` to approve ALL pending diffs in that build at once. Exactly one of diffIds / buildId is required.',
    {
      action: z
        .enum(["approve", "reject"])
        .describe(
          '"approve" accepts the current screenshots as new baselines; "reject" marks them as regressions',
        ),
      diffIds: z
        .array(z.string())
        .optional()
        .describe(
          "Visual diff IDs to approve/reject (batch). Mutually exclusive with buildId.",
        ),
      buildId: z
        .string()
        .optional()
        .describe(
          'Build ID — approve ALL pending diffs in this build (only valid with action:"approve").',
        ),
    },
    withActivityReporting(client, "lastest_decide_diff", async (params) => {
      const action = params.action as "approve" | "reject";
      const diffIds = params.diffIds as string[] | undefined;
      const buildId = params.buildId as string | undefined;

      if (!diffIds?.length && !buildId) {
        throw new Error(
          "Provide either 'diffIds' (batch) or 'buildId' (approve all in build).",
        );
      }
      if (diffIds?.length && buildId) {
        throw new Error(
          "Provide only one of 'diffIds' or 'buildId', not both.",
        );
      }

      if (buildId) {
        if (action !== "approve") {
          throw new Error(
            "buildId is only valid with action:'approve' (approve all diffs in the build).",
          );
        }
        const result = await client.approveAllDiffs(buildId);
        const response: ToolResponse = {
          status: "approved",
          summary: `All diffs in build ${buildId} approved.`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // diffIds batch
      if (action === "approve") {
        const result = await client.approveDiffs(diffIds as string[]);
        const response: ToolResponse = {
          status: "approved",
          summary: `Approved ${result.approvedCount} visual diff(s). Baselines updated.`,
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      const result = await client.rejectDiffs(diffIds as string[]);
      const response: ToolResponse = {
        status: "rejected",
        summary: `Rejected ${result.rejectedCount} visual diff(s). Build may be blocked.`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_build (list, get, review) =====
  // Replaces lastest_list_builds, lastest_get_build_status, lastest_review_build.
  // (lastest_get_test_run is dropped — build "get" covers it.)
  server.tool(
    "lastest_build",
    'Build resource. `action`: "list" (recent builds for a repo with status/test counts — needs repositoryId; optional limit), "get" (current status & results of a build; slim diff index by default — needs buildId; pass includeDiffs:"full" for joined a11y/network/AI payloads), "review" (comprehensive QA review: build details + visual diffs + failed tests into a structured summary with action items — needs buildId).',
    {
      action: z
        .enum(["list", "get", "review"])
        .describe("Build operation to perform"),
      repositoryId: z
        .string()
        .optional()
        .describe('Repository ID — required for "list"'),
      buildId: z
        .string()
        .optional()
        .describe("Build ID — required for get/review"),
      limit: z
        .number()
        .optional()
        .describe(
          'For "list": number of builds to return (default 10, max 100)',
        ),
      includeDiffs: z
        .enum(["slim", "full"])
        .optional()
        .describe(
          'For "get": "slim" (default) returns only id/testId/stepLabel/status/classification/pct per diff. "full" returns every joined column (heavy — can be 100KB+).',
        ),
    },
    async (
      params,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const action = params.action as "list" | "get" | "review";

      if (action === "list") {
        const repositoryId = requireParam(
          params.repositoryId as string | undefined,
          "repositoryId",
          "list",
        );
        const builds = (await client.listBuilds(
          repositoryId,
          params.limit as number | undefined,
        )) as Array<Record<string, unknown>>;
        const response: ToolResponse = {
          status: "ok",
          summary: `${builds.length} build(s) for repository`,
          details: {
            count: builds.length,
            builds: builds.map((b) => ({
              id: b.id,
              status: b.overallStatus,
              createdAt: b.createdAt,
              totalTests: b.totalTests,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      if (action === "get") {
        const buildId = requireParam(
          params.buildId as string | undefined,
          "buildId",
          "get",
        );
        const includeDiffs =
          (params.includeDiffs as string | undefined) ?? "slim";
        // Slim is the default. The API now slims server-side too so the wire
        // payload stays small unless `full` is explicitly requested.
        const build = (await client.getBuild(buildId, {
          full: includeDiffs === "full",
        })) as Record<string, unknown>;

        const status = build.overallStatus as string;
        const passed = build.passedCount as number;
        const failed = build.failedCount as number;
        const total = build.totalTests as number;
        const changes = build.changesDetected as number;
        const flaky = build.flakyCount as number;

        const actionRequired: string[] = [];
        if (status === "review_required") {
          actionRequired.push(
            `Review ${changes} visual change(s) — use lastest_get_diffs scope:"build" to inspect`,
          );
        }
        if (status === "blocked") {
          actionRequired.push(
            "Build is blocked — review failed tests and rejected diffs",
          );
        }
        if (failed > 0) {
          actionRequired.push(
            `${failed} test(s) failed — use lastest_test action:"list" filter:"failing" to see details`,
          );
        }

        // Slim the response by default. The REST API joins a11yViolations,
        // consoleErrors, networkRequests, aiAnalysis, and diff metadata onto
        // every diff — for builds with N diffs that can easily clear 100KB and
        // saturate an agent's context. Most callers only need the diff index;
        // they fetch heavy payloads per-diff via lastest_get_diffs.
        const rawDiffs = Array.isArray(build.diffs)
          ? (build.diffs as Array<Record<string, unknown>>)
          : [];
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
          includeDiffs === "full"
            ? { ...buildScalars, diffs: rawDiffs }
            : {
                ...buildScalars,
                diffs: slimDiffs,
                diffsTrimmed: true,
                diffsCount: rawDiffs.length,
              };

        const response: ToolResponse = {
          status,
          summary: `Build ${buildId}: ${passed}/${total} passed, ${failed} failed, ${changes} visual changes, ${flaky} flaky. Status: ${status}`,
          actionRequired:
            actionRequired.length > 0 ? actionRequired : undefined,
          details,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'review'
      const buildId = requireParam(
        params.buildId as string | undefined,
        "buildId",
        "review",
      );
      const build = (await client.getBuild(buildId)) as Record<string, unknown>;
      const diffs = (build.diffs ?? []) as Array<Record<string, unknown>>;

      const pending = diffs.filter((d) => d.status === "pending");
      const approved = diffs.filter((d) => d.status === "approved");
      const rejected = diffs.filter((d) => d.status === "rejected");
      const changed = diffs.filter(
        (d) =>
          d.classification === "changed" ||
          (d.percentageDifference as number) > 0,
      );

      const status = build.overallStatus as string;
      const passed = (build.passedCount as number) ?? 0;
      const failed = (build.failedCount as number) ?? 0;
      const total = (build.totalTests as number) ?? 0;

      const executorError = build.executorError as string | null | undefined;
      const executorFailedAt = build.executorFailedAt as
        | string
        | Date
        | null
        | undefined;

      const actionRequired: string[] = [];
      if (status === "executor_failed") {
        actionRequired.push(
          `Executor crashed before any test ran — inspect executorError and runner/EB pod logs (build won't recover by retry)`,
        );
      }
      if (pending.length > 0) {
        actionRequired.push(
          `Review ${pending.length} pending diff(s) — use lastest_get_diffs (scope:"single") then lastest_decide_diff`,
        );
      }
      if (failed > 0) {
        actionRequired.push(
          `${failed} test(s) failed — use lastest_test action:"list" filter:"failing" or lastest_heal_test`,
        );
      }

      const response: ToolResponse = {
        status,
        summary:
          status === "executor_failed"
            ? `Build ${buildId}: EXECUTOR FAILED. ${passed}/${total} tests ran (executor crashed before completion). ${executorError ? executorError.split("\n")[0] : ""}`
            : `Build ${buildId}: ${status}. ${passed}/${total} passed. ${diffs.length} diffs (${pending.length} pending, ${approved.length} approved, ${rejected.length} rejected).`,
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
            pendingDiffs: pending.map((d) => ({
              id: d.id,
              testName: d.testName,
              classification: d.classification,
              percentageDifference: d.percentageDifference,
              aiRecommendation: d.aiRecommendation,
            })),
          },
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // ===== lastest_share (list, revoke) =====
  // Replaces lastest_list_build_shares, lastest_list_test_shares, lastest_revoke_share.
  // (Publishing stays as lastest_publish_share.)
  server.tool(
    "lastest_share",
    'Manage existing public shares (publishing is lastest_publish_share). `action`: "list" (shares anchored on a build — needs buildId — or on a test — needs testId; includes revoked ones, check `status`), "revoke" (kill a share by its share ID so the /r/<slug> URL stops resolving — needs shareId; find share IDs via a "list" call).',
    {
      action: z
        .enum(["list", "revoke"])
        .describe('"list" shares for a build or test; "revoke" a share by ID'),
      buildId: z
        .string()
        .optional()
        .describe('Build ID — for "list" of build shares'),
      testId: z
        .string()
        .optional()
        .describe('Test ID — for "list" of test shares'),
      shareId: z
        .string()
        .optional()
        .describe(
          'Share ID to revoke (NOT the slug — use "list" to find it). Required for "revoke".',
        ),
    },
    withActivityReporting(client, "lastest_share", async (params) => {
      const action = params.action as "list" | "revoke";

      if (action === "list") {
        const buildId = params.buildId as string | undefined;
        const testId = params.testId as string | undefined;
        if (!buildId && !testId) {
          throw new Error(
            "Provide either 'buildId' or 'testId' to list shares.",
          );
        }
        if (buildId) {
          const shares = (await client.listBuildShares(buildId)) as Array<
            Record<string, unknown>
          >;
          const active = shares.filter((s) => s.status === "public");
          const response: ToolResponse = {
            status: "ok",
            summary: `${shares.length} share(s) for build ${buildId} (${active.length} active)`,
            details: {
              count: shares.length,
              shares: shares.map((s) => ({
                id: s.id,
                slug: s.slug,
                status: s.status,
                testId: s.testId,
                createdAt: s.createdAt,
              })),
            },
          };
          return {
            content: [
              { type: "text", text: JSON.stringify(response, null, 2) },
            ],
          };
        }
        const shares = (await client.listTestShares(testId as string)) as Array<
          Record<string, unknown>
        >;
        const active = shares.filter((s) => s.status === "public");
        const response: ToolResponse = {
          status: "ok",
          summary: `${shares.length} share(s) for test ${testId} (${active.length} active)`,
          details: {
            count: shares.length,
            shares: shares.map((s) => ({
              id: s.id,
              slug: s.slug,
              status: s.status,
              buildId: s.buildId,
              createdAt: s.createdAt,
            })),
          },
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'revoke'
      const shareId = requireParam(
        params.shareId as string | undefined,
        "shareId",
        "revoke",
      );
      const result = await client.revokeShare(shareId);
      const response: ToolResponse = {
        status: "revoked",
        summary: `Share ${shareId} revoked. The /r/<slug> URL is now dead.`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_verify (view, change_map) =====
  // Replaces lastest_verify_build, lastest_get_change_map.
  server.tool(
    "lastest_verify",
    'Verify-phase reads for a build (needs buildId). `action`: "view" (full verify-build view — Change Map + step comparisons grouped by regression vs intent gate, plus `visualUrlsByDiffId` clickable /api/media URLs and `testsByTestId` source/setup hints), "change_map" (just the build-level Change Map — 4-signal area ranking + AI intent/risk summary).',
    {
      action: z
        .enum(["view", "change_map"])
        .describe(
          '"view" = full verify view; "change_map" = build-level Change Map only',
        ),
      buildId: z.string().describe("Build ID"),
    },
    withActivityReporting(client, "lastest_verify", async (params) => {
      const action = params.action as "view" | "change_map";
      const buildId = params.buildId as string;
      if (action === "change_map") {
        const result = await client.getChangeMap(buildId);
        const response: ToolResponse = {
          status: "ok",
          summary: "Change Map retrieved.",
          details: result as Record<string, unknown>,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }
      // action === 'view'
      const result = await client.verifyBuild(buildId);
      const response: ToolResponse = {
        status: "ok",
        summary: "Verify view retrieved.",
        details: result as Record<string, unknown>,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== lastest_insights (coverage, qa) =====
  // Replaces lastest_get_coverage, lastest_qa_summary.
  server.tool(
    "lastest_insights",
    'Repository-level insights (needs repositoryId). `action`: "coverage" (test coverage statistics by functional area and route), "qa" (comprehensive QA overview: test health, recent builds, and action items).',
    {
      action: z
        .enum(["coverage", "qa"])
        .describe('"coverage" = coverage stats; "qa" = QA health summary'),
      repositoryId: z.string().describe("Repository ID"),
    },
    async (
      params,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const action = params.action as "coverage" | "qa";
      const repositoryId = params.repositoryId as string;

      if (action === "coverage") {
        const coverage = (await client.getCoverage(repositoryId)) as Record<
          string,
          unknown
        >;

        const routeCoverage = coverage.routeCoverage as
          | Record<string, unknown>
          | undefined;
        const areaCoverage = coverage.areaCoverage as
          | Record<string, unknown>
          | undefined;

        const routePct = routeCoverage?.percentage as number | undefined;
        const areaTotal = areaCoverage?.total as number | undefined;
        const areaTested = areaCoverage?.tested as number | undefined;

        const response: ToolResponse = {
          status: "coverage_retrieved",
          summary: `Route coverage: ${routePct ?? "N/A"}%. Areas: ${areaTested ?? "?"}/${areaTotal ?? "?"} have tests.`,
          actionRequired:
            routePct !== undefined && routePct < 80
              ? [
                  "Coverage is below 80% — consider generating tests for uncovered routes with lastest_create_test",
                ]
              : undefined,
          details: coverage,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // action === 'qa'
      const [tests, builds] = await Promise.all([
        client.listTests(repositoryId) as Promise<
          Array<Record<string, unknown>>
        >,
        client.listBuilds(repositoryId, 5) as Promise<
          Array<Record<string, unknown>>
        >,
      ]);

      const passing = tests.filter((t) => t.lastRunStatus === "passed").length;
      const failing = tests.filter((t) => t.lastRunStatus === "failed").length;
      const neverRun = tests.filter((t) => !t.lastRunStatus).length;
      const passRate =
        tests.length > 0 ? Math.round((passing / tests.length) * 100) : 0;

      const buildsNeedingReview = builds.filter(
        (b) => b.overallStatus === "review_required",
      );

      const actionRequired: string[] = [];
      if (failing > 0) {
        actionRequired.push(
          `${failing} test(s) currently failing — use lastest_test action:"list" filter:"failing"`,
        );
      }
      if (buildsNeedingReview.length > 0) {
        actionRequired.push(
          `${buildsNeedingReview.length} build(s) need review — use lastest_build action:"review"`,
        );
      }
      if (neverRun > 0) {
        actionRequired.push(
          `${neverRun} test(s) never run — use lastest_run_tests`,
        );
      }

      const response: ToolResponse = {
        status:
          failing > 0 || buildsNeedingReview.length > 0
            ? "action_required"
            : "healthy",
        summary: `QA Summary: ${tests.length} tests (${passRate}% pass rate), ${builds.length} recent builds, ${buildsNeedingReview.length} needing review`,
        actionRequired: actionRequired.length > 0 ? actionRequired : undefined,
        details: {
          testHealth: {
            total: tests.length,
            passing,
            failing,
            neverRun,
            passRate,
          },
          recentBuilds: builds.map((b) => ({
            id: b.id,
            status: b.overallStatus,
            createdAt: b.createdAt,
          })),
          buildsNeedingReview: buildsNeedingReview.map((b) => b.id),
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // ===== lastest_qa_agent (ongoing QA agent: status, runs, direction queue) =====
  server.tool(
    "lastest_qa_agent",
    'Drive the ongoing QA agent for a repository (needs repositoryId). `action`: "status" (live session, latest coverage summary, task board, trigger config), "start_run" (start an autonomous run — optional mode full|refresh_spec|fill_gaps and targetUrl; 409 when a session is already running), "run_status" (poll a session by sessionId), "add_task" (queue a directive on the agent\'s task board — it picks tasks up when idle, works them with the right protocol, and replies on the card), "list_tasks" (the task board).',
    {
      action: z
        .enum(["status", "start_run", "run_status", "add_task", "list_tasks"])
        .describe(
          '"status" = agent overview; "start_run" = start a run; "run_status" = poll a run; "add_task" = queue a directive; "list_tasks" = task board',
        ),
      repositoryId: z
        .string()
        .optional()
        .describe("Repository ID (required for all actions except run_status)"),
      sessionId: z
        .string()
        .optional()
        .describe("QA session ID (run_status only)"),
      mode: z
        .enum(["full", "refresh_spec", "fill_gaps"])
        .optional()
        .describe(
          "start_run only. Omit to let the agent pick (fill_gaps when a stored plan exists, else full).",
        ),
      targetUrl: z
        .string()
        .optional()
        .describe(
          "start_run only. Override the target app URL (defaults to the last run's URL or the repo's env base URL).",
        ),
      title: z
        .string()
        .optional()
        .describe(
          'add_task only. The directive, e.g. "Cover the billing flow".',
        ),
      description: z
        .string()
        .optional()
        .describe("add_task only. Extra context for the agent."),
    },
    async (
      params,
    ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const action = params.action as
        | "status"
        | "start_run"
        | "run_status"
        | "add_task"
        | "list_tasks";
      const repositoryId = params.repositoryId as string | undefined;

      const respond = (response: ToolResponse) => ({
        content: [
          { type: "text" as const, text: JSON.stringify(response, null, 2) },
        ],
      });
      const needRepo = () =>
        respond({
          status: "error",
          summary: "repositoryId is required for this action",
          details: {},
        });

      if (action === "run_status") {
        if (!params.sessionId) {
          return respond({
            status: "error",
            summary: "sessionId is required for run_status",
            details: {},
          });
        }
        const session = (await client.getQaSession(
          params.sessionId as string,
        )) as Record<string, unknown>;
        return respond({
          status: `run_${session.status}`,
          summary: `QA session ${session.id}: ${session.status} (step: ${session.currentStepId ?? "?"})`,
          details: session,
        });
      }

      if (!repositoryId) return needRepo();

      if (action === "status") {
        const status = (await client.getQaAgentStatus(repositoryId)) as Record<
          string,
          unknown
        >;
        const live = status.liveSession as Record<string, unknown> | null;
        const tasks = (status.tasks ?? []) as Array<Record<string, unknown>>;
        const queued = tasks.filter((t) => t.status === "queued").length;
        return respond({
          status: live ? "agent_working" : "agent_idle",
          summary: live
            ? `QA agent is ${live.status} (step: ${live.currentStepId ?? "?"}) on ${live.targetUrl ?? "?"}`
            : `QA agent is idle. ${queued} task(s) queued.`,
          details: status,
        });
      }

      if (action === "start_run") {
        // The v1 API answers 409 when a session is already running (the
        // client surfaces non-2xx as a thrown error) — convert that into a
        // "queue a task instead" hint rather than a hard failure.
        try {
          const result = (await client.startQaAgentRun(repositoryId, {
            mode: params.mode as string | undefined,
            targetUrl: params.targetUrl as string | undefined,
          })) as Record<string, unknown>;
          return respond({
            status: "run_started",
            summary: `QA agent run started (session ${result.sessionId}). Poll with action:"run_status".`,
            details: result,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return respond({
            status: "not_started",
            summary: `Could not start: ${message}`,
            actionRequired: [
              'Queue the work with action:"add_task" instead — the agent picks tasks up as soon as it is idle.',
            ],
            details: { error: message },
          });
        }
      }

      if (action === "add_task") {
        if (!params.title || !(params.title as string).trim()) {
          return respond({
            status: "error",
            summary: "title is required for add_task",
            details: {},
          });
        }
        const task = (await client.addQaTask(repositoryId, {
          title: params.title as string,
          description: params.description as string | undefined,
        })) as Record<string, unknown>;
        return respond({
          status: "task_queued",
          summary: `Task "${task.title}" queued for the QA agent. It will pick it up when idle and reply on the card; check with action:"list_tasks".`,
          details: task,
        });
      }

      // action === 'list_tasks'
      const tasks = (await client.listQaTasks(repositoryId)) as Array<
        Record<string, unknown>
      >;
      const byStatus = (s: string) => tasks.filter((t) => t.status === s);
      return respond({
        status: "tasks_listed",
        summary: `${byStatus("queued").length} queued · ${byStatus("working").length} working · ${byStatus("needs_input").length} waiting on a human · ${byStatus("done").length} done`,
        details: { tasks },
      });
    },
  );

  // ===== Workflow verbs (standalone, unchanged) =====

  // --- lastest_run_tests ---
  server.tool(
    "lastest_run_tests",
    "Trigger a test build and return structured results. Can run all tests in a repo, all tests inside one functional area, or specific test IDs. Pass `forceVideoRecording: true` when you intend to publish a share that should include the video player (the share page renders the embedded clip only when the build has video).",
    {
      repositoryId: z
        .string()
        .optional()
        .describe(
          "Repository ID to run tests for. If omitted, uses the default repo.",
        ),
      testIds: z
        .array(z.string())
        .optional()
        .describe(
          "Specific test IDs to run. Takes precedence over functionalAreaId.",
        ),
      functionalAreaId: z
        .string()
        .optional()
        .describe(
          "Run every test inside this functional area (ignored if testIds is set).",
        ),
      gitBranch: z.string().optional().describe("Git branch override"),
      forceVideoRecording: z
        .boolean()
        .optional()
        .describe(
          "Force-enable per-test video recording for this build. Required for demo-style shares that should render the video player. Disabled by default to keep build storage small.",
        ),
    },
    withActivityReporting(client, "lastest_run_tests", async (params) => {
      const result = await client.createBuild({
        repositoryId: params.repositoryId as string | undefined,
        testIds: params.testIds as string[] | undefined,
        functionalAreaId: params.functionalAreaId as string | undefined,
        gitBranch: params.gitBranch as string | undefined,
        forceVideoRecording: params.forceVideoRecording as boolean | undefined,
        triggerType: "manual",
      });

      const response: ToolResponse = {
        status: "build_started",
        summary: `Build started: ${result.testCount} test(s) queued. Build ID: ${result.buildId}`,
        actionRequired: [
          `Poll build status with lastest_build action:"get" using buildId: ${result.buildId}`,
        ],
        details: result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_validate_diff ---
  server.tool(
    "lastest_validate_diff",
    "Diff-scoped validation in one call: pass a git diff (or a base/head branch range for GitHub repos) and Lastest maps the changed files to the affected tests, runs ONLY those, and returns a pass/fail/review verdict with the failing tests and pending visual changes. Use this in a coding-agent loop right after making a change to confirm nothing relevant broke, without running the whole suite. Blocks until the scoped build finishes by default; pass `wait: false` to get a buildId to poll instead.",
    {
      repositoryId: z.string().describe("Repository ID to validate against"),
      diff: z
        .string()
        .optional()
        .describe(
          "Unified git diff text. Changed file paths are extracted from the headers. Required for local (non-GitHub) repos.",
        ),
      baseBranch: z
        .string()
        .optional()
        .describe(
          "Base branch for GitHub compare mode (used when no diff text is given).",
        ),
      headBranch: z
        .string()
        .optional()
        .describe("Head branch for GitHub compare mode."),
      wait: z
        .boolean()
        .optional()
        .describe(
          'Default true: block until the scoped build finishes and return the verdict. false → return buildId to poll with lastest_build action:"get".',
        ),
      maxWaitMs: z
        .number()
        .optional()
        .describe("Cap on blocking time when wait is true (default 300000)."),
    },
    withActivityReporting(client, "lastest_validate_diff", async (params) => {
      const result = await client.validateDiff({
        repositoryId: params.repositoryId as string,
        diff: params.diff as string | undefined,
        baseBranch: params.baseBranch as string | undefined,
        headBranch: params.headBranch as string | undefined,
        wait: params.wait as boolean | undefined,
        maxWaitMs: params.maxWaitMs as number | undefined,
      });
      const status = result.status as string;
      const actionRequired: string[] = [];
      if (status === "fail") {
        actionRequired.push(
          "Affected tests failed — inspect failingTests, then use lastest_suggest_app_fix or lastest_heal_test.",
        );
      } else if (status === "review_required") {
        actionRequired.push(
          'Visual/behavioral changes need review — use lastest_get_diffs scope:"build" then lastest_decide_diff.',
        );
      } else if (status === "build_running") {
        actionRequired.push(
          `Poll lastest_build action:"get" with buildId ${result.buildId}.`,
        );
      } else if (status === "no_affected_tests") {
        actionRequired.push(
          "No tests mapped to the change. Run the full suite with lastest_run_tests if the change is high-risk.",
        );
      }
      const response: ToolResponse = {
        status,
        summary: result.summary as string,
        actionRequired: actionRequired.length ? actionRequired : undefined,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_scout_url ---
  server.tool(
    "lastest_scout_url",
    "Static (no-browser) scout of a URL: returns title, headings, forms, inputs, links, and candidate selectors to help you author a test. Best-effort — SPA/JS-rendered content won't appear, so prefer your own Playwright MCP for live pages and use this only as a fallback or quick map.",
    {
      url: z.string().describe("Absolute URL to scout (http/https)"),
    },
    withActivityReporting(client, "lastest_scout_url", async (params) => {
      const scout = (await client.scoutUrl(params.url as string)) as Record<
        string,
        unknown
      >;
      const response: ToolResponse = {
        status: "scouted",
        summary: `Scouted ${params.url} (static HTML). Use these selectors as a starting point and verify dynamic content with Playwright MCP if you can.`,
        actionRequired: [
          "Write the test against lastest://authoring-guide; verify selectors on the live page where possible.",
        ],
        details: scout,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_ranger ---
  server.tool(
    "lastest_ranger",
    "Start a 'ranger' — an Embedded Browser that navigates a URL live and returns a rendered (SPA-aware) page map: headings, landmarks, forms, inputs, buttons, links, test-ids, and candidate selectors. Unlike lastest_scout_url (static, instant), ranger drives a real browser and is WATCHABLE in the Lastest activity feed via a live stream. Async: returns a sessionId immediately — poll lastest_ranger_status for the live streamUrl and the final page map. Prefer your own Playwright MCP if you have one; use ranger when you don't, or want a watchable run on a JS-rendered page.",
    {
      repositoryId: z.string().describe("Repository ID (sets the default URL)"),
      url: z
        .string()
        .optional()
        .describe("URL to browse (defaults to the repo base URL)"),
      viewport: z
        .object({ width: z.number(), height: z.number() })
        .optional()
        .describe("Optional viewport size"),
    },
    withActivityReporting(client, "lastest_ranger", async (params) => {
      const { sessionId } = await client.startRanger(
        params.repositoryId as string,
        {
          url: params.url as string | undefined,
          viewport: params.viewport as
            | { width: number; height: number }
            | undefined,
        },
      );
      const response: ToolResponse = {
        status: "ranger_started",
        summary: `Ranger session ${sessionId} started. It is browsing in an Embedded Browser — watch it live in the Lastest activity feed.`,
        actionRequired: [
          `Poll lastest_ranger_status with sessionId "${sessionId}" until status is "completed", then read details.metadata.pageMap.`,
        ],
        details: { sessionId },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_ranger_status ---
  server.tool(
    "lastest_ranger_status",
    "Poll a ranger session: returns its status, the live stream URL (watchable while it runs), and — once completed — the rendered page map to author tests from.",
    {
      sessionId: z.string().describe("Ranger session ID from lastest_ranger"),
    },
    withActivityReporting(client, "lastest_ranger_status", async (params) => {
      const s = await client.getRangerStatus(params.sessionId as string);
      const done = s.status === "completed";
      const response: ToolResponse = {
        status: s.status,
        summary: done
          ? `Ranger complete for ${s.metadata.rangerUrl ?? "the URL"} — page map ready.`
          : s.metadata.queuedForBrowser
            ? "Waiting for an Embedded Browser to become available…"
            : `Ranger ${s.status} (step: ${s.currentStepId ?? "—"}).`,
        actionRequired: done
          ? [
              "Use details.metadata.pageMap to write the test, then lastest_create_test (direct mode).",
            ]
          : s.status === "failed" || s.status === "cancelled"
            ? [
                "Ranger did not finish; fall back to lastest_scout_url or your own Playwright MCP.",
              ]
            : ["Poll again in a few seconds."],
        details: s as unknown as Record<string, unknown>,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_create_test ---
  server.tool(
    "lastest_create_test",
    'Create a test. **Preferred (MCP-first): DIRECT browser mode** — YOU write the Playwright code and pass { name, code }. First read the resource lastest://repo/{repositoryId}/authoring-guide for the exact runner contract + this repo\'s base URL, areas, and setup; discover selectors with your Playwright MCP (or lastest_scout_url). The `author-test` prompt walks the whole flow. Other modes: **AI browser** ({ url } and/or { prompt }) has the Lastest AI generate the test server-side (only if in-product AI is configured there — else fall back to direct). **direct API** (E1) — { name, testType:"api", apiDefinition } inserts a headless HTTP test (method/url/headers/body + assertions, runs without a browser). **AI API** (E1) — { testType:"api", prompt } (and optionally endpoint/openapiSpec) has the AI generate an API test. Direct modes return immediately; AI modes may take longer.',
    {
      repositoryId: z.string().describe("Repository ID to create the test in"),
      name: z
        .string()
        .optional()
        .describe("Test name (required for direct modes)"),
      code: z
        .string()
        .optional()
        .describe(
          "Playwright test code (required for direct browser mode). Expected signature: `export async function test(page, baseUrl, screenshotPath, stepLogger)`",
        ),
      url: z
        .string()
        .optional()
        .describe("URL to generate a test for (AI browser mode)"),
      prompt: z
        .string()
        .optional()
        .describe("Natural language description of what to test (AI modes)"),
      functionalAreaId: z
        .string()
        .optional()
        .describe("Functional area to assign the test to"),
      targetUrl: z
        .string()
        .optional()
        .describe("Target URL for the test (direct browser mode)"),
      description: z
        .string()
        .optional()
        .describe("Test description (direct browser mode)"),
      testType: z
        .enum(["browser", "api"])
        .optional()
        .describe(
          '"api" creates a headless HTTP test (E1). Defaults to browser.',
        ),
      apiDefinition: z
        .record(z.any())
        .optional()
        .describe(
          "API test definition for direct API mode: { method, url, headers?, query?, body?, auth?, assertions: [...] }. Assertion kinds: status|header|jsonPath|jsonSchema|bodyContains|latencyMs.",
        ),
      endpoint: z
        .string()
        .optional()
        .describe(
          'Focus endpoint for AI API generation, e.g. "POST /api/users".',
        ),
      openapiSpec: z
        .string()
        .optional()
        .describe("Raw OpenAPI/Swagger JSON to ground AI API generation."),
    },
    withActivityReporting(client, "lastest_create_test", async (params) => {
      const repositoryId = params.repositoryId as string;
      const name = params.name as string | undefined;
      const code = params.code as string | undefined;
      const functionalAreaId = params.functionalAreaId as string | undefined;
      const testType = params.testType as "browser" | "api" | undefined;

      // Direct API mode: explicit apiDefinition provided.
      if (testType === "api" && params.apiDefinition) {
        if (!name)
          throw new Error("name is required for direct API test creation.");
        const result = await client.createTestDirect({
          repositoryId,
          name,
          testType: "api",
          apiDefinition: params.apiDefinition as Record<string, unknown>,
          functionalAreaId,
        });
        const response: ToolResponse = {
          status: "test_created",
          summary: `API test "${result.name}" created (ID: ${result.id}). Use lastest_run_tests to execute it.`,
          actionRequired: [
            "Run the test with lastest_run_tests to verify it works",
          ],
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // AI API mode: generate an API test from a prompt / OpenAPI.
      if (testType === "api") {
        const result = await client.generateApiTest({
          repositoryId,
          name,
          prompt: params.prompt as string | undefined,
          endpoint: params.endpoint as string | undefined,
          openapiSpec: params.openapiSpec as string | undefined,
          functionalAreaId,
        });
        const response: ToolResponse = {
          status:
            result.status === "generated"
              ? "test_created"
              : "ai_generation_failed",
          summary:
            (result.summary as string) ?? "API test generation finished.",
          actionRequired:
            result.status === "generated"
              ? ["Run the generated API test with lastest_run_tests"]
              : [
                  "Provide an apiDefinition for direct creation, or check Settings → AI.",
                ],
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

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
          status: "test_created",
          summary: `Test "${result.name}" created from supplied code (ID: ${result.id}). Use lastest_run_tests to execute it.`,
          actionRequired: [
            "Run the test with lastest_run_tests to verify it works",
          ],
          details: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      }

      // AI mode: require at least url or prompt
      if (!params.url && !params.prompt) {
        throw new Error(
          "Provide either { name, code } for direct creation, or { url } and/or { prompt } for AI generation.",
        );
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
        let parsedBody: {
          error?: string;
          retryable?: boolean;
          fallback?: string;
        } = {};
        if (match) {
          try {
            parsedBody = JSON.parse(match[2]);
          } catch {
            parsedBody = { error: match[2] };
          }
        }
        const retryable =
          parsedBody.retryable ?? (httpStatus === 502 || httpStatus === 429);
        const failResponse: ToolResponse = {
          status: "ai_generation_failed",
          summary: `AI test generation failed${httpStatus ? ` (HTTP ${httpStatus})` : ""}: ${parsedBody.error ?? message}`,
          actionRequired: [
            retryable
              ? "Provider is overloaded or rate-limited — retry lastest_create_test in a few seconds."
              : "AI provider is not configured or rejected the request — check Settings → AI in Lastest.",
            parsedBody.fallback ??
              `MCP-first fallback: read lastest://repo/${repositoryId}/authoring-guide, scout the page (your Playwright MCP, or lastest_scout_url), then call lastest_create_test in DIRECT mode with { name, code } you write yourself.`,
          ],
          details: {
            httpStatus,
            retryable,
            error: parsedBody.error ?? message,
          },
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(failResponse, null, 2) },
          ],
        };
      }

      const response: ToolResponse = {
        status: "test_created",
        summary: `Test created via AI${result.testId ? ` (ID: ${result.testId})` : ""}. Use lastest_run_tests to execute it.`,
        actionRequired: [
          "Run the test with lastest_run_tests to verify it works",
        ],
        details: result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_heal_test ---
  server.tool(
    "lastest_heal_test",
    "Trigger the AI healer agent to automatically fix a failing test by inspecting the live UI and updating selectors/assertions.",
    {
      testId: z.string().describe("ID of the failing test to heal"),
    },
    withActivityReporting(client, "lastest_heal_test", async (params) => {
      const result = (await client.healTest(params.testId as string)) as Record<
        string,
        unknown
      >;

      const response: ToolResponse = {
        status: result.success ? "healed" : "heal_failed",
        summary: result.success
          ? `Test ${params.testId} healed successfully. Run lastest_run_tests to verify the fix.`
          : `Healing failed for test ${params.testId}. Manual intervention may be needed.`,
        actionRequired: result.success
          ? ["Re-run the test with lastest_run_tests to confirm the fix"]
          : ["Review the test manually or check error details"],
        details: result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_suggest_app_fix ---
  server.tool(
    "lastest_suggest_app_fix",
    'For a failing test classified as a real regression, get a structured APPLICATION-code fix recommendation (file, snippet, rationale) localized against the build\'s change map. This is the "fix the app" loop: it complements lastest_heal_test (which fixes the *test*). The suggestion is advisory only — Lastest never edits your application code; review and apply it yourself. Returns `not_a_regression` when the failure was triaged as flaky/environment/test-maintenance.',
    {
      testId: z
        .string()
        .describe(
          "A failing test (ideally already triaged as real_regression)",
        ),
      buildId: z
        .string()
        .optional()
        .describe("Build context; defaults to the test's latest failing build"),
    },
    withActivityReporting(client, "lastest_suggest_app_fix", async (params) => {
      const result = await client.suggestAppFix(params.testId as string, {
        buildId: params.buildId as string | undefined,
      });
      const status = result.status as string;
      const response: ToolResponse = {
        status,
        summary: result.summary as string,
        actionRequired:
          status === "app_fix_suggested"
            ? [
                "Review the suggested change and apply it manually — Lastest does not modify application code. Then re-run lastest_validate_diff or lastest_run_tests.",
              ]
            : undefined,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_publish_share (PROTECTED — shape unchanged) ---
  server.tool(
    "lastest_publish_share",
    "Publish a public-share link for a build (or a single test within it). Returns a `/r/<slug>` URL anyone can view without logging in. Use after a build completes so demos and outreach messages can link directly to the visual result. Pass `scopedTestId` to scope the share to one test instead of the whole build.",
    {
      buildId: z.string().describe("Build ID to publish a share for"),
      scopedTestId: z
        .string()
        .optional()
        .describe(
          "Optional — restrict the share to a single test within the build",
        ),
    },
    withActivityReporting(client, "lastest_publish_share", async (params) => {
      const result = await client.publishShare(params.buildId as string, {
        scopedTestId: params.scopedTestId as string | undefined,
      });
      const response: ToolResponse = {
        status: "share_published",
        summary: params.scopedTestId
          ? `Test share published: ${result.url}`
          : `Build share published: ${result.url}`,
        details: result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // --- lastest_approve_layer ---
  server.tool(
    "lastest_approve_layer",
    "Per-layer feedback on a step comparison: approve (Mark expected → write baseline), reject (Needs fix → create todo), or snooze (suppress for this build only).",
    {
      stepComparisonId: z.string().describe("Step comparison ID"),
      buildId: z.string().describe("Build ID"),
      layer: z
        .enum([
          "visual",
          "dom",
          "a11y",
          "network",
          "console",
          "url",
          "perf",
          "variable",
        ])
        .describe("Layer name"),
      status: z
        .enum(["approved", "rejected", "snoozed"])
        .describe(
          "approved=Mark expected; rejected=Needs fix; snoozed=Suppress for this build",
        ),
      note: z
        .string()
        .optional()
        .describe("Optional note attached to the decision"),
    },
    withActivityReporting(client, "lastest_approve_layer", async (params) => {
      const result = await client.approveLayer({
        stepComparisonId: params.stepComparisonId as string,
        buildId: params.buildId as string,
        layer: params.layer as string,
        status: params.status as "approved" | "rejected" | "snoozed",
        note: params.note as string | undefined,
      });
      const response: ToolResponse = {
        status: "ok",
        summary: `Layer ${params.layer} ${params.status}.`,
        details: result as Record<string, unknown>,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }),
  );

  // ===== QuickStart agent (PROTECTED — shapes unchanged) =====

  // --- lastest_quickstart ---
  server.tool(
    "lastest_quickstart",
    "Productized form of /gtm-lastest-saas-demo. Spins up a 2-test demo (auth setup + app walkthrough) on a repo whose baseUrl is set, runs it with video, and writes build_demo_notes. Gated by team early-adopter mode + repo baseUrl. Returns a sessionId to poll with lastest_quickstart_status.",
    {
      repositoryId: z
        .string()
        .describe(
          "Repository ID — must have baseUrl set and team must have early-adopter mode enabled",
        ),
      emailTemplate: z
        .string()
        .optional()
        .describe(
          "Optional override for the demo email template (must contain {slug} and {stamp} tokens). Persisted on the team for next time.",
        ),
    },
    withActivityReporting(client, "lastest_quickstart", async (params) => {
      try {
        const result = await client.startQuickstart(
          params.repositoryId as string,
          {
            emailTemplate: params.emailTemplate as string | undefined,
          },
        );
        const response: ToolResponse = {
          status: "started",
          summary: `QuickStart session started: ${result.sessionId}`,
          actionRequired: [
            `Poll lastest_quickstart_status with sessionId: ${result.sessionId}`,
            'Status flips to "completed" when the build finishes and demo notes are written.',
          ],
          details: result as unknown as Record<string, unknown>,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const match = message.match(/Lastest API error (\d+): (.*)$/s);
        let parsedBody: Record<string, unknown> = {};
        if (match) {
          try {
            parsedBody = JSON.parse(match[2]);
          } catch {
            /* ignore */
          }
        }
        const isDisabled = parsedBody.error === "quickstart_disabled";
        const failResponse: ToolResponse = {
          status: isDisabled ? "disabled" : "error",
          summary: isDisabled
            ? `QuickStart is disabled for this repo: ${String(parsedBody.reason ?? "unknown")}`
            : `Failed to start QuickStart: ${message}`,
          actionRequired: isDisabled
            ? [
                String(
                  parsedBody.hint ??
                    "Check team early-adopter mode and repo baseUrl.",
                ),
              ]
            : [
                "Inspect the error and retry; check that the repo has baseUrl set and AI provider configured.",
              ],
          details: parsedBody,
        };
        return {
          content: [
            { type: "text", text: JSON.stringify(failResponse, null, 2) },
          ],
        };
      }
    }),
  );

  // --- lastest_quickstart_status ---
  server.tool(
    "lastest_quickstart_status",
    "Poll a QuickStart session by ID. Returns step-by-step status, the auth-setup outcome, the walkthrough test ID, the build ID, and whether demo notes were written.",
    {
      sessionId: z
        .string()
        .describe("QuickStart session ID returned by lastest_quickstart"),
    },
    withActivityReporting(
      client,
      "lastest_quickstart_status",
      async (params) => {
        const result = await client.getQuickstartStatus(
          params.sessionId as string,
        );
        const completed = result.status === "completed";
        const failed = result.status === "failed";
        const cancelled = result.status === "cancelled";
        const summaryBits: string[] = [`status: ${result.status}`];
        if (result.currentStepId)
          summaryBits.push(`current: ${result.currentStepId}`);
        const buildId =
          (result.metadata?.buildId as string | undefined) ?? null;
        const walkthroughTestId =
          (result.metadata?.walkthroughTestId as string | undefined) ?? null;
        if (walkthroughTestId)
          summaryBits.push(`walkthroughTestId: ${walkthroughTestId}`);
        if (buildId) summaryBits.push(`buildId: ${buildId}`);

        const actionRequired: string[] = [];
        if (!completed && !failed && !cancelled) {
          actionRequired.push("Poll again in a few seconds.");
        }
        if (completed && buildId) {
          actionRequired.push(`Open the build: /builds/${buildId}`);
          actionRequired.push(
            `Publish a share via POST /api/v1/builds/${buildId}/share { scopedTestId: "${walkthroughTestId ?? "..."}" }`,
          );
        }
        if (failed) {
          actionRequired.push(
            "Inspect the failed step in `steps[]`. The `error` and `result` fields contain the cause.",
          );
        }

        const response: ToolResponse = {
          status: result.status,
          summary: summaryBits.join(" · "),
          actionRequired:
            actionRequired.length > 0 ? actionRequired : undefined,
          details: result as unknown as Record<string, unknown>,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        };
      },
    ),
  );

  // ===== Resources: how to author a test the runner will accept =====

  // Generic, repo-independent authoring contract.
  server.registerResource(
    "authoring-guide",
    "lastest://authoring-guide",
    {
      title: "Lastest test authoring guide",
      description:
        "The contract a test must follow for the Lastest runner (signature, no-imports rule, selector + resilience rules, how to scout and wire auth). Read this before generating any test.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: AUTHORING_CONTRACT }],
    }),
  );

  // Repo-specific guide: the contract plus this repo's base URL, functional
  // areas, setup scripts, and saved auth storage states.
  server.registerResource(
    "repo-authoring-guide",
    new ResourceTemplate("lastest://repo/{repositoryId}/authoring-guide", {
      list: undefined,
    }),
    {
      title: "Lastest authoring guide (repo context)",
      description:
        "The authoring contract plus a specific repo's base URL, functional areas, reusable setup scripts, and saved auth storage states. Read this before generating a test for that repo.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const repositoryId = String(variables.repositoryId);
      const text = await buildRepoAuthoringGuide(client, repositoryId);
      return { contents: [{ uri: uri.href, text }] };
    },
  );

  // ===== Prompts: workflows the user invokes from their client =====

  server.registerPrompt(
    "author-test",
    {
      title: "Author a Lastest test (MCP-first)",
      description:
        "Generate a Playwright test for a Lastest repo using your own model: read the repo authoring guide, scout the page (Playwright MCP preferred), write runner-valid code, create + run it, and iterate on failures.",
      argsSchema: {
        repositoryId: z.string().describe("Target Lastest repository ID"),
        url: z
          .string()
          .optional()
          .describe("URL/path to test (defaults to the repo base URL)"),
        spec: z
          .string()
          .optional()
          .describe("Optional spec / acceptance criteria to turn into tests"),
        area: z
          .string()
          .optional()
          .describe(
            "Optional functional area name or ID to file the test under",
          ),
      },
    },
    ({ repositoryId, url, spec, area }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Author a Lastest test for repository ${repositoryId}.`,
              "",
              "Follow these steps:",
              `1. Read the resource lastest://repo/${repositoryId}/authoring-guide and follow its contract exactly (signature, no imports, selector + resilience rules).`,
              url
                ? `2. Target: ${url}.`
                : "2. Target the repo's base URL from the guide.",
              "3. Discover real selectors BEFORE writing code: prefer your own Playwright MCP (open the page, snapshot, read roles/labels/text). No browser of your own? Use lastest_ranger (live, watchable Embedded Browser; poll lastest_ranger_status) for a rendered map, or lastest_scout_url for a fast static map.",
              spec
                ? `4. Turn this spec into one or more tests, one concern each:\n---\n${spec}\n---`
                : "4. Cover the primary user flow on that page; keep each test focused.",
              "5. If the flow needs auth, discover setup via lastest_list_setup_scripts / lastest_list_storage_states and wire it with lastest_update_test (setupScriptId / setupOverrides) — do not script login inside the test.",
              area
                ? `6. File the test under functional area "${area}" (create it with lastest_create_area if missing).`
                : "6. Assign a sensible functional area (create one if needed).",
              "7. Create with lastest_create_test in DIRECT mode { repositoryId, name, code }, then lastest_run_tests and lastest_get_build_status. If it fails, read the error, fix, and lastest_update_test until it passes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
