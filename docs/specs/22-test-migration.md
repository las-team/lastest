# 22 — Test Migration (Cross-Instance Export/Import)

## Summary

Move tests and functional areas between Lastest instances — e.g. from a staging deployment to production, or between self-hosted servers.

## API Endpoints

### `GET /api/v1/repos/:id/export`

Returns all tests and functional areas for a repository in the exact format accepted by the import endpoint. Includes all fields: code, description, overrides, execution mode, capabilities, quarantine status, etc.

**Response:**

```json
{
  "functionalAreas": [
    {
      "name": "Login Flow",
      "description": "...",
      "parentName": null,
      "orderIndex": 0,
      "isRouteFolder": false,
      "agentPlan": null
    }
  ],
  "tests": [
    {
      "name": "Login happy path",
      "code": "export async function test(page, ...) { ... }",
      "description": "...",
      "targetUrl": "https://example.com/login",
      "functionalAreaName": "Login Flow",
      "executionMode": "procedural",
      "agentPrompt": null,
      "assertions": null,
      "setupOverrides": null,
      "teardownOverrides": null,
      "stabilizationOverrides": null,
      "viewportOverride": null,
      "diffOverrides": null,
      "playwrightOverrides": null,
      "requiredCapabilities": null,
      "quarantined": false,
      "isPlaceholder": false
    }
  ]
}
```

### `POST /api/v1/repos/:id/import`

Upserts functional areas and tests by name matching (case-insensitive). Handles parent-child area relationships in two passes.

**Request body:** Same shape as the export response.

**Response:**

```json
{
  "success": true,
  "areasCreated": 3,
  "areasUpdated": 1,
  "testsCreated": 12,
  "testsUpdated": 2,
  "errors": []
}
```

## CLI Usage

```bash
# One-liner: pipe export from source → import to target
curl -H "Authorization: Bearer $SOURCE_KEY" \
  "$SOURCE_URL/api/v1/repos/$SOURCE_REPO_ID/export" \
| curl -X POST -H "Authorization: Bearer $TARGET_KEY" \
  -H "Content-Type: application/json" \
  -d @- "$TARGET_URL/api/v1/repos/$TARGET_REPO_ID/import"
```

## In-App UI

Settings → Test Migration card:

1. Enter remote Lastest URL + API key
2. Browse available remote repositories
3. Select source repo → import into current repo
4. Idempotent: re-running updates existing tests by name match

## Key Files

| Path | Role |
|------|------|
| `src/app/api/v1/[...slug]/route.ts` | Export (GET) and import (POST) handlers |
| `src/server/actions/test-migration.ts` | `fetchRemoteRepositories()`, `migrateTests()` server actions |
| `src/components/settings/test-migration-card.tsx` | Migration UI card |
