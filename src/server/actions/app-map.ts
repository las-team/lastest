"use server";

import { revalidatePath } from "next/cache";
import { requireTeamAccess } from "@/lib/auth";
import {
  getSelectedRepository,
  getLatestTestResultsWithTrajectoryByRepo,
  getEnvironmentConfig,
  getActiveAgentSession,
} from "@/lib/db/queries";
import { planConfig } from "@/lib/billing/plans";
import type { ExploreStrategy, QaExploreState } from "@/lib/db/schema";
import { buildAppMap, type AppMapGraph } from "@/lib/app-map/build-map";
import { deriveFlows, type AppFlow } from "@/lib/app-map/flows";
import { addQaTask, startQaAgent } from "./qa-agent";

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

export type GetAppFlowsResult =
  | { ok: true; flows: AppFlow[]; branch: string }
  | { ok: false; reason: "no-repo" };

/**
 * Derive the Flows view data (named user journeys from test URL trajectories)
 * for the caller's currently-selected repository. Lazy-loaded by the client
 * when the Flows tab first opens — not part of the map payload.
 */
export async function getAppFlows(opts?: {
  branch?: string;
}): Promise<GetAppFlowsResult> {
  const { user, team } = await requireTeamAccess();
  const repo = await getSelectedRepository(user.id, team.id);
  if (!repo) return { ok: false, reason: "no-repo" };

  const branch =
    opts?.branch ?? repo.selectedBranch ?? repo.defaultBranch ?? "main";
  const rows = await getLatestTestResultsWithTrajectoryByRepo(repo.id, branch);
  return { ok: true, flows: deriveFlows(rows, branch), branch };
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

// ── Explore (QA agent mode = "explore") ──────────────────────────────────────

export interface StartExplorationInput {
  explorers: number;
  /** Crawl depth 1–6. */
  depth: number;
  strategy: ExploreStrategy;
  /** Wall-clock budget in minutes (2/5/10/20 in the dialog). */
  maxMinutes: number;
  /** Free-text sign-in instructions — AI-extracted into structured creds. */
  authContext?: string;
  /** Optional structured credentials (used directly, no extraction). */
  email?: string;
  password?: string;
}

export interface ActiveExploration {
  sessionId: string;
  status: string;
  explore: QaExploreState | null;
}

/**
 * Launch an App Map exploration: a QA-agent run in mode "explore"
 * (setup → login → discover only). Thin wrapper over `startQaAgent`, which
 * enforces the Pro gate (`assertQaAgentAccess`) and one-active-session-per-
 * repo. The target URL resolves exactly as `buildAppMap` resolves it: the
 * branch base URL, falling back to the environment config's base URL.
 */
export async function startExploration(
  input: StartExplorationInput,
): Promise<{ sessionId: string }> {
  const { user, team } = await requireTeamAccess();
  const repo = await getSelectedRepository(user.id, team.id);
  if (!repo) throw new Error("No repository selected");

  const envConfig = await getEnvironmentConfig(repo.id);
  const branch = repo.selectedBranch ?? repo.defaultBranch ?? "main";
  const targetUrl = repo.branchBaseUrls?.[branch] ?? envConfig?.baseUrl ?? "";
  if (!targetUrl) {
    throw new Error(
      "No base URL configured for this repository — set one under Settings → Environment",
    );
  }

  const maxExplorers = Math.max(1, planConfig(team.plan).maxExplorers);
  const { sessionId } = await startQaAgent({
    repositoryId: repo.id,
    targetUrl,
    mode: "explore",
    groups: [],
    explore: {
      explorers: Math.max(1, Math.min(input.explorers, maxExplorers)),
      depth: input.depth,
      strategy: input.strategy,
      maxMinutes: input.maxMinutes,
    },
    authContext: input.authContext,
    email: input.email,
    password: input.password,
  });
  revalidatePath("/app-map");
  return { sessionId };
}

/** The repo's in-flight exploration, if any — lets a page reload resume the
 *  live progress UI instead of losing track of the run. */
export async function getActiveExploration(): Promise<ActiveExploration | null> {
  const { user, team } = await requireTeamAccess();
  const repo = await getSelectedRepository(user.id, team.id);
  if (!repo) return null;

  const session = await getActiveAgentSession(repo.id, "qa");
  if (!session || session.metadata.qaMode !== "explore") return null;
  return {
    sessionId: session.id,
    status: session.status,
    explore: session.metadata.qaExplore ?? null,
  };
}
