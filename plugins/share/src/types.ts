/**
 * Narrowed copies of core types the share page renders.
 *
 * `DomDiffResult`, `DomSnapshotElement`, `StepTiming` and `WebVitalsSample`
 * are already in `@lastest/eb-protocol` and are imported from there directly.
 * Everything below is *not* share's own type — it is core's (the
 * `step_comparisons`/`test_results`/`build_demo_notes` domains) — so per
 * `plugin-migration-recipe.md` §6.1 it is narrowed rather than promoted:
 * these are structural copies of the shapes this page reads, not the
 * canonical definitions. `src/lib/core/share-host.ts` returns the real core
 * rows, and TypeScript's structural typing is the assertion that they still
 * match — the same route `rca`'s `RcaChangeMap` and `app-map`'s
 * `AppMapDiscovery` took.
 */

export type StepVerdict = "green" | "yellow" | "red";

export interface NetworkDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  addedEndpoints?: number;
  removedEndpoints?: number;
  changedEndpoints?: number;
  newErrorCount: number;
  newClientErrors: Array<{ url: string; method: string; status: number }>;
  newServerErrors: Array<{ url: string; method: string; status: number }>;
  statusFlips: Array<{ url: string; method: string; from: number; to: number }>;
}

export type ConsoleFingerprintCategory =
  | "app"
  | "thirdParty"
  | "network"
  | "csp"
  | "unknown";

export interface ConsoleDiffSummary {
  newFingerprints: Array<{
    fingerprint: string;
    sample: string;
    count: number;
    category?: ConsoleFingerprintCategory;
  }>;
  disappeared: Array<{
    fingerprint: string;
    sample: string;
    count: number;
    category?: ConsoleFingerprintCategory;
  }>;
  countDelta: Record<string, number>;
}

export interface UrlTrajectoryDiffSummary {
  divergedSteps: Array<{
    stepIndex: number;
    stepLabel?: string;
    baselineUrl: string;
    currentUrl: string;
    redirectChainChanged: boolean;
  }>;
  totalStepsCompared: number;
}

// The page only ever reads `.newBySeverity` off these two — the violation
// arrays themselves are never destructured, so their element type is left
// opaque rather than guessed at.
export interface A11yDiffSummary {
  newViolations: unknown[];
  disappeared: unknown[];
  newBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

export interface DesignSystemDiffSummary {
  newViolations: unknown[];
  disappeared: unknown[];
  newBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

export interface PerfDiffSummary {
  deltas: Array<{
    stepIndex?: number;
    stepLabel?: string;
    metric: "lcp" | "cls" | "inp" | "fcp" | "tbt" | "ttfb";
    baseline: number;
    current: number;
    delta: number;
    budgetBreached: boolean;
    newlyBreached?: boolean;
    drifted: boolean;
  }>;
}

export interface VariableDiffSummary {
  changes: Array<{
    path: string;
    tier:
      | "structural-break"
      | "type-change"
      | "value-change-numeric"
      | "value-change-string";
    baseline?: unknown;
    current?: unknown;
  }>;
}

export interface StorageStateDiffEntry {
  key: string;
  change: "added" | "removed" | "changed";
  detail?: string;
}

export interface StorageStateDiffSummary {
  cookies: StorageStateDiffEntry[];
  localStorage: StorageStateDiffEntry[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
}

export interface StepComparisonEvidence {
  visual?: {
    pixelDifference: number;
    percentageDifference: string | null;
    diffId?: string;
  };
  dom?: import("@lastest/eb-protocol").DomDiffResult;
  a11y?: A11yDiffSummary;
  designSystem?: DesignSystemDiffSummary;
  network?: NetworkDiffSummary;
  consoleDiff?: ConsoleDiffSummary;
  url?: UrlTrajectoryDiffSummary;
  perf?: PerfDiffSummary;
  variable?: VariableDiffSummary;
  storageState?: StorageStateDiffSummary;
}

export interface CapturedScreenshot {
  path: string;
  label?: string;
  atMs?: number;
  title?: string;
  domSnapshot?: import("@lastest/eb-protocol").DomSnapshotData;
}

export interface VideoCaption {
  stepIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  focus?: { x: number; y: number; w: number; h: number };
  annotation?: "arrow" | "underline" | "box";
}

export interface DemoNoteItem {
  label: string;
  note: string;
}

export interface DemoNoteSkippedRoute {
  path: string;
  reason: string;
}

export interface DemoNotes {
  uxSummary: string;
  highlights: DemoNoteItem[];
  frictionPoints: DemoNoteItem[];
  testingStruggles: DemoNoteItem[];
  skippedRoutes?: DemoNoteSkippedRoute[];
  outreachHook?: string;
  fallbackSummary?: boolean;
  captions?: VideoCaption[];
  generatedAt: string;
  modelId?: string;
}

/** Narrow copy of `BuildA11yViolationRow` (`src/lib/db/queries/builds.ts`) —
 * core's own aggregate, not share's. `a11y-projection.ts` reads every field
 * of this one, so it is copied in full rather than trimmed further. */
export interface BuildA11yViolationRow {
  id: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  description: string;
  help: string;
  helpUrl: string;
  wcagLevel?: "A" | "AA" | "AAA";
  tags: string[];
  occurrenceCount: number;
  totalNodes: number;
  samples: Array<{
    testResultId: string;
    testId: string | null;
    testName: string | null;
    areaName: string | null;
    nodes: number;
    sampleNode?: {
      target: string[];
      failureSummary?: string;
      html?: string;
    };
  }>;
}

/**
 * Structural copy of `RepoAward` — the `awards` domain's own type, not
 * share's. Copied in FULL (not trimmed to the fields this page reads):
 * `<AwardBadgeRow>` stays in the app (`plugin-migration-recipe.md` §6, "the
 * app owns the thing placed") and is typed against the real, wide
 * `RepoAward`, so the value this plugin hands it has to satisfy that whole
 * shape, not just the subset `showAwardBadges` inspects.
 */
export interface RepoAward {
  id: string;
  repositoryId: string;
  currentTier: "none" | "starter" | "bronze" | "silver" | "gold";
  highestTier: "none" | "starter" | "bronze" | "silver" | "gold";
  categories: { a11y: boolean; allPassing: boolean; zeroDrift: boolean };
  proofShareSlug: string | null;
  lastBuildId: string | null;
  earnedAt: Date;
  lastRecomputedAt: Date;
  lastDowngradeAt: Date | null;
  lastDowngradeReason: string | null;
}
