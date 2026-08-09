import type { ReposCapability, TeamRef } from "@lastest/contracts";

import type { ReposHost } from "./host";

export interface ReposFactoryOptions {
  readonly host: ReposHost;
}

/**
 * Build the `repos` capability, scoped to the calling plugin's team.
 *
 * `team` is captured at factory-build time (once per context) rather than
 * threaded through `baseUrl`'s arguments — `buildContext` already resolved and
 * authorized it, so re-deriving it per call would only be able to trust the
 * same value again.
 */
export function createReposCapability(
  host: ReposHost,
  team: TeamRef,
): ReposCapability {
  return {
    async baseUrl(repositoryId, branch) {
      const repo = await host.lookup(repositoryId);

      // A nonexistent repo resolves `teamId: null`, which can never equal a
      // real team id — so "doesn't exist" and "belongs to another team" fail
      // this one check identically. A distinguishable rejection would let a
      // plugin binary-search repository ids by team, which is a tenancy leak
      // in the shape of an error message.
      if (repo.teamId !== team.id) return null;

      const preferred = branch ?? repo.defaultBranch ?? null;
      const map = repo.branchBaseUrls ?? {};
      const fromBranch = preferred ? map[preferred] : undefined;
      if (fromBranch) return fromBranch;
      if (map.main) return map.main;
      const anyBranch = Object.values(map)[0];
      if (anyBranch) return anyBranch;

      return host.environmentBaseUrl(repositoryId);
    },
  };
}
