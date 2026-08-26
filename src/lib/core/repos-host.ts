import "server-only";

import type { ReposHost } from "@lastest/core-repos";

import { getEnvironmentConfig, getRepository } from "@/lib/db/queries";

export const appReposHost: ReposHost = {
  async lookup(repositoryId) {
    const repo = await getRepository(repositoryId).catch(() => null);
    if (!repo) {
      return { branchBaseUrls: null, defaultBranch: null, teamId: null };
    }
    return {
      branchBaseUrls: (repo.branchBaseUrls ?? {}) as Record<string, string>,
      defaultBranch: repo.defaultBranch ?? null,
      teamId: repo.teamId ?? null,
    };
  },

  async environmentBaseUrl(repositoryId) {
    const env = await getEnvironmentConfig(repositoryId).catch(() => null);
    return env?.baseUrl ?? null;
  },
};
