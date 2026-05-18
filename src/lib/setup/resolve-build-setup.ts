/**
 * Single resolver for "what setup runs at the start of a build / run".
 *
 * Walks default_setup_steps once to:
 *   1. Pre-load the first `storage_state` step into setupContext.storageState
 *      (cookies/localStorage that downstream tests cold-start from).
 *   2. Pick the setup *code* to run on a runner — build-level override first
 *      (build.buildSetupTestId / buildSetupScriptId), then per-test fallback
 *      via `resolveSetupCodeForRunner`.
 *
 * Returns a shape ready to drop into `ExecutionOptions` (`setupInfo`,
 * `setupContext`). Replaces ad-hoc copies of this logic in builds.ts / runs.ts
 * / debug.ts.
 */
import type { Test } from '@/lib/db/schema';
import * as queries from '@/lib/db/queries';
import { resolveSetupCodeForRunner } from '@/lib/execution/setup-capture';

export interface ResolveBuildSetupArgs {
  tests: Test[];
  repositoryId: string | null;
  /**
   * Build-level setup overrides. Pass `null` (or omit) for callers without a
   * build row (e.g. ad-hoc test runs, debug). When both `buildSetupTestId` and
   * `buildSetupScriptId` are set, the test wins (matches prior builds.ts order).
   */
  build?: { buildSetupTestId: string | null; buildSetupScriptId: string | null } | null;
  /** Optional log tag — `[build]` for builds, `[test-run]` for runs, etc. */
  logTag?: string;
}

export interface ResolvedBuildSetup {
  setupInfo: { code: string; setupId: string } | undefined;
  setupContext: { storageState?: string; variables: Record<string, unknown> };
  /**
   * `true` when a build-level override was successfully resolved into
   * `setupInfo`. Callers that flip `builds.setupStatus` use this to distinguish
   * "build setup configured & resolved" from "fell back to per-test setup".
   */
  buildSetupResolved: boolean;
}

export async function resolveBuildSetup(args: ResolveBuildSetupArgs): Promise<ResolvedBuildSetup> {
  const { tests, repositoryId, build, logTag } = args;
  const tag = logTag ?? '[setup-resolve]';
  const setupContext: ResolvedBuildSetup['setupContext'] = { variables: {} };

  // 1. Pre-load first matching storage_state step into setupContext
  if (repositoryId) {
    const defaultSteps = await queries.getDefaultSetupSteps(repositoryId);
    for (const step of defaultSteps) {
      if (step.stepType === 'storage_state' && step.storageStateId) {
        const ss = await queries.getStorageState(step.storageStateId);
        if (ss) {
          setupContext.storageState = ss.storageStateJson;
          console.log(`${tag} Pre-loaded storage state "${ss.name}" for setup context`);
          break;
        }
      }
    }
  }

  // 2. Resolve setup code, build-level override first
  let setupInfo: ResolvedBuildSetup['setupInfo'];
  let buildSetupResolved = false;

  if (build?.buildSetupTestId) {
    const setupTest = await queries.getTest(build.buildSetupTestId);
    if (setupTest) {
      setupInfo = { code: setupTest.code, setupId: setupTest.id };
      buildSetupResolved = true;
    } else {
      console.warn(`${tag} Build setup test not found: ${build.buildSetupTestId} - skipping`);
    }
  } else if (build?.buildSetupScriptId) {
    const setupScript = await queries.getSetupScript(build.buildSetupScriptId);
    if (setupScript?.type === 'playwright') {
      setupInfo = { code: setupScript.code, setupId: setupScript.id };
      buildSetupResolved = true;
    } else {
      console.warn(`${tag} Build setup script not found or not playwright type: ${build.buildSetupScriptId} - skipping`);
    }
  }

  if (!setupInfo) {
    setupInfo = await resolveSetupCodeForRunner(tests);
    if (setupInfo) {
      console.log(`${tag} Resolved per-test setup for runner: setupId=${setupInfo.setupId}`);
    }
  }

  return { setupInfo, setupContext, buildSetupResolved };
}
