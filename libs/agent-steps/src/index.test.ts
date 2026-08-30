import { describe, expect, it } from "vitest";
import { activeStep, sessionNarration, sessionProgress } from "./index";

const step = (status: string, over: Record<string, unknown> = {}) => ({
  id: "s",
  status,
  label: "Generate",
  description: "Write the tests",
  ...over,
});

describe("activeStep", () => {
  it("returns the first active, waiting or failed step", () => {
    expect(
      activeStep({ steps: [step("completed"), step("failed"), step("active")] })
        ?.status,
    ).toBe("failed");
  });

  it("returns nothing for a fully settled run", () => {
    expect(
      activeStep({ steps: [step("completed"), step("skipped")] }),
    ).toBeUndefined();
  });
});

describe("sessionNarration", () => {
  it("prefers the freshest running substep", () => {
    expect(
      sessionNarration({
        steps: [
          step("active", {
            substeps: [
              { label: "test 1", status: "done" },
              { label: "test 6", detail: "apply coupon", status: "running" },
            ],
          }),
        ],
      }),
    ).toBe("Generate — apply coupon");
  });

  it("falls back to the step description", () => {
    expect(sessionNarration({ steps: [step("waiting_user")] })).toBe(
      "Generate — Write the tests",
    );
  });

  it("narrates a failed step instead of going silent", () => {
    expect(sessionNarration({ steps: [step("failed")] })).toBe(
      "Generate — Write the tests",
    );
  });
});

describe("sessionProgress", () => {
  it("counts completed and skipped over total", () => {
    expect(
      sessionProgress({
        steps: [
          step("completed"),
          step("skipped"),
          step("active"),
          step("pending"),
        ],
      }),
    ).toBe(50);
    expect(sessionProgress({ steps: [] })).toBe(0);
  });
});
