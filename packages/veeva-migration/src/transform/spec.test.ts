import { describe, expect, it } from "vitest";
import { formatTransform, parseTransform, TransformSpecError } from "./spec";

describe("parseTransform arguments", () => {
  it("text/longtext/number take non-negative integer arguments only", () => {
    expect(parseTransform("text(128)")).toEqual({ kind: "text", max: 128 });
    expect(parseTransform("longtext(32000)")).toEqual({
      kind: "longtext",
      max: 32000,
    });
    expect(parseTransform("number(2)")).toEqual({ kind: "number", scale: 2 });
    expect(parseTransform("text")).toEqual({ kind: "text" });
    for (const bad of ["text(abc)", "text(1.5)", "number(x)", "text(-1)"]) {
      expect(() => parseTransform(bad), bad).toThrow(TransformSpecError);
      expect(() => parseTransform(bad), bad).toThrow(
        /MAP_TRANSFORM_INVALID|integer/,
      );
    }
  });
  it("round-trips through formatTransform", () => {
    for (const t of ["text(128)", "longtext(32000)", "number(2)", "text"])
      expect(formatTransform(parseTransform(t))).toBe(t);
  });
});
