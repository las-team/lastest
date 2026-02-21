# Feature Spec: Build Composition

## Overview

Per-branch configuration of which tests run in a build, which tests are excluded, and which specific test versions to use — enabling "Compose" page functionality.

## Database: `composeConfigs` Table

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | text PK | UUID | Primary key |
| `repositoryId` | text | required | Repository reference |
| `branch` | text | required | Branch this config applies to |
| `config` | json | required | Composition configuration object |
| `createdAt` | text | now | Creation timestamp |
| `updatedAt` | text | now | Last update timestamp |

### Config JSON Structure
```typescript
{
  selectedTestIds: string[];                    // Tests to include in build
  excludedTestIds: string[];                    // Tests to exclude from build
  versionOverrides: Record<string, string>;     // testId → specific versionId
}
```

## Query Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `upsertComposeConfig` | `(repositoryId, branch, config)` | Create or update per-branch config |
| `getComposeConfig` | `(repositoryId, branch)` | Retrieve compose config for branch |

## Use Case
1. User navigates to Compose page (early adopter feature)
2. Selects tests to include/exclude for a specific branch
3. Optionally pins specific test versions (e.g., use v3 of login test instead of latest)
4. Saves config → `upsertComposeConfig()`
5. When build runs on that branch, executor uses compose config to determine which tests execute and which versions

## Related Features
- **Early Adopter Mode** — Compose page hidden unless `team.earlyAdopterMode = true`
- **Build Execution** — `getBuildTestSummaries()` returns aggregated test summaries per build with version info

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/db/schema.ts` | Table definition |
| `src/lib/db/queries.ts` | `upsertComposeConfig`, `getComposeConfig` |
