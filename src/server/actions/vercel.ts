"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireTeamAccess, requireRepoAccess } from "@/lib/auth";
import { getVercelProjects, type VercelProject } from "@/lib/vercel/oauth";
import type { VercelRunOn } from "@/lib/db/schema";

/**
 * Fetch the Vercel projects visible to this team's integration token. Used by
 * the settings mapping UI to populate the project picker. Returns [] when the
 * team hasn't connected Vercel.
 */
export async function refreshVercelProjectsAction(): Promise<VercelProject[]> {
  const { team } = await requireTeamAccess();
  const account = await queries.getVercelAccountByTeam(team.id);
  if (!account) return [];
  return getVercelProjects(account.accessToken, account.vercelTeamId);
}

export interface CreateVercelConfigInput {
  repositoryId: string;
  vercelProjectId: string;
  vercelProjectName?: string;
  runOn?: VercelRunOn;
  blocking?: boolean;
  rerequestable?: boolean;
  timeoutMinutes?: number;
}

export async function createVercelProjectConfigAction(
  input: CreateVercelConfigInput,
) {
  const { team } = await requireTeamAccess();
  // Enforce that the target repo belongs to this team.
  await requireRepoAccess(input.repositoryId);

  const account = await queries.getVercelAccountByTeam(team.id);
  if (!account) throw new Error("Vercel is not connected for this team");

  const config = await queries.createVercelProjectConfig({
    teamId: team.id,
    repositoryId: input.repositoryId,
    vercelAccountId: account.id,
    vercelProjectId: input.vercelProjectId,
    vercelProjectName: input.vercelProjectName ?? null,
    runOn: input.runOn ?? "preview",
    blocking: input.blocking ?? true,
    rerequestable: input.rerequestable ?? true,
    timeoutMinutes: input.timeoutMinutes ?? 15,
    enabled: true,
  });

  revalidatePath("/settings");
  return config;
}

export interface UpdateVercelConfigInput {
  repositoryId?: string;
  runOn?: VercelRunOn;
  blocking?: boolean;
  rerequestable?: boolean;
  timeoutMinutes?: number;
  enabled?: boolean;
}

export async function updateVercelProjectConfigAction(
  id: string,
  input: UpdateVercelConfigInput,
) {
  const { team } = await requireTeamAccess();
  if (input.repositoryId) await requireRepoAccess(input.repositoryId);

  const updated = await queries.updateVercelProjectConfig(id, team.id, input);
  revalidatePath("/settings");
  return updated;
}

export async function deleteVercelProjectConfigAction(id: string) {
  const { team } = await requireTeamAccess();
  await queries.deleteVercelProjectConfig(id, team.id);
  revalidatePath("/settings");
  return { success: true };
}

/**
 * Disconnect Vercel from the Lastest side (removes the stored token + all
 * project mappings). The install still exists on Vercel until the user removes
 * it there; the `integration-configuration.removed` webhook also lands here.
 */
export async function disconnectVercelAction() {
  const { team } = await requireTeamAccess();
  const account = await queries.getVercelAccountByTeam(team.id);
  if (account) await queries.deleteVercelAccount(account.id, team.id);
  revalidatePath("/settings");
  return { success: true };
}
