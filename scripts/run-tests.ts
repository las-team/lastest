#!/usr/bin/env npx tsx
/**
 * CLI Test Runner for GitHub Actions
 * Supports two modes:
 * 1. Local mode: Runs Playwright tests directly (requires local database and browsers)
 * 2. Remote mode: Dispatches to a remote runner via the Lastest server API
 *
 * Usage:
 *   # Local mode (existing behavior)
 *   npx tsx scripts/run-tests.ts --repo-id <id> [--base-url <url>] [--no-headless] [--output-dir <dir>]
 *
 *   # Remote mode (dispatch to runner)
 *   npx tsx scripts/run-tests.ts --repo-id <id> --server-url <url> --runner-token <token> --runner-id <id> --team-id <id>
 *
 * Options:
 *   --repo-id <id>        Repository ID (required)
 *   --server-url <url>    Lastest server URL (required for remote mode)
 *   --runner-token <tok>  API authentication token (required for remote mode)
 *   --runner-id <id>      Remote runner ID (omit or 'local' for local mode)
 *   --team-id <id>        Team ID (required for remote mode)
 *   --base-url <url>      Override target base URL (default: http://localhost:3000)
 *   --headless            Run headless (default: true)
 *   --no-headless         Show browser window
 *   --output-dir <dir>    Screenshot output for local mode (default: ./test-output)
 *   --timeout <ms>        Timeout for remote build completion (default: 300000)
 */

interface CLIArgs {
  repoId: string;
  serverUrl: string;
  runnerToken: string;
  runnerId: string;
  teamId: string;
  baseUrl: string;
  headless: boolean;
  outputDir: string;
  timeout: number;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    repoId: '',
    serverUrl: '',
    runnerToken: '',
    runnerId: 'local',
    teamId: '',
    baseUrl: 'http://localhost:3000',
    headless: true,
    outputDir: './test-output',
    timeout: 300000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--repo-id':
        result.repoId = args[++i] || '';
        break;
      case '--server-url':
        result.serverUrl = args[++i] || '';
        break;
      case '--runner-token':
        result.runnerToken = args[++i] || '';
        break;
      case '--runner-id':
        result.runnerId = args[++i] || 'local';
        break;
      case '--team-id':
        result.teamId = args[++i] || '';
        break;
      case '--base-url':
        result.baseUrl = args[++i] || result.baseUrl;
        break;
      case '--headless':
        result.headless = true;
        break;
      case '--no-headless':
        result.headless = false;
        break;
      case '--output-dir':
        result.outputDir = args[++i] || result.outputDir;
        break;
      case '--timeout':
        result.timeout = parseInt(args[++i] || '300000', 10);
        break;
    }
  }

  // Read from environment variables as fallback
  result.serverUrl = result.serverUrl || process.env.LASTEST_SERVER_URL || '';
  result.runnerToken = result.runnerToken || process.env.LASTEST_TOKEN || '';
  result.runnerId = result.runnerId || process.env.LASTEST_RUNNER_ID || 'local';
  result.teamId = result.teamId || process.env.LASTEST_TEAM_ID || '';

  if (!result.repoId) {
    console.error('Error: --repo-id is required');
    printUsage();
    process.exit(1);
  }

  return result;
}

function printUsage() {
  console.error(`
Usage:
  # Local mode
  npx tsx scripts/run-tests.ts --repo-id <id> [options]

  # Remote mode
  npx tsx scripts/run-tests.ts --repo-id <id> --server-url <url> --runner-token <token> --runner-id <id> --team-id <id>

Options:
  --repo-id <id>        Repository ID (required)
  --server-url <url>    Lastest server URL (for remote mode)
  --runner-token <tok>  API authentication token (for remote mode)
  --runner-id <id>      Remote runner ID (omit or 'local' for local mode)
  --team-id <id>        Team ID (for remote mode)
  --base-url <url>      Target base URL (default: http://localhost:3000)
  --no-headless         Show browser window
  --output-dir <dir>    Screenshot output (default: ./test-output)
  --timeout <ms>        Remote build timeout (default: 300000)

Environment Variables:
  LASTEST_SERVER_URL    Alternative to --server-url
  LASTEST_TOKEN         Alternative to --runner-token
  LASTEST_RUNNER_ID     Alternative to --runner-id
  LASTEST_TEAM_ID       Alternative to --team-id
`);
}

function isRemoteMode(args: CLIArgs): boolean {
  return args.runnerId !== 'local' && args.runnerId !== '';
}

// =============================================================================
// Remote Mode: Dispatch to Lastest server
// =============================================================================

interface BuildResponse {
  buildId: string;
  testRunId: string;
  testCount: number;
}

interface BuildStatus {
  id: string;
  overallStatus: 'passed' | 'failed' | 'review_required' | 'safe_to_merge' | 'blocked';
  totalTests: number;
  passedCount: number;
  failedCount: number;
  changesDetected: number;
  flakyCount: number;
  completedAt: string | null;
  elapsedMs: number | null;
  diffs: Array<{
    testName: string;
    classification: string;
    percentageDifference: string;
  }>;
}

async function runRemote(args: CLIArgs): Promise<void> {
  // Validate required args for remote mode
  if (!args.serverUrl) {
    console.error('Error: --server-url is required for remote mode');
    process.exit(1);
  }
  if (!args.runnerToken) {
    console.error('Error: --runner-token is required for remote mode');
    process.exit(1);
  }
  if (!args.teamId) {
    console.error('Error: --team-id is required for remote mode');
    process.exit(1);
  }

  console.log('=== Visual Regression Test Runner (Remote Mode) ===');
  console.log(`Server: ${args.serverUrl}`);
  console.log(`Repository ID: ${args.repoId}`);
  console.log(`Runner ID: ${args.runnerId}`);
  console.log(`Team ID: ${args.teamId}`);
  console.log('');

  // Create build via API
  console.log('Creating build...');
  const buildResponse = await createRemoteBuild(args);
  console.log(`Build created: ${buildResponse.buildId}`);
  console.log(`Tests to run: ${buildResponse.testCount}`);
  console.log('');

  // Poll for completion
  console.log('Waiting for build completion...');
  const finalStatus = await waitForBuildCompletion(args, buildResponse.buildId);

  // Print results
  printBuildResults(finalStatus, args.serverUrl);

  // Set GitHub Actions outputs if running in GHA
  await setGitHubOutputs(finalStatus, args.serverUrl);

  // Exit with appropriate code
  const exitCode = getExitCode(finalStatus.overallStatus);
  process.exit(exitCode);
}

async function createRemoteBuild(args: CLIArgs): Promise<BuildResponse> {
  const url = `${args.serverUrl}/api/builds/create`;

  const gitBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown';
  const gitCommit = process.env.GITHUB_SHA?.slice(0, 7) || 'unknown';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.runnerToken}`,
    },
    body: JSON.stringify({
      repositoryId: args.repoId,
      runnerId: args.runnerId,
      teamId: args.teamId,
      triggerType: 'ci',
      gitBranch,
      gitCommit,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create build: ${response.status} ${text}`);
  }

  return response.json();
}

async function waitForBuildCompletion(args: CLIArgs, buildId: string): Promise<BuildStatus> {
  const url = `${args.serverUrl}/api/builds/${buildId}/status`;
  const pollInterval = 3000;
  const startTime = Date.now();
  let lastProgress = '';

  while (Date.now() - startTime < args.timeout) {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${args.runnerToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get build status: ${response.status}`);
    }

    const status: BuildStatus = await response.json();

    // Print progress update
    const progress = `  Progress: ${status.passedCount + status.failedCount}/${status.totalTests} tests`;
    if (progress !== lastProgress) {
      console.log(progress);
      lastProgress = progress;
    }

    // Check if completed
    if (status.completedAt) {
      return status;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Build timed out after ${args.timeout}ms`);
}

function printBuildResults(status: BuildStatus, serverUrl: string) {
  console.log('\n=== Build Results ===');
  console.log(`Status: ${status.overallStatus}`);
  console.log(`Total Tests: ${status.totalTests}`);
  console.log(`Passed: ${status.passedCount}`);
  console.log(`Failed: ${status.failedCount}`);
  console.log(`Changes Detected: ${status.changesDetected}`);
  console.log(`Flaky: ${status.flakyCount}`);
  if (status.elapsedMs) {
    console.log(`Duration: ${(status.elapsedMs / 1000).toFixed(1)}s`);
  }
  console.log(`\nView results: ${serverUrl}/builds/${status.id}`);
}

async function setGitHubOutputs(status: BuildStatus, serverUrl: string) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;

  const { appendFileSync } = await import('fs');
  const outputs = [
    `status=${status.overallStatus}`,
    `build-url=${serverUrl}/builds/${status.id}`,
    `changed-count=${status.changesDetected}`,
    `passed-count=${status.passedCount}`,
    `failed-count=${status.failedCount}`,
    `total-tests=${status.totalTests}`,
  ];

  appendFileSync(outputFile, outputs.join('\n') + '\n');
}

function getExitCode(overallStatus: string): number {
  switch (overallStatus) {
    case 'passed':
    case 'safe_to_merge':
      return 0;
    case 'review_required':
      // Visual changes detected - exit 0 but changes need review
      // User can configure GitHub Actions to treat this as failure if desired
      return 0;
    case 'failed':
    case 'blocked':
    default:
      return 1;
  }
}

// =============================================================================
// Local Mode: Run Playwright directly
// =============================================================================

async function runLocal(args: CLIArgs): Promise<void> {
  // Dynamic imports for local mode only (avoids bundling issues in Docker)
  const { v4: uuid } = await import('uuid');
  const { PlaywrightRunner } = await import('../src/lib/playwright/runner');
  const queries = await import('../src/lib/db/queries');
  type TestRunResult = import('../src/lib/playwright/runner').TestRunResult;

  console.log('=== Visual Regression Test Runner (Local Mode) ===');
  console.log(`Repository ID: ${args.repoId}`);
  console.log(`Base URL: ${args.baseUrl}`);
  console.log(`Headless: ${args.headless}`);
  console.log(`Output Dir: ${args.outputDir}`);
  console.log('');

  // Load tests for the repository
  const tests = await queries.getTestsByRepo(args.repoId);
  if (tests.length === 0) {
    console.log('No tests found for this repository.');
    process.exit(0);
  }
  console.log(`Found ${tests.length} test(s)`);

  // Load settings
  const settings = await queries.getPlaywrightSettings(args.repoId);
  const envConfig = await queries.getEnvironmentConfig(args.repoId);

  // Override base URL from CLI argument
  const config = {
    ...envConfig,
    baseUrl: args.baseUrl,
    mode: 'manual' as const,
  };

  // Create runner instance
  const runner = new PlaywrightRunner(args.repoId, args.outputDir);
  runner.setSettings(settings);
  runner.setEnvironmentConfig(config);

  // Create test run record
  const runId = uuid();
  const testRun = await queries.createTestRun({
    repositoryId: args.repoId,
    status: 'running',
    gitBranch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local',
    gitCommit: process.env.GITHUB_SHA || 'local-' + Date.now(),
    startedAt: new Date(),
  });

  console.log(`\nStarting test run: ${testRun.id}`);
  console.log('');

  // Track results
  let passed = 0;
  let failed = 0;

  const onProgress = (progress: { completed: number; total: number; currentTestName?: string }) => {
    if (progress.currentTestName) {
      console.log(`[${progress.completed + 1}/${progress.total}] Running: ${progress.currentTestName}`);
    }
  };

  const onResult = async (result: TestRunResult) => {
    // Save result to database
    await queries.createTestResult({
      testRunId: testRun.id,
      testId: result.testId,
      status: result.status,
      screenshotPath: result.screenshotPath || null,
      screenshots: result.screenshots.length > 0 ? result.screenshots : null,
      errorMessage: result.errorMessage || null,
      durationMs: result.durationMs,
      viewport: settings.viewportWidth && settings.viewportHeight
        ? `${settings.viewportWidth}x${settings.viewportHeight}`
        : null,
      browser: settings.browser || null,
      consoleErrors: result.consoleErrors || null,
      networkRequests: result.networkRequests || null,
      softErrors: result.softErrors || null,
    });

    // Log result
    const testName = tests.find(t => t.id === result.testId)?.name || result.testId;
    if (result.status === 'passed') {
      passed++;
      console.log(`  ✓ ${testName} (${result.durationMs}ms)`);
    } else {
      failed++;
      console.log(`  ✗ ${testName} (${result.durationMs}ms)`);
      if (result.errorMessage) {
        console.log(`    Error: ${result.errorMessage}`);
      }
    }
  };

  // Run tests
  try {
    await runner.runTests(tests, runId, onProgress, onResult, args.headless);
  } catch (error) {
    console.error('\nTest execution failed:', error);
    process.exit(1);
  }

  // Print summary
  console.log('\n=== Results ===');
  console.log(`Total: ${tests.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  // Exit with appropriate code
  if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed');
    process.exit(0);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs();

  if (isRemoteMode(args)) {
    await runRemote(args);
  } else {
    await runLocal(args);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
