import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeTestRun, projectResult } from "./test-run-summary.js";

// The real ~2.9MB payload that overflowed the MCP token limit, captured from
// `lastest_get_test_run`. Used to prove the changes-only projection stays small.
const FIXTURE =
  "/home/ewyct/.claude/projects/-home-ewyct-dev-lastest/0986bf47-2af6-4315-9a15-8da17439f937/tool-results/mcp-lastest-lastest_get_test_run-1781377167074.txt";

function loadFixture(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(FIXTURE, "utf8")).details;
  } catch {
    return null; // fixture is machine-local; skip the size assertions elsewhere
  }
}

describe("summarizeTestRun", () => {
  it("drops 95%+ of bytes by default vs the raw pretty-printed payload", () => {
    const data = loadFixture();
    if (!data) return;
    const rawPretty = JSON.stringify({ details: data }, null, 2).length;
    const lean = JSON.stringify(summarizeTestRun(data)).length;
    expect(lean).toBeLessThan(rawPretty * 0.1);
  });

  it("keeps every result and the run header", () => {
    const data = loadFixture();
    if (!data) return;
    const out = summarizeTestRun(data) as Record<string, unknown>;
    expect(out.run).toEqual(data.run);
    expect((out.results as unknown[]).length).toEqual(
      (data.results as unknown[]).length,
    );
  });

  it("default view omits raw context but keeps change signal", () => {
    const result = {
      id: "r1",
      status: "failed",
      errorMessage: "boom",
      consoleErrors: ["bad"],
      domSnapshot: { elements: [1, 2, 3] },
      webVitals: [{ cls: 0.3 }],
      urlTrajectory: [{ finalUrl: "/x" }],
      logs: [{ level: "info", message: "hi" }],
      storageStateSnapshot: { cookies: [] },
      networkRequests: [
        { url: "/ok", status: 200, failed: false },
        { url: "/bad", status: 500, failed: false },
        { url: "/err", status: 0, failed: true },
      ],
      a11yViolations: [
        {
          id: "button-name",
          impact: "critical",
          help: "Buttons need text",
          tags: ["wcag2a", "section508"],
          helpUrl: "https://example.com",
          description: "long static description",
          sampleNodes: [
            {
              target: ["button"],
              failureSummary: "fix",
              html: "x".repeat(500),
            },
          ],
        },
      ],
    };

    const lean = projectResult(result, []);
    // change signal kept
    expect(lean.errorMessage).toBe("boom");
    expect(lean.consoleErrors).toEqual(["bad"]);
    // only failed/4xx/5xx requests survive
    expect((lean.failedNetworkRequests as unknown[]).length).toBe(2);
    expect(lean.networkRequestCount).toBe(3);
    // raw context dropped
    expect(lean.domSnapshot).toBeUndefined();
    expect(lean.webVitals).toBeUndefined();
    expect(lean.urlTrajectory).toBeUndefined();
    expect(lean.logs).toBeUndefined();
    expect(lean.storageStateSnapshot).toBeUndefined();
    expect(lean.networkRequests).toBeUndefined();
    // violations trimmed: static fields gone, one locator + summary lifted, no raw html
    const a11y = (lean.a11yViolations as Record<string, unknown>[])[0];
    expect(a11y.tags).toBeUndefined();
    expect(a11y.helpUrl).toBeUndefined();
    expect(a11y.description).toBeUndefined();
    expect(a11y.sampleNodes).toBeUndefined();
    expect(a11y.help).toBe("Buttons need text");
    expect(a11y.target).toEqual(["button"]);
    expect(a11y.summary).toBe("fix");
    expect(JSON.stringify(lean)).not.toContain("xxxxx"); // captured html never leaks
  });

  it("caps noisy violation lists with an omittedCount", () => {
    const designSystemViolations = Array.from({ length: 14 }, (_, i) => ({
      id: `spacing:${i}px`,
      category: "spacing",
      sampleNodes: [{ target: ["div"], failureSummary: `s${i}` }],
    }));
    const lean = projectResult({ id: "r1", designSystemViolations }, []);
    const out = lean.designSystemViolations as Record<string, unknown>[];
    expect(out.length).toBe(11); // 10 kept + 1 overflow marker
    expect(out[10]).toEqual({ omittedCount: 4 });
  });

  it("trims assertions to failures plus a pass count", () => {
    const lean = projectResult(
      {
        id: "r1",
        assertionResults: [
          { status: "passed", assertionId: "a" },
          { status: "passed", assertionId: "b" },
          { status: "failed", assertionId: "c" },
        ],
      },
      [],
    );
    expect(lean.assertionResults).toEqual({
      passed: 2,
      failures: [{ status: "failed", assertionId: "c" }],
    });
  });

  it("include flags add back the requested raw sections", () => {
    const result = {
      id: "r1",
      domSnapshot: { elements: [] },
      webVitals: [{ cls: 0 }],
      networkRequests: [{ url: "/ok", status: 200 }],
    };
    const withDom = projectResult(result, ["dom", "network"]);
    expect(withDom.domSnapshot).toEqual({ elements: [] });
    expect(withDom.networkRequests).toEqual([{ url: "/ok", status: 200 }]);
    expect(withDom.webVitals).toBeUndefined(); // not requested
  });

  it("include 'all' returns the untouched raw payload", () => {
    const data = { run: { id: "x" }, results: [{ id: "r1", domSnapshot: {} }] };
    expect(summarizeTestRun(data, ["all"])).toBe(data);
  });
});
