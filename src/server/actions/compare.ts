'use server';

import * as queries from '@/lib/db/queries';
import { requireTeamAccess, requireRepoAccess } from '@/lib/auth';
import { createAndRunBuild } from '@/server/actions/builds';
import { revalidatePath } from 'next/cache';

export interface BranchRunInfo {
  branch: string;
  run: Awaited<ReturnType<typeof queries.getLatestRunByBranch>> | null;
  results: Awaited<ReturnType<typeof queries.getTestResultsWithTestInfo>>;
  allTests: Awaited<ReturnType<typeof queries.getTestsWithRunStatus>>;
  timestamp: Date | null;
}

export async function getLatestRunForBranch(
  branch: string,
  repositoryId?: string
): Promise<BranchRunInfo> {
  const run = await queries.getLatestRunByBranch(branch, repositoryId);

  if (!run) {
    // No run found - get all tests with null status if we have a repositoryId
    const allTests = repositoryId
      ? await queries.getTestsWithRunStatus(repositoryId)
      : [];

    return {
      branch,
      run: null,
      results: [],
      allTests,
      timestamp: null,
    };
  }

  const results = await queries.getTestResultsWithTestInfo(run.id);

  // Get all tests for the repository with their status from this run
  const allTests = run.repositoryId
    ? await queries.getTestsWithRunStatus(run.repositoryId, run.id)
    : [];

  return {
    branch,
    run,
    results,
    allTests,
    timestamp: run.startedAt,
  };
}

export async function queueRunForBranch(branch: string, repositoryId?: string, testIds?: string[]) {
  if (repositoryId) await requireRepoAccess(repositoryId);
  else await requireTeamAccess();

  const result = await createAndRunBuild(
    'manual',
    testIds,
    repositoryId,
    undefined,
    undefined,
    branch,
  );

  revalidatePath('/compare');

  return {
    buildId: result.buildId as string | null,
    testRunId: result.testRunId as string | null,
    queued: 'queued' in result ? true : false,
  };
}
