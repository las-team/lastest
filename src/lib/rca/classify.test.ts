import { describe, it, expect } from "vitest";
import {
  classifyDiffSource,
  RCA_VERSION,
  type ClassifyDiffInput,
} from "./classify";
import {
  isDynamicTextChange,
  isPurelyDynamic,
  maskDynamic,
} from "./dynamic-text";
import type {
  ChangeMap,
  DiffMetadata,
  DomDiffResult,
  DomSnapshotElement,
} from "@/lib/db/schema";

const NOW = "2026-06-16T00:00:00.000Z";

function el(
  textContent: string,
  over: Partial<DomSnapshotElement> = {},
): DomSnapshotElement {
  return {
    tag: "div",
    textContent,
    boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    selectors: [{ type: "css", value: "div" }],
    ...over,
  };
}

function domDiff(over: Partial<DomDiffResult> = {}): DomDiffResult {
  return { added: [], removed: [], changed: [], unchangedCount: 5, ...over };
}

function meta(over: Partial<DiffMetadata> = {}): DiffMetadata {
  return { changedRegions: [{ x: 0, y: 0, width: 10, height: 10 }], ...over };
}

function changeMap(over: Partial<ChangeMap> = {}): ChangeMap {
  return {
    files: [],
    areas: [],
    tests: [],
    steps: [],
    intentSummary: "",
    riskSummary: "",
    manuallyScopedAreaIds: [],
    generatedAt: NOW,
    modelId: "",
    ...over,
  };
}

function classify(over: Partial<ClassifyDiffInput>) {
  return classifyDiffSource(
    { metadata: meta(), testId: "t1", areaId: "a1", ...over },
    NOW,
  );
}

const codeAreaMap = changeMap({
  files: [
    {
      path: "src/app/login/page.tsx",
      pkg: "app",
      status: "M",
      insertions: 3,
      deletions: 1,
    },
  ],
  areas: [
    {
      areaId: "a1",
      areaName: "Login",
      sources: ["code"],
      risk: "medium",
      aiNarrative: [],
    },
  ],
});

describe("classifyDiffSource — CODE verdicts", () => {
  it("structural DOM change + code-flagged area → code:structural, headline code", () => {
    const v = classify({
      changeMap: codeAreaMap,
      metadata: meta({ domDiff: domDiff({ added: [el("New banner")] }) }),
    });
    expect(v.headline).toBe("code");
    expect(v.signals[0].category).toBe("code:structural");
    expect(v.signals[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(v.changedFiles).toContain("src/app/login/page.tsx");
  });

  it("element moved/resized → code:style", () => {
    const v = classify({
      changeMap: codeAreaMap,
      metadata: meta({
        domDiff: domDiff({
          changed: [
            { baseline: el("Hi"), current: el("Hi"), changes: ["position"] },
          ],
        }),
      }),
    });
    expect(v.headline).toBe("code");
    expect(v.signals.some((s) => s.category === "code:style")).toBe(true);
  });

  it("real copy edit → code:content", () => {
    const v = classify({
      changeMap: codeAreaMap,
      metadata: meta({
        domDiff: domDiff({
          changed: [
            {
              baseline: el("Sign in"),
              current: el("Log in now"),
              changes: ["text"],
            },
          ],
        }),
      }),
    });
    expect(v.headline).toBe("code");
    expect(v.signals.some((s) => s.category === "code:content")).toBe(true);
  });

  it("code touched surface but no DOM diff captured → still code", () => {
    const v = classify({
      changeMap: codeAreaMap,
      metadata: meta({ changeCategories: ["style"] }),
      percentageDifference: "4.0",
    });
    expect(v.headline).toBe("code");
    expect(v.changedFiles.length).toBeGreaterThan(0);
  });
});

describe("classifyDiffSource — TEST verdicts", () => {
  it("only a date changed, no code → test:dynamic-data", () => {
    const v = classify({
      changeMap: changeMap(), // no code area
      metadata: meta({
        domDiff: domDiff({
          changed: [
            {
              baseline: el("Updated Jun 15, 2026"),
              current: el("Updated Jun 16, 2026"),
              changes: ["text"],
            },
          ],
        }),
      }),
    });
    expect(v.headline).toBe("test");
    expect(v.signals[0].category).toBe("test:dynamic-data");
  });

  it("pixels differ but DOM identical, no code → test:animation", () => {
    const v = classify({
      changeMap: changeMap(),
      metadata: meta({ domDiff: domDiff() }),
      percentageDifference: "2.0",
    });
    expect(v.headline).toBe("test");
    expect(v.signals.some((s) => s.category === "test:animation")).toBe(true);
  });

  it("page shifted, no code → test:environment", () => {
    const v = classify({
      changeMap: changeMap(),
      metadata: meta({
        pageShift: { detected: true, deltaY: 40, confidence: 0.9 },
      }),
      percentageDifference: "30",
    });
    expect(v.headline).toBe("test");
    expect(v.signals.some((s) => s.category === "test:environment")).toBe(true);
  });

  it("cross-branch baseline → test:environment", () => {
    const v = classify({
      changeMap: changeMap(),
      metadata: meta({ baselineSourceBranch: "main" }),
      percentageDifference: "5",
    });
    expect(v.headline).toBe("test");
    expect(v.signals.some((s) => s.category === "test:environment")).toBe(true);
  });

  it("tiny diff, no DOM/code → test:flake", () => {
    const v = classify({
      changeMap: changeMap(),
      metadata: meta(),
      percentageDifference: "0.3",
    });
    expect(v.headline).toBe("test");
    expect(v.signals.some((s) => s.category === "test:flake")).toBe(true);
  });
});

describe("classifyDiffSource — UNCERTAIN", () => {
  it("no metadata and no change map → uncertain", () => {
    const v = classifyDiffSource({ metadata: null, testId: "t1" }, NOW);
    expect(v.headline).toBe("uncertain");
    expect(v.signals[0].category).toBe("uncertain");
  });

  it("stamps version and computedAt", () => {
    const v = classify({
      changeMap: codeAreaMap,
      metadata: meta({ domDiff: domDiff({ added: [el("x")] }) }),
    });
    expect(v.version).toBe(RCA_VERSION);
    expect(v.computedAt).toBe(NOW);
  });

  it("includes a deterministic narrative matching the headline", () => {
    const code = classify({
      changeMap: codeAreaMap,
      metadata: meta({ domDiff: domDiff({ added: [el("x")] }) }),
    });
    expect(code.narrative).toMatch(/^Likely a code change:/);
    const test = classify({
      changeMap: changeMap(),
      metadata: meta({ domDiff: domDiff() }),
      percentageDifference: "2.0",
    });
    expect(test.narrative).toMatch(/^Likely test noise:/);
  });
});

describe("dynamic-text helpers", () => {
  it("detects volatile-only changes", () => {
    expect(
      isDynamicTextChange("Updated 3 minutes ago", "Updated 5 minutes ago"),
    ).toBe(true);
    expect(isDynamicTextChange("Total: $1,200.00", "Total: $1,350.50")).toBe(
      true,
    );
    expect(isDynamicTextChange("12:04 PM", "12:05 PM")).toBe(true);
    expect(isDynamicTextChange("Order #48213", "Order #99917")).toBe(true);
  });

  it("treats real copy edits as non-dynamic", () => {
    expect(isDynamicTextChange("Welcome back", "Goodbye")).toBe(false);
    expect(isDynamicTextChange("Sign in", "Sign in")).toBe(false); // unchanged
    expect(isDynamicTextChange("Buy now for $5", "Subscribe for $5")).toBe(
      false,
    );
  });

  it("isPurelyDynamic", () => {
    expect(isPurelyDynamic("12:04:55")).toBe(true);
    expect(isPurelyDynamic("$1,299")).toBe(true);
    expect(isPurelyDynamic("Dashboard")).toBe(false);
  });

  it("maskDynamic collapses tokens", () => {
    expect(maskDynamic("seen 12 times")).toBe(maskDynamic("seen 9999 times"));
  });
});
