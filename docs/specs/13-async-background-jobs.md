# Feature Spec: Async Background Job Processing

## Overview

All long-running operations (AI scans, spec analysis, test generation, builds) now use a fire-and-forget background job pattern with parallel AI execution via semaphore-based concurrency control.

## Pattern

### Server Action Flow
```typescript
// 1. Validate input (synchronous, return early on error)
if (!isValid) return { error: '...' };

// 2. Create job immediately
const jobId = await createJob(type, label, total, repositoryId);

// 3. Return jobId to caller
return { success: true, jobId };

// 4. Launch async function without awaiting
asyncFunction(...).catch(console.error);
```

### Client-Side Polling
```
1. Call server action → receive jobId
2. Poll /api/jobs/[jobId] for status
3. Check job.status === 'completed'
4. Retrieve results from job.metadata
```

## Parallel AI Module (`src/lib/ai/parallel.ts`)

### API
```typescript
async function runParallel<T>(
  tasks: ParallelTask<T>[],
  maxConcurrent: number = 5,
  onProgress?: (completed: number, total: number, activeCount: number) => Promise<void>
): Promise<ParallelResult<T>[]>

interface ParallelTask<T> {
  id: string;
  execute: () => Promise<T>;
}

interface ParallelResult<T> {
  id: string;
  success: boolean;
  result?: T;
  error?: string;
}
```

### Features
- Semaphore pattern for bounded concurrency (default: 5)
- Maintains result order matching input order
- Progress callbacks for job tracking
- Individual task failures don't abort others

### Used By
| Function | Concurrency | Purpose |
|----------|-------------|---------|
| `aiFixAllFailedTestsAsync()` | 5 | AI fix all failing tests |
| `aiFixTestsAsync()` | 5 | AI fix selected tests |
| `aiMcpFixTestsAsync()` | 5 | MCP-based test fixes |
| `saveAndBuildTestsAsync()` | 5 | Parallel test generation from specs |

## Background Job Types
```typescript
type BackgroundJobType =
  | 'ai_scan'      // Route scanning
  | 'spec_analysis' // Spec analysis
  | 'build_tests'   // Test generation from specs
  | 'test_run'      // Individual test execution
  | 'build_run'     // Full build execution
  | 'ai_fix'        // AI test fixing (NEW)
  | 'ai_validate'   // AI test validation (NEW)
```

## Operations Converted to Async
| Operation | Sync Function | Async Function |
|-----------|--------------|----------------|
| Route scanning | `aiScanRoutes()` | `aiScanRoutesAsync()` |
| MCP exploration | `mcpExploreRoutes()` | `mcpExploreRoutesAsync()` |
| Fix all failed | `aiFixAllFailedTests()` | `aiFixAllFailedTestsAsync()` |
| Fix selected | `aiFixTests()` | `aiFixTestsAsync()` |
| MCP fix | `aiMcpFixTests()` | `aiMcpFixTestsAsync()` |
| Spec analysis | `analyzeSelectedSpecs()` | `analyzeSelectedSpecsAsync()` |
| Repo spec scan | `scanRepoSpecs()` | `scanRepoSpecsAsync()` |
| Upload analysis | `analyzeUploadedSpecs()` | `analyzeUploadedSpecsAsync()` |
| Test building | `saveAndBuildTests()` | `saveAndBuildTestsAsync()` |

## Result Storage
Results stored in `backgroundJobs.metadata` JSON field:
```typescript
await queries.updateBackgroundJob(jobId, {
  metadata: {
    functionalAreas: [...],     // Route scanning results
    analysisResult: {...},       // Spec analysis results
    testsCreated: number,        // Test building results
  }
});
```

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/ai/parallel.ts` (84 lines) | Semaphore-based concurrency |
| `src/server/actions/ai-routes.ts` | Route scanning async |
| `src/server/actions/ai.ts` | Test fixing async |
| `src/server/actions/spec-analysis.ts` | Spec analysis async |
| `src/server/actions/spec-import.ts` | Test building async |
| `src/server/actions/jobs.ts` | Job management actions |
| `src/app/api/jobs/[jobId]/route.ts` | Job status API endpoint |
| `src/components/queue/use-job-result.ts` | Client-side job result hook |
