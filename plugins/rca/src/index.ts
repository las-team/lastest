import { definePlugin } from "@lastest/kernel";

/**
 * `@lastest/plugin-rca` — root-cause analysis for visual diffs: "is this diff
 * the TEST or the CODE?". The first feature migrated in RFC §9 phase 4.
 *
 * ### No capabilities, no schema
 *
 * RCA owns no tables and asks for no capability. Everything it reads and
 * writes belongs to core (`visual_diffs`, `build_change_maps`, `tests`,
 * `test_results`), so it reaches all of it through `RcaHost` — see `host.ts`
 * for why a port rather than `ctx.data`. `resolveRegistry` requires a
 * `deletion` hook only when `schema` is declared, so there is none here:
 * deleting a team deletes the visual diffs, and the verdict is a field on
 * them.
 *
 * The manifest still exists, and is not ceremony. It is what puts the plugin
 * in `MANIFESTS`, which is what makes `contextFor()` resolve a scope for its
 * actions — that is where `requireRepoAccess` runs. A plugin that skipped the
 * registry would have to authorize itself.
 */
export const rcaPlugin = definePlugin({
  id: "rca",
  title: "Root Cause Analysis",
});

export default rcaPlugin;

export { classifyDiffSource, RCA_VERSION } from "./classify";
export type { ClassifyDiffInput } from "./classify";
export { correlateRegions, pickSelector } from "./correlate";
export {
  isDynamicTextChange,
  isPurelyDynamic,
  maskDynamic,
} from "./dynamic-text";
export { classifyBuildDiffs } from "./run";
export type { RcaChangeMap, RcaHost, RcaVisualDiff } from "./host";
export { configureRca, isRcaConfigured, type RcaWiring } from "./wiring";
