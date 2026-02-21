# Feature Spec: Runner Package Simplification

## Overview

The remote runner (`packages/runner/`) shifted from concurrent multi-test execution to a sequential single-test model with simplified protocol, in-memory command queuing, and relaxed polling.

## Architecture Changes

### Execution Model
| Aspect | Old | New |
|--------|-----|-----|
| Concurrent tests | `activeTests` Map | Sequential only |
| Browser management | Shared instance, pooled | Fresh per test |
| Test timeout | Scaled by concurrency | Fixed 120s |
| Soft errors | Tracked and reported | Removed |
| Status values | passed/failed/timeout/cancelled | passed/failed/cancelled |
| Poll interval | 3 seconds | 30 seconds |

### Browser Lifecycle
```
Per-test execution:
  1. Launch fresh browser
  2. Create context/page
  3. Run test code
  4. Capture screenshots
  5. Close page/context/browser
```

### Removed Features
- `activeTests` tracking and slot-filling
- `ensureBrowser()` pooling and `closeBrowserIfIdle()`
- Timeout scaling calculations
- Heartbeat logging (15s intervals)
- Page event listeners (console, errors, network)
- StorageState injection
- SetupVariables support
- Soft error collection
- Video recording support
- Recording command handling (start/stop/capture)
- Retry queue (`pendingResults`)
- Command deduplication (`seenCommandIds`)

### TestRunResult
```typescript
interface TestRunResult {
  status: 'passed' | 'failed' | 'cancelled';
  durationMs: number;
  error?: { message: string; stack?: string; screenshot?: string };
  logs: LogEntry[];
  screenshots: Array<{ filename: string; data: string; width: number; height: number }>;
}
```

## Protocol Changes (`src/lib/ws/protocol.ts`)

### Removed Message Types
- `command:start_recording`
- `command:stop_recording`
- `command:capture_screenshot`
- `response:recording_stopped`

### Simplified Payloads
**RunTestCommandPayload** — removed `storageState`, `setupVariables`
**TestResultPayload** — removed `softErrors`, removed `'timeout'` status

## Executor Changes (`src/lib/execution/executor.ts`)

### From DB-Backed Queues to In-Memory
```
OLD: Executor → DB Commands Table → Runner Polls → DB Results Table
NEW: Executor → In-Memory Map → Runner Polls HTTP → In-Memory Map
```

### In-Memory Maps
```typescript
__runnerPendingCommands: Map<runnerId, Command[]>
__runnerTestResults: Map<runnerId, TestResultResponse[]>
__runnerScreenshots: Map<runnerId, Message[]>
```

### Simplified Functions
```typescript
queueCommand(runnerId, command)     // push to map
getTestResults(runnerId)             // retrieve and clear
getScreenshots(runnerId)             // retrieve and clear
```

### Removed Functions
- `queueCommandToDB()`, `claimPendingCommands()`, `getCommandsByTestRun()`
- `getUnacknowledgedResults()`, `acknowledgeResults()`
- `timeoutStaleCommands()`, `cleanupOldCommands()`

## Runner CLI
- **Postinstall**: Changed `npx` → `pnpm exec` (project policy)
- **Package**: `lastest2-runner`, npm-publishable with `publishConfig.access: "public"`

## Key Files
| File | Purpose |
|------|---------|
| `packages/runner/src/runner.ts` | Test execution engine |
| `packages/runner/src/client.ts` | Server connection client |
| `packages/runner/src/protocol.ts` | Message protocol types |
| `src/lib/execution/executor.ts` | Server-side executor |
| `src/app/api/ws/runner/route.ts` | WebSocket endpoint |

## Risks
| Risk | Mitigation |
|------|-----------|
| In-memory queues lost on restart | Add Redis or DB persistence for production |
| 30s poll interval latency | Add WebSocket fallback for real-time |
| No concurrent test execution | Sequential is simpler; add job queue later |
