import { describe, it, expect } from "vitest";
import { isStuck, isActionLooping } from "./supervisor";

describe("isStuck", () => {
  it("is false for fresh exploration (all states new)", () => {
    expect(isStuck(["a", "b", "c", "d"])).toBe(false);
  });

  it("detects a state repeating three times in the recent window", () => {
    expect(isStuck(["a", "x", "a", "b", "a"])).toBe(true);
  });

  it("ignores repeats outside the recent window", () => {
    expect(isStuck(["a", "a", "b", "c", "d", "e", "f", "a"])).toBe(false);
  });

  it("is false on short history", () => {
    expect(isStuck(["a", "a"])).toBe(false);
  });
});

describe("isActionLooping", () => {
  it("detects the same action+selector repeating", () => {
    const steps = [
      { action: "click", selector: "#save" },
      { action: "click", selector: "#save" },
      { action: "click", selector: "#save" },
    ];
    expect(isActionLooping(steps)).toBe(true);
  });

  it("is false when actions vary", () => {
    const steps = [
      { action: "click", selector: "#save" },
      { action: "fill", selector: "#name" },
      { action: "click", selector: "#save" },
    ];
    expect(isActionLooping(steps)).toBe(false);
  });
});
