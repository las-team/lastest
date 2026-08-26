import type { CheckLayerDescriptor } from "@lastest/contracts";

/**
 * The "a11y" check layer (RFC §6.3) — axe-core WCAG 2.2 AA conformance.
 *
 * `wasCaptured`/`delta` are ported 1:1 from the "a11y" cases in
 * `wasLayerCaptured`/`deltaForLayer` (src/app/(app)/verify/[buildId]/board-view.tsx)
 * they replace. `wasCaptured` is called with a persisted `test_results` row;
 * `delta` is called with the step's `layers.a11y` comparison sub-object —
 * different shape, same convention `CheckLayerDescriptor` documents.
 */
export const a11yCheckLayer: CheckLayerDescriptor = {
  id: "a11y",
  name: "A11y",
  icon: "Accessibility",
  // Slot 5 in the canonical layer order (check-modes-dialog.tsx's
  // pre-registry LAYERS array): visual(0) text(1) dom(2) network(3)
  // console(4) a11y(5) design(6) perf(7) url(8) api(9) storage(10).
  order: 5,
  description: "Run axe-core WCAG 2.2 AA compliance checks.",
  defaultMode: "log",
  modeField: "a11yMode",
  legacyEnabledField: "enableA11y",

  wasCaptured(result) {
    return result.a11yViolations != null || result.a11yPassesCount != null;
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
