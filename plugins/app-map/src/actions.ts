"use server";

import { revalidatePath } from "next/cache";

import { buildAppMap, type AppMapGraph } from "./build-map";
import { deriveFlows, type AppFlow } from "./flows";
import type {
  AppMapActiveExploration,
  AppMapExploreStrategy,
  AppMapHost,
} from "./host";
import { appMapPlugin } from "./index";
import { appMapWiring } from "./wiring";

/**
 * App Map's server actions.
 *
 * A `"use server"` module inside a `transpilePackages` workspace package
 * produces real, dispatchable action ids (spike S1), so these live in the
 * package with no codegen and no shim. Note the trap S1 also found: an
 * `export { x } from "…"` re-export inside a `"use server"` file compiles to a
 * module with *no exports at all* — every action here is declared locally for
 * that reason.
 *
 * ### Two things changed in the move, both deliberate
 *
 * **`repositoryId` is now an argument.** Every action used to open with
 * `requireTeamAccess()` and then `getSelectedRepository(user.id, team.id)`.
 * Repository *selection* is per-user app state; a plugin has no business
 * reading it, so the route page resolves it and passes the id down. The
 * authorization that replaces it is stronger, not weaker:
 * `contextFor({ repositoryId })` runs the app's `requireRepoAccess` inside
 * `resolveScope`, so an id belonging to another team is rejected before any
 * capability exists to use it. There is no `setTeam` on the resulting context.
 *
 * **`branch` is now required.** It was optional and resolved deep inside
 * `buildAppMap` from `repo.selectedBranch ?? repo.defaultBranch ?? "main"`.
 * Both callers already knew the branch and already passed it (the client on
 * every call, the page on none — it computed the identical value two lines
 * above the call and threw it away). Making it an argument is what let
 * base-URL resolution move to `ctx.repos.baseUrl`.
 */

async function scope(repositoryId: string): Promise<{
  host: AppMapHost;
  baseUrl(branch: string): Promise<string>;
}> {
  const { runtime, host } = appMapWiring();
  const ctx = await runtime.contextFor(appMapPlugin, { repositoryId });
  return {
    host,
    async baseUrl(branch: string) {
      return (await ctx.repos.baseUrl(repositoryId, branch)) ?? "";
    },
  };
}

export type GetAppMapResult =
  | { ok: true; graph: AppMapGraph }
  | { ok: false; reason: "no-data" };

/**
 * Build the App Map for a repository. Merges routes + sitemap + QA crawl +
 * test trajectories into a node-network. Computed on read (no persisted table
 * — the data is fully derivable).
 */
export async function getAppMap(input: {
  repositoryId: string;
  branch: string;
}): Promise<GetAppMapResult> {
  const { host, baseUrl } = await scope(input.repositoryId);

  const graph = await buildAppMap(host, input.repositoryId, {
    branch: input.branch,
    baseUrl: await baseUrl(input.branch),
    includeSitemap: true,
  });
  if (graph.nodes.length === 0) return { ok: false, reason: "no-data" };
  return { ok: true, graph };
}

export type GetAppFlowsResult = {
  ok: true;
  flows: AppFlow[];
  branch: string;
};

/**
 * Derive the Flows view data (named user journeys from test URL trajectories).
 * Lazy-loaded by the client when the Flows tab first opens — not part of the
 * map payload.
 */
export async function getAppFlows(input: {
  repositoryId: string;
  branch: string;
}): Promise<GetAppFlowsResult> {
  const { host } = await scope(input.repositoryId);
  const rows = await host.listTrajectoryResults(
    input.repositoryId,
    input.branch,
  );
  return {
    ok: true,
    flows: deriveFlows(rows, input.branch),
    branch: input.branch,
  };
}

/**
 * Enqueue an "Ask QA agent to cover <page>" task for an uncovered node.
 * Pro-gating is enforced by the host, inside qa-agent's own `addQaTask`.
 */
export async function requestCoverage(input: {
  repositoryId: string;
  path: string;
  url?: string;
}): Promise<{ taskId: string }> {
  const { host } = await scope(input.repositoryId);
  const result = await host.requestCoverage(input);
  revalidatePath("/app-map");
  return result;
}

export interface StartExplorationInput {
  repositoryId: string;
  branch: string;
  explorers: number;
  /** Crawl depth 1–6. */
  depth: number;
  strategy: AppMapExploreStrategy;
  /** Wall-clock budget in minutes (2/5/10/20 in the dialog). */
  maxMinutes: number;
  /** Free-text sign-in instructions — AI-extracted into structured creds. */
  authContext?: string;
  /** Optional structured credentials (used directly, no extraction). */
  email?: string;
  password?: string;
}

/**
 * Launch an App Map exploration: a QA-agent run in mode "explore"
 * (setup → login → discover only). The host enforces the Pro gate, the
 * one-active-session-per-repo rule and the plan's explorer quota — a plugin
 * that could clamp its own quota would not be a quota.
 *
 * The target URL resolves exactly as `getAppMap` resolves it, which is now
 * literally the same call rather than two copies of the same `??` chain.
 */
export async function startExploration(
  input: StartExplorationInput,
): Promise<{ sessionId: string }> {
  const { host, baseUrl } = await scope(input.repositoryId);

  const targetUrl = await baseUrl(input.branch);
  if (!targetUrl) {
    throw new Error(
      "No base URL configured for this repository — set one under Settings → Environment",
    );
  }

  const { sessionId } = await host.startExploration({
    repositoryId: input.repositoryId,
    targetUrl,
    explorers: input.explorers,
    depth: input.depth,
    strategy: input.strategy,
    maxMinutes: input.maxMinutes,
    authContext: input.authContext,
    email: input.email,
    password: input.password,
  });
  revalidatePath("/app-map");
  return { sessionId };
}

export type ActiveExploration = AppMapActiveExploration;

/** The repo's in-flight exploration, if any — lets a page reload resume the
 *  live progress UI instead of losing track of the run. */
export async function getActiveExploration(input: {
  repositoryId: string;
}): Promise<ActiveExploration | null> {
  const { host } = await scope(input.repositoryId);
  return host.getActiveExploration(input.repositoryId);
}
