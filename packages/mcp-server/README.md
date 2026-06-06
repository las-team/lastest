# @lastest/mcp-server

[![npm version](https://img.shields.io/npm/v/@lastest/mcp-server.svg)](https://www.npmjs.com/package/@lastest/mcp-server)
[![npm downloads](https://img.shields.io/npm/dw/@lastest/mcp-server.svg)](https://www.npmjs.com/package/@lastest/mcp-server)
[![License](https://img.shields.io/npm/l/@lastest/mcp-server.svg)](https://github.com/las-team/lastest/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/las-team/lastest.svg?style=social)](https://github.com/las-team/lastest)

MCP server for [Claude Code](https://claude.com/product/claude-code), [Cursor](https://cursor.com), [Windsurf](https://windsurf.com), [Cline](https://cline.bot), and [Claude Desktop](https://claude.ai/download). Lets AI agents run visual regression tests, review screenshot diffs, and approve baselines on a [Lastest](https://lastest.cloud) instance through the Model Context Protocol.

## Quick start

```bash
npx -y @lastest/mcp-server@latest --url https://your-lastest-instance --api-key YOUR_API_KEY
```

Generate an API key in the Lastest UI: **Settings → Runners & API Access → Create API Key** (shown only once). The server speaks MCP over stdio — wire it into any compatible client below.

## Compatible clients

| Client | Status | Install method |
|--------|--------|----------------|
| Claude Code | Verified | `claude mcp add` (see below) |
| Claude Desktop | Verified | `claude_desktop_config.json` |
| Cursor | Verified | `~/.cursor/mcp.json` |
| Windsurf | Verified | MCP config (generic JSON) |
| Cline | Verified | MCP config (generic JSON) |

Any MCP-compliant client that can launch a stdio server with arguments works.

## Install — Claude Code

```bash
claude mcp add lastest -- npx -y @lastest/mcp-server@latest \
  --url https://your-lastest-instance \
  --api-key YOUR_API_KEY
```

Verify with `claude mcp list`.

## Install — Claude Desktop / Cursor / Windsurf / Cline

Add to `claude_desktop_config.json`, `~/.cursor/mcp.json`, or your client's MCP config:

```json
{
  "mcpServers": {
    "lastest": {
      "command": "npx",
      "args": [
        "-y",
        "@lastest/mcp-server@latest",
        "--url",
        "https://your-lastest-instance",
        "--api-key",
        "YOUR_API_KEY"
      ]
    }
  }
}
```

Restart the client.

## What an agent can do

- List repositories, tests, functional areas, builds, and active jobs
- Create AI-authored tests from a URL or natural-language prompt
- Update or delete tests and functional areas
- Self-configure test runtime: `playwrightOverrides`, `diffOverrides`, `stabilizationOverrides`, viewport, setup wiring
- Manage shared auth: storage states (Playwright `storageState()` blobs) and reusable setup scripts
- Trigger test runs (optionally `forceVideoRecording`) and read run results
- Inspect visual diffs and approve / reject baselines individually or in bulk
- Heal failing tests with AI based on the latest run
- Publish, list, and revoke public-share links for builds and tests
- Read and update repo-level Playwright settings (browser, viewport, timeouts, parallelism, stabilization)
- Drive the Verify phase: Change Map, step comparisons, per-layer approvals
- Pull QA summaries, build review reports, and coverage stats

## Tools exposed

The server registers 20 MCP tools (all prefixed `lastest_`). Every tool returns a structured `{ status, summary, actionRequired?, details }` payload.

Pure CRUD operations are consolidated into **resource tools** that take an `action` (or `scope`) discriminator; workflow verbs stay as standalone tools.

### Resource tools (action-dispatched)

| Tool | `action` (or `scope`) values | Purpose |
|------|------------------------------|---------|
| `lastest_status` | `health`, `jobs`, `job` | Instance connectivity + background-job status |
| `lastest_repo` | `list`, `get`, `create`, `update`, `get_settings`, `update_settings` | Repositories + repo-level Playwright settings |
| `lastest_area` | `list`, `create`, `update`, `delete`, `list_tests` | Functional areas (test groupings) |
| `lastest_test` | `list` (`filter: all\|failing`), `get`, `update`, `delete` | Read/update/delete tests |
| `lastest_storage_state` | `list`, `create`, `delete` | Saved Playwright `storageState()` blobs |
| `lastest_setup_script` | `list`, `get`, `create`, `update`, `delete` | Reusable Playwright/API setup blocks |
| `lastest_get_diffs` | `scope: single\|build` | Read visual diffs (one, or all for a build) |
| `lastest_decide_diff` | `approve`, `reject` (via `diffIds` batch or `buildId` approve-all) | Approve/reject visual diffs & baselines |
| `lastest_build` | `list`, `get`, `review` | Builds: list, status, comprehensive QA review |
| `lastest_share` | `list`, `revoke` | List/revoke existing public shares |
| `lastest_verify` | `view`, `change_map` | Verify-phase view + build-level Change Map |
| `lastest_insights` | `coverage`, `qa` | Repo coverage stats + QA summary |

### Workflow verbs (standalone)

| Tool | Purpose |
|------|---------|
| `lastest_run_tests` | Trigger a test build (repo / area / specific tests) |
| `lastest_create_test` | Create a test (direct/AI, browser/API modes) |
| `lastest_heal_test` | AI healer agent auto-fixes a failing test |
| `lastest_validate_diff` | Diff-scoped validation: run only affected tests, return a verdict |
| `lastest_suggest_app_fix` | Advisory application-code fix for a real regression |
| `lastest_approve_layer` | Per-layer approve/reject/snooze on a step comparison |
| `lastest_publish_share` | Publish a `/r/<slug>` public share for a build/test |
| `lastest_quickstart` | Spin up the productized 2-test demo (returns sessionId) |
| `lastest_quickstart_status` | Poll a QuickStart session |

### Self-configuring tests

`lastest_test` (`action: "update"`) accepts a full override surface so an agent can shape a test without touching the UI:

- **Setup wiring** — `setupTestId` (use another test as setup, takes precedence) or `setupScriptId`, plus `setupOverrides` / `teardownOverrides` blocks to inject/skip default steps (`test` | `script` | `storage_state`).
- **Runtime overrides** — `playwrightOverrides` (browser, navigation/action/selector timeouts, error modes, `baseUrl`, cursor speed), `viewportOverride`, `diffOverrides`, `stabilizationOverrides`.
- **Lifecycle** — `quarantined`, `executionMode` (`procedural` | `agent`).

Pass `null` to any override block to clear it. The API validates each referenced id is in the same repo before persisting.

## CLI

```
lastest-mcp --url <url> --api-key <key>
```

Both flags are required. The process communicates with the host client over stdio.

**Requirements:** Node.js 18+ and a reachable [Lastest](https://lastest.cloud) instance.

## Authentication

The server authenticates against Lastest's REST API (`/api/v1/*`) with a `Bearer` token. Manage and revoke keys from **Settings → Runners & API Access** in the Lastest UI.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Failed to connect to Lastest at …` | Check the URL is reachable from this machine and that the API key is valid. |
| `Lastest API error 401` | Token revoked or expired — generate a new one in Settings. |
| Tools don't appear in Claude Code | Run `claude mcp list`; if missing re-run `claude mcp add`. Restart the client. |
| Tools don't appear in Cursor / Windsurf / Cline | Confirm the JSON config is valid and the client was fully restarted. |

## Local development

```bash
git clone https://github.com/las-team/lastest
cd lastest/packages/mcp-server
pnpm install
pnpm dev -- --url http://localhost:3000 --api-key <key>
```

## Used with

- **[Lastest](https://lastest.cloud)** — visual regression testing platform with screenshot diffs and AI test authoring
- **[@lastest/runner](https://www.npmjs.com/package/@lastest/runner)** — self-hosted runner so AI-triggered tests execute on your infra
- **[Model Context Protocol](https://modelcontextprotocol.io)** — open standard powering tool use in Claude, Cursor, Windsurf, and others

## Links

- **Homepage:** https://lastest.cloud
- **GitHub:** https://github.com/las-team/lastest
- **Wiki:** https://github.com/las-team/lastest/wiki/MCP-Server
- **Issues:** https://github.com/las-team/lastest/issues
- **npm:** https://www.npmjs.com/package/@lastest/mcp-server

## License

FSL-1.1-ALv2 — see [LICENSE](./LICENSE).
