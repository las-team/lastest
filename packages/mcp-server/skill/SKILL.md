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

1. **Check health** — call `lastest_status` with `action: "health"`. If it fails, ask the user to verify the URL and API key, then stop.
2. **Find the repo** — call `lastest_repo` with `action: "list"`. If there are multiple, ask the user which one.
3. **Pick tests**:
   - All tests in an area: call `lastest_area` with `action: "list_tests"` and skip to step 4.
   - A subset: call `lastest_test` with `action: "list"` (or `lastest_area` `action: "list_tests"`) and confirm which ones with the user.
4. **Run** — call `lastest_run_tests` with the repo id and optional `testIds`. Poll `lastest_build` (`action: "get"`) until the build finishes, surfacing progress to the user.
5. **Review diffs**:
   - Call `lastest_build` (`action: "get"`) for the finished build. If there are visual diffs, inspect them with `lastest_get_diffs` (`scope: "build"`, or `scope: "single"` per diff).
   - For each diff, describe it to the user and ask whether to approve or reject via `lastest_decide_diff`. Do **not** approve/reject without explicit confirmation.
6. **AI-assisted test creation or healing** — if the user wants a new test, call `lastest_create_test` with a URL and prompt. If an existing test is broken, call `lastest_heal_test` after confirming.

## Safety rules

- **Never** call `lastest_decide_diff` with a `buildId` (approve-all), `lastest_test` `action: "delete"`, or `lastest_decide_diff` `action: "reject"` on a batch without the user explicitly confirming the scope first — these operations are destructive or change shared baselines for the whole team.
- **Never** create API keys or change team settings from within this skill.
- If `lastest_status` (`action: "health"`) or any tool returns a 401, stop and ask the user to regenerate their API key; do not retry with a different key.

## Tool reference (via @lastest/mcp-server)

Pure CRUD lives on resource tools that take an `action` (or `scope`) discriminator; workflow verbs are standalone.

| Purpose          | Tool(s)                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Status & jobs    | `lastest_status` (`health` \| `jobs` \| `job`)                                                       |
| Repositories     | `lastest_repo` (`list` \| `get` \| `create` \| `update` \| `get_settings` \| `update_settings`)      |
| Functional areas | `lastest_area` (`list` \| `create` \| `update` \| `delete` \| `list_tests`)                          |
| Tests            | `lastest_test` (`list` \| `get` \| `update` \| `delete`), `lastest_create_test`, `lastest_heal_test` |
| Builds & runs    | `lastest_build` (`list` \| `get` \| `review`), `lastest_run_tests`, `lastest_validate_diff`          |
| Diffs            | `lastest_get_diffs` (`single` \| `build`), `lastest_decide_diff` (`approve` \| `reject`)             |
| Verify phase     | `lastest_verify` (`view` \| `change_map`), `lastest_approve_layer`                                   |
| Sharing          | `lastest_publish_share`, `lastest_share` (`list` \| `revoke`)                                        |
| Insights         | `lastest_insights` (`coverage` \| `qa`)                                                              |
| Setup & storage  | `lastest_setup_script` (5 actions), `lastest_storage_state` (`list` \| `create` \| `delete`)         |

Full docs: [Lastest MCP Server wiki](https://github.com/las-team/lastest/wiki/MCP-Server).

## Troubleshooting

| Symptom                        | Guide the user to...                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `Failed to connect to Lastest` | Verify the URL is reachable and the API key hasn't been revoked.          |
| `Lastest API error 401`        | Regenerate the key at Settings → Runners & API Access.                    |
| No repositories returned       | Confirm the key belongs to a team with at least one connected repository. |
