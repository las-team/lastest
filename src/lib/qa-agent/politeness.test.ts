import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CRAWLER_PRODUCT_TOKEN,
  CRAWLER_UA_SUFFIX,
  CrawlPacer,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
  MAX_HONORED_CRAWL_DELAY_MS,
  pacerFor,
  parseRobotsTxt,
} from "./politeness";

const ORIGIN = "https://app.test";
const url = (path: string) => `${ORIGIN}${path}`;

describe("parseRobotsTxt", () => {
  it("applies the wildcard group when no agent matches us", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /admin"].join("\n"),
    );
    expect(policy.isAllowed(url("/admin"))).toBe(false);
    expect(policy.isAllowed(url("/admin/users"))).toBe(false); // prefix match
    expect(policy.isAllowed(url("/dashboard"))).toBe(true);
  });

  it("prefers the group naming our product token over the wildcard group", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /",
        "",
        `User-agent: ${CRAWLER_PRODUCT_TOKEN}`,
        "Disallow: /private",
      ].join("\n"),
    );
    // Our own group wins outright — no merging with `*`.
    expect(policy.isAllowed(url("/dashboard"))).toBe(true);
    expect(policy.isAllowed(url("/private"))).toBe(false);
  });

  it("matches our token case-insensitively and as a prefix of the UA", () => {
    const policy = parseRobotsTxt(
      ["User-agent: lastestbot", "Disallow: /nope"].join("\n"),
    );
    expect(policy.isAllowed(url("/nope"))).toBe(false);
  });

  it("treats an empty Disallow as allow-all", () => {
    const policy = parseRobotsTxt(["User-agent: *", "Disallow:"].join("\n"));
    expect(policy.isAllowed(url("/anything"))).toBe(true);
  });

  it("lets the longest matching rule win, with ties going to Allow", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /app",
        "Allow: /app/public",
        "Disallow: /x",
        "Allow: /x",
      ].join("\n"),
    );
    expect(policy.isAllowed(url("/app/secret"))).toBe(false);
    expect(policy.isAllowed(url("/app/public/page"))).toBe(true);
    expect(policy.isAllowed(url("/x"))).toBe(true); // equal length → Allow
  });

  it("honours `*` and `$` wildcards", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /*/edit", "Disallow: /reports$"].join("\n"),
    );
    expect(policy.isAllowed(url("/orders/edit"))).toBe(false);
    expect(policy.isAllowed(url("/orders/view"))).toBe(true);
    expect(policy.isAllowed(url("/reports"))).toBe(false);
    expect(policy.isAllowed(url("/reports/2024"))).toBe(true); // anchored
  });

  it("matches against path AND query", () => {
    const policy = parseRobotsTxt(
      ["User-agent: *", "Disallow: /search?q="].join("\n"),
    );
    expect(policy.isAllowed(url("/search?q=shoes"))).toBe(false);
    expect(policy.isAllowed(url("/search"))).toBe(true);
  });

  it("ignores comments and unknown fields", () => {
    const policy = parseRobotsTxt(
      [
        "# a comment",
        "Sitemap: https://app.test/sitemap.xml",
        "User-agent: *   # trailing comment",
        "Disallow: /admin",
      ].join("\n"),
    );
    expect(policy.isAllowed(url("/admin"))).toBe(false);
    expect(policy.isAllowed(url("/"))).toBe(true);
  });

  it("reads Crawl-delay in seconds and clamps pathological values", () => {
    expect(
      parseRobotsTxt(["User-agent: *", "Crawl-delay: 2.5"].join("\n"))
        .crawlDelayMs,
    ).toBe(2500);
    expect(
      parseRobotsTxt(["User-agent: *", "Crawl-delay: 99999"].join("\n"))
        .crawlDelayMs,
    ).toBe(MAX_HONORED_CRAWL_DELAY_MS);
    expect(parseRobotsTxt("User-agent: *").crawlDelayMs).toBeNull();
  });

  it("groups contiguous user-agent lines into one record", () => {
    const policy = parseRobotsTxt(
      [
        "User-agent: SomeOtherBot",
        `User-agent: ${CRAWLER_PRODUCT_TOKEN}`,
        "Disallow: /shared",
      ].join("\n"),
    );
    expect(policy.isAllowed(url("/shared"))).toBe(false);
  });

  it("allows everything when robots.txt is empty or has no relevant group", () => {
    expect(parseRobotsTxt("").isAllowed(url("/x"))).toBe(true);
    expect(
      parseRobotsTxt(
        ["User-agent: GoogleBot", "Disallow: /"].join("\n"),
      ).isAllowed(url("/x")),
    ).toBe(true);
  });
});

describe("CrawlPacer", () => {
  afterEach(() => vi.useRealTimers());

  it("serializes concurrent waiters one interval apart", async () => {
    vi.useFakeTimers();
    const pacer = new CrawlPacer(500);
    const done: number[] = [];
    // Five explorers arriving at once — the target sees one request per slot.
    for (let i = 0; i < 5; i++) {
      void pacer.wait().then(() => done.push(i));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]); // first is free
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not delay a caller that already waited out the interval", async () => {
    vi.useFakeTimers();
    const pacer = new CrawlPacer(500);
    await pacer.wait();
    await vi.advanceTimersByTimeAsync(2000);
    let resolved = false;
    void pacer.wait().then(() => (resolved = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});

describe("pacerFor", () => {
  it("uses the robots Crawl-delay when it is slower than our floor", async () => {
    vi.useFakeTimers();
    const pacer = pacerFor({
      isAllowed: () => true,
      crawlDelayMs: 3000,
      source: "robots",
    });
    let second = false;
    await pacer.wait();
    void pacer.wait().then(() => (second = true));
    await vi.advanceTimersByTimeAsync(DEFAULT_MIN_REQUEST_INTERVAL_MS + 10);
    expect(second).toBe(false); // still honouring the 3s Crawl-delay
    await vi.advanceTimersByTimeAsync(3000);
    expect(second).toBe(true);
    vi.useRealTimers();
  });

  it("falls back to the default floor when robots names no delay", async () => {
    vi.useFakeTimers();
    const pacer = pacerFor({
      isAllowed: () => true,
      crawlDelayMs: null,
      source: "missing",
    });
    let second = false;
    await pacer.wait();
    void pacer.wait().then(() => (second = true));
    await vi.advanceTimersByTimeAsync(DEFAULT_MIN_REQUEST_INTERVAL_MS);
    expect(second).toBe(true);
    vi.useRealTimers();
  });
});

describe("crawler identity", () => {
  it("carries a product token and a contact URL", () => {
    expect(CRAWLER_UA_SUFFIX).toContain(CRAWLER_PRODUCT_TOKEN);
    expect(CRAWLER_UA_SUFFIX).toMatch(/\(\+https?:\/\//);
  });
});
