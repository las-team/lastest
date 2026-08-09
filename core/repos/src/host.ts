/**
 * The host port.
 *
 * `core/**` may never import `@/…` (`pnpm arch` enforces it), so resolving a
 * repo's branch-URL map and its environment-config fallback — both app
 * queries — has to be injected rather than imported. Same shape and same
 * reason as `core/browser`'s `BrowserHost`.
 */

export interface RepoUrlLookup {
  /** `null` when the repo does not exist, or belongs to a different team. */
  readonly branchBaseUrls: Readonly<Record<string, string>> | null;
  readonly defaultBranch: string | null;
  readonly teamId: string | null;
}

export interface ReposHost {
  lookup(repositoryId: string): Promise<RepoUrlLookup>;
  /** `environment_settings.baseUrl`, trailing slashes stripped. */
  environmentBaseUrl(repositoryId: string): Promise<string | null>;
}
