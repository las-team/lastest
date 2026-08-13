/**
 * Cross-domain JSON column types.
 *
 * What belongs here: a type or interface that more than one domain module
 * stores in a jsonb column. Nothing else — no tables, and no type that only one
 * domain uses (that type belongs in the domain that uses it).
 *
 * The rule is mechanical, and it is what keeps the split acyclic: `shared` is
 * the sink of the module graph. It imports from no other schema module, so no
 * domain can ever create an import cycle by depending on it.
 */

export type {
  AlignmentSegment,
  DesignRoleToken,
  DesignSystemConfig,
  DesignSystemGroups,
  DesignSystemMeta,
  DiffMetadata,
  DomDiffResult,
  PageShiftInfo,
  RcaCategory,
  RcaRegionCause,
  RcaSignal,
  RcaVerdict,
} from "@lastest/eb-protocol";

// Selector configuration for multi-input recording
export type SelectorType =
  | "data-testid"
  | "id"
  | "role-name"
  | "label"
  | "heading-context"
  | "text"
  | "aria-label"
  | "placeholder"
  | "name"
  | "alt-text"
  | "title"
  | "css-path"
  | "ocr-text"
  | "coords";

export interface SelectorConfig {
  type: SelectorType;
  enabled: boolean;
  priority: number;
}

export interface ActionSelector {
  type: SelectorType;
  value: string;
}

export interface RecordedAction {
  action: "click" | "fill" | "selectOption" | "goto";
  selectors: ActionSelector[];
  value?: string;
  timestamp: number;
}

// ── Visual-diff payload shapes (`visual_diffs.metadata`) ─────────────────
// `AlignmentSegment`/`PageShiftInfo`/`DomDiffResult` and the whole RCA
// cluster (`RcaCategory`/`RcaSignal`/`RcaRegionCause`/`RcaVerdict`/
// `DiffMetadata`) moved to `@lastest/eb-protocol` (re-exported above), for
// the same reason the design tokens below moved: `@lastest/plugin-rca`
// computes the `rca` verdict and reads the pixel/DOM signals it fuses, and a
// plugin cannot import `packages/db` (FORBIDDEN_PLUGIN_IMPORTS).

// ── Design System tokens / violations ────────────────────────────────────
// `DesignSystemConfig`/`DesignRoleToken`/`DesignSystemGroups`/`DesignSystemMeta`
// moved to `@lastest/eb-protocol` (re-exported above) alongside their
// siblings `DesignToken`/`DesignTokenCategory`/`DesignSystemViolation` —
// `plugins/design-system` needs the same shape for its token parser/scorer
// and cannot import `packages/db` (FORBIDDEN_PLUGIN_IMPORTS), but
// `@lastest/eb-protocol` is a dependency-free shared payload-shape package
// plugins may import (see `tools/architecture/boundaries.mjs`).

// Stabilization settings for flaky test prevention
export interface StabilizationSettings {
  // Wait strategies
  waitForNetworkIdle: boolean; // Wait for no network activity (default: true)
  networkIdleTimeout: number; // Max wait time in ms (default: 5000)
  waitForDomStable: boolean; // Wait for DOM mutations to stop (default: true)
  domStableTimeout: number; // Max wait time in ms (default: 2000)

  // Content freezing
  freezeTimestamps: boolean; // Replace Date.now(), new Date() (default: true)
  frozenTimestamp: string; // ISO timestamp to use (default: "2024-01-01T12:00:00Z")
  freezeRandomValues: boolean; // Seed Math.random() (default: true)
  randomSeed: number; // Seed value (default: 12345)

  // Third-party handling
  blockThirdParty: boolean; // Block external domains (default: false)
  allowedDomains: string[]; // Whitelist (default: [])
  mockThirdPartyImages: boolean; // Replace with placeholders (default: true)

  // Spinner/loader handling
  hideLoadingIndicators: boolean; // CSS hide common spinners (default: true)
  loadingSelectors: string[]; // Custom selectors to wait for removal

  // Image loading
  waitForImages: boolean; // Wait for all images to finish loading (default: true)
  waitForImagesTimeout: number; // Max wait time in ms (default: 5000)

  // Style stabilization
  waitForFonts: boolean; // Wait for font loading (default: true)
  disableWebfonts: boolean; // Use system fonts only (default: false)
  crossOsConsistency: boolean; // Bundled font + Chromium flags for identical screenshots across OS (default: false)

  // Burst capture (multi-frame instability detection)
  burstCapture: boolean; // Take N screenshots and compare for stability (default: false)
  burstFrameCount: number; // Number of frames to capture (default: 3)
  burstStabilityThreshold: number; // % diff below which frames are considered stable (default: 0.5)

  // Dynamic content masking
  autoMaskDynamicContent: boolean; // Detect and mask dynamic text before screenshot (default: false)
  maskPatterns: string[]; // Pattern types to mask (default: ['timestamps', 'uuids', 'relative-times'])
  maskStyle: "solid-color" | "placeholder-text"; // How to mask matched content (default: 'solid-color')
  maskColor: string; // Color for solid-color mask (default: '#808080')

  // Canvas stabilization
  waitForCanvasStable: boolean; // Loop canvas.toDataURL() comparisons until stable (default: false)
  canvasStableTimeout: number; // Max wait time in ms (default: 3000)
  canvasStableThreshold: number; // Consecutive stable checks needed (default: 3)

  // Canvas rendering
  disableImageSmoothing: boolean; // Set imageSmoothingEnabled = false on 2D contexts (default: false)
  roundCanvasCoordinates: boolean; // Snap stroke coords to pixel centers for deterministic lines (default: false)
  reseedRandomOnInput: boolean; // Reseed LCG from event hash on user input (default: false)
  freezeAnimations: boolean; // Freeze CSS animations/transitions (default: false)
}

// Default stabilization settings
export const DEFAULT_STABILIZATION_SETTINGS: StabilizationSettings = {
  waitForNetworkIdle: true,
  networkIdleTimeout: 2000,
  waitForDomStable: true,
  domStableTimeout: 500,
  freezeTimestamps: true,
  frozenTimestamp: "2024-01-01T12:00:00Z",
  freezeRandomValues: true,
  randomSeed: 12345,
  blockThirdParty: false,
  allowedDomains: [],
  mockThirdPartyImages: true,
  hideLoadingIndicators: true,
  loadingSelectors: [],
  waitForImages: true,
  waitForImagesTimeout: 2000,
  waitForFonts: true,
  disableWebfonts: false,
  crossOsConsistency: false,
  burstCapture: false,
  burstFrameCount: 3,
  burstStabilityThreshold: 0.5,
  autoMaskDynamicContent: false,
  maskPatterns: ["timestamps", "uuids", "relative-times"],
  maskStyle: "solid-color",
  maskColor: "#808080",
  waitForCanvasStable: false,
  canvasStableTimeout: 3000,
  canvasStableThreshold: 3,
  disableImageSmoothing: false,
  roundCanvasCoordinates: false,
  reseedRandomOnInput: false,
  freezeAnimations: false,
};

// Stability metadata from burst capture
export interface StabilityMetadata {
  frameCount: number;
  stableFrames: number;
  maxFrameDiff: number;
  isStable: boolean;
}

// Default selector priority - can be used in both server and client components
export const DEFAULT_SELECTOR_PRIORITY: SelectorConfig[] = [
  { type: "data-testid", enabled: true, priority: 1 },
  { type: "id", enabled: true, priority: 2 },
  { type: "role-name", enabled: true, priority: 3 },
  { type: "label", enabled: true, priority: 4 },
  { type: "heading-context", enabled: true, priority: 5 },
  { type: "aria-label", enabled: true, priority: 6 },
  { type: "text", enabled: true, priority: 7 },
  { type: "placeholder", enabled: true, priority: 8 },
  { type: "name", enabled: true, priority: 9 },
  { type: "alt-text", enabled: true, priority: 10 },
  { type: "title", enabled: true, priority: 11 },
  { type: "css-path", enabled: true, priority: 12 },
  { type: "ocr-text", enabled: false, priority: 13 },
  { type: "coords", enabled: true, priority: 14 },
];

export type PwAgentType =
  | "orchestrator"
  | "planner"
  | "scout"
  | "diver"
  | "generator"
  | "healer"
  | "quickstart"
  | "ranger"
  | "explorer";

/**
 * The in-product agents that can author a test.
 *
 * Core's own vocabulary, not gamification's: `tests.created_by_bot_id` is a
 * core column and `createTest`'s `createdByAgent` argument is typed by this.
 * The `gamification_bots` *row* per kind belongs to
 * `@lastest/plugin-gamification`, which is why this type stayed behind when
 * that table left — see `src/lib/db/test-hooks.ts`.
 */
export type BotKind = "play_agent" | "generate_agent" | "mcp_server";
