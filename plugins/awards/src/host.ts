/**
 * The core surface this feature needs and does not have yet.
 *
 * Costed before starting (recipe §1.5): **8 methods**, matching the estimate
 * left in `tools/architecture/boundaries.mjs`'s `PSEUDO_PLUGINS.awards` entry
 * when `share` migrated ahead of this one specifically to unblock it. They
 * group into two things, not eight:
 *
 * | # | Method | Group |
 * | --- | --- | --- |
 * | 1 | `getRecentCompletedBuilds` | build/test/diff aggregate read |
 * | 2 | `getTestCount` | build/test/diff aggregate read |
 * | 3 | `getRejectedDiffCount` | build/test/diff aggregate read |
 * | 4 | `getRepository` | build/test/diff aggregate read (repo lookup) |
 * | 5 | `listReposWithTests` | build/test/diff aggregate read |
 * | 6 | `getBuildTotalTests` | build/test/diff aggregate read |
 * | 7 | `resolveShareSlug` | cross-feature read (share) |
 * | 8 | `resolveLatestShareSlugs` | cross-feature read (share) |
 *
 * Six of eight are reads of core's `builds`/`tests`/`visualDiffs`/
 * `repositories` tables — exactly what `src/lib/db/queries/awards.ts` did
 * directly through the shared `db` handle before the move; `core-scope.md`
 * §6 means a plugin calls a core function instead of reaching the table
 * itself, so each read became one method with the same shape it already had.
 *
 * The other two are the mirror image of `src/lib/core/share-reads.ts`, which
 * `share`'s migration built *for this feature specifically* — see that
 * file's header. This plugin cannot import `@lastest/plugin-share` (the
 * plugin→plugin ban), so the same cross-read has to cross through a host
 * method instead of a direct function call; `src/lib/core/awards-host.ts`
 * implements both by calling straight into `share-reads.ts`, so the
 * boot-order reasoning documented there does not need to be duplicated here.
 *
 * ### `getRejectedDiffCount` merges two former query functions
 *
 * `getRejectedDiffCountForRepo` and `getRejectedDiffCountForRepoSince` were
 * the same query with an optional time filter appended. One method with an
 * optional `sinceMs` argument is the same information, one line shorter, and
 * one fewer thing to keep in sync — not a capability change, just the kind of
 * cleanup recipe §1.5 asks for when grouping port methods by what they *are*.
 *
 * ### `resolveLatestShareSlugs` is always batched, even for one repo
 *
 * The pre-migration code had both a single-repo `getLatestPublicShareSlug`
 * and a batched `listLatestPublicSharesForRepositories`; `recomputeRepoAward`
 * used the former, `getTeamTrophyRoom` the latter. Collapsing to one batched
 * method (call it with a one-element array from `recomputeRepoAward`) is what
 * takes this port from 9 to 8 — not a behaviour change, since both wrapped
 * the same underlying `share_public_shares` read.
 */

export interface AwardsRepoBuildRow {
  id: string;
  totalTests: number | null;
  passedCount: number | null;
  failedCount: number | null;
  changesDetected: number | null;
  flakyCount: number | null;
  a11yScore: number | null;
  a11yCriticalCount: number | null;
  completedAt: Date | null;
}

export interface AwardsRepoSummary {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  teamId: string | null;
}

export interface AwardsRepoWithTestCount {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  testCount: number;
}

export interface AwardsShareContext {
  slug: string;
  targetDomain: string | null;
  repositoryId: string | null;
}

export interface AwardsHost {
  /**
   * Last N completed builds for a repo, newest first. Was
   * `getRecentCompletedBuildsForRepo` — a `builds ⋈ testRuns` join, because
   * `testRuns` (not `builds`) owns `repositoryId`.
   */
  getRecentCompletedBuilds(
    repositoryId: string,
    limit: number,
  ): Promise<AwardsRepoBuildRow[]>;

  /** Count of non-deleted tests owned by the repo. */
  getTestCount(repositoryId: string): Promise<number>;

  /**
   * Count of `visualDiffs.status === 'rejected'` on the repo's build history.
   * `sinceMs` omitted means "ever"; provided means "since this time,
   * matching either `approvedAt` or `createdAt`" — the exact filter the two
   * former query functions applied.
   */
  getRejectedDiffCount(repositoryId: string, sinceMs?: number): Promise<number>;

  /** Basic repo identity, or null if the id does not resolve. */
  getRepository(repositoryId: string): Promise<AwardsRepoSummary | null>;

  /**
   * Every repo owned by a team that has at least one non-deleted test —
   * `repositories ⋈ tests` with `HAVING COUNT(tests.id) > 0`. That `HAVING`
   * is an existence predicate, not just a column source (recipe §3.2): a
   * repo with zero tests must not appear, so a caller cannot reconstruct this
   * from `getRepository` calls alone.
   */
  listReposWithTests(teamId: string): Promise<AwardsRepoWithTestCount[]>;

  /**
   * `builds.totalTests` for one build, or null if the build does not resolve.
   * Used by the all-passing badge to render "N / N" instead of just a
   * pass/fail state.
   */
  getBuildTotalTests(buildId: string): Promise<number | null>;

  /** Resolve a public share slug to its target repo, or null if unknown. */
  resolveShareSlug(slug: string): Promise<AwardsShareContext | null>;

  /**
   * Latest public share slug per repo, for the repos that have one. Missing
   * repos are simply absent from the map — the caller treats that the same
   * as "no proof link yet".
   */
  resolveLatestShareSlugs(
    repositoryIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}
