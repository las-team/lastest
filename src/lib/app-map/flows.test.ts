import { describe, it, expect } from "vitest";
import { deriveFlows, flowsThroughNode } from "./flows";
import type { FlowSourceResult } from "./flows";

function result(overrides: Partial<FlowSourceResult> = {}): FlowSourceResult {
  return {
    testId: "t1",
    testName: "Checkout",
    screenshots: null,
    urlTrajectory: null,
    gitBranch: "main",
    startedAt: new Date("2026-01-02T03:04:05Z"),
    ...overrides,
  };
}

const traj = (steps: Array<[number, string, string?]>) =>
  steps.map(([stepIndex, finalUrl, stepLabel]) => ({
    stepIndex,
    stepLabel,
    finalUrl,
    redirectChain: [],
  }));

describe("deriveFlows", () => {
  it("drops results with fewer than 2 trajectory steps", () => {
    const flows = deriveFlows([
      result({ urlTrajectory: traj([[0, "https://a.test/"]]) }),
      result({ urlTrajectory: [] }),
      result({ urlTrajectory: null }),
    ]);
    expect(flows).toEqual([]);
  });

  it("orders steps by stepIndex and canonicalizes node ids", () => {
    const flows = deriveFlows([
      result({
        urlTrajectory: traj([
          [2, "https://a.test/orders/123"],
          [0, "https://a.test/"],
          [1, "https://a.test/orders"],
        ]),
      }),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]!.steps.map((s) => s.nodeId)).toEqual([
      "/",
      "/orders",
      "/orders/:id",
    ]);
    expect(flows[0]!.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
  });

  it("matches screenshots to steps by label", () => {
    const flows = deriveFlows([
      result({
        urlTrajectory: traj([
          [0, "https://a.test/", "Step 1"],
          [1, "https://a.test/cart", "Step 2"],
        ]),
        screenshots: [
          { path: "/shots/cart.png", label: "Step 2" },
          { path: "/shots/home.png", label: "Step 1" },
        ],
      }),
    ]);
    expect(flows[0]!.steps.map((s) => s.screenshotPath)).toEqual([
      "/shots/home.png",
      "/shots/cart.png",
    ]);
  });

  it("falls back to positional zip when no labels match and counts align", () => {
    const flows = deriveFlows([
      result({
        urlTrajectory: traj([
          [0, "https://a.test/", "Step 1"],
          [1, "https://a.test/cart", "Step 2"],
        ]),
        screenshots: [
          { path: "/shots/0.png", label: "final" },
          { path: "/shots/1.png" },
        ],
      }),
    ]);
    expect(flows[0]!.steps.map((s) => s.screenshotPath)).toEqual([
      "/shots/0.png",
      "/shots/1.png",
    ]);
  });

  it("attributes a lone unmatched screenshot to the final step", () => {
    const flows = deriveFlows([
      result({
        urlTrajectory: traj([
          [0, "https://a.test/"],
          [1, "https://a.test/cart"],
          [2, "https://a.test/checkout"],
        ]),
        screenshots: [{ path: "/shots/end.png", label: "final" }],
      }),
    ]);
    expect(flows[0]!.steps.map((s) => s.screenshotPath)).toEqual([
      undefined,
      undefined,
      "/shots/end.png",
    ]);
  });

  it("sorts branch-matching flows first, then by name", () => {
    const flows = deriveFlows(
      [
        result({
          testId: "b",
          testName: "Zeta",
          gitBranch: "main",
          urlTrajectory: traj([
            [0, "https://a.test/"],
            [1, "https://a.test/z"],
          ]),
        }),
        result({
          testId: "a",
          testName: "Alpha",
          gitBranch: "other",
          urlTrajectory: traj([
            [0, "https://a.test/"],
            [1, "https://a.test/a"],
          ]),
        }),
      ],
      "main",
    );
    expect(flows.map((f) => f.name)).toEqual(["Zeta", "Alpha"]);
  });
});

describe("flowsThroughNode", () => {
  it("returns flows whose steps hit the node id", () => {
    const flows = deriveFlows([
      result({
        testId: "t1",
        urlTrajectory: traj([
          [0, "https://a.test/"],
          [1, "https://a.test/orders/42"],
        ]),
      }),
      result({
        testId: "t2",
        testName: "Other",
        urlTrajectory: traj([
          [0, "https://a.test/"],
          [1, "https://a.test/settings"],
        ]),
      }),
    ]);
    expect(flowsThroughNode(flows, "/orders/:id").map((f) => f.testId)).toEqual(
      ["t1"],
    );
    expect(
      flowsThroughNode(flows, "/")
        .map((f) => f.testId)
        .sort(),
    ).toEqual(["t1", "t2"]);
  });
});
