import { db } from "./data/db";
import {
  getRepoAward as getOwnRepoAward,
  listRepoAwards,
} from "./data/queries";
import { awardsPlugin } from "./index";
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
 * Award + repo summary for every repository owned by the session's team that
 * has at least one test. Repos with no award row yet come back with
 * `award: null` so the UI can grey them out as "not yet earned".
 *
 * The team is resolved here, not passed in: `contextFor` with no scope
 * request falls through to the app's `requireTeamAccess()`, so `ctx.team.id`
 * is a session-authorized tenant no argument influenced. See `wiring.ts`.
 */
export async function getTeamTrophyRoom(): Promise<
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
  const { runtime, host } = awardsWiring();
  const ctx = await runtime.contextFor(awardsPlugin);

  const repos = await host.listReposWithTests(ctx.team.id);
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
