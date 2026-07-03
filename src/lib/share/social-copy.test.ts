import { describe, expect, it } from "vitest";
import {
  buildSocialCopy,
  buildStatLine,
  buildTikTokCaption,
  buildXPost,
  buildYouTubeChapters,
  buildYouTubeMeta,
  formatTimestamp,
  xWeightedLength,
  type SocialCopyInput,
} from "./social-copy";

const base: SocialCopyInput = {
  shareUrl: "https://app.lastest.cloud/r/abc123def456",
  title: "Checkout flow",
  domain: "shop.example.com",
  variant: "test",
  verdictLabel: "Changed",
  pixelsChanged: 12345,
  changesDetected: 3,
  totalTests: 12,
  durationMs: 8200,
  chapters: [
    { title: "Open homepage", atSec: 0 },
    { title: "Add to cart", atSec: 3.4 },
    { title: "Checkout", atSec: 6.1 },
    { title: "Final", atSec: 7.9 },
  ],
  uxSummary: "Smooth checkout overall; the coupon field is hard to find.",
  highlights: [{ label: "Fast cart", note: "Cart updates instantly." }],
};

describe("formatTimestamp", () => {
  it("formats minutes/seconds and hours", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(3723)).toBe("1:02:03");
  });
});

describe("xWeightedLength", () => {
  it("counts URLs as 23 chars", () => {
    expect(
      xWeightedLength("hi https://example.com/very/long/path/here x"),
    ).toBe(3 + 23 + 2);
    expect(xWeightedLength("no links")).toBe(8);
  });
});

describe("buildStatLine", () => {
  it("summarizes changed test shares", () => {
    expect(buildStatLine(base)).toBe("12,345 pixels changed — changed");
  });
  it("summarizes passing test shares", () => {
    expect(
      buildStatLine({ ...base, pixelsChanged: 0, verdictLabel: "Passed" }),
    ).toBe("0 pixels changed in 8.2s — matches baseline");
  });
  it("summarizes build shares", () => {
    expect(buildStatLine({ ...base, variant: "build" })).toBe(
      "3 visual changes caught across 12 automated tests",
    );
    expect(
      buildStatLine({ ...base, variant: "build", changesDetected: 0 }),
    ).toBe("0 regressions across 12 automated tests");
  });
});

describe("buildXPost", () => {
  it("includes the share URL and stays under the weighted limit", () => {
    const post = buildXPost(base);
    expect(post).toContain(base.shareUrl);
    expect(post).toContain("Checkout flow");
    expect(xWeightedLength(post)).toBeLessThanOrEqual(280);
  });
  it("clamps very long titles without dropping the URL", () => {
    const post = buildXPost({ ...base, title: "T".repeat(400) });
    expect(post).toContain(base.shareUrl);
    expect(xWeightedLength(post)).toBeLessThanOrEqual(280);
  });
});

describe("buildYouTubeChapters", () => {
  it("emits one line per stamped chapter, starting at 0:00", () => {
    const block = buildYouTubeChapters(base.chapters);
    expect(block.split("\n")).toHaveLength(4);
    expect(block.startsWith("0:00 Open homepage")).toBe(true);
  });
  it("forces strictly increasing timestamps", () => {
    const block = buildYouTubeChapters([
      { title: "A", atSec: 0 },
      { title: "B", atSec: 0.2 },
      { title: "C", atSec: 0.5 },
    ]);
    expect(block).toBe("0:00 A\n0:01 B\n0:02 C");
  });
  it("returns empty when fewer than 3 usable chapters", () => {
    expect(
      buildYouTubeChapters([
        { title: "A", atSec: 0 },
        { title: "B", atSec: null },
      ]),
    ).toBe("");
  });
});

describe("buildYouTubeMeta", () => {
  it("stays inside platform limits and carries the run content", () => {
    const meta = buildYouTubeMeta(base);
    expect(meta.title.length).toBeLessThanOrEqual(100);
    expect(meta.description.length).toBeLessThanOrEqual(5000);
    expect(meta.tags.length).toBeLessThanOrEqual(500);
    expect(meta.description).toContain("Chapters:\n0:00 Open homepage");
    expect(meta.description).toContain(base.shareUrl);
    expect(meta.description).toContain(base.uxSummary);
    expect(meta.description).toContain("• Fast cart — Cart updates instantly.");
    expect(meta.tags).toContain("visual regression testing");
    expect(meta.tags).toContain(base.domain);
  });
  it("omits the chapter block when the run has no timestamps", () => {
    const meta = buildYouTubeMeta({ ...base, chapters: [] });
    expect(meta.description).not.toContain("Chapters:");
  });
});

describe("buildTikTokCaption", () => {
  it("includes hook, link, and hashtags within the limit", () => {
    const caption = buildTikTokCaption(base);
    expect(caption.length).toBeLessThanOrEqual(2200);
    expect(caption).toContain(base.shareUrl);
    expect(caption).toContain("#visualtesting");
    expect(caption).toContain("caught a UI change");
  });
  it("uses the build hook on build shares", () => {
    const caption = buildTikTokCaption({ ...base, variant: "build" });
    expect(caption).toContain("3 UI changes caught before shipping");
  });
});

describe("buildSocialCopy", () => {
  it("returns all three platform payloads", () => {
    const copy = buildSocialCopy(base);
    expect(copy.x).toBeTruthy();
    expect(copy.youtube.title).toBeTruthy();
    expect(copy.tiktok).toBeTruthy();
  });
});
