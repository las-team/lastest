import { describe, expect, it, vi } from "vitest";
import { parseAiJson } from "./json-parse";

interface Plan {
  appProfile: { summary: string };
  items: unknown[];
}

function isPlan(v: unknown): v is Plan {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const profile = p.appProfile as Record<string, unknown> | undefined;
  return (
    !!profile &&
    typeof profile.summary === "string" &&
    Array.isArray(p.items) &&
    p.items.length > 0
  );
}

const VALID = '{"appProfile":{"summary":"x"},"items":[1]}';

describe("parseAiJson", () => {
  it("parses a clean JSON object", () => {
    expect(parseAiJson(VALID, isPlan)).toEqual({
      appProfile: { summary: "x" },
      items: [1],
    });
  });

  it("strips markdown fences", () => {
    expect(parseAiJson("```json\n" + VALID + "\n```", isPlan)).toEqual({
      appProfile: { summary: "x" },
      items: [1],
    });
  });

  it("recovers the first object when the model emits it twice concatenated", () => {
    // Reproduces the claude-agent-sdk double-emission that failed the QA
    // planner: two identical objects joined by a newline. A plain JSON.parse
    // throws "Unexpected non-whitespace character after JSON".
    const doubled = VALID + "\n" + VALID;
    expect(() => JSON.parse(doubled)).toThrow();
    expect(parseAiJson(doubled, isPlan)).toEqual({
      appProfile: { summary: "x" },
      items: [1],
    });
  });

  it("recovers a JSON object wrapped in surrounding prose", () => {
    const noisy = `Sure, here is the plan:\n${VALID}\nLet me know if you want changes.`;
    expect(parseAiJson(noisy, isPlan)).toEqual({
      appProfile: { summary: "x" },
      items: [1],
    });
  });

  it("does not mistake braces inside string values for structure", () => {
    const withBraces =
      '{"appProfile":{"summary":"a } b { c"},"items":[1]} trailing';
    expect(parseAiJson(withBraces, isPlan)).toEqual({
      appProfile: { summary: "a } b { c" },
      items: [1],
    });
  });

  it("returns null on unrecoverable garbage", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseAiJson("not json at all", isPlan)).toBeNull();
    expect(parseAiJson("", isPlan)).toBeNull();
  });

  it("returns null when the recovered value fails the shape predicate", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Parses fine but items is empty → predicate rejects.
    expect(
      parseAiJson('{"appProfile":{"summary":"x"},"items":[]}', isPlan),
    ).toBeNull();
  });
});
