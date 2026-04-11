---
name: lastest
slug: las-team/lastest
version: 0.2.2
description: Run visual regression tests, review screenshot diffs, and manage baselines on a Lastest instance via the @lastest/mcp-server MCP tools.
category: testing
tags:
  - visual-regression
  - playwright
  - mcp
  - qa
  - screenshot-testing
  - ai-testing
author: las-team
license: FSL-1.1-ALv2
homepage: https://github.com/las-team/lastest
repository: https://github.com/las-team/lastest
---

# Lastest — Visual Regression Testing

This skill teaches the agent to drive a [Lastest](https://github.com/las-team/lastest) instance — running visual regression tests, inspecting screenshot diffs, and approving or rejecting baselines — through the official `@lastest/mcp-server` MCP server.

## When to use

Use this skill when the user:

- Asks to run visual regression tests, UI snapshot tests, or screenshot comparisons
- Mentions "Lastest", "baseline screenshots", "visual QA", or "pixel diff"
- Wants to review, approve, or reject visual diffs on a build
- Asks to heal a failing visual test with AI

## Prerequisites

The agent needs the `@lastest/mcp-server` MCP server configured in the user's MCP client. If it is not present, guide the user through setup:

**One-liner (Claude Code, stdio):**

```bash
claude mcp add lastest -- npx -y @lastest/mcp-server@latest \
  --url <LASTEST_URL> \
  --api-key <LASTEST_API_KEY>
```

**Claude Desktop / Cursor (stdio):**

```json
{
  "mcpServers": {
    "lastest": {
      "command": "npx",
      "args": [
        "-y",
        "@lastest/mcp-server@latest",
        "--url",
        "https://app.lastest.cloud",
        "--api-key",
        "YOUR_API_KEY"
      ]
    }
  }
}
```

**Remote HTTP (no local Node required):**

```bash
claude mcp add --transport http lastest https://app.lastest.cloud/api/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

The API key is created at **Settings → Runners & API Access → Create API Key** in the Lastest web UI. Tell the user it is shown only once.

## Recommended flow

Always verify connectivity before mutating state.

1. **Check health** — call `lastest_health_check`. If it fails, ask the user to verify the URL and API key, then stop.
2. **Find the repo** — call `list_repos`. If there are multiple, ask the user which one.
3. **Pick tests**:
   - Whole suite: skip to step 4.
   - A subset: call `list_tests` (or `list_tests_by_area`) and confirm which ones with the user.
4. **Run** — call `create_build` with the repo id and optional `testIds`. Poll `get_build` until the build finishes, surfacing progress to the user.
5. **Review diffs**:
   - Call `get_build` for the finished build. If there are visual diffs, iterate through them with `get_diff`.
   - For each diff, describe it to the user and ask whether to `approve_diff` or `reject_diff`. Do **not** approve/reject without explicit confirmation.
6. **AI-assisted test creation or healing** — if the user wants a new test, call `create_test` with a URL and prompt. If an existing test is broken, call `heal_test` after confirming.

## Safety rules

- **Never** call `approve_all_diffs`, `delete_test`, or `reject_diffs` (batch) without the user explicitly confirming the scope first — these operations are destructive or change shared baselines for the whole team.
- **Never** create API keys or change team settings from within this skill.
- If `lastest_health_check` or any tool returns a 401, stop and ask the user to regenerate their API key; do not retry with a different key.

## Tool reference (via @lastest/mcp-server)

| Purpose          | Tools                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Health           | `lastest_health_check`                                                |
| Repositories     | `list_repos`, `get_repo`                                              |
| Tests            | `list_tests`, `get_test`, `create_test`, `update_test`, `delete_test`, `heal_test` |
| Functional areas | `list_areas`, `create_area`, `list_tests_by_area`                     |
| Builds & runs    | `create_build`, `get_build`, `list_builds`, `get_run`                 |
| Diffs            | `get_diff`, `approve_diff`, `reject_diff`, `approve_all_diffs`        |
| Jobs             | `get_active_jobs`, `get_job`                                          |
| Coverage         | `get_coverage`                                                        |

Full docs: [Lastest MCP Server wiki](https://github.com/las-team/lastest/wiki/MCP-Server).

## Troubleshooting

| Symptom                       | Guide the user to...                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `Failed to connect to Lastest` | Verify the URL is reachable and the API key hasn't been revoked.             |
| `Lastest API error 401`        | Regenerate the key at Settings → Runners & API Access.                       |
| No repositories returned       | Confirm the key belongs to a team with at least one connected repository.    |
