# AGENTS.md — Lastest

## What is Lastest?

Lastest is a visual regression testing platform. It records browser interactions, runs Playwright tests, diffs screenshots against baselines, and uses AI to classify changes.

## MCP Server

Install the MCP server to let AI agents interact with Lastest:

```bash
npx @lastest/mcp-server --url http://localhost:3000 --api-key YOUR_API_KEY
```

### Available Tools (50 total, all prefixed `lastest_`)

| Category | Tools |
|----------|-------|
| Health & jobs | `health_check`, `list_active_jobs`, `get_job_status` |
| Repositories | `list_repos`, `get_repo`, `create_repo`, `update_repo` |
| Playwright settings (repo-level) | `get_playwright_settings`, `update_playwright_settings` |
| Functional areas | `list_areas`, `create_area`, `update_area`, `delete_area`, `list_tests_by_area` |
| Tests | `list_tests`, `list_failing_tests`, `get_test`, `create_test`, `update_test`, `delete_test`, `heal_test` |
| Setup scripts | `list_setup_scripts`, `get_setup_script`, `create_setup_script`, `update_setup_script`, `delete_setup_script` |
| Storage states | `list_storage_states`, `create_storage_state`, `delete_storage_state` |
| Runs & builds | `run_tests` (accepts `forceVideoRecording`, `functionalAreaId`), `get_test_run`, `list_builds`, `get_build_status`, `review_build` |
| Diffs & baselines | `get_diff`, `get_visual_diff`, `approve_diff`, `reject_diff`, `approve_all_diffs`, `approve_baseline`, `reject_baseline` |
| Verify phase | `get_change_map`, `verify_build`, `approve_layer` |
| Sharing | `publish_share`, `list_build_shares`, `list_test_shares`, `revoke_share` |
| Coverage & QA | `get_coverage`, `qa_summary` |

`lastest_update_test` self-configures a test end-to-end: name/code/URL, functional area, lifecycle (`quarantined`, `executionMode`), setup wiring (`setupTestId` | `setupScriptId`, `setupOverrides`, `teardownOverrides`), and runtime overrides (`playwrightOverrides`, `diffOverrides`, `stabilizationOverrides`, `viewportOverride`). Pass `null` to any override block to clear it.

### Typical Workflow

1. `lastest_run_tests` — start a build (`forceVideoRecording: true` if you need video for a share)
2. `lastest_build` `action:"get"` — poll until complete (`action:"review"` for failures + action items)
3. If visual changes: `lastest_get_diffs` `scope:"build"` — inspect diffs
4. `lastest_decide_diff` `action:"approve"|"reject"` — act on diffs/baselines
5. If failures: `lastest_heal_test` — auto-fix the test, then re-run; or `lastest_suggest_app_fix` for an app-code fix suggestion
6. To share: `lastest_publish_share` → public `/r/<slug>` URL. Manage with `lastest_share` `action:"list"|"revoke"`.

For a fast inner-loop check after a code change, use `lastest_validate_diff` (maps a diff to the affected tests, runs only those, returns one verdict).

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
Auth: `Authorization: Bearer <api-key>` (or browser cookie session)

The MCP server is a thin wrapper around these endpoints — anything an agent can do, a script can do.

### Read

| Method + Path | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /repos` | List team repositories (`baseUrl` joined from `environment_configs`) |
| `GET /repos/:id` | Get repo + baseUrl |
| `GET /repos/:id/tests` | Tests in repo with last-run status |
| `GET /repos/:id/functional-areas` | Functional areas in repo |
| `GET /repos/:id/builds?limit=N` | Recent builds |
| `GET /repos/:id/coverage` | Route + area coverage stats |
| `GET /repos/:id/export` | Tests + areas (for cross-instance migration) |
| `GET /repos/:id/playwright-settings` | Repo Playwright settings (merged with defaults) |
| `GET /repos/:id/storage-states` | Storage states (metadata only — `storageStateJson` stripped) |
| `GET /repos/:id/setup-scripts` | Setup scripts (Playwright + API types) |
| `GET /functional-areas/:id` | Single functional area |
| `GET /functional-areas/:id/tests` | Tests in area |
| `GET /tests/:id` | Test (includes setup wiring, overrides, last-run status) |
| `GET /tests/:id/shares` | Public shares scoped to this test |
| `GET /runs/:id` | Test run + results |
| `GET /builds/:id` | Build + slim diffs (`?full=true` for joined a11y / network / AI payloads) |
| `GET /builds/:id/shares` | Public shares anchored on this build |
| `GET /builds/:id/change-map` | Verify-phase change map |
| `GET /builds/:id/verify` | Change map + step comparisons + verdict counts |
| `GET /builds/:id/demo-notes` | AI UI/UX notes from a demo run |
| `GET /diffs/:id` | Full visual diff |
| `GET /storage-states/:id` | Storage state metadata. `?includeJson=true` (bearer-only) returns the cookie/origin blob. |
| `GET /setup-scripts/:id` | Setup script (code included) |
| `GET /shares/:id` | Public share row |
| `GET /jobs/active` / `GET /jobs/:id` | Background jobs (team-scoped) |

### Write

| Method + Path | Purpose |
|---|---|
| `POST /repos` | Create a local repo (optional `baseUrl`) |
| `POST /repos/:id/import` | Import tests + areas (cross-instance migration) |
| `POST /repos/:id/storage-states` | Create a storage state (`{ name, storageStateJson }`) |
| `POST /repos/:id/setup-scripts` | Create a setup script (`{ name, type, code, description? }`) |
| `POST /functional-areas` | Create a functional area |
| `POST /tests` | Create a test directly (raw code) |
| `POST /tests/create` | Create a test via AI (URL + prompt) |
| `POST /tests/:id/heal` | Heal a failing test via AI |
| `POST /runs` | Start a build (optional `forceVideoRecording`, `functionalAreaId`, `testIds`) |
| `POST /snapshot` | Single-URL synchronous capture (URL Diff) |
| `POST /diff` | Two-URL async diff |
| `POST /diffs/approve` / `POST /diffs/reject` | Batch approve/reject |
| `POST /diffs/:id/approve` / `POST /diffs/:id/reject` | Single approve/reject |
| `POST /builds/:id/approve-all` | Approve every diff in a build |
| `POST /builds/:id/share` | Publish a public-share link (optional `scopedTestId`) |
| `POST /builds/:id/demo-notes` | Upsert demo-run UI/UX notes |
| `POST /verify/layer-feedback` | Per-layer approve/reject/snooze on a step comparison |
| `POST /activity` | Report MCP / agent activity events |
| `PUT /repos/:id` | Update repo (`name`, `defaultBranch`, `selectedBranch`, `baseUrl`) |
| `PUT /repos/:id/playwright-settings` | Upsert repo-level Playwright settings (partial; whitelisted) |
| `PUT /tests/:id` | Update test — accepts `name`, `code`, `targetUrl`, `functionalAreaId`, `quarantined`, `executionMode`, `viewportOverride`, `playwrightOverrides`, `diffOverrides`, `stabilizationOverrides`, `setupTestId`, `setupScriptId`, `setupOverrides`, `teardownOverrides`. Validates referenced ids live in the same repo. |
| `PUT /functional-areas/:id` | Update area |
| `PUT /setup-scripts/:id` | Update setup script |
| `DELETE /tests/:id` | Soft-delete |
| `DELETE /functional-areas/:id` | Soft-delete |
| `DELETE /storage-states/:id` | Hard-delete |
| `DELETE /setup-scripts/:id` | Hard-delete (refused with 409 if any test still references it) |
| `DELETE /shares/:id` | Revoke a public share |

All endpoints are team-scoped: cross-team access returns 404, never 200-with-empty.

## Running Tests Locally

```bash
pnpm dev          # Start dev server on localhost:3000
pnpm test         # Run unit tests
pnpm build        # Production build
```
