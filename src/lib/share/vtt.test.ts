import { describe, it, expect } from "vitest";
import { captionsToVtt, msToVttTimestamp } from "./vtt";
import type { VideoCaption } from "@/lib/db/schema";

function cap(p: Partial<VideoCaption>): VideoCaption {
  return {
    stepIndex: 0,
    startMs: 0,
    endMs: 1000,
    text: "hello",
    ...p,
  };
}

describe("msToVttTimestamp", () => {
  it("formats zero", () => {
    expect(msToVttTimestamp(0)).toBe("00:00:00.000");
  });
  it("formats sub-second millis with padding", () => {
    expect(msToVttTimestamp(1500)).toBe("00:00:01.500");
    expect(msToVttTimestamp(50)).toBe("00:00:00.050");
  });
  it("formats minutes and hours", () => {
    expect(msToVttTimestamp(65_000)).toBe("00:01:05.000");
    expect(msToVttTimestamp(3_661_001)).toBe("01:01:01.001");
  });
  it("clamps negative / non-finite to zero", () => {
    expect(msToVttTimestamp(-10)).toBe("00:00:00.000");
    expect(msToVttTimestamp(NaN)).toBe("00:00:00.000");
  });
});

describe("captionsToVtt", () => {
  it("emits a header-only doc when there are no usable cues", () => {
    expect(captionsToVtt([])).toBe("WEBVTT\n");
  });

  it("emits numbered cues with timestamps", () => {
    const vtt = captionsToVtt([
      cap({ startMs: 0, endMs: 2000, text: "Opens the page" }),
      cap({ startMs: 2000, endMs: 4000, text: "Clicks sign in" }),
    ]);
    expect(vtt).toBe(
      [
        "WEBVTT",
        "",
        "1",
        "00:00:00.000 --> 00:00:02.000",
        "Opens the page",
        "",
        "2",
        "00:00:02.000 --> 00:00:04.000",
        "Clicks sign in",
        "",
      ].join("\n"),
    );
  });

  it("sorts cues by start time", () => {
    const vtt = captionsToVtt([
      cap({ startMs: 4000, endMs: 6000, text: "later" }),
      cap({ startMs: 0, endMs: 2000, text: "earlier" }),
    ]);
    expect(vtt.indexOf("earlier")).toBeLessThan(vtt.indexOf("later"));
  });

  it("neutralizes the --> delimiter and collapses newlines in cue text", () => {
    const vtt = captionsToVtt([cap({ text: "a --> b\nsecond   line" })]);
    expect(vtt).not.toContain("a --> b");
    expect(vtt).toContain("a → b second line");
  });

  it("drops empty-text and non-positive-duration cues", () => {
    const vtt = captionsToVtt([
      cap({ startMs: 0, endMs: 0, text: "zero duration" }),
      cap({ startMs: 100, endMs: 50, text: "negative duration" }),
      cap({ startMs: 0, endMs: 1000, text: "   " }),
      cap({ startMs: 0, endMs: 1000, text: "kept" }),
    ]);
    expect(vtt).toContain("kept");
    expect(vtt).not.toContain("zero duration");
    expect(vtt).not.toContain("negative duration");
    // exactly one cue survived
    expect(vtt.match(/-->/g)?.length).toBe(1);
  });
});
