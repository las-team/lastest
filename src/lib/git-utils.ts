import { execFile } from 'child_process';
import * as queries from '@/lib/db/queries';

/**
 * Detect the current branch for a repository.
 * Checks: CI env vars → repo selectedBranch → local git branch → repo defaultBranch → null
 */
export async function getCurrentBranchForRepo(repositoryId: string | null | undefined): Promise<string | null> {
  // CI environment variables (GitHub Actions, GitLab CI, etc.)
  const envBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_BRANCH;
  if (envBranch) return envBranch;

  if (repositoryId) {
    const repo = await queries.getRepository(repositoryId);

    // Explicitly selected branch takes priority
    if (repo?.selectedBranch) return repo.selectedBranch;

    // Try detecting actual local git branch from the working directory
    const localBranch = await getLocalGitBranch(process.cwd());
    if (localBranch) return localBranch;

    // Fall back to repo's default branch
    if (repo?.defaultBranch) return repo.defaultBranch;
  }

  return null;
}

/**
 * Get the current git branch name from a local directory.
 */
async function getLocalGitBranch(repoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const branch = stdout.trim();
      resolve(branch && branch !== 'HEAD' ? branch : null);
    });
  });
}
