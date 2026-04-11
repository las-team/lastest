# @lastest/mcp-server

[![npm](https://img.shields.io/npm/v/@lastest/mcp-server.svg)](https://www.npmjs.com/package/@lastest/mcp-server)

**Model Context Protocol server for [Lastest](https://github.com/las-team/lastest)** — lets AI agents (Claude Code, Claude Desktop, Cursor, Cline, Windsurf, …) drive a Lastest visual regression testing instance directly.

With this MCP server an agent can:

- List repositories, tests, functional areas, and builds
- Create and run tests, including AI-authored tests from a URL or prompt
- Inspect test runs and background jobs
- Review visual diffs and approve / reject baselines
- Heal failing tests via AI

## Prerequisites

1. A running [Lastest](https://github.com/las-team/lastest) instance reachable over HTTP(S).
2. An **API key** generated in the Lastest UI: **Settings → Runners & API Access → Create API Key**. Copy the key — it is shown only once.
3. Node.js **18+**.

## Install — Claude Code

```bash
claude mcp add lastest -- npx -y @lastest/mcp-server@latest \
  --url https://your-lastest-instance \
  --api-key YOUR_API_KEY
```

Verify: `claude mcp list`

## Install — Claude Desktop / Cursor / generic JSON

Add to `claude_desktop_config.json` (or `~/.cursor/mcp.json`):

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

## CLI

```
lastest-mcp --url <url> --api-key <key>
```

Both flags are required. Communicates over stdio.

## Tools

| Category         | Tools                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Repositories     | `list_repos`, `get_repo`                                                                             |
| Tests            | `list_tests`, `get_test`, `create_test`, `update_test`, `delete_test`, `heal_test`                   |
| Functional areas | `list_areas`, `create_area`, `list_tests_by_area`                                                    |
| Builds & runs    | `create_build`, `get_build`, `list_builds`, `get_run`                                                |
| Diffs            | `get_diff`, `approve_diff`, `reject_diff`, `approve_all_diffs`                                       |
| Jobs             | `get_active_jobs`, `get_job`                                                                         |
| Coverage         | `get_coverage`                                                                                       |

All tools return a structured `{ status, summary, actionRequired?, details }` payload.

## Authentication

The server authenticates against Lastest's REST API (`/api/v1/*`) with a `Bearer` token. Manage and revoke keys from **Settings → Runners & API Access** in the Lastest UI.

## Troubleshooting

| Symptom                                | Fix                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Failed to connect to Lastest at …`    | Check the URL is reachable from this machine and that the API key is valid.                         |
| `Lastest API error 401`                | Token revoked or expired — generate a new one in Settings.                                           |
| Tools don't appear in Claude Code      | Run `claude mcp list`; if missing re-run `claude mcp add`. Restart the client.                       |

## Local development

```bash
git clone https://github.com/las-team/lastest
cd lastest/packages/mcp-server
pnpm install
pnpm dev -- --url http://localhost:3000 --api-key <key>
```

## Links

- 📖 **Wiki:** https://github.com/las-team/lastest/wiki/MCP-Server
- 🐛 **Issues:** https://github.com/las-team/lastest/issues
- 📦 **Lastest:** https://github.com/las-team/lastest

## License

FSL-1.1-ALv2
