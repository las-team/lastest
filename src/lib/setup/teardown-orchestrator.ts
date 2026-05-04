import type { Page } from 'playwright';
import type { SetupContext, SetupResult, SetupScript } from './types';
import type { Test } from '@/lib/db/schema';
import { runPlaywrightSetup, runTestAsSetup } from './script-runner';
import { runApiSetup } from './api-seeder';
import * as queries from '@/lib/db/queries';

/**
 * TeardownOrchestrator coordinates teardown execution after tests.
 * Teardown errors are non-blocking — a passed test stays passed even if teardown fails.
 */
export class TeardownOrchestrator {
  /**
   * Resolve and run a single teardown step (test ID or script ID)
   */
  async resolveAndRunTeardown(
    teardownTestId: string | null | undefined,
    teardownScriptId: string | null | undefined,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const startTime = Date.now();

    if (!teardownTestId && !teardownScriptId) {
      return { success: true, duration: 0, variables: {} };
    }

    try {
      if (teardownTestId) {
        return this.runTestAsTeardown(teardownTestId, page, context);
      }

      if (teardownScriptId) {
        return this.runScript(teardownScriptId, page, context);
      }

      return { success: true, duration: 0, variables: {} };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Run a test as teardown (executes test code but skips screenshot capture)
   */
  async runTestAsTeardown(
    testId: string,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const test = await queries.getTest(testId);
    if (!test) {
      console.warn(`Teardown test not found: ${testId} - skipping teardown (orphaned reference)`);
      return { success: true, duration: 0, variables: {} };
    }

    return runTestAsSetup(page, test.code, context, testId);
  }

  /**
   * Run a dedicated teardown script
   */
  async runScript(
    scriptId: string,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const script = await queries.getSetupScript(scriptId);
    if (!script) {
      console.warn(`Teardown script not found: ${scriptId} - skipping teardown (orphaned reference)`);
      return { success: true, duration: 0, variables: {} };
    }

    if (script.type === 'playwright') {
      return runPlaywrightSetup(page, script as SetupScript, context);
    } else if (script.type === 'api') {
      const configs = await queries.getSetupConfigs(script.repositoryId || '');
      const config = configs[0];
      if (!config) {
        return {
          success: false,
          error: 'No API config found for API teardown script',
          duration: 0,
        };
      }
      const setupConfig = {
        ...config,
        authType: config.authType as 'none' | 'bearer' | 'basic' | 'custom',
      };
      return runApiSetup(setupConfig, script as SetupScript, context);
    }

    return {
      success: false,
      error: `Unknown script type: ${script.type}`,
      duration: 0,
    };
  }

  /**
   * Run test-level teardown.
   * Uses multi-step default teardown steps with per-test overrides:
   * 1. Load default teardown steps for repo
   * 2. Filter out steps in test.teardownOverrides.skippedDefaultStepIds
   * 3. Append test.teardownOverrides.extraSteps
   * 4. Execute each step sequentially
   * 5. Continue on failure (teardown errors are non-blocking)
   */
  async runTestTeardown(
    test: Test,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    if (!test.repositoryId) {
      return { success: true, duration: 0, variables: {} };
    }

    const defaultSteps = await queries.getDefaultTeardownSteps(test.repositoryId);
    if (defaultSteps.length === 0 && !test.teardownOverrides?.extraSteps?.length) {
      return { success: true, duration: 0, variables: {} };
    }

    const overrides = test.teardownOverrides;
    const skippedIds = new Set(overrides?.skippedDefaultStepIds ?? []);

    const activeDefaults = defaultSteps.filter((s) => !skippedIds.has(s.id));

    const stepsToRun: Array<{ stepType: string; testId: string | null; scriptId: string | null }> = [
      ...activeDefaults.map((s) => ({ stepType: s.stepType, testId: s.testId, scriptId: s.scriptId })),
    ];

    if (overrides?.extraSteps) {
      for (const extra of overrides.extraSteps) {
        stepsToRun.push({
          stepType: extra.stepType,
          testId: extra.testId ?? null,
          scriptId: extra.scriptId ?? null,
        });
      }
    }

    // Execute sequentially, but continue on failure (non-blocking)
    let currentContext = context;
    for (const step of stepsToRun) {
      const stepTestId = step.stepType === 'test' ? step.testId : null;
      const stepScriptId = step.stepType === 'script' ? step.scriptId : null;

      // Prevent self-referential teardown
      if (stepTestId === test.id) continue;

      try {
        const result = await this.resolveAndRunTeardown(stepTestId, stepScriptId, page, currentContext);
        if (!result.success) {
          console.warn(`[teardown] Step failed: ${result.error}`);
          errors.push(result.error || 'Unknown teardown error');
        }
        if (result.variables) {
          currentContext = {
            ...currentContext,
            variables: { ...currentContext.variables, ...result.variables },
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[teardown] Step threw: ${msg}`);
        errors.push(msg);
      }
    }

    return {
      success: errors.length === 0,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      variables: currentContext.variables,
    };
  }
}

// Singleton instance
let teardownInstance: TeardownOrchestrator | null = null;

export function getTeardownOrchestrator(): TeardownOrchestrator {
  if (!teardownInstance) {
    teardownInstance = new TeardownOrchestrator();
  }
  return teardownInstance;
}

/**
 * Helper to check if a test needs teardown
 */
export async function testNeedsTeardown(test: Test): Promise<boolean> {
  if (test.teardownOverrides?.extraSteps?.length) {
    return true;
  }

  if (test.repositoryId) {
    const defaultSteps = await queries.getDefaultTeardownSteps(test.repositoryId);
    if (defaultSteps.length > 0) {
      const skippedIds = new Set(test.teardownOverrides?.skippedDefaultStepIds ?? []);
      const hasActiveDefaults = defaultSteps.some((s) => !skippedIds.has(s.id));
      if (hasActiveDefaults) return true;
    }
  }

  return false;
}
