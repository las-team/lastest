import { definePlugin } from "@lastest/kernel";

import { a11yCheckLayer } from "./check-layer";
import { createDeletionHook } from "./deletion";

/**
 * `@lastest/plugin-a11y` — WCAG 2.2 AA conformance, the third plugin
 * through the kernel and the second check-layer contributor (RFC §9 phase 3,
 * alongside `@lastest/plugin-design-system`).
 *
 * ### No host port
 *
 * Unlike explorer and design-system, this plugin declares no `<Name>Host`.
 * It needs exactly one thing core owns — a place to keep its baselines — and
 * that is `ctx.data` over its own `a11y_baselines` table. The a11y columns
 * on `test_results`/`test_runs` (`a11y_violations`, `a11y_score`, …) are
 * core's: core's build pipeline writes them, calling this plugin's *pure*
 * scoring functions (`./wcag-score`) to compute the values. Nothing here
 * reaches a core table, so there is no gap for a port to paper over.
 */
export const a11yPlugin = definePlugin({
  id: "a11y",
  title: "Accessibility",

  capabilities: ["data"],

  checkLayers: [a11yCheckLayer],

  // Loaded once at boot by `core/data`, which validates the `a11y_` prefix
  // on every table before binding a handle to it.
  schema: () => import("./schema"),

  // Required whenever `schema` is present — `resolveRegistry` refuses to boot
  // without it. See `deletion.ts` for the FK this replaces.
  deletion: createDeletionHook(),
});

export default a11yPlugin;

export { a11yCheckLayer } from "./check-layer";
export { configureA11y, isA11yConfigured, type A11yWiring } from "./wiring";
export type { A11yBaseline, NewA11yBaseline } from "./schema";
