# AGENTS.md — Lastest

## What is Lastest?

Lastest is a visual regression testing platform. It records browser interactions, runs Playwright tests, diffs screenshots against baselines, and uses AI to classify changes.

## MCP Server

Install the MCP server to let AI agents interact with Lastest:

```bash
npx @lastest/mcp-server --url http://localhost:3000 --api-key YOUR_API_KEY
```

### Available Tools

| Tool | Description |
|------|-------------|
| `lastest_run_tests` | Trigger a test build. Returns build ID for polling. |
| `lastest_get_build_status` | Get build results: pass/fail counts, visual diffs, overall status. |
| `lastest_list_tests` | List all tests with latest pass/fail status. |
| `lastest_list_failing_tests` | List currently failing tests with error details. |
| `lastest_get_visual_diff` | Get visual diff details with AI classification and confidence. |
| `lastest_approve_baseline` | Approve visual changes (updates baselines). |
| `lastest_reject_baseline` | Reject visual changes (blocks build). |
| `lastest_create_test` | Generate a test via AI from a URL or natural language prompt. |
| `lastest_get_coverage` | Get test coverage stats by functional area and route. |
| `lastest_heal_test` | Auto-fix a failing test using AI healer agent. |

### Typical Workflow

1. `lastest_run_tests` — start a build
2. `lastest_get_build_status` — poll until complete
3. If visual changes: `lastest_get_visual_diff` — inspect diffs
4. `lastest_approve_baseline` or `lastest_reject_baseline` — act on diffs
5. If failures: `lastest_heal_test` — auto-fix, then re-run

### Build Status Values

- `safe_to_merge` — all tests passed, no pending diffs
- `review_required` — visual changes detected, awaiting review
- `blocked` — tests failed or diffs rejected
- `has_todos` — diffs marked as todo for later review

### Response Format

Every tool returns:
```json
{
  "status": "machine_readable_status",
  "summary": "Human-readable 1-2 sentence summary",
  "actionRequired": ["Next steps for the agent"],
  "details": {}
}
```

## REST API

Base URL: `http://localhost:3000/api/v1/`
Auth: `Authorization: Bearer <api-key>`

Key endpoints: `/repos`, `/repos/:id/tests`, `/builds/:id`, `/diffs/approve`, `/diffs/reject`

## Running Tests Locally

```bash
pnpm dev          # Start dev server on localhost:3000
pnpm test         # Run unit tests
pnpm build        # Production build
```
