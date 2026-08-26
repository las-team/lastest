import "server-only";

import * as queries from "@/lib/db/queries";

/**
 * "What does this repo already have that a run could authenticate with?"
 *
 * Composition-root code, not a feature's. It used to be `findExistingAuthSetup()`
 * in `src/lib/qa-agent/auth.ts` (a file that is now fully migrated away —
 * `plugins/qa-agent/src/domain/auth.ts` is its page-driving half), and it has
 * two consumers, both host fills: `src/lib/core/explorer-host.ts`
 * (`ExplorerHost.resolveExistingAuth`) and `src/lib/core/qa-agent-host.ts`
 * (`QaAgentHost.resolveExistingAuth`) — the same method, declared verbatim in
 * two plugins' ports, which is recipe §1.5's signal that this wants to become
 * a `core/browser` credential-resolution capability (its own PR).
 *
 * It lives here rather than in either plugin for the reason recipe §1.6.2
 * gives (same shape as `quickstart-storage-shared.ts`): two features want it,
 * neither owns it, and it reads nothing but core tables (`setup_steps`,
 * `tests`, `setup_scripts`, `storage_states`).
 *
 * Nothing here touches a browser, which is the other half of why it did not
 * come along: `plugins/qa-agent/src/domain/auth.ts` is now page-driving code
 * only, and says so in its header.
 */
/** What the repo's existing setup infrastructure offers for auth. */
/** What the repo's existing setup infrastructure offers for auth. */
export interface ExistingAuthSetup {
  /** Newest usable storage state (from default steps, or the repo's list). */
  storageStateId?: string;
  storageStateName?: string;
  /** First default setup step that is a test (its id, for qaAuth.setupTestId). */
  setupTestId?: string;
  /** First default setup step that is a script — runnable to mint a fresh
   *  session when no (valid) storage state exists. */
  setupScriptId?: string;
  setupStepName?: string;
  /** Repo default setup steps include a test/script/storage_state — the
   *  executor already applies them to every test. */
  defaultSetupInUse: boolean;
}

/**
 * Check the repo's existing setup infrastructure, strongest first: default
 * setup steps (storage_state step wins, then test/script steps), then the
 * repo's storage-state list (non-expired, newest first, agent-captured names
 * preferred so a prior QA/QuickStart login is picked over unrelated states).
 */
export async function findExistingAuthSetup(
  repositoryId: string,
): Promise<ExistingAuthSetup> {
  const result: ExistingAuthSetup = { defaultSetupInUse: false };

  const defaults = await queries
    .getDefaultSetupSteps(repositoryId)
    .catch(() => []);
  if (defaults.length > 0) {
    result.defaultSetupInUse = true;
    const storageStep = defaults.find(
      (s) => s.stepType === "storage_state" && s.storageStateId,
    );
    if (storageStep?.storageStateId) {
      result.storageStateId = storageStep.storageStateId;
      result.storageStateName = storageStep.storageStateName ?? undefined;
    }
    const testStep = defaults.find((s) => s.stepType === "test" && s.testId);
    if (testStep?.testId) {
      result.setupTestId = testStep.testId;
      result.setupStepName = testStep.testName ?? undefined;
    } else {
      const scriptStep = defaults.find(
        (s) => s.stepType === "script" && s.scriptId,
      );
      if (scriptStep?.scriptId) {
        result.setupScriptId = scriptStep.scriptId;
        result.setupStepName = scriptStep.scriptName ?? undefined;
      }
    }
  }

  if (!result.storageStateId) {
    const now = Date.now();
    const rows = await queries.getStorageStates(repositoryId).catch(() => []);
    const preferred = (name: string) =>
      /^(QA agent |QuickStart login |QuickStart signup )/i.test(name) ? 0 : 1;
    const candidate = rows
      .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
      .sort(
        (a, b) =>
          preferred(a.name) - preferred(b.name) ||
          (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      )[0];
    if (candidate) {
      result.storageStateId = candidate.id;
      result.storageStateName = candidate.name;
    }
  }

  return result;
}
