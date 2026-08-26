/**
 * Per-check 3-way mode (enforce / log / disable) governing the check layers
 * shown in the Verify focus toolbar — the 9 core layers
 * (`src/lib/verify/core-check-layers.ts`) plus whatever plugins contribute
 * (`CHECK_LAYERS` in `check-layers.ts`, RFC §6.3). Replaces the older mix of
 * `enable*` booleans and `*ErrorMode` selects with a single uniform shape
 * per layer.
 *
 *   enforce → check runs AND a failure marks the test red
 *   log     → check runs, evidence is surfaced as amber, test stays green
 *   disable → check does not run; layer is "absent" in the focus view
 */

import type { CheckMode } from "@lastest/contracts";
import type {
  PlaywrightSettings,
  EvidenceItem,
  StepVerdict,
} from "@/lib/db/schema";
import { CHECK_LAYERS, CHECK_LAYER_BY_ID } from "@/lib/verify/check-layers";

export type { CheckMode } from "@lastest/contracts";

/**
 * Open registry (RFC §6.3, phase 3) — `CheckLayer` used to be an 11-member
 * closed union hand-duplicated here and in `core/contracts/src/refs.ts`.
 * `visual`/`text`/`dom`/`network`/`console`/`perf`/`url`/`api`/`storage`
 * stay core-owned (`src/lib/verify/core-check-layers.ts`); `a11y`/`design`
 * are now contributed by `@lastest/plugin-a11y`/`@lastest/plugin-design-system`
 * via `CHECK_LAYERS` (`src/lib/verify/check-layers.ts`). Widening this to
 * `string` gives up compile-time exhaustiveness for the id itself — the
 * same tradeoff already made for `jobTypes`/capability `provides` in
 * `core/kernel/src/registry.ts` — in exchange for "add a new check layer"
 * requiring zero edits here.
 */
export type CheckLayer = string;

export type CheckModeMap = Record<CheckLayer, CheckMode>;

/** The 9 core-owned layers, whose derive/patch logic stays hardcoded below
 *  instead of running through the generic `modeField`/`legacyEnabledField`
 *  loop — bespoke legacy fallbacks (network's two-axis capture+errorMode,
 *  console's errorMode, text's textDiffEnabled) that don't reduce to the
 *  shape a plugin layer declares. Everything else comes from the registry. */
const HARDCODED_LAYER_IDS: ReadonlySet<string> = new Set([
  "visual",
  "text",
  "dom",
  "network",
  "console",
  "perf",
  "url",
  "api",
  "storage",
]);

/** Repo / global default to use when nothing is persisted. Derived from the
 *  composed registry so a plugin layer's `defaultMode` needs no edit here. */
const DEFAULTS: CheckModeMap = Object.fromEntries(
  CHECK_LAYERS.map((layer) => [layer.id, layer.defaultMode]),
);

export function defaultCheckModes(): CheckModeMap {
  return { ...DEFAULTS };
}

/** Whether a layer is always captured regardless of its mode — `disable`
 *  means "don't surface or grade", not "skip the capture". */
export function isAlwaysCaptured(layer: CheckLayer): boolean {
  return CHECK_LAYER_BY_ID.get(layer)?.alwaysCaptured ?? false;
}

type LegacySource = Partial<
  Pick<
    PlaywrightSettings,
    | "enableA11y"
    | "enableDesignSystem"
    | "enableDomDiff"
    | "enableNetworkInterception"
    | "networkErrorMode"
    | "consoleErrorMode"
    | "visualMode"
    | "textMode"
    | "domMode"
    | "networkMode"
    | "consoleMode"
    | "a11yMode"
    | "designMode"
    | "perfMode"
    | "urlMode"
    | "apiMode"
    | "storageMode"
  >
> & {
  textDiffEnabled?: boolean | null;
};

function normalizeMode(value: unknown): CheckMode | null {
  if (value === "enforce" || value === "log" || value === "disable")
    return value;
  return null;
}

/**
 * Read the effective 3-way mode for each layer. New `*Mode` columns win
 * when present; otherwise we derive from the legacy boolean / error-mode
 * fields so a row written before the migration still classifies correctly.
 */
export function deriveCheckModes(
  source: LegacySource | null | undefined,
): CheckModeMap {
  const out = defaultCheckModes();
  if (!source) return out;

  // --- visual ---
  out.visual = normalizeMode(source.visualMode) ?? "enforce";

  // --- text ---
  // textMode wins; legacy diffSensitivity.textDiffEnabled treats true→enforce,
  // unset (the DB default) → falls through to DEFAULTS.text so a default flip
  // in this file reaches existing rows.
  out.text =
    normalizeMode(source.textMode) ??
    (source.textDiffEnabled === true ? "enforce" : DEFAULTS.text);

  // --- dom ---
  out.dom =
    normalizeMode(source.domMode) ??
    (source.enableDomDiff === true ? "enforce" : DEFAULTS.dom);

  // --- network ---
  // Network is a two-axis legacy: enableNetworkInterception (capture) +
  // networkErrorMode (fail/warn/ignore on 4xx/5xx). Collapse:
  //   capture=true, errorMode=fail   → enforce
  //   capture=true, errorMode=warn   → log
  //   capture=true, errorMode=ignore → log (still surfaced in the panel)
  //   capture=false                  → mode from errorMode:
  //                                       fail→enforce, warn→log, ignore→disable
  out.network =
    normalizeMode(source.networkMode) ??
    (() => {
      const capture = source.enableNetworkInterception ?? false;
      const err = source.networkErrorMode ?? "fail";
      if (capture) {
        if (err === "fail") return "enforce";
        return "log";
      }
      if (err === "fail") return "enforce";
      if (err === "warn") return "log";
      return "disable";
    })();

  // --- console ---
  // Console capture is always on at the runner level. The legacy gate is
  // consoleErrorMode alone.
  out.console =
    normalizeMode(source.consoleMode) ??
    (() => {
      const err = source.consoleErrorMode ?? "fail";
      if (err === "fail") return "enforce";
      if (err === "warn") return "log";
      return "disable";
    })();

  // --- perf / url / api / storage ---
  out.perf = normalizeMode(source.perfMode) ?? DEFAULTS.perf;
  out.url = normalizeMode(source.urlMode) ?? DEFAULTS.url;
  out.api = normalizeMode(source.apiMode) ?? DEFAULTS.api;
  out.storage = normalizeMode(source.storageMode) ?? DEFAULTS.storage;

  // --- plugin-contributed layers (a11y, design) ---
  // Each declares `modeField`/`legacyEnabledField` on its descriptor instead
  // of a hardcoded branch here — see `CheckLayerDescriptor` in
  // `core/contracts/src/check-layer.ts`. This is what makes a new check
  // layer a plugin-only PR: this loop needs no edit when one is added.
  const rawSource = source as unknown as Record<string, unknown>;
  for (const layer of CHECK_LAYERS) {
    if (HARDCODED_LAYER_IDS.has(layer.id)) continue;
    const legacy = layer.legacyEnabledField
      ? rawSource[layer.legacyEnabledField]
      : undefined;
    out[layer.id] =
      normalizeMode(rawSource[layer.modeField]) ??
      (legacy === true ? "enforce" : DEFAULTS[layer.id]);
  }

  return out;
}

/**
 * Inverse of deriveCheckModes — given the modes the user picked in the
 * cogwheel modal, produce the patch to persist (new `*Mode` columns are
 * authoritative AND legacy fields are mirrored so executor code that
 * still reads them keeps working).
 */
export function checkModesToSettingsPatch(modes: Partial<CheckModeMap>): {
  // new columns
  visualMode?: CheckMode;
  textMode?: CheckMode;
  domMode?: CheckMode;
  networkMode?: CheckMode;
  consoleMode?: CheckMode;
  a11yMode?: CheckMode;
  designMode?: CheckMode;
  perfMode?: CheckMode;
  urlMode?: CheckMode;
  apiMode?: CheckMode;
  storageMode?: CheckMode;
  // legacy mirrors
  enableA11y?: boolean;
  enableDesignSystem?: boolean;
  enableDomDiff?: boolean;
  enableNetworkInterception?: boolean;
  networkErrorMode?: "fail" | "warn" | "ignore";
  consoleErrorMode?: "fail" | "warn" | "ignore";
  textDiffEnabled?: boolean;
} {
  const patch: ReturnType<typeof checkModesToSettingsPatch> = {};

  if (modes.visual) {
    patch.visualMode = modes.visual;
  }
  if (modes.text) {
    patch.textMode = modes.text;
    patch.textDiffEnabled = modes.text !== "disable";
  }
  if (modes.dom) {
    patch.domMode = modes.dom;
    patch.enableDomDiff = modes.dom !== "disable";
  }
  if (modes.network) {
    patch.networkMode = modes.network;
    patch.enableNetworkInterception = modes.network !== "disable";
    patch.networkErrorMode =
      modes.network === "enforce"
        ? "fail"
        : modes.network === "log"
          ? "warn"
          : "ignore";
  }
  if (modes.console) {
    patch.consoleMode = modes.console;
    patch.consoleErrorMode =
      modes.console === "enforce"
        ? "fail"
        : modes.console === "log"
          ? "warn"
          : "ignore";
  }
  if (modes.perf) {
    patch.perfMode = modes.perf;
  }
  if (modes.url) {
    patch.urlMode = modes.url;
  }
  if (modes.api) {
    patch.apiMode = modes.api;
  }
  if (modes.storage) {
    patch.storageMode = modes.storage;
  }

  // --- plugin-contributed layers (a11y, design) ---
  const rawPatch = patch as Record<string, unknown>;
  for (const layer of CHECK_LAYERS) {
    if (HARDCODED_LAYER_IDS.has(layer.id)) continue;
    const mode = modes[layer.id];
    if (!mode) continue;
    rawPatch[layer.modeField] = mode;
    if (layer.legacyEnabledField) {
      rawPatch[layer.legacyEnabledField] = mode !== "disable";
    }
  }

  return patch;
}

/** Visual treatment a layer's broken/warn/clean pill should take given the
 *  active mode and the evidence signal recorded on the step. Centralizing
 *  here so the focus toolbar, board cards, and any future surfaces all stay
 *  in agreement. */
export function classifyEvidenceWithMode(
  mode: CheckMode,
  signal: "high" | "medium" | "low" | null | undefined,
): "broken" | "warned" | "clean" {
  if (mode === "disable") return "clean";
  if (signal !== "high") return "clean";
  if (mode === "enforce") return "broken";
  return "warned";
}

/**
 * Tone class for a per-layer chip on the board view's case card.
 *
 *   - `regression` (red)   → evidence is high-signal AND mode is `enforce`
 *   - `missed`     (amber) → either evidence is high-signal + mode is `log`,
 *                            or evidence is medium-signal regardless of mode
 *   - `done`       (green) → evidence is low-signal OR no evidence (matched)
 *   - `unknown`    (mute)  → mode is `disable` — chip dimmed to show the
 *                            layer was deliberately suppressed
 *
 * Keeps the board card's per-layer treatment in step with the focus
 * toolbar's broken/warned/clean classification so a Network layer set to
 * `log` reads as amber on both surfaces (was: always red on the board).
 */
export function chipToneForLayer(
  mode: CheckMode,
  signal: "high" | "medium" | "low" | null | undefined,
): "regression" | "missed" | "done" | "unknown" {
  if (mode === "disable") return "unknown";
  if (signal == null) return "done";
  if (signal === "high") return mode === "enforce" ? "regression" : "missed";
  if (signal === "medium") return "missed";
  return "done";
}

/**
 * Mode-aware roll-up of a step's evidence into a green/yellow/red verdict —
 * the read-time analogue of the stored `step_comparisons.verdict`.
 *
 * The persisted verdict is a *pre-verdict*: the scorer computes it mode-blind
 * (any high-signal layer → red) because it doesn't know each layer's mode.
 * This function re-derives the verdict honoring the per-layer mode, so the
 * Broken/Missed columns and the build-status gate agree with the per-layer
 * chips (`chipToneForLayer`). Without it a high-signal layer in `log` mode
 * (e.g. perf, which defaults to `log`) reddens the whole step while every
 * chip renders amber — a card lands in Broken with nothing red.
 *
 *   red    ← any layer is `enforce` AND high-signal     (≥1 red chip)
 *   yellow ← any non-disabled layer is high (`log`) or medium-signal
 *   green  ← otherwise
 *
 * `disable` layers are ignored entirely. The `variable` layer has no
 * configurable mode today, so it's treated as `enforce` (its high-signal
 * structural-break still gates) — matching the board card's legacy mapping.
 */
export function effectiveVerdict(
  evidence:
    | ReadonlyArray<Pick<EvidenceItem, "layer" | "signal">>
    | null
    | undefined,
  modes: CheckModeMap,
): StepVerdict {
  let hasRed = false;
  let hasAmber = false;
  for (const e of evidence ?? []) {
    const mode: CheckMode =
      e.layer === "variable"
        ? "enforce"
        : (modes[e.layer as CheckLayer] ?? "enforce");
    if (mode === "disable") continue;
    if (e.signal === "high") {
      if (mode === "enforce") hasRed = true;
      else hasAmber = true; // log → surfaced amber, never reddens
    } else if (e.signal === "medium") {
      hasAmber = true;
    }
  }
  return hasRed ? "red" : hasAmber ? "yellow" : "green";
}

/**
 * Pull only the per-layer mode override keys from a tests.playwrightOverrides
 * blob. Returns null when no override is present so callers can skip the
 * merge entirely. Reads new `*Mode` keys; falls back to the legacy
 * `networkErrorMode` / `consoleErrorMode` if only the legacy field is set
 * (lets a row written before this migration still classify correctly).
 */
export function pickTestModeOverrides(
  overrides:
    | {
        visualMode?: string | null;
        textMode?: string | null;
        domMode?: string | null;
        networkMode?: string | null;
        consoleMode?: string | null;
        a11yMode?: string | null;
        designMode?: string | null;
        perfMode?: string | null;
        urlMode?: string | null;
        storageMode?: string | null;
        networkErrorMode?: "fail" | "warn" | "ignore" | null;
        consoleErrorMode?: "fail" | "warn" | "ignore" | null;
      }
    | null
    | undefined,
): Partial<CheckModeMap> | null {
  if (!overrides) return null;
  const errToMode = (
    e: "fail" | "warn" | "ignore" | null | undefined,
  ): CheckMode | null => {
    if (e === "fail") return "enforce";
    if (e === "warn") return "log";
    if (e === "ignore") return "disable";
    return null;
  };
  const out: Partial<CheckModeMap> = {};
  for (const { id: layer } of CHECK_LAYERS) {
    const newKey = `${layer}Mode` as const;
    const raw = (overrides as Record<string, unknown>)[newKey];
    const norm = normalizeMode(raw);
    if (norm) {
      out[layer] = norm;
      continue;
    }
    // Legacy fallback only for the two gating layers — older test rows
    // can have networkErrorMode/consoleErrorMode but no networkMode.
    if (layer === "network") {
      const m = errToMode(overrides.networkErrorMode ?? null);
      if (m) out.network = m;
    } else if (layer === "console") {
      const m = errToMode(overrides.consoleErrorMode ?? null);
      if (m) out.console = m;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Inverse of `pickTestModeOverrides` — given a sparse map of per-test
 * mode overrides, produce the JSONB patch to merge into
 * tests.playwrightOverrides. Also mirrors network/console onto the legacy
 * `*ErrorMode` keys so executor code that still reads them sees the same
 * value.
 *
 * Layers absent from the input map are *not* emitted, meaning the caller
 * should perform a key delete when the reviewer picks "Inherit" rather
 * than relying on this to clear keys.
 */
export function testModeOverridesToOverridesPatch(
  modes: Partial<CheckModeMap>,
): {
  visualMode?: CheckMode;
  textMode?: CheckMode;
  domMode?: CheckMode;
  networkMode?: CheckMode;
  consoleMode?: CheckMode;
  a11yMode?: CheckMode;
  designMode?: CheckMode;
  perfMode?: CheckMode;
  urlMode?: CheckMode;
  storageMode?: CheckMode;
  networkErrorMode?: "fail" | "warn" | "ignore";
  consoleErrorMode?: "fail" | "warn" | "ignore";
} {
  const patch: ReturnType<typeof testModeOverridesToOverridesPatch> = {};
  const modeToErr = (m: CheckMode): "fail" | "warn" | "ignore" =>
    m === "enforce" ? "fail" : m === "log" ? "warn" : "ignore";

  if (modes.visual) patch.visualMode = modes.visual;
  if (modes.text) patch.textMode = modes.text;
  if (modes.dom) patch.domMode = modes.dom;
  if (modes.perf) patch.perfMode = modes.perf;
  if (modes.url) patch.urlMode = modes.url;
  if (modes.storage) patch.storageMode = modes.storage;
  if (modes.network) {
    patch.networkMode = modes.network;
    patch.networkErrorMode = modeToErr(modes.network);
  }
  if (modes.console) {
    patch.consoleMode = modes.console;
    patch.consoleErrorMode = modeToErr(modes.console);
  }

  // --- plugin-contributed layers (a11y, design) ---
  // No legacy-boolean mirror here: per-test overrides postdate the
  // enable*/mode-column migration, so only `*Mode` needs writing.
  const rawPatch = patch as Record<string, unknown>;
  for (const layer of CHECK_LAYERS) {
    if (HARDCODED_LAYER_IDS.has(layer.id)) continue;
    const mode = modes[layer.id];
    if (mode) rawPatch[layer.modeField] = mode;
  }

  return patch;
}

/** Merge a repo-level mode map with a sparse per-test override map. Per-test
 *  wins for any layer it touches; absent layers fall through to repo. */
export function mergeWithTestOverrides(
  repo: CheckModeMap,
  perTest: Partial<CheckModeMap> | null | undefined,
): CheckModeMap {
  if (!perTest) return repo;
  // `Partial<Record<string, CheckMode>>` types every value as possibly
  // `undefined` (unlike `Partial` of a literal-keyed type); the object
  // itself never actually holds one — `checkModesToSettingsPatch` and
  // friends only ever set a key when they have a real `CheckMode`.
  return { ...repo, ...perTest } as CheckModeMap;
}
