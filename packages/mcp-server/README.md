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

| Client         | Status   | Install method               |
| -------------- | -------- | ---------------------------- |
| Claude Code    | Verified | `claude mcp add` (see below) |
| Claude Desktop | Verified | `claude_desktop_config.json` |
| Cursor         | Verified | `~/.cursor/mcp.json`         |
| Windsurf       | Verified | MCP config (generic JSON)    |
| Cline          | Verified | MCP config (generic JSON)    |

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

The server registers 50 MCP tools (all prefixed `lastest_`). Every tool returns a structured `{ status, summary, actionRequired?, details }` payload.

| Category                         | Tools                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health & jobs                    | `lastest_health_check`, `lastest_list_active_jobs`, `lastest_get_job_status`                                                                                                     |
| Repositories                     | `lastest_list_repos`, `lastest_get_repo`, `lastest_create_repo`, `lastest_update_repo`                                                                                           |
| Playwright settings (repo-level) | `lastest_get_playwright_settings`, `lastest_update_playwright_settings`                                                                                                          |
| Functional areas                 | `lastest_list_areas`, `lastest_create_area`, `lastest_update_area`, `lastest_delete_area`, `lastest_list_tests_by_area`                                                          |
| Tests                            | `lastest_list_tests`, `lastest_list_failing_tests`, `lastest_get_test`, `lastest_create_test`, `lastest_update_test`, `lastest_delete_test`, `lastest_heal_test`                 |
| Setup scripts                    | `lastest_list_setup_scripts`, `lastest_get_setup_script`, `lastest_create_setup_script`, `lastest_update_setup_script`, `lastest_delete_setup_script`                            |
| Storage states                   | `lastest_list_storage_states`, `lastest_create_storage_state`, `lastest_delete_storage_state`                                                                                    |
| Runs & builds                    | `lastest_run_tests`, `lastest_get_test_run`, `lastest_list_builds`, `lastest_get_build_status`, `lastest_review_build`                                                           |
| Diffs & baselines                | `lastest_get_diff`, `lastest_get_visual_diff`, `lastest_approve_diff`, `lastest_reject_diff`, `lastest_approve_all_diffs`, `lastest_approve_baseline`, `lastest_reject_baseline` |
| Verify phase                     | `lastest_get_change_map`, `lastest_verify_build`, `lastest_approve_layer`                                                                                                        |
| Sharing                          | `lastest_publish_share`, `lastest_list_build_shares`, `lastest_list_test_shares`, `lastest_revoke_share`                                                                         |
| Coverage & QA                    | `lastest_get_coverage`, `lastest_qa_summary`                                                                                                                                     |

### Self-configuring tests

`lastest_update_test` accepts a full override surface so an agent can shape a test without touching the UI:

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

| Symptom                                         | Fix                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `Failed to connect to Lastest at …`             | Check the URL is reachable from this machine and that the API key is valid.    |
| `Lastest API error 401`                         | Token revoked or expired — generate a new one in Settings.                     |
| Tools don't appear in Claude Code               | Run `claude mcp list`; if missing re-run `claude mcp add`. Restart the client. |
| Tools don't appear in Cursor / Windsurf / Cline | Confirm the JSON config is valid and the client was fully restarted.           |

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
