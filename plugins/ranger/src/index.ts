import { definePlugin } from "@lastest/kernel";

import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-ranger` — an MCP-triggered, EB-backed live page scout.
 *
 * RFC §9 phase 4's tenth plugin, and the first from the `src/lib/playwright`
 * split (§6.2): `ranger.ts` was one of the six direct-CDP call sites §1.1
 * opened the whole RFC with (`chromium.connectOverCDP(cdpUrl)`, called on a
 * raw string handed to feature code). That import is gone. `browse.ts` now
 * receives a page from `ctx.browser.withBrowser` — core made the connection,
 * core closes it, and the plugin never holds a pod address.
 *
 * ### Smallest table-owning migration so far
 *
 * One table (`ranger_sessions`), one host method (`assertSafeOutboundUrl`,
 * the fourth declaration of the same SSRF gap after `explorer`, `app-map` and
 * `api-test` — see `host.ts`), no UI of its own (MCP-driven, polled over
 * `/api/v1/ranger/*`, see the migration result doc). `explorer`'s
 * `explorer_sessions` — "replaces this feature's slice of `agent_sessions`" —
 * is the direct precedent for `ranger_sessions` doing the same.
 *
 * ### What migrating to `ctx.browser` fixed for free
 *
 * The pre-migration code called `claimEmbeddedBrowserForAgent` /
 * `releasePoolEB` directly — the same primitives `core/browser`'s own host
 * (`src/lib/core/browser-host.ts`) wraps, so this is a pure refactor, not a
 * behaviour change, with one exception: run-minute quota enforcement and
 * deadline enforcement now apply to ranger sessions, which they did not
 * before (`claimEmbeddedBrowserForAgent` alone did not check either). See the
 * result doc §4.
 */
export const rangerPlugin = definePlugin({
  id: "ranger",
  title: "Ranger",

  capabilities: ["browser", "repos", "events", "data"],

  // Loaded once at boot by `core/data`, which validates the `ranger_` prefix
  // on every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — see `deletion.ts`.
  deletion: createDeletionHook(),
});

export default rangerPlugin;

export type { RangerHost } from "./host";
export type {
  RangerSessionMetadata,
  RangerSessionStatus,
  RangerStepId,
  RangerStepState,
} from "./types";
export {
  configureRanger,
  isRangerConfigured,
  type RangerWiring,
} from "./wiring";
