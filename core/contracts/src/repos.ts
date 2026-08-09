/**
 * The repository capability.
 *
 * ### Why this is a method and not a field on `RepoRef`
 *
 * `docs/architecture/explorer-migration-result.md` §3 offered both: a
 * `baseUrl` on `RepoRef`, or a call. The ref lost, for two reasons.
 *
 * 1. **A field cannot carry the question.** `repositories.branchBaseUrls` is a
 *    *map keyed by branch*, because a PR branch and `main` deploy to different
 *    URLs — that is the entire reason the column is a map and not a string. A
 *    field on `RepoRef` can only answer for one branch (the default), so every
 *    caller that builds against a PR would need the method anyway, and we
 *    would own both.
 * 2. **A field is paid for by everyone.** `RepoRef` is built by `resolveScope`
 *    on *every* context build, for every plugin. The branch map rides along on
 *    the repo row the auth guard already loaded, so that part is free — but
 *    the `environment_settings` fallback is a second query, needed precisely
 *    when the map is empty, which is the common case for a repo that was
 *    never configured per-branch. That would be one extra round trip per
 *    context build for ~19 features of which a minority drive a browser at
 *    all.
 *
 * `refs.ts` says each field added there "should have to justify itself". A
 * field that costs a query and can only answer a third of the question does
 * not. What the method costs instead is an `await` at each use and one line
 * in the consuming manifest — both visible, which is the point.
 */

export interface ReposCapability {
  /**
   * The app's base URL for a repo, resolved for `branch`.
   *
   * Resolution order — first hit wins:
   *   1. `branchBaseUrls[branch]`, or `branchBaseUrls[defaultBranch]` when no
   *      branch is asked for;
   *   2. `branchBaseUrls.main`;
   *   3. any other configured branch URL;
   *   4. the repo's environment settings.
   *
   * Resolves `null` when the repo has no URL configured anywhere, and *also*
   * when the repo is not in the caller's team. Those two are deliberately
   * indistinguishable: a distinguishable "forbidden" would turn this into an
   * oracle for which repository ids exist, which is a tenancy leak in the
   * shape of an error message.
   */
  baseUrl(repositoryId: string, branch?: string | null): Promise<string | null>;
}
