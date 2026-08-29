import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-app-map` — the App Map: every page of the target app as one
 * node-network, merged from four discovery sources, decorated with the best
 * screenshot covering each page and a coverage status. The second feature
 * migrated in RFC §9 phase 4.
 *
 * ### One capability, no schema
 *
 * App Map owns no tables, and that is not an accident of this migration — the
 * graph is *computed on read* from data four other subsystems already persist
 * (`routes`, the app's live sitemap, `agent_sessions.metadata.qaDiscovery`,
 * `test_results.urlTrajectory`). There is nothing to store, so there is no
 * `schema` and therefore no `deletion` hook; `resolveRegistry` requires one
 * only when the other is declared.
 *
 * The single declared capability is `repos`, for `ctx.repos.baseUrl()`. That
 * one line replaced two hand-rolled copies of
 * `repo.branchBaseUrls?.[branch] ?? envConfig?.baseUrl` — see
 * `docs/architecture/app-map-migration-result.md` §3 for the behaviour change
 * that carries, which is the only one in this migration.
 *
 * Everything else App Map needs is on `AppMapHost`. **Read `host.ts` before
 * concluding this migration is finished** — nine methods, of which three are
 * an unmigrated `qa-agent` reached through the composition root rather than
 * through an import.
 */
export const appMapPlugin = definePlugin({
  id: "app-map",
  title: "App Map",

  capabilities: ["repos"],

  // No nav entry of its own any more. The map is mounted as the default view
  // of core's Coverage screen (`src/app/(app)/coverage/page.tsx`) — the two
  // were one question asked on two axes, and two entries for it was the seam.
  // `/app-map` survives as a redirect there.
});

export default appMapPlugin;

export { buildAppMap, canonicalPath } from "./build-map";
export type {
  AppMapEdge,
  AppMapEdgeKind,
  AppMapGraph,
  AppMapNode,
  AppMapScreenshot,
  AppMapSource,
  CoverageStatus,
} from "./build-map";
export { deriveFlows, flowsThroughNode } from "./flows";
export type { AppFlow, AppFlowStep, FlowSourceResult } from "./flows";
export { buildSpanningTree } from "./hierarchy";
export type { SpanningTree } from "./hierarchy";
export type {
  AppMapActiveExploration,
  AppMapAreaRow,
  AppMapCapturedScreenshot,
  AppMapCrawledPage,
  AppMapDiscovery,
  AppMapExploreState,
  AppMapExploreStrategy,
  AppMapHost,
  AppMapRouteRow,
  AppMapStartExplorationInput,
  AppMapTrajectoryResult,
} from "./host";
export {
  configureAppMap,
  isAppMapConfigured,
  type AppMapWiring,
} from "./wiring";
