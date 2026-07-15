import { describe, it, expect } from "vitest";
import {
  buildTaskPlanFromTriage,
  buildTaskTriageSystemPrompt,
  buildTaskTriageUserPrompt,
  explainInvalidTaskTriage,
  isTaskTriageResult,
  triageTestsToPlanItems,
  MAX_TRIAGE_TESTS,
  type TaskTriageTest,
} from "./task-triage";
import type { QaTestGroup } from "@/lib/db/schema";

const targeted = {
  scope: "targeted",
  reason: "Names one concrete flow",
  tests: [
    {
      title: "Billing rejects an expired card",
      scenario: "1. Open /billing 2. Enter expired card 3. Assert inline error",
      pagePath: "/billing",
      group: "negative",
    },
  ],
};

const explore = {
  scope: "explore",
  reason: "Asks for coverage across the whole app",
  tests: [],
};

describe("isTaskTriageResult", () => {
  it("accepts a targeted decision with tests", () => {
    expect(isTaskTriageResult(targeted)).toBe(true);
  });

  it("accepts an explore decision with empty tests", () => {
    expect(isTaskTriageResult(explore)).toBe(true);
  });

  it("rejects unknown scopes, missing reasons, and malformed tests", () => {
    expect(isTaskTriageResult({ ...targeted, scope: "both" })).toBe(false);
    expect(isTaskTriageResult({ ...targeted, reason: "" })).toBe(false);
    expect(isTaskTriageResult({ ...explore, tests: [{ title: "x" }] })).toBe(
      false,
    );
    expect(isTaskTriageResult({ ...explore, tests: undefined })).toBe(false);
    expect(isTaskTriageResult(null)).toBe(false);
    expect(isTaskTriageResult("targeted")).toBe(false);
  });
});

describe("explainInvalidTaskTriage", () => {
  it("returns null for a valid decision", () => {
    expect(explainInvalidTaskTriage(targeted)).toBeNull();
  });

  it("names the first failing field", () => {
    expect(explainInvalidTaskTriage({})).toContain('"scope"');
    expect(
      explainInvalidTaskTriage({ scope: "targeted", reason: "" }),
    ).toContain('"reason"');
    expect(
      explainInvalidTaskTriage({ scope: "targeted", reason: "r" }),
    ).toContain('"tests"');
    expect(
      explainInvalidTaskTriage({
        scope: "targeted",
        reason: "r",
        tests: [{ title: "no scenario" }],
      }),
    ).toContain("tests[0]");
  });
});

describe("triageTestsToPlanItems", () => {
  const groups: QaTestGroup[] = ["journey", "smoke", "negative"];

  it("maps tests to D-prefixed P1 plan items", () => {
    const items = triageTestsToPlanItems(
      targeted.tests as TaskTriageTest[],
      groups,
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("D1");
    expect(items[0].priority).toBe("P1");
    expect(items[0].group).toBe("negative");
    expect(items[0].pagePath).toBe("/billing");
    expect(items[0].scenario).toContain("expired card");
  });

  it("falls back to the first selected group for unknown/missing groups", () => {
    const items = triageTestsToPlanItems(
      [
        { title: "A", scenario: "s", group: "not-a-group" as QaTestGroup },
        { title: "B", scenario: "s" },
      ],
      groups,
    );
    expect(items[0].group).toBe("journey");
    expect(items[1].group).toBe("journey");
  });

  it("caps at MAX_TRIAGE_TESTS", () => {
    const many: TaskTriageTest[] = Array.from({ length: 6 }, (_, i) => ({
      title: `T${i}`,
      scenario: "s",
    }));
    expect(triageTestsToPlanItems(many, groups)).toHaveLength(MAX_TRIAGE_TESTS);
  });
});

describe("buildTaskPlanFromTriage", () => {
  it("wraps the items in a minimal runnable plan", () => {
    const items = triageTestsToPlanItems(targeted.tests as TaskTriageTest[], [
      "journey",
    ]);
    const plan = buildTaskPlanFromTriage("Cover billing errors", items);
    expect(plan.items).toEqual(items);
    expect(plan.journeys).toEqual([]);
    expect(plan.appProfile.summary).toContain("Cover billing errors");
  });
});

describe("triage prompts", () => {
  it("system prompt pins the JSON contract and both scopes", () => {
    const p = buildTaskTriageSystemPrompt();
    expect(p).toContain('"targeted"|"explore"');
    expect(p).toContain('"tests"');
    expect(p).toContain(`${MAX_TRIAGE_TESTS}`);
  });

  it("user prompt carries directive, groups, plan digest, and known pages", () => {
    const p = buildTaskTriageUserPrompt({
      directive: "Add negative tests for signup",
      groups: ["journey", "negative"],
      existingPlanDigest: 'Tests:\n- test: "Signup happy path"',
      knownPagePaths: ["/signup", "/login"],
      authenticated: true,
    });
    expect(p).toContain("Add negative tests for signup");
    expect(p).toContain("- negative:");
    expect(p).toContain("Signup happy path");
    expect(p).toContain("- /signup");
    expect(p).toContain("Authenticated session available: YES");
  });

  it("user prompt states when no plan exists", () => {
    const p = buildTaskTriageUserPrompt({
      directive: "d",
      groups: ["journey"],
      authenticated: false,
    });
    expect(p).toContain("no stored test plan");
    expect(p).not.toContain("KNOWN PAGES");
  });
});
