import * as queries from '@/lib/db/queries';

/**
 * Detect the current branch for a repository.
 * Checks: CI env vars → repo defaultBranch → null
 */
export async function getCurrentBranchForRepo(repositoryId: string | null | undefined): Promise<string | null> {
  // CI environment variables (GitHub Actions, GitLab CI, etc.)
  const envBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_BRANCH;
  if (envBranch) return envBranch;

  // Fall back to repo's default branch
  if (repositoryId) {
    const repo = await queries.getRepository(repositoryId);
    if (repo?.defaultBranch) return repo.defaultBranch;
  }

  return null;
}
