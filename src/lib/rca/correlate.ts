/**
 * RCA pixel↔DOM correlation — "which element caused this changed region?".
 *
 * Maps each changed pixel region (`DiffMetadata.changedRegions`) to the
 * DOM-diff element whose bounding box overlaps it most, yielding the
 * element-level {@link RcaRegionCause}s the interactive RCA UI renders as
 * clickable boxes. When both baseline and current elements carry computed
 * `styles` (captured by the embedded browser once enabled), it also emits the
 * per-property CSS deltas.
 *
 * Pure and unit-tested — no DB/IO.
 *
 * CAVEAT: changedRegions are in screenshot-pixel space; DOM bounding boxes come
 * from `getBoundingClientRect()` (CSS px, viewport-relative at capture time).
 * They align for same-DPR, top-of-page captures; full-page / high-DPR captures
 * may need scroll/DPR normalization (a follow-up). Mismatched coordinates
 * simply yield no/fewer causes rather than wrong verdicts — the Phase-1
 * headline never depends on this.
 */

import type {
  DomDiffResult,
  DomSnapshotElement,
  RcaRegionCause,
} from "@/lib/db/schema";

type Rect = { x: number; y: number; width: number; height: number };

/** Cap region causes embedded per diff to keep the JSONB payload bounded. */
const MAX_CAUSES = 50;

/** Area of overlap between two rectangles (0 when disjoint). */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const h = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return w * h;
}

/** Most human-readable stable selector for an element. */
export function pickSelector(el: DomSnapshotElement): string {
  const byType = (t: string) => el.selectors.find((s) => s.type === t)?.value;
  return (
    byType("data-testid") ||
    byType("id") ||
    (el.id ? `#${el.id}` : undefined) ||
    byType("role") ||
    byType("role-name") ||
    byType("css") ||
    byType("css-path") ||
    el.selectors[0]?.value ||
    el.tag
  );
}

/** Per-property CSS deltas, when both sides carry computed styles. */
function cssDeltas(
  baseline: DomSnapshotElement | undefined,
  current: DomSnapshotElement | undefined,
): RcaRegionCause["cssDeltas"] {
  const b = baseline?.styles;
  const c = current?.styles;
  if (!b || !c) return undefined;
  const deltas: NonNullable<RcaRegionCause["cssDeltas"]> = [];
  for (const property of new Set([...Object.keys(b), ...Object.keys(c)])) {
    if (b[property] !== c[property]) {
      deltas.push({
        property,
        baseline: b[property] ?? "",
        current: c[property] ?? "",
      });
    }
  }
  return deltas.length ? deltas : undefined;
}

type ChangeType = RcaRegionCause["changeType"];
interface Candidate {
  rect: Rect;
  changeType: ChangeType;
  el: DomSnapshotElement;
  baseline?: DomSnapshotElement;
}

export function correlateRegions(input: {
  changedRegions?: Rect[] | null;
  domDiff?: DomDiffResult | null;
}): RcaRegionCause[] {
  const regions = input.changedRegions ?? [];
  const dom = input.domDiff;
  if (!regions.length || !dom) return [];

  const candidates: Candidate[] = [];
  for (const el of dom.added)
    candidates.push({ rect: el.boundingBox, changeType: ["added"], el });
  for (const el of dom.removed)
    candidates.push({ rect: el.boundingBox, changeType: ["removed"], el });
  for (const c of dom.changed) {
    candidates.push({
      rect: c.current.boundingBox,
      changeType: c.changes as ChangeType,
      el: c.current,
      baseline: c.baseline,
    });
  }
  if (!candidates.length) return [];

  const causes: RcaRegionCause[] = [];
  for (const region of regions) {
    let best: Candidate | undefined;
    let bestArea = 0;
    for (const cand of candidates) {
      const area = overlapArea(region, cand.rect);
      if (area > bestArea) {
        bestArea = area;
        best = cand;
      }
    }
    if (!best || bestArea <= 0) continue;
    causes.push({
      region,
      selector: pickSelector(best.el),
      changeType: best.changeType,
      cssDeltas: cssDeltas(best.baseline, best.el),
    });
    if (causes.length >= MAX_CAUSES) break;
  }
  return causes;
}
