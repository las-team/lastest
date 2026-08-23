import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-authoring-ai` — AI test authoring: generate, heal, and
 * enhance Playwright tests, and plan functional-area coverage, all by
 * giving the AI provider live MCP browser tools bound to a core-issued
 * `BrowserSession`.
 *
 * The fifteenth phase-4 plugin, and the second to have been costed and
 * **stopped** before it could migrate at all
 * (`docs/architecture/authoring-ai-migration-result.md`). Its blocker was
 * not a missing host method — it was that no capability existed for "AI +
 * live browser tools" at all: `core/browser`'s `BrowserSession` explicitly
 * documents no CDP-URL escape hatch, and `AiCallOptions` had nothing that
 * could carry an MCP server config. `AiCallOptions.browserTools` closed
 * that gap as its own core PR, built to the migration doc's exact
 * specification. This plugin is the first (of two, alongside
 * `quickstart-scout`) to actually consume it.
 *
 * ### No capabilities beyond `ai` and `browser`
 *
 * This plugin owns no tables — every functional-area, test, and route row
 * it reads or writes belongs to core, reached through `AuthoringAiHost`
 * (see `host.ts` for why a port rather than `ctx.tests`/`ctx.repos`: those
 * capabilities don't yet cover functional areas or the specific writes
 * this feature needs). Two of the port's methods are deliberately
 * **sideways**, not core — `aiScanRoutes` and `extractUserStoriesFromFiles`
 * reach `src/server/actions/ai-routes.ts` and `spec-import.ts`, two
 * still-unmigrated, unclassified features (recipe §1.6.2). This plugin
 * does not make either of them migratable; that debt is unchanged.
 *
 * ### Browser tools, not a raw page
 *
 * Every MCP-driven call passes `ctx.ai.generate({ browserTools: session })`
 * a `BrowserSession` obtained from `ctx.browser.withBrowser(...)` — never a
 * CDP endpoint, never a raw string. The composition root
 * (`src/lib/core/ai-capability.ts`) is the only code in the program that can
 * turn that session back into an address.
 */
export const authoringAiPlugin = definePlugin({
  id: "authoring-ai",
  title: "AI Test Authoring",

  capabilities: ["ai", "browser"],
});

export default authoringAiPlugin;

export type { AuthoringAiHost } from "./host";
export type {
  AreaClassification,
  PlannerArea,
  PlannerResult,
  PlannerSource,
  ScoutArea,
  ScoutOutput,
} from "./planner-types";
export type { ParsedScenario, ScenarioGroup } from "./scenario-grouping";
export {
  configureAuthoringAi,
  isAuthoringAiConfigured,
  type AuthoringAiWiring,
} from "./wiring";
