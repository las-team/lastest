import { definePlugin } from "@lastest/kernel";

import { designSystemCheckLayer } from "./check-layer";

/**
 * `@lastest/plugin-design-system` — design-token compliance, the second
 * plugin through the check-layer registry (RFC §9 phase 3, alongside
 * `@lastest/plugin-a11y`).
 *
 * No `capabilities`/`provides`/`schema`/`deletion`: this plugin owns no
 * table (its config lives in core-owned JSONB columns, reached through
 * `DesignSystemHost` — see `host.ts`) and needs no browser/AI/data
 * capability, only the host. `resolveRegistry` doesn't require a deletion
 * hook here for the same reason it doesn't for `events` — that rule only
 * fires when `schema` is declared.
 */
export const designSystemPlugin = definePlugin({
  id: "design-system",
  title: "Design System",
  checkLayers: [designSystemCheckLayer],
});

export default designSystemPlugin;

export type { DesignSystemHost } from "./host";
export { configureDesignSystem } from "./wiring";
