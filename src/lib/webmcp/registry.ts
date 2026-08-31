/**
 * Which Lastest tools we hand to browser agents, and how each one narrows a
 * tool from `@lastest/mcp-server`.
 *
 * Why narrow at all: the MCP surface is 29 consolidated tools, several of which
 * multiplex read and destructive actions behind one `action` enum
 * (`lastest_test` covers list/get/update/delete). Registering those verbatim
 * would both hand an agent `action:"delete"` and degrade tool selection —
 * agents match intent against descriptions, and "test resource (read/update/
 * delete)" matches everything and nothing. So each entry below pins the action
 * via `source.bind`, publishes a small hand-written `inputSchema`, and lets the
 * real MCP tool do the work (server-side zod validation, team scoping,
 * capability guards and activity reporting all still run).
 *
 * The hand-written schemas are the one place this stops being generated. The
 * drift guard is `registry.test.ts`, which lists the live MCP surface and fails
 * when a `source.tool` disappears or a bound/exposed key is not a real
 * parameter of it.
 *
 * Sizing follows the WebMCP guidance (and OpenAI's own showcase site, which
 * ships 10 tools): roughly 3 global + 5-6 route-scoped on any given page.
 */
import type { WebMcpToolDef } from "@/lib/webmcp/types";

const NO_INPUT = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

export const WEBMCP_TOOLS: readonly WebMcpToolDef[] = [
  // ===== global =====
  {
    name: "lastest_list_projects",
    title: "List Lastest projects",
    description:
      "List the visual-regression projects (repositories) in the signed-in user's Lastest team, with their ids. Call this first when the user names a project but you do not have its id.",
    inputSchema: NO_INPUT,
    scope: "global",
    readOnly: true,
    source: { tool: "lastest_repo", bind: { action: "list" } },
  },
  {
    name: "lastest_check_running_jobs",
    title: "Check running Lastest jobs",
    description:
      "List Lastest background jobs that are currently queued or running (test builds, healing runs, scans). Use this to find out whether work started earlier has finished.",
    inputSchema: NO_INPUT,
    scope: "global",
    readOnly: true,
    source: { tool: "lastest_status", bind: { action: "jobs" } },
  },
  {
    name: "lastest_get_job_status",
    title: "Get a Lastest job's status",
    description:
      "Get the status and result of one Lastest background job by id. Poll this after starting a test run instead of waiting on the run itself.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The background job id." },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
    scope: "global",
    readOnly: true,
    source: { tool: "lastest_status", bind: { action: "job" } },
  },

  // ===== repository pages =====
  {
    name: "lastest_list_builds",
    title: "List builds for this project",
    description:
      "List recent builds for the project currently open in Lastest, newest first, with pass/fail counts and pending visual changes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many builds to return (default 10).",
        },
      },
      additionalProperties: false,
    },
    scope: "repo",
    readOnly: true,
    needs: ["repositoryId"],
    source: { tool: "lastest_build", bind: { action: "list" } },
  },
  {
    name: "lastest_list_failing_tests",
    title: "List failing tests in this project",
    description:
      "List the currently-failing tests in the project open in Lastest, with their error details. Use this to answer 'what is broken'.",
    inputSchema: NO_INPUT,
    scope: "repo",
    readOnly: true,
    needs: ["repositoryId"],
    source: {
      tool: "lastest_test",
      bind: { action: "list", filter: "failing" },
    },
  },
  {
    name: "lastest_qa_summary",
    title: "Summarize this project's QA state",
    description:
      "Get a QA summary for the project open in Lastest: latest build verdict, failing tests, pending visual diffs and what needs a human decision.",
    inputSchema: NO_INPUT,
    scope: "repo",
    readOnly: true,
    needs: ["repositoryId"],
    source: { tool: "lastest_insights", bind: { action: "qa" } },
  },
  {
    name: "lastest_get_coverage",
    title: "Get test coverage for this project",
    description:
      "Get test-coverage statistics for the project open in Lastest: which functional areas and routes are covered and where the gaps are.",
    inputSchema: NO_INPUT,
    scope: "repo",
    readOnly: true,
    needs: ["repositoryId"],
    source: { tool: "lastest_insights", bind: { action: "coverage" } },
  },
  {
    name: "lastest_run_tests",
    title: "Run tests in this project",
    description:
      "Start a test build for the project open in Lastest. Runs every test unless you pass specific test ids. Returns immediately with a job id — poll lastest_get_job_status for the result rather than waiting.",
    inputSchema: {
      type: "object",
      properties: {
        testIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific test ids to run. Omit to run the whole project.",
        },
      },
      additionalProperties: false,
    },
    scope: "repo",
    readOnly: false,
    consent: true,
    needs: ["repositoryId"],
    source: { tool: "lastest_run_tests" },
  },

  // ===== build pages =====
  {
    name: "lastest_review_build",
    title: "Review the open build",
    description:
      "Review the build currently open in Lastest: pass/fail per test, failure reasons, and the visual changes waiting for a decision.",
    inputSchema: NO_INPUT,
    scope: "build",
    readOnly: true,
    needs: ["buildId"],
    source: { tool: "lastest_build", bind: { action: "review" } },
  },
  {
    name: "lastest_list_build_diffs",
    title: "List visual diffs in the open build",
    description:
      "List the visual diffs recorded in the build open in Lastest, with their ids, status and change percentage. Use the ids with lastest_approve_diffs / lastest_reject_diffs.",
    inputSchema: NO_INPUT,
    scope: "build",
    readOnly: true,
    needs: ["buildId"],
    source: { tool: "lastest_get_diffs", bind: { scope: "build" } },
  },
  {
    name: "lastest_get_change_map",
    title: "Get the change map for the open build",
    description:
      "Get the Change Map for the build open in Lastest: what changed in this build grouped by page and check layer (visual, text, DOM, network, console, a11y, design, perf, URL).",
    inputSchema: NO_INPUT,
    scope: "build",
    readOnly: true,
    needs: ["buildId"],
    source: { tool: "lastest_verify", bind: { action: "change_map" } },
  },
  {
    name: "lastest_approve_diffs",
    title: "Approve visual diffs",
    description:
      "Accept visual changes as the new baseline. Pass diff ids to approve just those; omit them to approve every pending diff in the build open in Lastest. This overwrites baselines and is not easily undone — always confirm which diffs the user means first.",
    inputSchema: {
      type: "object",
      properties: {
        diffIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Visual diff ids to approve. Omit to approve all pending diffs in the open build.",
        },
      },
      additionalProperties: false,
    },
    scope: "build",
    readOnly: false,
    consent: true,
    // buildId is bound by the caller only when diffIds is absent — see
    // buildToolArguments(); the MCP tool rejects both together.
    needs: [],
    source: { tool: "lastest_decide_diff", bind: { action: "approve" } },
  },
  {
    name: "lastest_reject_diffs",
    title: "Reject visual diffs",
    description:
      "Mark visual changes as regressions. Requires explicit diff ids — get them from lastest_list_build_diffs.",
    inputSchema: {
      type: "object",
      properties: {
        diffIds: {
          type: "array",
          items: { type: "string" },
          description: "Visual diff ids to reject.",
        },
      },
      required: ["diffIds"],
      additionalProperties: false,
    },
    scope: "build",
    readOnly: false,
    consent: true,
    source: { tool: "lastest_decide_diff", bind: { action: "reject" } },
  },
  {
    name: "lastest_publish_share",
    title: "Publish a public share link",
    description:
      "Publish a public /r/<slug> link for the build open in Lastest, viewable without logging in. Anyone with the link can see the screenshots — confirm before publishing.",
    inputSchema: NO_INPUT,
    scope: "build",
    readOnly: false,
    consent: true,
    needs: ["buildId"],
    source: { tool: "lastest_publish_share" },
  },

  // ===== test pages =====
  {
    name: "lastest_get_test",
    title: "Get the open test",
    description:
      "Get full details of the test open in Lastest: its Playwright code, target URL, setup wiring and last run result.",
    inputSchema: NO_INPUT,
    scope: "test",
    readOnly: true,
    needs: ["testId"],
    source: { tool: "lastest_test", bind: { action: "get" } },
  },
  {
    name: "lastest_heal_test",
    title: "Heal the open test",
    description:
      "Ask Lastest's AI healer to fix the failing test open in Lastest by inspecting the live UI and updating its selectors and assertions. This rewrites the test's code — confirm first. Returns a job id to poll.",
    inputSchema: NO_INPUT,
    scope: "test",
    readOnly: false,
    consent: true,
    needs: ["testId"],
    source: { tool: "lastest_heal_test" },
  },
];

export const WEBMCP_TOOLS_BY_NAME: ReadonlyMap<string, WebMcpToolDef> = new Map(
  WEBMCP_TOOLS.map((t) => [t.name, t]),
);

/**
 * MCP tools that must NEVER back a browser-agent tool, asserted by the drift
 * test. A browser agent may have read an attacker-controlled page in another
 * tab; nothing here should be one prompt injection away from running.
 */
export const WEBMCP_FORBIDDEN_SOURCE_TOOLS: readonly string[] = [
  "lastest_storage_state", // browser credentials
  "lastest_setup_script", // arbitrary code at setup time
  "lastest_create_test", // arbitrary code
  "lastest_area", // multiplexes delete
  "lastest_validate_diff", // runs an arbitrary git diff
  "lastest_explorer",
  "lastest_ranger",
  "lastest_quickstart",
  "lastest_suggest_app_fix",
  "lastest_approve_layer",
];

/**
 * Actions on the multi-action tools that must never be bound or left for the
 * agent to choose. `lastest_repo` is allowed as a source *only* because
 * `lastest_list_projects` pins `action:"list"`; the drift test enforces that no
 * registered tool binds one of these or exposes `action`/`scope` in its own
 * schema (which would let an agent pick the action itself).
 */
export const WEBMCP_FORBIDDEN_ACTIONS: readonly string[] = [
  "create",
  "update",
  "delete",
  "update_settings",
  "start_run",
  "add_task",
  "revoke",
];
