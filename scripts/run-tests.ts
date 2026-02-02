#!/usr/bin/env npx tsx
/**
 * CLI Test Runner for GitHub Actions
 * Runs visual regression tests directly (bypassing Next.js server actions) for CI/CD pipelines.
 *
 * Usage:
 *   npx tsx scripts/run-tests.ts --repo-id <id> [--base-url <url>] [--headless] [--output-dir <dir>]
 *
 * Options:
 *   --repo-id <id>      Repository ID (required)
 *   --base-url <url>    Override base URL (default: http://localhost:3000)
 *   --headless          Run headless (default: true)
 *   --output-dir <dir>  Screenshot output (default: ./test-output)
 */

import { v4 as uuid } from 'uuid';
import { PlaywrightRunner } from '../src/lib/playwright/runner';
import {
  getTestsByRepo,
  getPlaywrightSettings,
  getEnvironmentConfig,
  createTestRun,
  createTestResult,
} from '../src/lib/db/queries';
import type { TestRunResult } from '../src/lib/playwright/runner';

// Parse CLI arguments
function parseArgs(): {
  repoId: string;
  baseUrl: string;
  headless: boolean;
  outputDir: string;
} {
  const args = process.argv.slice(2);
  let repoId = '';
  let baseUrl = 'http://localhost:3000';
  let headless = true;
  let outputDir = './test-output';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--repo-id':
        repoId = args[++i] || '';
        break;
      case '--base-url':
        baseUrl = args[++i] || baseUrl;
        break;
      case '--headless':
        headless = true;
        break;
      case '--no-headless':
        headless = false;
        break;
      case '--output-dir':
        outputDir = args[++i] || outputDir;
        break;
    }
  }

  if (!repoId) {
    console.error('Error: --repo-id is required');
    console.error('Usage: npx tsx scripts/run-tests.ts --repo-id <id> [options]');
    process.exit(1);
  }

  return { repoId, baseUrl, headless, outputDir };
}

async function main() {
  const { repoId, baseUrl, headless, outputDir } = parseArgs();

  console.log('=== Visual Regression Test Runner ===');
  console.log(`Repository ID: ${repoId}`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Headless: ${headless}`);
  console.log(`Output Dir: ${outputDir}`);
  console.log('');

  // Load tests for the repository
  const tests = await getTestsByRepo(repoId);
  if (tests.length === 0) {
    console.log('No tests found for this repository.');
    process.exit(0);
  }
  console.log(`Found ${tests.length} test(s)`);

  // Load settings
  const settings = await getPlaywrightSettings(repoId);
  const envConfig = await getEnvironmentConfig(repoId);

  // Override base URL from CLI argument
  const config = {
    ...envConfig,
    baseUrl,
    mode: 'manual' as const, // CI mode always uses manual (server already running)
  };

  // Create runner instance
  const runner = new PlaywrightRunner(repoId, outputDir);
  runner.setSettings(settings);
  runner.setEnvironmentConfig(config);

  // Create test run record
  const runId = uuid();
  const testRun = await createTestRun({
    repositoryId: repoId,
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
    await createTestResult({
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
    await runner.runTests(tests, runId, onProgress, onResult, headless);
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

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
