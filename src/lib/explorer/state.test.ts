import { describe, it, expect } from "vitest";
import { normalizeUrl, headingsDigest, hashState } from "./state";

describe("normalizeUrl", () => {
  it("strips query, hash, and trailing slash", () => {
    expect(normalizeUrl("https://app.io/users/?tab=all#top")).toBe(
      "https://app.io/users",
    );
  });

  it("collapses numeric and uuid-ish path segments to :id", () => {
    expect(normalizeUrl("https://app.io/users/123")).toBe(
      "https://app.io/users/:id",
    );
    expect(
      normalizeUrl(
        "https://app.io/orders/0f8fad5b-d9cb-469f-a165-70867728950e/items",
      ),
    ).toBe("https://app.io/orders/:id/items");
  });

  it("lowercases host and path but preserves structure", () => {
    expect(normalizeUrl("https://App.IO/Admin/Users")).toBe(
      "https://app.io/admin/users",
    );
  });

  it("passes through unparseable input", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("headingsDigest", () => {
  it("keeps only h1/h2, lowercased and deduped", () => {
    expect(
      headingsDigest([
        { level: 1, text: "  Dashboard " },
        { level: 2, text: "Recent Activity" },
        { level: 2, text: "Recent Activity" },
        { level: 3, text: "Ignored H3" },
      ]),
    ).toBe("dashboard | recent activity");
  });

  it("is empty for no main headings", () => {
    expect(headingsDigest([{ level: 3, text: "x" }])).toBe("");
  });
});

describe("hashState", () => {
  const headings = [{ level: 1, text: "Dashboard" }];

  it("is stable across query strings and id segments", () => {
    const a = hashState("https://app.io/users/123?tab=x", headings);
    const b = hashState("https://app.io/users/456", headings);
    expect(a).toBe(b);
  });

  it("differs when headings differ (SPA views on one URL)", () => {
    const a = hashState("https://app.io/app", [{ level: 1, text: "Inbox" }]);
    const b = hashState("https://app.io/app", [{ level: 1, text: "Settings" }]);
    expect(a).not.toBe(b);
  });

  it("is 16 hex chars", () => {
    expect(hashState("https://app.io/", [])).toMatch(/^[0-9a-f]{16}$/);
  });
});
