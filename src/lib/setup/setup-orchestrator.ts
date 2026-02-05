import type { Page } from 'playwright';
import type { SetupContext, SetupResult, ResolvedSetup, SetupScript } from './types';
import type { Test, Suite, Build } from '@/lib/db/schema';
import { runPlaywrightSetup, runTestAsSetup } from './script-runner';
import { runApiSetup } from './api-seeder';
import * as queries from '@/lib/db/queries';

/**
 * SetupOrchestrator coordinates setup execution at all levels:
 * - Build level: Runs once at start of build
 * - Suite level: Runs once before each suite
 * - Test level: Runs before each test
 *
 * Variables flow from higher levels to lower levels:
 * Build Setup → Suite Setup → Test Setup → Test
 */
export class SetupOrchestrator {
  /**
   * Resolve and run setup for any source (test ID or script ID)
   * Returns combined result with merged variables
   */
  async resolveAndRunSetup(
    setupTestId: string | null | undefined,
    setupScriptId: string | null | undefined,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const startTime = Date.now();

    // No setup configured
    if (!setupTestId && !setupScriptId) {
      return { success: true, duration: 0, variables: {} };
    }

    try {
      // setupTestId takes precedence over setupScriptId
      if (setupTestId) {
        return this.runTestAsSetup(setupTestId, page, context);
      }

      if (setupScriptId) {
        return this.runScript(setupScriptId, page, context);
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
   * Run a test as setup (executes test code but skips screenshot capture)
   */
  async runTestAsSetup(
    testId: string,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const test = await queries.getTest(testId);
    if (!test) {
      return {
        success: false,
        error: `Setup test not found: ${testId}`,
        duration: 0,
      };
    }

    return runTestAsSetup(page, test.code, context);
  }

  /**
   * Run a dedicated setup script
   */
  async runScript(
    scriptId: string,
    page: Page,
    context: SetupContext
  ): Promise<SetupResult> {
    const script = await queries.getSetupScript(scriptId);
    if (!script) {
      return {
        success: false,
        error: `Setup script not found: ${scriptId}`,
        duration: 0,
      };
    }

    if (script.type === 'playwright') {
      return runPlaywrightSetup(page, script as SetupScript, context);
    } else if (script.type === 'api') {
      // For API scripts, we need a config
      const configs = await queries.getSetupConfigs(script.repositoryId || '');
      const config = configs[0]; // Use first available config
      if (!config) {
        return {
          success: false,
          error: 'No API config found for API setup script',
          duration: 0,
        };
      }
      // Cast config to SetupConfig type (authType is stored as string in DB)
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
   * Run build-level setup
   * Returns context with variables for suite/test setups
   */
  async runBuildSetup(
    build: Build,
    page: Page,
    baseContext: SetupContext
  ): Promise<SetupResult> {
    const result = await this.resolveAndRunSetup(
      build.buildSetupTestId,
      build.buildSetupScriptId,
      page,
      baseContext
    );

    return result;
  }

  /**
   * Run suite-level setup
   * Receives context from build setup
   */
  async runSuiteSetup(
    suite: Suite,
    page: Page,
    buildContext: SetupContext
  ): Promise<SetupResult> {
    const result = await this.resolveAndRunSetup(
      suite.setupTestId,
      suite.setupScriptId,
      page,
      buildContext
    );

    return result;
  }

  /**
   * Run test-level setup
   * Receives context from suite setup (which includes build setup variables)
   *
   * Uses multi-step default setup steps with per-test overrides:
   * 1. Load default setup steps for repo
   * 2. If no defaults → fall back to legacy setupTestId/setupScriptId
   * 3. Filter out steps in test.setupOverrides.skippedDefaultStepIds
   * 4. Append test.setupOverrides.extraSteps
   * 5. Execute each step sequentially, accumulating variables
   * 6. Stop on first failure
   */
  async runTestSetup(
    test: Test,
    page: Page,
    suiteContext: SetupContext
  ): Promise<SetupResult> {
    const startTime = Date.now();

    // Check for multi-step default setup
    if (test.repositoryId) {
      const defaultSteps = await queries.getDefaultSetupSteps(test.repositoryId);

      if (defaultSteps.length > 0) {
        const overrides = test.setupOverrides;
        const skippedIds = new Set(overrides?.skippedDefaultStepIds ?? []);

        // Filter out skipped defaults
        const activeDefaults = defaultSteps.filter((s) => !skippedIds.has(s.id));

        // Build step list: active defaults + extras
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

        // Execute sequentially, accumulate variables, stop on first failure
        let currentContext = suiteContext;
        for (const step of stepsToRun) {
          const stepTestId = step.stepType === 'test' ? step.testId : null;
          const stepScriptId = step.stepType === 'script' ? step.scriptId : null;

          // Prevent self-referential setup
          if (stepTestId === test.id) continue;

          const result = await this.resolveAndRunSetup(stepTestId, stepScriptId, page, currentContext);
          if (!result.success) {
            return { ...result, duration: Date.now() - startTime };
          }
          if (result.variables) {
            currentContext = this.extendContext(currentContext, result.variables);
          }
        }

        return { success: true, duration: Date.now() - startTime, variables: currentContext.variables };
      }
    }

    // Legacy fallback: single setupTestId/setupScriptId
    let setupTestId = test.setupTestId;
    let setupScriptId = test.setupScriptId;

    // Fall back to repository defaults if test has no setup configured
    if (!setupTestId && !setupScriptId && test.repositoryId) {
      const repo = await queries.getRepository(test.repositoryId);
      if (repo) {
        setupTestId = repo.defaultSetupTestId;
        setupScriptId = repo.defaultSetupScriptId;
      }
    }

    // Prevent self-referential setup (a test running itself as setup)
    if (setupTestId === test.id) {
      return { success: true, duration: 0, variables: {} };
    }

    return this.resolveAndRunSetup(setupTestId, setupScriptId, page, suiteContext);
  }

  /**
   * Merge variables from multiple setup results
   * Later variables override earlier ones
   */
  mergeVariables(...results: SetupResult[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const result of results) {
      if (result.variables) {
        Object.assign(merged, result.variables);
      }
    }
    return merged;
  }

  /**
   * Create a new context with merged variables
   */
  extendContext(
    baseContext: SetupContext,
    newVariables: Record<string, unknown>
  ): SetupContext {
    return {
      ...baseContext,
      variables: {
        ...baseContext.variables,
        ...newVariables,
      },
    };
  }
}

// Singleton instance
let orchestratorInstance: SetupOrchestrator | null = null;

export function getSetupOrchestrator(): SetupOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new SetupOrchestrator();
  }
  return orchestratorInstance;
}

/**
 * Helper to check if a test needs setup
 */
export async function testNeedsSetup(test: Test): Promise<boolean> {
  // Check for extra steps in overrides
  if (test.setupOverrides?.extraSteps?.length) {
    return true;
  }

  // Check multi-step default setup steps
  if (test.repositoryId) {
    const defaultSteps = await queries.getDefaultSetupSteps(test.repositoryId);
    if (defaultSteps.length > 0) {
      const skippedIds = new Set(test.setupOverrides?.skippedDefaultStepIds ?? []);
      // If not all defaults are skipped, setup is needed
      const hasActiveDefaults = defaultSteps.some((s) => !skippedIds.has(s.id));
      if (hasActiveDefaults) return true;
    }
  }

  // Legacy fallback: check test's own setup (but not if it references itself)
  if (test.setupTestId && test.setupTestId !== test.id) {
    return true;
  }
  if (test.setupScriptId) {
    return true;
  }

  // Legacy: check repository defaults
  if (test.repositoryId) {
    const repo = await queries.getRepository(test.repositoryId);
    if (repo?.defaultSetupTestId && repo.defaultSetupTestId !== test.id) {
      return true;
    }
    if (repo?.defaultSetupScriptId) {
      return true;
    }
  }

  return false;
}

/**
 * Helper to get resolved setup info for display
 */
export async function getResolvedSetup(
  setupTestId: string | null | undefined,
  setupScriptId: string | null | undefined
): Promise<ResolvedSetup> {
  if (setupTestId) {
    const test = await queries.getTest(setupTestId);
    if (test) {
      return {
        type: 'test',
        test: {
          id: test.id,
          name: test.name,
          code: test.code,
          targetUrl: test.targetUrl,
        },
      };
    }
  }

  if (setupScriptId) {
    const script = await queries.getSetupScript(setupScriptId);
    if (script) {
      return {
        type: 'script',
        script: script as SetupScript,
      };
    }
  }

  return { type: 'none' };
}
