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

  // Resolve from real, named branches only: the repo's default branch (e.g.
  // main/master), then its comparison baseline branch, then any other branch.
  // The legacy repo-wide "default" key is intentionally IGNORED — it was a
  // write-once fallback (set at repo creation/onboarding, never updated by the
  // per-branch UI) that went stale and shadowed real branch URLs, sending the
  // QuickStart scout to the wrong site (e.g. an excalidraw repo whose stale
  // default was https://playwright.dev). Data is migrated off it; see
  // scripts/migrate-drop-default-baseurl.sql.
  const seen = new Set<string>();
  const pushBranch = (branch: string | null | undefined) => {
    if (!branch || branch === "default" || seen.has(branch)) return;
    seen.add(branch);
    if (typeof map[branch] === "string") candidates.push(map[branch]);
  };
  pushBranch(repo.defaultBranch);
  pushBranch(repo.comparisonBaselineBranch);
  for (const branch of Object.keys(map)) pushBranch(branch);

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

  // QuickStart is generally available (promoted out of Early Adopter). The only
  // remaining requirement is a non-local base URL to point the agent at.
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
