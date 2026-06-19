import { describe, it, expect } from "vitest";
import { correlateRegions, pickSelector } from "./correlate";
import type { DomDiffResult, DomSnapshotElement } from "@/lib/db/schema";

function el(
  box: { x: number; y: number; width: number; height: number },
  over: Partial<DomSnapshotElement> = {},
): DomSnapshotElement {
  return {
    tag: "div",
    boundingBox: box,
    selectors: [{ type: "css", value: "div" }],
    ...over,
  };
}

describe("correlateRegions", () => {
  const region = { x: 100, y: 100, width: 50, height: 20 };

  it("maps a region to the overlapping changed element", () => {
    const dom: DomDiffResult = {
      added: [],
      removed: [],
      changed: [
        {
          baseline: el(
            { x: 100, y: 100, width: 50, height: 20 },
            { textContent: "A" },
          ),
          current: el(
            { x: 100, y: 100, width: 50, height: 20 },
            {
              textContent: "B",
              selectors: [{ type: "data-testid", value: "cta" }],
            },
          ),
          changes: ["text"],
        },
      ],
      unchangedCount: 0,
    };
    const causes = correlateRegions({ changedRegions: [region], domDiff: dom });
    expect(causes).toHaveLength(1);
    expect(causes[0].selector).toBe("cta");
    expect(causes[0].changeType).toContain("text");
  });

  it("picks the element with the largest overlap", () => {
    const dom: DomDiffResult = {
      added: [
        el(
          { x: 0, y: 0, width: 10, height: 10 },
          { selectors: [{ type: "id", value: "far" }] },
        ),
        el(
          { x: 95, y: 95, width: 60, height: 40 },
          { selectors: [{ type: "id", value: "near" }] },
        ),
      ],
      removed: [],
      changed: [],
      unchangedCount: 0,
    };
    const causes = correlateRegions({ changedRegions: [region], domDiff: dom });
    expect(causes[0].selector).toBe("near");
    expect(causes[0].changeType).toEqual(["added"]);
  });

  it("emits css deltas when both sides carry styles", () => {
    const dom: DomDiffResult = {
      added: [],
      removed: [],
      changed: [
        {
          baseline: el(
            { x: 100, y: 100, width: 50, height: 20 },
            { styles: { color: "rgb(0,0,0)", padding: "4px" } },
          ),
          current: el(
            { x: 100, y: 100, width: 50, height: 20 },
            { styles: { color: "rgb(255,0,0)", padding: "4px" } },
          ),
          changes: ["selector"],
        },
      ],
      unchangedCount: 0,
    };
    const causes = correlateRegions({ changedRegions: [region], domDiff: dom });
    expect(causes[0].cssDeltas).toEqual([
      { property: "color", baseline: "rgb(0,0,0)", current: "rgb(255,0,0)" },
    ]);
  });

  it("returns nothing when regions and elements don't overlap", () => {
    const dom: DomDiffResult = {
      added: [el({ x: 0, y: 0, width: 10, height: 10 })],
      removed: [],
      changed: [],
      unchangedCount: 0,
    };
    expect(
      correlateRegions({ changedRegions: [region], domDiff: dom }),
    ).toEqual([]);
  });

  it("no-ops without domDiff or regions", () => {
    expect(
      correlateRegions({ changedRegions: [region], domDiff: null }),
    ).toEqual([]);
    expect(
      correlateRegions({
        changedRegions: [],
        domDiff: { added: [], removed: [], changed: [], unchangedCount: 0 },
      }),
    ).toEqual([]);
  });
});

describe("pickSelector", () => {
  it("prefers data-testid, then id", () => {
    expect(
      pickSelector(
        el(
          { x: 0, y: 0, width: 1, height: 1 },
          {
            selectors: [
              { type: "css", value: "div.x" },
              { type: "data-testid", value: "submit" },
            ],
          },
        ),
      ),
    ).toBe("submit");
    expect(
      pickSelector(
        el(
          { x: 0, y: 0, width: 1, height: 1 },
          { id: "hero", selectors: [{ type: "css", value: "div" }] },
        ),
      ),
    ).toBe("#hero");
  });
});
