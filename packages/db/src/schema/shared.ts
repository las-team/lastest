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

import type {
  DomSnapshotElement,
  DesignTokenCategory,
  DesignToken,
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

export interface AlignmentSegment {
  op: "match" | "insert" | "delete";
  count: number;
}

export interface PageShiftInfo {
  detected: boolean;
  deltaY: number;
  confidence: number;
  insertedRows?: number;
  deletedRows?: number;
  alignedBaselineImagePath?: string;
  alignedCurrentImagePath?: string;
  alignedDiffImagePath?: string;
  alignmentSegments?: AlignmentSegment[];
}

// DOM diff result for comparing two snapshots
export interface DomDiffResult {
  added: DomSnapshotElement[];
  removed: DomSnapshotElement[];
  changed: Array<{
    baseline: DomSnapshotElement;
    current: DomSnapshotElement;
    changes: ("text" | "position" | "size" | "selector")[];
  }>;
  unchangedCount: number;
}

// ---------------------------------------------------------------------------
// Root Cause Analysis (RCA) — "is this diff the TEST or the CODE?"
// ---------------------------------------------------------------------------
//
// A per-visual-diff verdict that fuses signals already computed elsewhere
// (pixel-diff metadata, optional DOM diff, the build's Change Map) into a
// rich-taxonomy classification. Computed by `src/lib/rca/` after the build's
// Change Map is available and persisted into `DiffMetadata.rca` below. The
// `headline` drives the badge color; `signals` explain the verdict; the
// element-level `regionCauses` are populated by the (later) correlation phase.

export type RcaCategory =
  // Application changed because the code changed (real regression or an
  // intended UI change to approve).
  | "code:structural" // DOM nodes/attributes added, removed, or re-selected
  | "code:style" // CSS/visual change (color, spacing, size) tied to a code change
  | "code:content" // copy/content changed and it is NOT a dynamic-data pattern
  // Diff is noise from the test/environment, not a code change.
  | "test:flake" // non-deterministic render with no DOM/code change
  | "test:dynamic-data" // dates, counters, ids, currency — data, not code
  | "test:animation" // transient/mid-animation frame or anti-aliasing
  | "test:environment" // page shift, cross-branch baseline, locale/viewport
  | "test:never-passed" // test has no green history — its baseline isn't trustworthy
  // Not enough signal to commit to test-vs-code.
  | "uncertain";

export interface RcaSignal {
  category: RcaCategory;
  /** 0..1 — strength of THIS signal, not a probability across categories. */
  confidence: number;
  /** One short plain-English sentence explaining the signal. */
  reason: string;
}

/** Element-level cause for one changed pixel region (populated by the
 *  correlation phase; empty in the Phase-1 classifier-only path). */
export interface RcaRegionCause {
  region: { x: number; y: number; width: number; height: number };
  selector: string;
  changeType: (
    | "text"
    | "position"
    | "size"
    | "selector"
    | "added"
    | "removed"
  )[];
  cssDeltas?: Array<{ property: string; baseline: string; current: string }>;
}

export interface RcaVerdict {
  /** Headline bucket that drives the badge: code change, test noise, or unsure. */
  headline: "code" | "test" | "uncertain";
  /** Ranked contributing signals (strongest first). */
  signals: RcaSignal[];
  /** Build-level files that changed (from the Change Map), surfaced for `code`. */
  changedFiles: string[];
  /** Element-level region→cause mapping (correlation phase). */
  regionCauses?: RcaRegionCause[];
  /** One-sentence human-readable root cause (AI, best-effort; Phase 4). */
  narrative?: string;
  /** Schema/heuristic version, so stale verdicts can be recomputed. */
  version: number;
  computedAt: string;
}

export interface DiffMetadata {
  changedRegions: { x: number; y: number; width: number; height: number }[];
  affectedComponents?: string[];
  changeCategories?: ("layout" | "color" | "text" | "image" | "style")[];
  pageShift?: PageShiftInfo;
  isNewTest?: boolean;
  textRegions?: { x: number; y: number; width: number; height: number }[];
  textRegionDiffPixels?: number;
  nonTextRegionDiffPixels?: number;
  ocrDurationMs?: number;
  domDiff?: DomDiffResult;
  textDiffSummary?: { added: number; removed: number; sameAsBaseline: boolean };
  // Branch the baseline was sourced from when it differs from the build's
  // branch. Set by `processVisualDiff` when the current-branch baseline lookup
  // misses and we fall back to the repo's default branch. UI uses this to
  // label the diff "baseline from <branch>" so users know they're not
  // comparing apples-to-apples within-branch.
  baselineSourceBranch?: string;
  // When no baseline exists on either the current branch or the default
  // branch, surface where the user DOES have an approved baseline so they
  // know it's not lost. Empty when there's no approved baseline anywhere.
  baselineExistsOn?: { branch: string; createdAt: string };
  // Root Cause Analysis verdict — "is this diff the test or the code?".
  // Computed post-build by src/lib/rca/ and read by the diff badge + Source
  // filter. Absent on diffs predating the feature (UI treats it as unknown).
  rca?: RcaVerdict;
}

// ── Design System tokens / violations ────────────────────────────────────
// A test/repo can declare a "design system" — a closed set of allowed
// values for color, border-radius, font-family, font-size, and spacing
// (margin/padding). During each test the EB walks the live DOM at
// screenshot time, samples computed styles per visible element, and the
// host marks any computed value not present in the allowed set as a
// violation. Same flow as a11y: per-test_result violations roll up into a
// build-level design_system_score (0-100), drill-in shows occurrence count
// and a sample selector for each off-token value.
export interface DesignSystemConfig {
  /** When false, the layer is opt-out for this test even if the repo
   *  toggle is on. Repo-level config has no `enabled` (the toggle on
   *  playwright_settings.enableDesignSystem governs that). */
  enabled?: boolean;
  /** Allowed CSS values per category. Values are stored normalized
   *  (lowercase hex, px ints). Token NAMES (`--c-red`) can be supplied as
   *  keys so the violation card surfaces a friendly label, but the raw
   *  resolved value is what the comparator matches against. */
  tokens: Partial<Record<DesignTokenCategory, DesignToken[]>>;
  /** Hide a class of violations entirely. Useful when a repo controls
   *  color tokens centrally but vendor 3rd-parties bring their own. */
  ignoredCategories?: DesignTokenCategory[];
  /** Per-screenshot cap on collected violations. Defaults to 200 to keep
   *  test_results.design_system_violations sane in JSONB. */
  maxViolationsPerScreenshot?: number;
  /** Display-only grouping the parser builds when ingesting a CSS file.
   *  The matcher in the EB never reads this — it exists solely to render
   *  the Claude-Design-style preview card on the Setup tab. */
  groups?: DesignSystemGroups;
  /** Bundle metadata captured at upload time. Used by the preview to
   *  show the bundle title, source files, and asset filenames. */
  meta?: DesignSystemMeta;
}

/** A token with a display role and the value it resolves to (after
 *  `var()` chasing). Used in the Setup preview to show "BRAND · Red ·
 *  #E03E36" tiles instead of just raw token names. */
export interface DesignRoleToken {
  /** Token name in CSS (`--c-red`). */
  name: string;
  /** Resolved literal value (hex / px / family). */
  value: string;
  /** Optional uppercase eyebrow label ("BRAND", "ACTION", "ACCENT") that
   *  the preview puts on the tile. Inferred from the token name by the
   *  parser. */
  role?: string;
  /** Optional human label ("Red", "Steel Blue") for the tile. Defaults
   *  to a Title-Cased version of the name suffix. */
  label?: string;
}

export interface DesignSystemGroups {
  brandPalette?: DesignRoleToken[];
  surfaces?: DesignRoleToken[];
  inkScale?: DesignRoleToken[];
  semantic?: DesignRoleToken[];
  radii?: DesignRoleToken[];
  spacing?: DesignRoleToken[];
  typeScale?: DesignRoleToken[];
  fonts?: DesignRoleToken[];
}

export interface DesignSystemMeta {
  /** Title pulled from the bundle README (first H1). */
  title?: string;
  /** First paragraph after the H1 in the README. */
  description?: string;
  /** All file paths the upload action ingested (CSS + README + assets). */
  files?: string[];
  /** Asset filenames (svg / png / woff / woff2) found in the archive.
   *  Used by the preview's "Missing brand fonts" detection. */
  assets?: string[];
  /** When set, the bundle carried `.woff` / `.woff2` files — no font
   *  warning needed. */
  hasFontFiles?: boolean;
}

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
