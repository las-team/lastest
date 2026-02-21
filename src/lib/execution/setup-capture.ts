/**
 * Setup Capture for Remote Runners
 *
 * When tests need setup (e.g. login), the local PlaywrightRunner handles it
 * automatically. But for remote runners, we need to run the setup locally,
 * capture the storageState (cookies/localStorage), and send it with the command.
 *
 * For remote runners that target a different server instance, use
 * resolveSetupCodeForRunner() to get setup code that can be sent via
 * command:run_setup for execution on the runner itself.
 */

import type { Test } from '@/lib/db/schema';
import type { SetupContext } from '@/lib/setup/types';
import { testNeedsSetup } from '@/lib/setup';
import * as queries from '@/lib/db/queries';

/**
 * Run setup locally for the first test that needs it, capture storageState,
 * and return it so it can be passed to the remote runner.
 *
 * Returns undefined if no tests need setup.
 */
export async function captureSetupForRemoteRunner(
  tests: Test[],
  baseUrl: string,
  repositoryId?: string | null,
): Promise<{ storageState?: string; variables?: Record<string, unknown> } | undefined> {
  // Check if any test needs setup
  let needsSetup = false;
  for (const test of tests) {
    if (await testNeedsSetup(test)) {
      needsSetup = true;
      break;
    }
  }

  if (!needsSetup) return undefined;

  // Find the first test that needs setup and run it locally
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const { getSetupOrchestrator } = await import('@/lib/setup');
    const orchestrator = getSetupOrchestrator();
    const setupContext: SetupContext = {
      baseUrl,
      page,
      variables: {},
      repositoryId: repositoryId || null,
    };

    // Find and run setup for the first test that needs it
    for (const test of tests) {
      if (await testNeedsSetup(test)) {
        console.log(`[setup-capture] Running setup for test "${test.name}" to capture storageState`);
        const setupResult = await orchestrator.runTestSetup(test, page, setupContext);

        if (!setupResult.success) {
          console.warn(`[setup-capture] Setup failed: ${setupResult.error}`);
          return undefined;
        }

        // Merge variables
        if (setupResult.variables) {
          setupContext.variables = { ...setupContext.variables, ...setupResult.variables };
        }

        // Wait for page to settle after setup
        const setupPageUrl = page.url();
        try {
          await page.waitForURL(
            (url: URL) => url.toString() !== setupPageUrl,
            { timeout: 10000, waitUntil: 'networkidle' }
          );
        } catch {
          // URL didn't change
        }

        // Capture storageState
        try {
          const state = await page.context().storageState();
          console.log(`[setup-capture] Captured storageState: ${state.cookies.length} cookies, ${state.origins.length} origins`);
          return {
            storageState: JSON.stringify(state),
            variables: setupContext.variables,
          };
        } catch (e) {
          console.warn('[setup-capture] Failed to capture storageState:', e);
          return undefined;
        }
      }
    }

    return undefined;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Resolve setup code for a set of tests WITHOUT executing it.
 * Returns the code + setupId so it can be sent to a remote runner
 * via command:run_setup for execution on the runner itself.
 *
 * This avoids running setup locally (which produces cookies invalid
 * on the runner's target server).
 */
export async function resolveSetupCodeForRunner(
  tests: Test[],
): Promise<{ code: string; setupId: string } | undefined> {
  for (const test of tests) {
    if (!(await testNeedsSetup(test))) continue;

    // Multi-step default setup: resolve the first step's code
    if (test.repositoryId) {
      const defaultSteps = await queries.getDefaultSetupSteps(test.repositoryId);
      if (defaultSteps.length > 0) {
        const skippedIds = new Set(test.setupOverrides?.skippedDefaultStepIds ?? []);
        for (const step of defaultSteps) {
          if (skippedIds.has(step.id)) continue;
          if (step.stepType === 'test' && step.testId) {
            const setupTest = await queries.getTest(step.testId);
            if (setupTest) return { code: setupTest.code, setupId: setupTest.id };
          } else if (step.stepType === 'script' && step.scriptId) {
            const setupScript = await queries.getSetupScript(step.scriptId);
            if (setupScript?.type === 'playwright') return { code: setupScript.code, setupId: setupScript.id };
          }
        }
      }
    }

    // Legacy: test's own setupTestId
    if (test.setupTestId && test.setupTestId !== test.id) {
      const setupTest = await queries.getTest(test.setupTestId);
      if (setupTest) return { code: setupTest.code, setupId: setupTest.id };
    }

    // Legacy: test's own setupScriptId
    if (test.setupScriptId) {
      const setupScript = await queries.getSetupScript(test.setupScriptId);
      if (setupScript?.type === 'playwright') return { code: setupScript.code, setupId: setupScript.id };
    }

    // Legacy: repository defaults
    if (test.repositoryId) {
      const repo = await queries.getRepository(test.repositoryId);
      if (repo?.defaultSetupTestId && repo.defaultSetupTestId !== test.id) {
        const setupTest = await queries.getTest(repo.defaultSetupTestId);
        if (setupTest) return { code: setupTest.code, setupId: setupTest.id };
      }
      if (repo?.defaultSetupScriptId) {
        const setupScript = await queries.getSetupScript(repo.defaultSetupScriptId);
        if (setupScript?.type === 'playwright') return { code: setupScript.code, setupId: setupScript.id };
      }
    }

    // Found a test needing setup but couldn't resolve code
    console.warn(`[setup-resolve] Test "${test.name}" needs setup but couldn't resolve setup code`);
    return undefined;
  }

  return undefined;
}
