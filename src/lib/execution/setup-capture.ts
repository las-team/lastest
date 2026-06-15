/**
 * Setup code resolution for remote runners.
 *
 * resolveSetupCodeForRunner() returns the setup code + setupId for a set of
 * tests without executing it. The caller sends it to the remote runner via
 * command:run_setup so the setup runs inside the sandboxed EB pod, not in the
 * host process.
 */

import type { Test } from "@/lib/db/schema";
import { testNeedsSetup } from "@/lib/setup";
import * as queries from "@/lib/db/queries";

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
      const defaultSteps = await queries.getDefaultSetupSteps(
        test.repositoryId,
      );
      if (defaultSteps.length > 0) {
        const skippedIds = new Set(
          test.setupOverrides?.skippedDefaultStepIds ?? [],
        );
        for (const step of defaultSteps) {
          if (skippedIds.has(step.id)) continue;
          // Skip storage_state steps — they don't produce code; handled by pre-loading into setupContext
          if (step.stepType === "storage_state") continue;
          if (step.stepType === "test" && step.testId) {
            const setupTest = await queries.getTest(step.testId);
            if (setupTest)
              return { code: setupTest.code, setupId: setupTest.id };
          } else if (step.stepType === "script" && step.scriptId) {
            const setupScript = await queries.getSetupScript(step.scriptId);
            if (setupScript?.type === "playwright")
              return { code: setupScript.code, setupId: setupScript.id };
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
      if (setupScript?.type === "playwright")
        return { code: setupScript.code, setupId: setupScript.id };
    }

    // Legacy: repository defaults
    if (test.repositoryId) {
      const repo = await queries.getRepository(test.repositoryId);
      if (repo?.defaultSetupTestId && repo.defaultSetupTestId !== test.id) {
        const setupTest = await queries.getTest(repo.defaultSetupTestId);
        if (setupTest) return { code: setupTest.code, setupId: setupTest.id };
      }
      if (repo?.defaultSetupScriptId) {
        const setupScript = await queries.getSetupScript(
          repo.defaultSetupScriptId,
        );
        if (setupScript?.type === "playwright")
          return { code: setupScript.code, setupId: setupScript.id };
      }
    }

    // Found a test needing setup but couldn't resolve code
    console.warn(
      `[setup-resolve] Test "${test.name}" needs setup but couldn't resolve setup code`,
    );
    return undefined;
  }

  return undefined;
}
