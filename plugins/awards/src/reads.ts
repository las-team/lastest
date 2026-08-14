import { db } from "./data/db";
import {
  getRepoAward as getOwnRepoAward,
  listRepoAwards,
} from "./data/queries";
import type { RepoAward } from "./schema";
import { awardsWiring } from "./wiring";

/**
 * Server-component / route-handler reads. Deliberately not `"use server"` —
 * this plugin dispatches no client-invoked actions at all (recompute is
 * system-triggered, everything else is a read), so there is nothing here
 * that should mint a POST-dispatchable action id. See `../index.ts`'s header
 * for the "plugin with no actions" gate, the same shape `launch` uses.
 */

/** A repo's own award row, or undefined if none has been computed yet. */
export async function getRepoAward(
  repositoryId: string,
): Promise<RepoAward | undefined> {
  return getOwnRepoAward(db(), repositoryId);
}

/**
 * Award + repo summary for every repository owned by a team that has at
 * least one test. Repos with no award row yet come back with `award: null`
 * so the UI can grey them out as "not yet earned".
 *
 * `teamId` is the caller's already-authorized team — `/leaderboard` resolves
 * its own session before calling this. See `wiring.ts`.
 */
export async function getTeamTrophyRoom(teamId: string): Promise<
  Array<{
    repo: {
      id: string;
      fullName: string;
      owner: string;
      name: string;
      testCount: number;
    };
    award: RepoAward | null;
    proofSlug: string | null;
  }>
> {
  const { host } = awardsWiring();

  const repos = await host.listReposWithTests(teamId);
  if (repos.length === 0) return [];

  const repoIds = repos.map((r) => r.id);
  const [awards, shareSlugs] = await Promise.all([
    listRepoAwards(db(), repoIds),
    host.resolveLatestShareSlugs(repoIds),
  ]);
  const awardByRepo = new Map(awards.map((a) => [a.repositoryId, a]));

  return repos.map((repo) => ({
    repo,
    award: awardByRepo.get(repo.id) ?? null,
    proofSlug: shareSlugs.get(repo.id) ?? null,
  }));
}

/**
 * Resolve a public share slug to its repo award. The badge SVG endpoint and
 * the public criteria page use this — the embed URL stays stable, the repo
 * state stays live. Deliberately anonymous: no session, no team check,
 * because a badge is meant to be readable by anyone who has the URL.
 */
export async function getRepoAwardBySlug(slug: string): Promise<{
  share: {
    slug: string;
    targetDomain: string | null;
    repositoryId: string | null;
  };
  repo: { id: string; fullName: string; owner: string; name: string } | null;
  award: RepoAward | null;
} | null> {
  const { host } = awardsWiring();

  const shareRow = await host.resolveShareSlug(slug);
  if (!shareRow) return null;

  const repoId = shareRow.repositoryId;

  const [repo, award] = await Promise.all([
    repoId ? host.getRepository(repoId) : Promise.resolve(null),
    repoId ? getOwnRepoAward(db(), repoId) : Promise.resolve(undefined),
  ]);

  return {
    share: {
      slug: shareRow.slug,
      targetDomain: shareRow.targetDomain,
      repositoryId: repoId,
    },
    repo: repo
      ? {
          id: repo.id,
          fullName: repo.fullName,
          owner: repo.owner,
          name: repo.name,
        }
      : null,
    award: award ?? null,
  };
}
