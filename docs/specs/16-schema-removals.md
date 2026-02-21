# Feature Spec: Schema Simplifications & Removals

## Overview

Significant database simplification: removed deprecated features (teardown workflows, comparison modes, video recording, bug reports, soft deletes) and streamlined the data model.

## Deleted Tables (4)

| Table | Purpose (Removed) |
|-------|-------------------|
| `defaultTeardownSteps` | Teardown step workflows |
| `bugReports` | In-app bug reporting |
| `runnerCommands` | DB-backed runner command queue |
| `runnerCommandResults` | Runner result storage |

## Removed Columns by Table

### `tests`
- ~~`deletedAt`~~ — No more soft deletes; hard delete only

### `testResults`
- ~~`testVersionId`~~ — No version-per-execution tracking
- ~~`videoPath`~~ — Video recording removed
- ~~`softErrors`~~ — All errors now hard errors

### `repositories`
- ~~`defaultComparisonMode`~~ — Always single baseline comparison
- ~~`testingTemplate`~~ — Template workflows removed
- ~~`autoApproveDefaultBranch`~~ — All approvals manual

### `builds`
- ~~`comparisonMode`~~ — Single comparison mode
- ~~`teardownStatus`~~, ~~`teardownError`~~, ~~`teardownDurationMs`~~ — Teardown removed
- ~~`codeChangeTestIds`~~ — Code change detection removed

### `visualDiffs`
- `currentImagePath` — Changed to **NOT NULL** (was nullable)
- ~~`mainBaselineImagePath`~~, ~~`mainDiffImagePath`~~ — No dual-comparison
- ~~`mainPixelDifference`~~, ~~`mainPercentageDifference`~~, ~~`mainClassification`~~ — No main baseline comparison

### `playwrightSettings`
- ~~`enableVideoRecording`~~ — Video removed
- ~~`acceptAnyCertificate`~~, ~~`networkErrorMode`~~, ~~`ignoreExternalNetworkErrors`~~ — Strict error handling
- ~~`consoleErrorMode`~~, ~~`grantClipboardAccess`~~, ~~`acceptDownloads`~~, ~~`enableNetworkInterception`~~ — Moved to per-test `requiredCapabilities`

### `testVersions`
- ~~`branch`~~, ~~`firstBuildId`~~, ~~`firstBuildBranch`~~, ~~`firstBuildCommit`~~ — Versions are repository-wide

### `sessions`
- ~~`updatedAt`~~ — Sessions no longer track updates

### `oauthAccounts`
- ~~`idToken`~~, ~~`accessTokenExpiresAt`~~, ~~`refreshTokenExpiresAt`~~, ~~`scope`~~, ~~`password`~~, ~~`updatedAt`~~ — Simplified OAuth storage

### `functionalAreas`
- ~~`deletedAt`~~ — No more soft deletes

## Modified Enum/Union Types

### BuildStatus — removed `'has_todos'`
```typescript
'safe_to_merge' | 'review_required' | 'blocked'
```

### DiffStatus — removed `'todo'`
```typescript
'pending' | 'approved' | 'rejected' | 'auto_approved'
```

### AIActionType — removed `'classify_template'`
```typescript
'create_test' | 'fix_test' | 'enhance_test' | 'scan_routes' | 'test_connection' |
'analyze_specs' | 'mcp_explore' | 'analyze_diff' | 'extract_user_stories' | 'generate_spec_tests'
```

### BackgroundJobType — added `'ai_fix'`, `'ai_validate'`

### TestChangeReason — removed `'branch_merge'`
```typescript
'initial' | 'manual_edit' | 'ai_fix' | 'ai_enhance' | 'restored'
```

## New Types

### `DiffEngineType`
```typescript
'pixelmatch' | 'ssim' | 'butteraugli'
```

### `TestRequiredCapabilities`
```typescript
interface TestRequiredCapabilities {
  fileUpload?: boolean;
  clipboard?: boolean;
  networkInterception?: boolean;
  downloads?: boolean;
}
```
Added to `tests` table. Replaces global Playwright settings for per-test capability tracking.

## Removed Query Functions (30+)

### Soft Deletes
`softDeleteTest()`, `restoreTest()`, `getDeletedTests()`, `permanentlyDeleteTest()`

### Teardowns
`getDefaultTeardownSteps()`, `createDefaultTeardownStep()`, `deleteDefaultTeardownStep()`, `deleteAllDefaultTeardownSteps()`, `updateDefaultTeardownStepOrder()`, `replaceDefaultTeardownSteps()`, `updateTestTeardownOverrides()`, `getResolvedTeardownStepsForTest()`

### Version Tracking
`getTestVersionsByBranch()`, `stampFirstBuild()`

### Bug Reports
`createBugReport()`, `countRecentBugReports()`, `getBugReportByHash()`, `updateBugReport()`

## Removed Default Constants
- `DEFAULT_STABILIZATION_SETTINGS.waitForImages`
- `DEFAULT_STABILIZATION_SETTINGS.waitForImagesTimeout`
- `DEFAULT_AI_SETTINGS.aiDiffingOllamaBaseUrl`
- `DEFAULT_AI_SETTINGS.aiDiffingOllamaModel`

## Migration Notes
- Convert soft-deleted tests to hard delete or archive externally
- Move teardown logic from `teardownOverrides` into test code
- Remove video recording expectations from CI/CD
- Populate `requiredCapabilities` on tests needing clipboard, downloads, etc.
- Update any bug reporting integrations (system removed)
- Baselines now single-comparison only (no dual main/branch)
