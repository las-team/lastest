import { describe, it, expect } from "vitest";
import {
  nextStyle,
  parseStyleRotation,
  ALL_STYLES,
  STYLE_FRAGMENTS,
} from "./styles";

describe("nextStyle", () => {
  it("cycles the default rotation normal → curious → psycho → normal", () => {
    expect(nextStyle(undefined, 0)).toBe("normal");
    expect(nextStyle(undefined, 1)).toBe("curious");
    expect(nextStyle(undefined, 2)).toBe("psycho");
    expect(nextStyle(undefined, 3)).toBe("normal");
  });

  it("respects a custom rotation and wraps", () => {
    expect(nextStyle(["psycho", "normal"], 0)).toBe("psycho");
    expect(nextStyle(["psycho", "normal"], 1)).toBe("normal");
    expect(nextStyle(["psycho", "normal"], 2)).toBe("psycho");
  });

  it("falls back to defaults on an empty rotation", () => {
    expect(nextStyle([], 0)).toBe("normal");
  });
});

describe("parseStyleRotation", () => {
  it("parses the persisted comma string", () => {
    expect(parseStyleRotation("normal,curious,psycho")).toEqual(ALL_STYLES);
    expect(parseStyleRotation("psycho, normal")).toEqual(["psycho", "normal"]);
  });

  it("drops unknown styles and falls back when nothing survives", () => {
    expect(parseStyleRotation("psycho,bogus")).toEqual(["psycho"]);
    expect(parseStyleRotation("bogus")).toEqual(ALL_STYLES);
    expect(parseStyleRotation(null)).toEqual(ALL_STYLES);
  });
});

describe("STYLE_FRAGMENTS", () => {
  it("has a fragment for every style", () => {
    for (const style of ALL_STYLES) {
      expect(STYLE_FRAGMENTS[style]).toContain("STYLE:");
    }
  });
});
