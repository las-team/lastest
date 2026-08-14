import "server-only";

import type {
  AwardsHost,
  AwardsRepoBuildRow,
  AwardsRepoSummary,
  AwardsRepoWithTestCount,
  AwardsShareContext,
} from "@lastest/plugin-awards/host";

import * as queries from "@/lib/db/queries";
import {
  getShareContextBySlug,
  listLatestPublicSharesForRepositories,
} from "@/lib/core/share-reads";

/**
 * The app's fill for `AwardsHost`.
 *
 * Eight adapters, no new behaviour — each is a call
 * `src/lib/db/queries/awards.ts` made inline before the migration, moved to
 * the side of the boundary that is allowed to make it. Six read core's
 * `builds`/`tests`/`visualDiffs`/`repositories` tables (still through
 * `src/lib/db/queries/awards.ts`, trimmed to exactly these, and
 * `repositories.ts`/`builds.ts` for the two single-row lookups); two are
 * cross-feature reads into the `share` plugin, going through
 * `src/lib/core/share-reads.ts` rather than importing `@lastest/plugin-share`
 * a second time — that file already carries the boot-order reasoning for why
 * it must not import `./runtime`, and duplicating it here would be the same
 * mistake in a new file.
 */
export const appAwardsHost: AwardsHost = {
  async getRecentCompletedBuilds(
    repositoryId: string,
    limit: number,
  ): Promise<AwardsRepoBuildRow[]> {
    return queries.getRecentCompletedBuildsForRepo(repositoryId, limit);
  },

  async getTestCount(repositoryId: string): Promise<number> {
    return queries.getRepoTestCount(repositoryId);
  },

  async getRejectedDiffCount(
    repositoryId: string,
    sinceMs?: number,
  ): Promise<number> {
    return queries.getRejectedDiffCount(repositoryId, sinceMs);
  },

  async getRepository(repositoryId: string): Promise<AwardsRepoSummary | null> {
    const repo = await queries.getRepository(repositoryId);
    if (!repo) return null;
    return {
      id: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      teamId: repo.teamId,
    };
  },

  async listReposWithTests(teamId: string): Promise<AwardsRepoWithTestCount[]> {
    return queries.listReposWithTestsForTeam(teamId);
  },

  async getBuildTotalTests(buildId: string): Promise<number | null> {
    const build = await queries.getBuild(buildId);
    return build?.totalTests ?? null;
  },

  async resolveShareSlug(slug: string): Promise<AwardsShareContext | null> {
    return getShareContextBySlug(slug);
  },

  async resolveLatestShareSlugs(
    repositoryIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const shares = await listLatestPublicSharesForRepositories(repositoryIds);
    const byRepo = new Map<string, string>();
    for (const s of shares) {
      if (s.repositoryId && !byRepo.has(s.repositoryId)) {
        byRepo.set(s.repositoryId, s.slug);
      }
    }
    return byRepo;
  },
};
