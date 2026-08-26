/**
 * The verify check-layer registry (RFC §6.3).
 *
 * Kept here rather than in `src/lib/verify/check-modes.ts` so that a plugin
 * contributing a layer does not have to import app code — it only needs
 * `@lastest/contracts`, the same as every other capability it declares.
 *
 * This used to be a closed union (`CheckLayer` in `refs.ts`) pre-placed for
 * this phase. It is now an open registry: a plugin's manifest lists the
 * layers it contributes as `CheckLayerDescriptor`s, `resolveRegistry`
 * validates them at boot (id uniqueness, no collision with a core-owned
 * id), and app code composes the full set (core + registry) for both the
 * derive/merge logic in `check-modes.ts` and the Verify UI.
 */

export type CheckMode = "enforce" | "log" | "disable";

export interface CheckLayerDescriptor {
  /** e.g. "a11y", "design". Namespaced against core-owned ids at boot. */
  readonly id: string;
  readonly name: string;
  /** lucide-react icon name — same convention as `NavEntry.icon`. */
  readonly icon: string;
  readonly description: string;
  /** Position among the full composed layer list (core + registry). */
  readonly order: number;
  readonly defaultMode: CheckMode;
  /** Layer whose data is always captured by the runner — `disable` means
   *  "don't surface or grade", not "skip the capture". */
  readonly alwaysCaptured?: boolean;

  /** The `<id>Mode` settings/override column name, e.g. "a11yMode". Lets
   *  deriveCheckModes/checkModesToSettingsPatch/testModeOverridesToOverridesPatch
   *  handle this layer generically instead of a hardcoded branch. */
  readonly modeField: string;
  /** Legacy `enable*` boolean fallback column, e.g. "enableA11y", read when
   *  `modeField` is unset on a pre-migration row. Omit if the layer has no
   *  such legacy column. */
  readonly legacyEnabledField?: string;

  /**
   * Was this layer's evidence captured on a given persisted test-result row?
   * Optional: core layers keep their existing hardcoded capture-check inline
   * in the Verify UI (board-view.tsx/focus-view.tsx) rather than round-
   * tripping through the registry — this only needs implementing by a plugin
   * whose layer isn't one of those hardcoded cases.
   */
  wasCaptured?(result: Readonly<Record<string, unknown>>): boolean;
  /**
   * Formatted delta string for the focus/board chip, or null if not
   * applicable / nothing changed. Same optionality reasoning as `wasCaptured`
   * — called with whichever object the UI already extracts the layer's
   * comparison data from (e.g. a `step.layers[id]` sub-object), not
   * necessarily the same shape as `wasCaptured`'s `result`.
   */
  delta?(layerData: Readonly<Record<string, unknown>>): string | null;
}
