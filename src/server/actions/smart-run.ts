'use server';

import * as queries from '@/lib/db/queries';
import { compareBranches } from '@/lib/github/content';
import { findAffectedTests, findUnaffectedTests, type AffectedTest } from '@/lib/smart-selection/file-matcher';
import { createAndRunBuild } from './builds';
import type { TriggerType } from '@/lib/db/schema';

export interface SmartRunAnalysis {
  currentBranch: string;
  baseBranch: string;
  changedFiles: string[];
  affectedTests: AffectedTest[];
  skippedTests: { id: string; name: string }[];
  isAvailable: boolean;
  unavailableReason?: string;
}

/**
 * Analyze which tests would be affected by a smart run
 * Uses GitHub API to compare the selected branch against the default branch
 */
export async function analyzeSmartRun(
  repositoryId: string | null
): Promise<SmartRunAnalysis> {
  // Check if we have a repository ID
  if (!repositoryId) {
    return {
      currentBranch: '',
      baseBranch: '',
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: 'No repository selected',
    };
  }

  // Get repository info
  const repo = await queries.getRepository(repositoryId);
  if (!repo) {
    return {
      currentBranch: '',
      baseBranch: '',
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: 'Repository not found',
    };
  }

  // Get GitHub account for API access
  const account = await queries.getGithubAccount();
  if (!account?.accessToken) {
    return {
      currentBranch: '',
      baseBranch: '',
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: 'GitHub not connected',
    };
  }

  // Determine branches to compare
  const currentBranch = repo.selectedBranch || repo.defaultBranch || 'main';
  const baseBranch = repo.defaultBranch || 'main';

  // If on the same branch as base, smart run isn't useful
  if (currentBranch === baseBranch) {
    return {
      currentBranch,
      baseBranch,
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: `Already on ${baseBranch} branch. Select a feature branch to compare.`,
    };
  }

  // Compare branches using GitHub API
  const comparison = await compareBranches(
    account.accessToken,
    repo.owner,
    repo.name,
    baseBranch,
    currentBranch
  );

  if (!comparison) {
    return {
      currentBranch,
      baseBranch,
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: 'Failed to compare branches. Check if both branches exist.',
    };
  }

  // Get list of changed files
  const changedFiles = comparison.files.map((f) => f.filename);

  // If no changed files, smart run isn't useful
  if (changedFiles.length === 0) {
    return {
      currentBranch,
      baseBranch,
      changedFiles: [],
      affectedTests: [],
      skippedTests: [],
      isAvailable: false,
      unavailableReason: 'No changed files between branches',
    };
  }

  // Find affected and skipped tests
  const affectedTests = await findAffectedTests(changedFiles, repositoryId);
  const skippedTests = await findUnaffectedTests(changedFiles, repositoryId);

  // If no tests would be affected, smart run isn't useful
  if (affectedTests.length === 0) {
    return {
      currentBranch,
      baseBranch,
      changedFiles,
      affectedTests: [],
      skippedTests,
      isAvailable: false,
      unavailableReason: 'No tests match the changed files',
    };
  }

  return {
    currentBranch,
    baseBranch,
    changedFiles,
    affectedTests,
    skippedTests,
    isAvailable: true,
  };
}

/**
 * Run only the tests affected by git changes (smart run)
 */
export async function runSmartBuild(
  repositoryId: string | null,
  runnerId?: string
): Promise<{ buildId: string; testCount: number } | { error: string }> {
  // Get analysis
  const analysis = await analyzeSmartRun(repositoryId);

  if (!analysis.isAvailable) {
    return { error: analysis.unavailableReason || 'Smart run not available' };
  }

  if (analysis.affectedTests.length === 0) {
    return { error: 'No tests to run' };
  }

  // Get affected test IDs
  const testIds = analysis.affectedTests.map((t) => t.testId);

  // Run the build with only affected tests
  const result = await createAndRunBuild(
    'manual' as TriggerType,
    testIds,
    repositoryId,
    runnerId
  );

  return {
    buildId: result.buildId!,
    testCount: result.testCount,
  };
}
