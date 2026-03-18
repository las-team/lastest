/**
 * Agent Executor — executes tests in "agent" mode using Playwright's
 * built-in agents. The agent receives a natural-language prompt and
 * drives the browser autonomously.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Test } from '@/lib/db/schema';
import {
  spawnAgentProcess,
  createTempSpecDir,
  createTempTestDir,
  writeSeedTest,
  writeSpecFile,
  cleanupTempDir,
} from './agent-bridge';

// ---------------------------------------------------------------------------
// Types (matching existing TestRunResult interface)
// ---------------------------------------------------------------------------

export interface AgentTestRunResult {
  testId: string;
  status: 'passed' | 'failed' | 'error';
  errorMessage?: string;
  screenshots: Array<{ path: string; label?: string }>;
  duration: number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Execute a single test in agent mode.
 *
 * Instead of running procedural Playwright code, the agent receives the
 * test's `agentPrompt` (natural-language description) and autonomously
 * drives the browser to verify the described behavior.
 */
export async function executeAgentTest(
  test: Test,
  options: {
    baseUrl: string;
    screenshotPath: string;
    setupCode?: string;
    timeout?: number;
    headless?: boolean;
    stepLogger?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<AgentTestRunResult> {
  const startTime = Date.now();
  const specsDir = await createTempSpecDir('play-agent');
  const outputDir = await createTempTestDir('play-agent-output');

  try {
    // Write the agent prompt as a spec file
    const prompt = test.agentPrompt || test.description || test.name;
    await writeSpecFile(specsDir, `# Test: ${test.name}\n\n${prompt}`, 'test.md');

    // Write setup/seed test if provided
    if (options.setupCode) {
      await writeSeedTest(specsDir, options.setupCode, 'setup.spec.ts');
    }

    const extraArgs: string[] = [
      `--specs=${specsDir}`,
      `--base-url=${options.baseUrl}`,
      `--output=${outputDir}`,
      `--screenshot-dir=${options.screenshotPath}`,
    ];

    if (options.headless !== false) {
      extraArgs.push('--headless');
    }

    const result = await spawnAgentProcess('generator', extraArgs, {
      timeout: options.timeout ?? 300_000,
      stepLogger: options.stepLogger,
      signal: options.signal,
      env: {
        PLAYWRIGHT_AGENT_MODE: 'play',
      },
    });

    // Collect screenshots from the output directory
    const screenshots = await collectScreenshots(outputDir, options.screenshotPath);

    const duration = Date.now() - startTime;

    if (result.exitCode === 0) {
      return {
        testId: test.id,
        status: 'passed',
        screenshots,
        duration,
      };
    }

    // Parse error from stderr/stdout
    const errorMessage = extractErrorFromOutput(result.stdout, result.stderr);

    return {
      testId: test.id,
      status: 'failed',
      errorMessage,
      screenshots,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      testId: test.id,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Agent execution failed',
      screenshots: [],
      duration,
    };
  } finally {
    await cleanupTempDir(specsDir);
    await cleanupTempDir(outputDir);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect screenshots from agent output dir and copy them to the
 * standard screenshot path for diff processing.
 */
async function collectScreenshots(
  outputDir: string,
  targetDir: string,
): Promise<Array<{ path: string; label?: string }>> {
  const screenshots: Array<{ path: string; label?: string }> = [];

  try {
    await fs.mkdir(targetDir, { recursive: true });
    const files = await fs.readdir(outputDir);

    for (const file of files) {
      if (!file.endsWith('.png') && !file.endsWith('.jpg')) continue;

      const srcPath = path.join(outputDir, file);
      const destPath = path.join(targetDir, file);
      await fs.copyFile(srcPath, destPath);

      screenshots.push({
        path: destPath,
        label: path.basename(file, path.extname(file)).replace(/-/g, ' '),
      });
    }
  } catch {
    // Directory might not exist if agent captured no screenshots
  }

  return screenshots;
}

/**
 * Extract a human-readable error message from agent process output.
 */
function extractErrorFromOutput(stdout: string, stderr: string): string {
  // Look for common error patterns
  const output = stderr || stdout;

  // Playwright error format
  const pwError = output.match(/Error: (.+?)(?:\n|$)/);
  if (pwError) return pwError[1];

  // Timeout
  if (output.includes('Timeout')) return 'Agent execution timed out';

  // Navigation error
  const navError = output.match(/page\.goto: (.+?)(?:\n|$)/);
  if (navError) return `Navigation failed: ${navError[1]}`;

  // Truncate to reasonable length
  const trimmed = output.trim();
  if (trimmed.length > 500) return trimmed.slice(0, 500) + '...';
  return trimmed || 'Agent test failed with unknown error';
}
