"use server";

import { revalidatePath } from "next/cache";
import { requireTeamAccess } from "@/lib/auth";
import { getSelectedRepository } from "@/lib/db/queries";
import { buildAppMap, type AppMapGraph } from "@/lib/app-map/build-map";
import { addQaTask } from "./qa-agent";

export type GetAppMapResult =
  | { ok: true; graph: AppMapGraph }
  | { ok: false; reason: "no-repo" | "no-data" };

/**
 * Build the App Map for the caller's currently-selected repository. Merges
 * routes + sitemap + QA crawl + test trajectories into a node-network. Computed
 * on read (no persisted table — the data is fully derivable).
 */
export async function getAppMap(opts?: {
  branch?: string;
}): Promise<GetAppMapResult> {
  const { user, team } = await requireTeamAccess();
  const repo = await getSelectedRepository(user.id, team.id);
  if (!repo) return { ok: false, reason: "no-repo" };

  const graph = await buildAppMap(repo.id, {
    branch: opts?.branch,
    includeSitemap: true,
  });
  if (graph.nodes.length === 0) return { ok: false, reason: "no-data" };
  return { ok: true, graph };
}

/**
 * Enqueue an "Ask QA agent to cover <page>" task for an uncovered node.
 * Pro-gating is enforced inside `addQaTask` (`assertQaAgentAccess`).
 */
export async function requestCoverage(input: {
  path: string;
  url?: string;
}): Promise<{ taskId: string }> {
  const { user, team } = await requireTeamAccess();
  const repo = await getSelectedRepository(user.id, team.id);
  if (!repo) throw new Error("No repository selected");

  const target = input.url || input.path;
  const result = await addQaTask({
    repositoryId: repo.id,
    title: `Cover ${input.path}`,
    description: `Add visual test coverage for ${target}`,
    source: "coverage_gap",
  });
  revalidatePath("/app-map");
  return result;
}
