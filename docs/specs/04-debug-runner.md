# Feature Spec: Interactive Debug Runner

## Overview

Step-by-step interactive test execution for debugging via the web UI. Allows stepping forward/backward through test code, editing mid-session, and capturing network/console logs.

## Architecture

### Singleton Pattern
One instance per repository at a time:
```typescript
getDebugRunner(repositoryId?)
```
- Called without args: returns existing instance (for polling)
- Called with repoId: creates new if repo changed, stops old
- Idle timeout: 5 minutes auto-closes session

### State Machine
```typescript
interface DebugState {
  sessionId: string;
  testId: string;
  status: 'initializing' | 'paused' | 'stepping' | 'running' | 'completed' | 'error';
  currentStepIndex: number;
  steps: DebugStep[];
  stepResults: StepResult[];
  code: string;
  error?: string;
  networkEntries: DebugNetworkEntry[];
  consoleEntries: DebugConsoleEntry[];
  traceUrl?: string;
}
```

### Commands
```typescript
type DebugCommand =
  | { type: 'step_forward' }
  | { type: 'step_back' }
  | { type: 'run_to_end' }
  | { type: 'run_to_step'; stepIndex: number }
  | { type: 'update_code'; code: string }
  | { type: 'stop' };
```

## Step Execution Model

### Cumulative Code
Each step executes all code from step 0 to current step. Variables and state persist across steps.

### Step Back Mechanism
1. Save current trace chunk
2. Close page and browser context
3. Clear network/console logs
4. Recreate page and context
5. Re-run setup code
6. Re-execute steps 0..targetIdx
7. Mark steps after target as pending

### Network & Console Capture
- Intercepts `page.on('request')`, `page.on('response')`, `page.on('console')`
- Both arrays capped at 500 entries (FIFO eviction)

### Tracing
- Playwright tracing started on page creation
- Flushed on `step_back` (before context close)
- Saved on `stop()` to `/debug-traces/{sessionId}.zip`
- Auto-cleaned after 1 hour

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/playwright/debug-runner.ts` (~800 lines) | Full implementation |
| `src/app/api/play-agent/[sessionId]/route.ts` | API endpoint |
| `src/lib/db/schema.ts` | `agentSessions` table for state persistence |

## Database: `agentSessions` Table
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Session UUID |
| `repositoryId` | text | Repository |
| `teamId` | text | Team |
| `status` | text | active / paused / completed / failed / cancelled |
| `currentStepId` | text | Current step identifier |
| `steps` | json | Array of `AgentStepState` objects |
| `metadata` | json | Generic `Record<string, unknown>` |
| `createdAt` | text | Timestamp |
| `completedAt` | text | Timestamp |

## Integration
- Uses `FREEZE_ANIMATIONS_CSS` via `addStyleTag()` (not the old script approach)
- Calls `setupFreezeScripts()` for timestamp/random determinism
- Browser launched with `headless: false` for interactive debugging
