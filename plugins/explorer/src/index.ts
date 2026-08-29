import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-explorer` — the pilot migration for the core/plugin refactor.
 *
 * ### What the manifest below is claiming
 *
 * RFC §7.4 makes the *dependency manifest* the reviewable unit, not the import
 * list, and `package.json` here is the load-bearing half of that: it lists no
 * `playwright`, no `@lastest/db`, no `@lastest/pool-service`. Under pnpm's
 * strict `node_modules` layout that is not advisory — those imports fail to
 * resolve. The three lines below say the same thing positively: a browser, a
 * model and its own tables, and nothing else.
 *
 * Adding a capability is a one-line diff here. That visible diff is the audit
 * trail, which is the whole reason the declaration exists rather than being
 * inferred from what the code happens to import.
 *
 * ### What the plugin still cannot do
 *
 * `resolveTargetUrl` (→ `ctx.repos`), `listCoverage`/`createQuarantinedTest`
 * (→ `ctx.tests`) and `emitActivity` (→ `ctx.events`, a provider plugin) have
 * since landed as real capabilities, declared below. Four things remain on
 * `ExplorerHost`'s port instead of `ctx` — existing-auth resolution, an SSRF
 * guard, field encryption, and per-repo settings that should be plugin-owned
 * and are not. Read `host.ts` before concluding this migration is finished.
 */
export const explorerPlugin = definePlugin({
  id: "explorer",
  title: "Explorer",

  capabilities: ["browser", "ai", "data", "events", "tests", "repos"],

  // Loaded once at boot by `core/data`, which validates the `explorer_` prefix
  // on every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — `resolveRegistry` refuses to boot
  // without it. See `deletion.ts` for why that rule is not bureaucracy.
  deletion: createDeletionHook(),

  ui: {
    nav: [{ href: "/explorer", label: "Explorer", icon: "Compass" }],
  },
});

export default explorerPlugin;

export type {
  ExplorerActivityEvent,
  ExplorerExistingAuth,
  ExplorerHost,
  ExplorerIssueContext,
  ExplorerIssueRequest,
  ExplorerIssueResult,
  ExplorerSettings,
} from "./host";
export {
  configureExplorer,
  isExplorerConfigured,
  type ExplorerWiring,
} from "./wiring";
