import * as queries from "@/lib/db/queries";
import type { Repository, Team } from "@/lib/db/schema";

export type QuickstartGateReason =
  | "no_repo"
  | "no_team"
  | "not_early_adopter"
  | "no_base_url";

export interface QuickstartGateResult {
  enabled: boolean;
  reason?: QuickstartGateReason;
  repo?: Repository;
  team?: Team;
  baseUrl?: string;
}

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Pick a usable baseUrl from the repo's branchBaseUrls. Localhost variants are
 * skipped: the QuickStart agent runs in the EB pod (or a transient browser on
 * the host) and "http://localhost:3000" almost never resolves to the target a
 * QuickStart demo wants to baseline.
 */
export function pickRepoBaseUrl(repo: Repository): string | undefined {
  const map = repo.branchBaseUrls ?? {};
  const candidates: string[] = [];
  if (typeof map.default === "string") candidates.push(map.default);
  for (const [branch, value] of Object.entries(map)) {
    if (branch !== "default" && typeof value === "string")
      candidates.push(value);
  }
  for (const url of candidates) {
    if (url.length > 0 && !isLocalUrl(url)) return url;
  }
  return undefined;
}

export async function isQuickstartEnabled(
  repositoryId: string,
): Promise<QuickstartGateResult> {
  const repo = await queries.getRepository(repositoryId);
  if (!repo) return { enabled: false, reason: "no_repo" };

  if (!repo.teamId) return { enabled: false, reason: "no_team", repo };
  const team = await queries.getTeam(repo.teamId);
  if (!team) return { enabled: false, reason: "no_team", repo };

  if (!team.earlyAdopterMode) {
    return { enabled: false, reason: "not_early_adopter", repo, team };
  }

  const baseUrl = pickRepoBaseUrl(repo);
  if (!baseUrl) return { enabled: false, reason: "no_base_url", repo, team };

  return { enabled: true, repo, team, baseUrl };
}

export function gateReasonHint(reason: QuickstartGateReason): string {
  switch (reason) {
    case "no_repo":
      return "Repository not found.";
    case "no_team":
      return "Repository has no team owner.";
    case "not_early_adopter":
      return "Enable Early Adopter mode in team settings to unlock the QuickStart agent.";
    case "no_base_url":
      return "Set a non-local baseUrl in the sidebar (or PUT /api/v1/repos/:id { baseUrl }). localhost URLs do not count.";
  }
}
