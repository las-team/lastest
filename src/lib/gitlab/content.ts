/**
 * GitLab Content API module for remote repository scanning
 * Uses GitLab Repository API for file access without local clones
 */

const DEFAULT_GITLAB_INSTANCE = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';

// Simple in-memory cache with TTL
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

export interface TreeEntry {
  id: string;
  name: string;
  type: 'blob' | 'tree';
  path: string;
  mode: string;
}

export interface RepoTree {
  entries: TreeEntry[];
}

export interface FileContent {
  file_name: string;
  file_path: string;
  size: number;
  content: string; // Base64 encoded
  encoding: 'base64';
  ref: string;
  blob_id: string;
  commit_id: string;
}

export interface BranchInfo {
  name: string;
  commit: {
    id: string;
    short_id: string;
    title: string;
  };
  default: boolean;
  protected: boolean;
}

/**
 * Fetch the entire repository tree recursively
 */
export async function getRepoTree(
  accessToken: string,
  projectId: number,
  branch: string,
  instanceUrl?: string
): Promise<TreeEntry[] | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;
  const cacheKey = `gitlab:tree:${projectId}:${branch}`;
  const cached = getCached<TreeEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/tree?recursive=true&ref=${encodeURIComponent(branch)}&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return null;

    const tree: TreeEntry[] = await response.json();
    setCache(cacheKey, tree);
    return tree;
  } catch {
    return null;
  }
}

/**
 * Fetch a single file's content
 */
export async function getFileContent(
  accessToken: string,
  projectId: number,
  path: string,
  ref: string,
  instanceUrl?: string
): Promise<string | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;
  const cacheKey = `gitlab:file:${projectId}:${ref}:${path}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  try {
    // URL encode the path (double-encode for GitLab API)
    const encodedPath = encodeURIComponent(path);
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return null;

    const data: FileContent = await response.json();

    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    setCache(cacheKey, content);
    return content;
  } catch {
    return null;
  }
}

/**
 * Get branch info including latest commit SHA
 */
export async function getBranchInfo(
  accessToken: string,
  projectId: number,
  branch: string,
  instanceUrl?: string
): Promise<BranchInfo | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) return null;

    return response.json();
  } catch {
    return null;
  }
}

export interface CompareResult {
  commit: {
    id: string;
    short_id: string;
    title: string;
  };
  commits: Array<{
    id: string;
    short_id: string;
    title: string;
  }>;
  diffs: Array<{
    old_path: string;
    new_path: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
  }>;
  compare_timeout: boolean;
  compare_same_ref: boolean;
}

/**
 * Compare two branches and get the list of changed files
 * Uses GitLab's Compare API: GET /projects/:id/repository/compare
 */
export async function compareBranches(
  accessToken: string,
  projectId: number,
  baseBranch: string,
  headBranch: string,
  instanceUrl?: string
): Promise<CompareResult | null> {
  const baseUrl = instanceUrl || DEFAULT_GITLAB_INSTANCE;
  const cacheKey = `gitlab:compare:${projectId}:${baseBranch}...${headBranch}`;
  const cached = getCached<CompareResult>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${baseUrl}/api/v4/projects/${projectId}/repository/compare?from=${encodeURIComponent(baseBranch)}&to=${encodeURIComponent(headBranch)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Branch not found
      }
      return null;
    }

    const data: CompareResult = await response.json();
    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Filter tree entries by glob-like pattern
 */
export function filterTree(tree: TreeEntry[], patterns: string[]): TreeEntry[] {
  return tree.filter(entry => {
    return patterns.some(pattern => {
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\*\*/g, '<<DOUBLESTAR>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<DOUBLESTAR>>/g, '.*')
        .replace(/\//g, '\\/');
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(entry.path);
    });
  });
}

/**
 * Check if a path exists in the tree
 */
export function pathExists(tree: TreeEntry[], path: string): boolean {
  return tree.some(entry => entry.path === path || entry.path.startsWith(path + '/'));
}

/**
 * Get all files in a directory from the tree
 */
export function getFilesInDirectory(tree: TreeEntry[], directory: string): TreeEntry[] {
  const normalizedDir = directory.endsWith('/') ? directory : directory + '/';
  return tree.filter(entry =>
    entry.type === 'blob' &&
    entry.path.startsWith(normalizedDir === '/' ? '' : normalizedDir)
  );
}

/**
 * Clear the cache (useful after branch changes)
 */
export function clearCache(): void {
  cache.clear();
}
