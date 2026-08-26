import type { CheckLayerDescriptor } from "@lastest/contracts";
import { a11yCheckLayer } from "@lastest/plugin-a11y/check-layer";
import { designSystemCheckLayer } from "@lastest/plugin-design-system/check-layer";

import { CORE_CHECK_LAYER_DESCRIPTORS } from "./core-check-layers";

/**
 * The full, composed check-layer registry: core's 9 layers plus every
 * plugin-contributed one (RFC §6.3).
 *
 * Deliberately does NOT import `resolveRegistry`/`MANIFESTS`
 * (`src/lib/core/manifests.ts`) — those pull in each plugin's full manifest,
 * which eagerly imports its `schema`/`deletion` (drizzle-orm and friends;
 * see `plugins/explorer/src/index.ts` → `deletion.ts` → `schema.ts`). That's
 * fine for `src/lib/core/runtime.ts` (server-only, already behind
 * `import "server-only"`), but this file is imported by client components
 * (board-view.tsx, focus-view.tsx, check-modes-dialog.tsx,
 * test-playwright-overrides.tsx) and must stay free of anything that isn't
 * safe to bundle into the browser.
 *
 * Instead, each plugin exports its check-layer descriptor(s) from a narrow
 * `./check-layer` subpath — the same pattern explorer already uses for
 * `./schema`/`./actions`/`./wiring` — imported directly below. Boot-time
 * uniqueness/reserved-id validation of the *same* descriptors still happens
 * for real via `resolveRegistry(MANIFESTS)` in `runtime.ts`'s
 * `getPluginRuntime()`, since every plugin also lists `checkLayers` on its
 * main manifest.
 */
const PLUGIN_CHECK_LAYER_DESCRIPTORS: readonly CheckLayerDescriptor[] = [
  a11yCheckLayer,
  designSystemCheckLayer,
];

export const CHECK_LAYERS: readonly CheckLayerDescriptor[] = [
  ...CORE_CHECK_LAYER_DESCRIPTORS,
  ...PLUGIN_CHECK_LAYER_DESCRIPTORS,
].sort((a, b) => a.order - b.order);

export const CHECK_LAYER_BY_ID: ReadonlyMap<string, CheckLayerDescriptor> =
  new Map(CHECK_LAYERS.map((layer) => [layer.id, layer]));
