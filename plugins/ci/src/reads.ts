import { db } from "./data/db";
import { listGithubConfigs, listGitlabConfigs } from "./data/queries";
import type { GithubActionConfig, GitlabPipelineConfig } from "./schema";

/**
 * Server-component reads, for `/settings`.
 *
 * Deliberately **not** actions. The settings page is a server component that
 * already resolved its team, and routing these through `"use server"` would
 * mint action ids nothing dispatches while adding a second authorization pass
 * over a team the page has already authorized. Same shape and same reasoning as
 * `plugins/gamification/src/reads.ts`.
 *
 * The caller passes the team id it authorized. That is the same arrangement
 * `awardScore` has: the tenancy guarantee stays with the caller that did
 * `requireTeamAccess()`, and this module treats the id as already authorized —
 * which is exactly what `queries.getGithubActionConfigs(teamId)` did before the
 * move. The handle comes straight from the wiring slot because a server
 * component has no `ctx` to hand down.
 */

export async function listGithubActionConfigs(
  teamId: string,
): Promise<GithubActionConfig[]> {
  return listGithubConfigs(db(), teamId);
}

export async function listGitlabPipelineConfigs(
  teamId: string,
): Promise<GitlabPipelineConfig[]> {
  return listGitlabConfigs(db(), teamId);
}
