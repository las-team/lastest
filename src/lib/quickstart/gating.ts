import * as queries from '@/lib/db/queries';
import type { Repository, Team } from '@/lib/db/schema';

export type QuickstartGateReason =
  | 'no_repo'
  | 'no_team'
  | 'not_early_adopter'
  | 'no_base_url';

export interface QuickstartGateResult {
  enabled: boolean;
  reason?: QuickstartGateReason;
  repo?: Repository;
  team?: Team;
  baseUrl?: string;
}

export function pickRepoBaseUrl(repo: Repository): string | undefined {
  const map = repo.branchBaseUrls ?? {};
  if (map.default && typeof map.default === 'string') return map.default;
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export async function isQuickstartEnabled(repositoryId: string): Promise<QuickstartGateResult> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo) return { enabled: false, reason: 'no_repo' };

  if (!repo.teamId) return { enabled: false, reason: 'no_team', repo };
  const team = await queries.getTeam(repo.teamId);
  if (!team) return { enabled: false, reason: 'no_team', repo };

  if (!team.earlyAdopterMode) {
    return { enabled: false, reason: 'not_early_adopter', repo, team };
  }

  const baseUrl = pickRepoBaseUrl(repo);
  if (!baseUrl) return { enabled: false, reason: 'no_base_url', repo, team };

  return { enabled: true, repo, team, baseUrl };
}

export function gateReasonHint(reason: QuickstartGateReason): string {
  switch (reason) {
    case 'no_repo':
      return 'Repository not found.';
    case 'no_team':
      return 'Repository has no team owner.';
    case 'not_early_adopter':
      return 'Enable Early Adopter mode in team settings to unlock the QuickStart agent.';
    case 'no_base_url':
      return 'Set the repo baseUrl first via PUT /api/v1/repos/:id { baseUrl } or lastest_update_repo.';
  }
}
