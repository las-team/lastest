/**
 * Re-export shim. The implementation moved to `libs/github` so features can
 * use it without a cross-plugin import — `@/lib/github` is the `scm`
 * pseudo-plugin, and a token-taking REST client guards nothing, which
 * `docs/architecture/core-scope.md` §3 says makes it a library, not core.
 *
 * App code that is not a pseudo-plugin keeps importing this path unchanged.
 */
export {
  clearCache,
  compareBranches,
  filterTree,
  getBranchInfo,
  getDirectoryChildren,
  getFileContent,
  getFilesInDirectory,
  getRepoTree,
  pathExists,
  type BranchInfo,
  type CompareResult,
  type FileContent,
  type RepoTree,
  type TreeEntry,
} from "@lastest/github";
