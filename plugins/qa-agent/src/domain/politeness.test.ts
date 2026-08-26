import { describe, it, expect, vi, afterEach } from "vitest";
import type { QaPage } from "./page";
import {
  applyUserAgentOverride,
  CrawlPacer,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
} from "./politeness";

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

  it("defaults to the swarm-wide floor", async () => {
    vi.useFakeTimers();
    const pacer = new CrawlPacer();
    let second = false;
    await pacer.wait();
    void pacer.wait().then(() => (second = true));
    await vi.advanceTimersByTimeAsync(DEFAULT_MIN_REQUEST_INTERVAL_MS - 10);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(second).toBe(true);
  });
});

/** Minimal Page stand-in: only the two paths applyUserAgentOverride touches. */
function fakePage(opts: { cdpFails?: boolean } = {}) {
  const sent: Array<{ method: string; params: unknown }> = [];
  const headers: Array<Record<string, string>> = [];
  const page = {
    context: () => ({
      newCDPSession: async () => {
        if (opts.cdpFails) throw new Error("no CDP");
        return {
          send: async (method: string, params: unknown) => {
            sent.push({ method, params });
          },
        };
      },
      setExtraHTTPHeaders: async (h: Record<string, string>) => {
        headers.push(h);
      },
    }),
  } as unknown as QaPage;
  return { page, sent, headers };
}

describe("applyUserAgentOverride", () => {
  it("applies the configured UA over CDP so navigator and headers agree", async () => {
    const { page, sent } = fakePage();
    await applyUserAgentOverride(page, "Mozilla/5.0 (Custom) Chrome/141");
    expect(sent).toEqual([
      {
        method: "Emulation.setUserAgentOverride",
        params: { userAgent: "Mozilla/5.0 (Custom) Chrome/141" },
      },
    ]);
  });

  it("leaves the stock browser UA alone when the setting is unset or blank", async () => {
    for (const value of [undefined, null, "", "   "]) {
      const { page, sent, headers } = fakePage();
      await applyUserAgentOverride(page, value);
      expect(sent).toEqual([]);
      expect(headers).toEqual([]);
    }
  });

  it("falls back to the request header when CDP is unavailable", async () => {
    const { page, headers } = fakePage({ cdpFails: true });
    await applyUserAgentOverride(page, "CustomAgent/2.0");
    expect(headers).toEqual([{ "User-Agent": "CustomAgent/2.0" }]);
  });

  it("never throws — a UA failure must not abort a crawl", async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => {
          throw new Error("no CDP");
        },
        setExtraHTTPHeaders: async () => {
          throw new Error("context closed");
        },
      }),
    } as unknown as QaPage;
    await expect(
      applyUserAgentOverride(page, "CustomAgent/2.0"),
    ).resolves.toBeUndefined();
  });
});
