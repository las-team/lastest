/**
 * GitHub Content API module for remote repository scanning
 * Uses GitHub Trees/Contents APIs for file access without local clones
 */

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
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export interface RepoTree {
  sha: string;
  url: string;
  tree: TreeEntry[];
  truncated: boolean;
}

export interface FileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string; // Base64 encoded
  encoding: 'base64';
}

export interface BranchInfo {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
}

/**
 * Fetch the entire repository tree recursively
 */
export async function getRepoTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoTree | null> {
  const cacheKey = `tree:${owner}/${repo}:${branch}`;
  const cached = getCached<RepoTree>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return null;

    const tree = await response.json();
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
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const cacheKey = `file:${owner}/${repo}:${ref}:${path}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
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
  owner: string,
  repo: string,
  branch: string
): Promise<BranchInfo | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${branch}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return null;

    return response.json();
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
 * Get direct children of a directory
 */
export function getDirectoryChildren(tree: TreeEntry[], directory: string): TreeEntry[] {
  const normalizedDir = directory === '' ? '' : (directory.endsWith('/') ? directory : directory + '/');
  const dirDepth = normalizedDir === '' ? 0 : normalizedDir.split('/').length - 1;

  return tree.filter(entry => {
    if (!entry.path.startsWith(normalizedDir)) return false;
    const entryDepth = entry.path.split('/').length - 1;
    return entryDepth === dirDepth;
  });
}

/**
 * Clear the cache (useful after branch changes)
 */
export function clearCache(): void {
  cache.clear();
}
