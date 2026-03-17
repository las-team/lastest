/**
 * Healer Agent — auto-fixes failing tests using Playwright's built-in
 * Healer agent which replays the test, inspects the live UI, and patches
 * broken selectors/assertions.
 */

import * as queries from '@/lib/db/queries';
import { requireRepoAccess } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { getCurrentBranchForRepo } from '@/lib/git-utils';
import {
  spawnAgentProcess,
  createTempTestDir,
  parseHealerOutput,
  cleanupTempDir,
  convertPwTestToLastest2,
} from './agent-bridge';
import { promises as fs } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealerResult {
  success: boolean;
  patchedCode?: string;
  attempts: number;
  log: string[];
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const MAX_HEAL_ATTEMPTS = 3;

/**
 * Run the Playwright Healer agent on a failing test.
 *
 * Writes the test to a temp dir, runs the Healer, reads the patched output.
 * Retries up to MAX_HEAL_ATTEMPTS times.
 */
export async function runHealerAgent(
  testCode: string,
  errorMessage: string,
  baseUrl: string,
  options?: {
    timeout?: number;
    stepLogger?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<HealerResult> {
  const log: string[] = [];
  let currentCode = testCode;

  for (let attempt = 1; attempt <= MAX_HEAL_ATTEMPTS; attempt++) {
    const testsDir = await createTempTestDir('healer');

    try {
      // Write the current (possibly already-patched) test code
      // Convert from Lastest2 format to PW format for the healer
      const pwCode = convertToPwFormat(currentCode);
      await fs.writeFile(path.join(testsDir, 'failing.spec.ts'), pwCode, 'utf-8');

      // Write error context file for the healer
      await fs.writeFile(
        path.join(testsDir, 'error-context.txt'),
        `Error from last run:\n${errorMessage}`,
        'utf-8',
      );

      const extraArgs: string[] = [
        `--tests=${testsDir}`,
        `--base-url=${baseUrl}`,
        `--output=${testsDir}`,
      ];

      log.push(`Attempt ${attempt}/${MAX_HEAL_ATTEMPTS}: running healer...`);

      const result = await spawnAgentProcess('healer', extraArgs, {
        timeout: options?.timeout ?? 300_000,
        stepLogger: (line) => {
          log.push(line);
          options?.stepLogger?.(line);
        },
        signal: options?.signal,
      });

      // Parse patched output
      const patched = await parseHealerOutput(testsDir);
      if (patched.length > 0) {
        const patchedCode = patched[0].patchedCode;
        log.push(`Attempt ${attempt}: healer produced patched code`);

        // If exit code 0, the healer verified the fix works
        if (result.exitCode === 0) {
          return {
            success: true,
            patchedCode,
            attempts: attempt,
            log,
          };
        }

        // Non-zero exit: the patch might still be an improvement, try again
        currentCode = patchedCode;
        log.push(`Attempt ${attempt}: healer exited with code ${result.exitCode}, retrying...`);
      } else {
        log.push(`Attempt ${attempt}: healer produced no output`);
        break;
      }
    } finally {
      await cleanupTempDir(testsDir);
    }
  }

  // Return best effort — the last patched code even if not verified
  if (currentCode !== testCode) {
    return {
      success: false,
      patchedCode: currentCode,
      attempts: MAX_HEAL_ATTEMPTS,
      log,
    };
  }

  return {
    success: false,
    attempts: MAX_HEAL_ATTEMPTS,
    log,
  };
}

// ---------------------------------------------------------------------------
// Server-action-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * Heal a single failing test using the PW Healer agent.
 */
export async function agentHealTest(
  repositoryId: string,
  testId: string,
): Promise<{ success: boolean; code?: string; error?: string }> {
  await requireRepoAccess(repositoryId);

  try {
    const test = await queries.getTest(testId);
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Get latest error
    const results = await queries.getTestResultsByTest(testId);
    const latestResult = results[results.length - 1];
    const errorMessage = latestResult?.errorMessage || 'Test failed with unknown error';

    // Get base URL
    const envConfig = await queries.getEnvironmentConfig(repositoryId);
    const baseUrl = test.targetUrl || envConfig?.baseUrl || 'http://localhost:3000';

    const settings = await queries.getAISettings(repositoryId);

    const result = await runHealerAgent(test.code, errorMessage, baseUrl, {
      timeout: settings.pwAgentTimeout ?? 300_000,
    });

    if (result.patchedCode) {
      return { success: true, code: result.patchedCode };
    }

    return { success: false, error: `Healer failed after ${result.attempts} attempts` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Healer agent failed';
    return { success: false, error: message };
  }
}

/**
 * Heal multiple failing tests in bulk.
 */
export async function agentHealTests(
  testIds: string[],
  repositoryId: string,
): Promise<{ success: boolean; fixed: number; failed: number; errors: string[] }> {
  await requireRepoAccess(repositoryId);
  const branch = await getCurrentBranchForRepo(repositoryId);
  const errors: string[] = [];
  let fixed = 0;
  let failed = 0;

  // Process with concurrency limit of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < testIds.length; i += CONCURRENCY) {
    const batch = testIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (testId) => {
        const result = await agentHealTest(repositoryId, testId);
        if (result.success && result.code) {
          await queries.updateTestWithVersion(testId, { code: result.code }, 'ai_fix', branch ?? undefined);
          return { testId, success: true };
        }
        return { testId, success: false, error: result.error };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) {
        fixed++;
      } else {
        failed++;
        const error = r.status === 'fulfilled' ? r.value.error : r.reason?.message;
        errors.push(error || 'Unknown error');
      }
    }
  }

  revalidatePath('/tests');
  return { success: true, fixed, failed, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert Lastest2's function signature to standard Playwright test format
 * so the Healer agent can understand it.
 */
function convertToPwFormat(code: string): string {
  // If already in PW format, return as-is
  if (code.includes("from '@playwright/test'") || code.includes('from "@playwright/test"')) {
    return code;
  }

  // Extract the function body
  const bodyMatch = code.match(
    /export\s+async\s+function\s+test\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/,
  );

  if (bodyMatch) {
    const body = bodyMatch[1].trim();
    return `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n  ${body}\n});\n`;
  }

  // Fallback: wrap entire code
  return `import { test, expect } from '@playwright/test';\n\ntest('test', async ({ page }) => {\n  ${code}\n});\n`;
}
