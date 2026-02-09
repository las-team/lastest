/**
 * Setup Capture for Remote Runners
 *
 * When tests need setup (e.g. login), the local PlaywrightRunner handles it
 * automatically. But for remote runners, we need to run the setup locally,
 * capture the storageState (cookies/localStorage), and send it with the command.
 */

import type { Test } from '@/lib/db/schema';
import type { SetupContext } from '@/lib/setup/types';
import { testNeedsSetup, getSetupOrchestrator } from '@/lib/setup';

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
