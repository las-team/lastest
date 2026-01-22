import { execSync } from 'child_process';

export interface GitInfo {
  branch: string;
  commit: string;
  isClean: boolean;
}

export async function getGitInfo(repoPath?: string): Promise<GitInfo> {
  try {
    const execOptions = repoPath ? { encoding: 'utf-8' as const, cwd: repoPath } : { encoding: 'utf-8' as const };
    const branch = execSync('git rev-parse --abbrev-ref HEAD', execOptions).trim();
    const commit = execSync('git rev-parse --short HEAD', execOptions).trim();
    const status = execSync('git status --porcelain', execOptions).trim();

    return {
      branch,
      commit,
      isClean: status === '',
    };
  } catch {
    return {
      branch: 'unknown',
      commit: 'unknown',
      isClean: true,
    };
  }
}

export async function checkoutBranch(branch: string): Promise<void> {
  execSync(`git checkout ${branch}`, { encoding: 'utf-8' });
}

export async function getBranches(): Promise<string[]> {
  try {
    const output = execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' });
    return output.split('\n').filter(b => b.trim());
  } catch {
    return [];
  }
}
