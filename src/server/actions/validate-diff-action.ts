"use server";

import { requireRepoAccess } from "@/lib/auth";

/**
 * The `"use server"` entry point for diff-scoped validation (E6).
 *
 * Split out of `src/server/actions/api-tests.ts` when `api-test` became
 * `@lastest/plugin-api-test`. It had been living there for no better reason
 * than shared feature-numbering: it maps a pasted git diff to affected tests
 * and runs a scoped *build*, which is the executor's business and touches no
 * API test at all. Leaving it in the plugin would have made "run a build" a
 * host-port method, i.e. carried the coupling across the boundary in a nicer
 * coat (RFC §4.3).
 *
 * `validate-diff.ts` itself cannot carry the directive: a `"use server"` module
 * may only export async functions, and that file exports its result types.
 */
export async function validateDiffAction(input: {
  repositoryId: string;
  diff?: string;
  baseBranch?: string;
  headBranch?: string;
  wait?: boolean;
  maxWaitMs?: number;
}): Promise<import("@/server/actions/validate-diff").ValidateDiffResult> {
  await requireRepoAccess(input.repositoryId);
  const { validateDiffCore } = await import("@/server/actions/validate-diff");
  return validateDiffCore(input);
}
