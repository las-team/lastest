import { describe, it, expect } from "vitest";
import { renderKeptTestCode, isKeepable } from "./keep";
import type { ExplorerActionLog, ExplorerScenario } from "@/lib/db/schema";

const scenario: ExplorerScenario = {
  id: "it0-s0-abc",
  title: "Create a project",
  style: "normal",
  steps: ["Open the form", "Fill the name", "Submit"],
  rationale: "Core CRUD flow",
  expectedOutcome: "Project appears in the list",
};

const log: ExplorerActionLog = {
  scenarioId: scenario.id,
  status: "passed",
  steps: [
    {
      intent: "Open the create form",
      action: "click",
      selector: '[data-testid="new-project"]',
      result: "ok",
    },
    {
      intent: "Fill the project name",
      action: "fill",
      selector: "#name",
      value: "Explorer Test",
      result: "ok",
    },
    {
      intent: "Try a dead-end button",
      action: "click",
      selector: "#nope",
      result: "error",
      note: "timeout",
    },
    { intent: "Submit", action: "press", value: "Enter", result: "ok" },
  ],
  summary: "Project visible in list",
};

describe("renderKeptTestCode", () => {
  it("emits the runner contract signature", () => {
    const code = renderKeptTestCode(scenario, log, "https://app.io/projects");
    expect(code).toContain(
      "export async function test(page, baseUrl, screenshotPath, stepLogger)",
    );
    expect(code).toContain('await page.goto("https://app.io/projects"');
  });

  it("replays only successful steps with stepLogger lines", () => {
    const code = renderKeptTestCode(scenario, log, "https://app.io/");
    expect(code).toContain('stepLogger.log("Open the create form")');
    expect(code).toContain('.fill("Explorer Test"');
    expect(code).toContain('keyboard.press("Enter")');
    expect(code).not.toContain("#nope");
  });

  it("escapes quotes safely", () => {
    const tricky: ExplorerActionLog = {
      ...log,
      steps: [
        {
          intent: 'Click "Save"',
          action: "click",
          selector: 'text=Say "hi"',
          result: "ok",
        },
        { intent: "Confirm", action: "press", value: "Enter", result: "ok" },
      ],
    };
    const code = renderKeptTestCode(scenario, tricky, "https://app.io/");
    expect(code).toContain('text=Say \\"hi\\"');
  });
});

describe("isKeepable", () => {
  it("keeps passing logs with at least two ok steps", () => {
    expect(isKeepable(log)).toBe(true);
  });

  it("rejects failed or trivial logs", () => {
    expect(isKeepable({ ...log, status: "failed" })).toBe(false);
    expect(isKeepable({ ...log, steps: [log.steps[0]] })).toBe(false);
  });
});
