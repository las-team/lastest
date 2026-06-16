/**
 * RCA diff-source classifier — "is this visual diff the TEST or the CODE?".
 *
 * A pure, deterministic function that fuses signals ALREADY computed elsewhere:
 *   - the build's Change Map (`git diff vs base branch → files/areas/tests`)
 *   - the diff's pixel metadata (changeCategories, pageShift, %diff)
 *   - the diff's optional DOM diff (added/removed/changed × text|position|size)
 *   - baseline provenance (cross-branch baseline)
 *
 * It emits a rich-taxonomy {@link RcaVerdict}. No DB/network/IO here so it is
 * fully unit-testable; the caller (`src/lib/rca/run.ts`) loads the inputs and
 * persists the result into `DiffMetadata.rca`.
 *
 * These are HEURISTICS, deliberately conservative: we never claim `code`
 * without positive evidence, and the headline falls back to `uncertain` when
 * code and test signals are close or when there is too little to go on.
 */

import type {
  ChangeMap,
  DiffMetadata,
  RcaCategory,
  RcaSignal,
  RcaVerdict,
} from "@/lib/db/schema";
import { isDynamicTextChange } from "@/lib/rca/dynamic-text";

/** Bump when the heuristics change so stale verdicts can be recomputed. */
export const RCA_VERSION = 1;

/** Headlines closer than this are treated as a conflict → `uncertain`. */
const CONFLICT_MARGIN = 0.15;

/** Cap on changed-file paths embedded per diff (keeps JSONB small). */
const MAX_CHANGED_FILES = 20;

export interface ClassifyDiffInput {
  metadata: DiffMetadata | null | undefined;
  changeMap?: ChangeMap | null;
  testId: string;
  /** Functional area of the diff's test (tests.functionalAreaId), if known. */
  areaId?: string | null;
  /** `visual_diffs.percentage_difference` (a row column, NOT in metadata). */
  percentageDifference?: string | number | null;
}

const isCode = (c: RcaCategory) => c.startsWith("code:");
const isTest = (c: RcaCategory) => c.startsWith("test:");
const maxConf = (signals: RcaSignal[], pred: (c: RcaCategory) => boolean) =>
  signals
    .filter((s) => pred(s.category))
    .reduce((m, s) => Math.max(m, s.confidence), 0);

export function classifyDiffSource(
  input: ClassifyDiffInput,
  now: string = new Date().toISOString(),
): RcaVerdict {
  const md = input.metadata ?? undefined;
  const cm = input.changeMap ?? undefined;
  const signals: RcaSignal[] = [];

  // ---- Code signal from the Change Map -----------------------------------
  // The strongest "code touched THIS surface" signal: the diff's functional
  // area is flagged by the git-diff source. (A test merely appearing in
  // changeMap.tests is weaker — it can be there for ai/signals/manual reasons.)
  const codeArea =
    input.areaId && cm
      ? cm.areas.find(
          (a) => a.areaId === input.areaId && a.sources.includes("code"),
        )
      : undefined;
  const codeTouchedThisSurface = !!codeArea;
  const allFiles = cm?.files.map((f) => f.path) ?? [];

  // ---- DOM-diff signals ---------------------------------------------------
  const dom = md?.domDiff;
  const domAvailable = !!dom;
  const hasStructural =
    !!dom &&
    (dom.added.length > 0 ||
      dom.removed.length > 0 ||
      dom.changed.some((c) => c.changes.includes("selector")));
  const hasPosSize =
    !!dom &&
    dom.changed.some(
      (c) => c.changes.includes("position") || c.changes.includes("size"),
    );
  const textChanges =
    dom?.changed.filter((c) => c.changes.includes("text")) ?? [];
  const realTextChange = textChanges.some(
    (c) => !isDynamicTextChange(c.baseline.textContent, c.current.textContent),
  );
  const dynamicOnlyText =
    textChanges.length > 0 &&
    textChanges.every((c) =>
      isDynamicTextChange(c.baseline.textContent, c.current.textContent),
    );
  const domEmpty =
    domAvailable &&
    dom!.added.length === 0 &&
    dom!.removed.length === 0 &&
    dom!.changed.length === 0;

  // ---- Pixel-diff signals ------------------------------------------------
  const cats = md?.changeCategories ?? [];
  const pageShift = md?.pageShift?.detected ?? false;
  const crossBranch = !!md?.baselineSourceBranch;
  const pctRaw = input.percentageDifference;
  const pct =
    pctRaw == null
      ? undefined
      : typeof pctRaw === "number"
        ? pctRaw
        : parseFloat(pctRaw);

  // ---- CODE rules --------------------------------------------------------
  if (hasStructural) {
    signals.push({
      category: "code:structural",
      confidence: codeTouchedThisSurface ? 0.9 : 0.7,
      reason: codeTouchedThisSurface
        ? `DOM structure changed and the build's code touched "${codeArea!.areaName}".`
        : "DOM nodes were added, removed, or re-selected between baseline and current.",
    });
  }
  if (
    hasPosSize ||
    (codeTouchedThisSurface &&
      cats.some((c) => c === "style" || c === "color" || c === "layout"))
  ) {
    signals.push({
      category: "code:style",
      confidence: codeTouchedThisSurface ? 0.82 : 0.6,
      reason: codeTouchedThisSurface
        ? `Visual styling/layout changed and the build's code touched "${codeArea!.areaName}".`
        : "Elements moved or resized between baseline and current.",
    });
  }
  if (realTextChange) {
    signals.push({
      category: "code:content",
      confidence: codeTouchedThisSurface ? 0.8 : 0.6,
      reason:
        "Text content changed in a way that isn't volatile data — a real copy edit.",
    });
  }
  // Code touched this surface but DOM diff wasn't captured: still lean code,
  // categorized from the pixel change shape.
  if (
    codeTouchedThisSurface &&
    !domAvailable &&
    !hasStructural &&
    !hasPosSize &&
    !realTextChange
  ) {
    signals.push({
      category: cats.includes("text") ? "code:content" : "code:style",
      confidence: 0.6,
      reason: `The build's code changed "${codeArea!.areaName}" and this step shows a visual diff.`,
    });
  }

  // ---- TEST rules (only when code did NOT touch this surface) ------------
  if (!codeTouchedThisSurface) {
    if (dynamicOnlyText && !realTextChange) {
      signals.push({
        category: "test:dynamic-data",
        confidence: 0.85,
        reason:
          "The only text changes are dynamic data (dates, counters, ids), not real content.",
      });
    }
    if (pageShift) {
      signals.push({
        category: "test:environment",
        confidence: 0.7,
        reason:
          "The page shifted vertically (content reflow), not a localized change.",
      });
    }
    if (crossBranch) {
      signals.push({
        category: "test:environment",
        confidence: 0.55,
        reason: `Baseline came from a different branch (${md!.baselineSourceBranch}) — not an apples-to-apples comparison.`,
      });
    }
    if (domEmpty) {
      signals.push({
        category: "test:animation",
        confidence: 0.7,
        reason:
          "Pixels differ but the DOM is identical — likely a transient/animation frame or anti-aliasing.",
      });
    }
    if (
      !hasStructural &&
      !realTextChange &&
      !dynamicOnlyText &&
      !pageShift &&
      pct !== undefined &&
      pct < 1
    ) {
      signals.push({
        category: "test:flake",
        confidence: 0.5,
        reason:
          "A small pixel difference with no code, DOM, or content change — likely rendering noise.",
      });
    }
  }

  // ---- Resolve headline --------------------------------------------------
  const codeConf = maxConf(signals, isCode);
  const testConf = maxConf(signals, isTest);

  let headline: RcaVerdict["headline"];
  if (signals.length === 0) {
    headline = "uncertain";
    signals.push({
      category: "uncertain",
      confidence: 0.4,
      reason: domAvailable
        ? "No code, DOM, or content signal could attribute this diff."
        : "Not enough signal to attribute this diff — enable DOM diff for sharper analysis.",
    });
  } else if (
    codeConf > 0 &&
    testConf > 0 &&
    Math.abs(codeConf - testConf) < CONFLICT_MARGIN
  ) {
    headline = "uncertain";
  } else {
    headline = codeConf >= testConf ? "code" : "test";
  }

  signals.sort((a, b) => b.confidence - a.confidence);

  const changedFiles = codeTouchedThisSurface
    ? allFiles.slice(0, MAX_CHANGED_FILES)
    : [];

  return {
    headline,
    signals,
    changedFiles,
    narrative: buildNarrative(headline, signals[0], changedFiles.length),
    version: RCA_VERSION,
    computedAt: now,
  };
}

/**
 * Deterministic one-sentence root-cause summary built from the verdict. Free
 * and always available; an LLM-backed version (richer phrasing across all
 * signals + file names) is a follow-up gated on the team's AI settings.
 */
function buildNarrative(
  headline: RcaVerdict["headline"],
  top: RcaSignal | undefined,
  fileCount: number,
): string {
  const reason = top?.reason ?? "No attributable signal.";
  const files =
    fileCount > 0
      ? ` (${fileCount} file${fileCount === 1 ? "" : "s"} changed in this build)`
      : "";
  if (headline === "code") return `Likely a code change: ${reason}${files}`;
  if (headline === "test") return `Likely test noise: ${reason}`;
  return `Source unclear: ${reason}`;
}
