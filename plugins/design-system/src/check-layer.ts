import type { CheckLayerDescriptor } from "@lastest/contracts";

/**
 * The "design" check layer (RFC §6.3) — comparing computed styles against a
 * repo's design-token bundle.
 *
 * `wasCaptured`/`delta` are ported 1:1 from the "design" cases in
 * `wasLayerCaptured`/`deltaForLayer` (src/app/(app)/verify/[buildId]/board-view.tsx)
 * they replace. `wasCaptured` is called with a persisted `test_results` row
 * (`result`); `delta` is called with the step's `layers.designSystem`
 * comparison sub-object, not `result` — different shape, same convention
 * `CheckLayerDescriptor` documents.
 */
export const designSystemCheckLayer: CheckLayerDescriptor = {
  id: "design",
  name: "Design",
  icon: "Palette",
  description:
    "Compare computed tokens (colors / radii / fonts) against the repo bundle.",
  // Reserved slot in the canonical layer order (check-modes-dialog.tsx's
  // pre-registry LAYERS array): visual(0) text(1) dom(2) network(3)
  // console(4) a11y(5) design(6) perf(7) url(8) api(9) storage(10).
  order: 6,
  defaultMode: "disable",
  modeField: "designMode",
  legacyEnabledField: "enableDesignSystem",

  wasCaptured(result) {
    return (
      result.designSystemViolations != null ||
      result.designSystemRulesChecked != null
    );
  },

  delta(layerData) {
    const newViolations = layerData.newViolations;
    const disappeared = layerData.disappeared;
    if (!Array.isArray(newViolations) || !Array.isArray(disappeared)) {
      return null;
    }
    return newViolations.length > 0
      ? `+${newViolations.length}`
      : `−${disappeared.length}`;
  },
};
