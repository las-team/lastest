import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import type { BrowserSession, Plan, TeamRef } from "@lastest/contracts";

import { createBrowserCapability, resolveSessionCdpUrl } from "./browser";
import {
  BrowserDeadlineExceededError,
  DeadlineExtensionRefusedError,
  NoBrowserAvailableError,
} from "./errors";
import { MAX_HOLD_MS, type BrowserHost, type ClaimedEb } from "./host";

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: vi.fn() },
}));

const connectOverCDP = vi.mocked(chromium.connectOverCDP);

function fakeBrowser() {
  const page = { setViewportSize: vi.fn(async () => {}), name: "default-page" };
  const isolatedPages: unknown[] = [];
  const closedContexts: string[] = [];
  const defaultContext = {
    pages: () => [page],
    newPage: vi.fn(async () => page),
    storageState: vi.fn(async () => ({ cookies: ["session=abc"] })),
    close: vi.fn(async () => {
      closedContexts.push("default");
    }),
  };
  const newContext = vi.fn(async (opts?: unknown) => {
    const p = { name: `isolated-${isolatedPages.length}`, opts };
    isolatedPages.push(p);
    const ctx = {
      newPage: vi.fn(async () => p),
      close: vi.fn(async () => {
        closedContexts.push(`isolated-${isolatedPages.indexOf(p)}`);
      }),
      pages: () => [p],
      storageState: vi.fn(async () => ({})),
    };
    return ctx;
  });
  const browser = {
    contexts: () => [defaultContext],
    newContext,
    close: vi.fn(async () => {}),
  };
  return { browser, page, defaultContext, newContext, closedContexts };
}

function makeHost(overrides: Partial<BrowserHost> = {}) {
  const claimed: ClaimedEb = {
    runnerId: "runner-1",
    cdpUrl: "http://10.0.0.5:9232",
    streamUrl: "ws://10.0.0.5:9223",
    instanceId: "inst-1",
  };
  const host: BrowserHost = {
    claim: vi.fn(async () => claimed),
    release: vi.fn(async () => {}),
    assertRunMinutes: vi.fn(async () => {}),
    applyAuth: vi.fn(async () => true),
    streamGrant: vi.fn(() => "/api/embedded/stream/ws?g=signed"),
    ...overrides,
  };
  return host;
}

const log = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const teamOn = (plan: Plan): TeamRef => ({
  id: "t1",
  name: "T1",
  slug: "t1",
  plan,
  entitlements: new Set(),
});

const scope = { team: teamOn("pro"), log };

beforeEach(() => {
  vi.clearAllMocks();
  connectOverCDP.mockImplementation(async () => fakeBrowser().browser as never);
});

describe("withBrowser", () => {
  it("hands the plugin a page and a signed stream grant, never an address", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    const seen = await cap.withBrowser({}, async (session) => ({
      hasPage: session.page !== undefined,
      streamUrl: session.streamUrl,
      keys: Object.keys(session),
    }));

    expect(seen.hasPage).toBe(true);
    expect(seen.streamUrl).toBe("/api/embedded/stream/ws?g=signed");
    // The one property a plugin must never be able to reach: anything that
    // would let it talk to the pod directly, or release someone else's claim.
    expect(JSON.stringify(seen.keys)).not.toContain("cdp");
    expect(JSON.stringify(seen.keys)).not.toContain("runner");
  });

  it("releases the EB when the callback throws", async () => {
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    await expect(
      cap.withBrowser({}, async () => {
        throw new Error("plugin blew up");
      }),
    ).rejects.toThrow("plugin blew up");

    expect(host.release).toHaveBeenCalledWith("runner-1");
  });

  it("releases the EB when connecting to it fails", async () => {
    // A claim that is never connected is still a claim. Leaking here would
    // burn a pool slot until the reaper noticed.
    connectOverCDP.mockRejectedValue(new Error("ECONNREFUSED"));
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    await expect(
      cap.withBrowser({}, async () => "unreachable"),
    ).rejects.toThrow("ECONNREFUSED");
    expect(host.release).toHaveBeenCalledWith("runner-1");
  });

  it("checks run minutes before claiming, not after", async () => {
    // An out-of-budget team must never occupy a pool slot it cannot pay for.
    const order: string[] = [];
    const host = makeHost({
      assertRunMinutes: vi.fn(async () => {
        order.push("assert");
        throw new Error("out of run minutes");
      }),
      claim: vi.fn(async () => {
        order.push("claim");
        return null;
      }),
    });
    const cap = createBrowserCapability(host, scope);

    await expect(cap.withBrowser({}, async () => 1)).rejects.toThrow(
      "out of run minutes",
    );
    expect(order).toEqual(["assert"]);
    expect(host.claim).not.toHaveBeenCalled();
  });

  it("throws NoBrowserAvailableError when the pool is full", async () => {
    const host = makeHost({ claim: vi.fn(async () => null) });
    const cap = createBrowserCapability(host, scope);
    await expect(cap.withBrowser({}, async () => 1)).rejects.toBeInstanceOf(
      NoBrowserAvailableError,
    );
    expect(host.release).not.toHaveBeenCalled();
  });

  it("resolves auth host-side from an id, so no credential reaches the plugin", async () => {
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);
    await cap.withBrowser({ storageStateId: "ss-42" }, async () => 1);
    expect(host.applyAuth).toHaveBeenCalledWith(
      "http://10.0.0.5:9232",
      "ss-42",
      "t1",
    );
  });

  it("degrades to an unauthenticated browser when injection fails, and says so", async () => {
    const host = makeHost({
      applyAuth: vi.fn(async () => {
        throw new Error("bad storage state");
      }),
    });
    const cap = createBrowserCapability(host, scope);
    await expect(
      cap.withBrowser({ storageStateId: "ss-42" }, async () => "still ran"),
    ).resolves.toBe("still ran");
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("deadline", () => {
  it("tears down and releases when the deadline expires", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    await expect(
      cap.withBrowser({ deadlineMs: 20 }, async () => {
        // A plugin that forgot its own timeout.
        await new Promise((r) => setTimeout(r, 5_000));
        return "never";
      }),
    ).rejects.toBeInstanceOf(BrowserDeadlineExceededError);

    // The capacity is what has to come back, and it has to come back before
    // the callback's promise settles — it never will.
    expect(browser.close).toHaveBeenCalled();
    expect(host.release).toHaveBeenCalledWith("runner-1");
  });

  it("clamps a plugin-supplied deadline to the plan's ceiling", async () => {
    // Holding shared capacity longer than the plan allows is a money decision,
    // so an over-large `deadlineMs` is clamped rather than honoured.
    const host = makeHost();
    const cap = createBrowserCapability(host, { team: teamOn("free"), log });

    const start = Date.now();
    await expect(
      cap.withBrowser({ deadlineMs: 10 * MAX_HOLD_MS.free }, async (s) => {
        // free's ceiling is 5 min; asking to extend past it must be refused
        // even though the requested deadline was far larger.
        await s.extendDeadline(MAX_HOLD_MS.free);
        return "no";
      }),
    ).rejects.toBeInstanceOf(DeadlineExtensionRefusedError);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("allows an extension that stays inside the plan budget", async () => {
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);
    const extended = await cap.withBrowser({ deadlineMs: 1_000 }, async (s) =>
      s.extendDeadline(1_000),
    );
    expect(extended).toBeGreaterThan(Date.now());
  });
});

describe("isolatedPage", () => {
  it("mints extra contexts inside the same EB, seeded from the live state", async () => {
    // This is the cheap shape for a crawler: N contexts, one pool slot. The
    // seed comes from the default context's *current* state, which is what a
    // persisted storageStateId cannot express.
    const fake = fakeBrowser();
    connectOverCDP.mockResolvedValue(fake.browser as never);
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    const pages = await cap.withBrowser({}, async (session) => [
      await session.isolatedPage(),
      await session.isolatedPage(),
    ]);

    expect(pages).toHaveLength(2);
    expect(fake.defaultContext.storageState).toHaveBeenCalledTimes(2);
    expect(fake.newContext).toHaveBeenCalledWith({
      storageState: { cookies: ["session=abc"] },
    });
    // One claim, not three.
    expect(host.claim).toHaveBeenCalledTimes(1);
  });

  it("closes every isolated context at teardown, including on throw", async () => {
    const fake = fakeBrowser();
    connectOverCDP.mockResolvedValue(fake.browser as never);
    const cap = createBrowserCapability(makeHost(), scope);

    await expect(
      cap.withBrowser({}, async (session) => {
        await session.isolatedPage();
        throw new Error("mid-crawl failure");
      }),
    ).rejects.toThrow("mid-crawl failure");

    expect(fake.closedContexts).toContain("isolated-0");
  });

  it("refuses to mint a page after the scope has ended", async () => {
    const cap = createBrowserCapability(makeHost(), scope);
    const escaped = await cap.withBrowser({}, async (session) => session);
    await expect(escaped.isolatedPage()).rejects.toThrow(/closed/i);
  });
});

describe("withBrowserSwarm", () => {
  it("returns settled results in input order", async () => {
    const cap = createBrowserCapability(makeHost(), scope);
    const results = await cap.withBrowserSwarm({ count: 3 }, async (_s, i) => {
      if (i === 1) throw new Error("scenario 1 failed");
      return `ok-${i}`;
    });

    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    // Partial progress is the normal useful outcome for a crawler — one branch
    // failing must not cancel the others.
    expect((results[2] as PromiseFulfilledResult<string>).value).toBe("ok-2");
  });

  it("clamps count to the configured ceiling and says it did", async () => {
    const host = makeHost();
    const cap = createBrowserCapability(host, scope, { maxSwarm: 2 });
    await cap.withBrowserSwarm({ count: 50 }, async () => "ok");
    expect(host.claim).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 50, granted: 2 }),
      expect.stringContaining("clamped"),
    );
  });

  it("releases every claim, including branches that threw", async () => {
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);
    await cap.withBrowserSwarm({ count: 2 }, async () => {
      throw new Error("nope");
    });
    expect(host.release).toHaveBeenCalledTimes(2);
  });

  it("reports a branch that never got a browser without failing the rest", async () => {
    let n = 0;
    const host = makeHost({
      claim: vi.fn(async () => {
        n += 1;
        return n === 1
          ? {
              runnerId: "runner-1",
              cdpUrl: "http://10.0.0.5:9232",
              streamUrl: null,
              instanceId: null,
            }
          : null;
      }),
    });
    const cap = createBrowserCapability(host, scope);
    const results = await cap.withBrowserSwarm({ count: 2 }, async () => "ok");

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      NoBrowserAvailableError,
    );
  });
});

describe("resolveSessionCdpUrl — the browserTools boundary", () => {
  it("resolves a live session for the composition root, while the session itself still carries no address", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const cap = createBrowserCapability(makeHost(), scope);

    const seen = await cap.withBrowser({}, async (session) => ({
      resolved: resolveSessionCdpUrl(session),
      serialized: JSON.stringify(session),
    }));

    expect(seen.resolved).toBe("http://10.0.0.5:9232");
    // The plugin holds the same object and still cannot read the address off
    // it — only this module's WeakMap can turn one into the other.
    expect(seen.serialized).not.toContain("10.0.0.5");
  });

  it("stops resolving once the withBrowser scope has ended", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const cap = createBrowserCapability(makeHost(), scope);

    const escaped = await cap.withBrowser({}, async (session) => session);

    // A session smuggled out of its scope is exactly the case that must not
    // hand a live pod address to a later AI call.
    expect(resolveSessionCdpUrl(escaped)).toBeUndefined();
  });

  it("stops resolving after the deadline tears the session down", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const cap = createBrowserCapability(makeHost(), scope);

    let captured: BrowserSession | undefined;
    await expect(
      cap.withBrowser({ deadlineMs: 20 }, async (session) => {
        captured = session;
        await new Promise((r) => setTimeout(r, 200));
        return "never";
      }),
    ).rejects.toBeInstanceOf(BrowserDeadlineExceededError);

    expect(captured).toBeDefined();
    expect(resolveSessionCdpUrl(captured!)).toBeUndefined();
  });

  it("resolves nothing for a forged session object", () => {
    // No string a plugin can construct is a key here: the WeakMap is keyed by
    // the object identity core minted, not by the session id.
    const forged = {
      id: "whatever",
      page: {},
      streamUrl: null,
      authApplied: false,
      extendDeadline: async () => 0,
      isolatedPage: async () => ({}),
    } as unknown as BrowserSession;
    expect(resolveSessionCdpUrl(forged)).toBeUndefined();
  });
});

describe("authApplied", () => {
  it("is false when no storage state was requested", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const host = makeHost();
    const cap = createBrowserCapability(host, scope);

    const applied = await cap.withBrowser({}, async (s) => s.authApplied);

    expect(applied).toBe(false);
    expect(host.applyAuth).not.toHaveBeenCalled();
  });

  it("reports what the host actually applied, not what was asked for", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const host = makeHost({ applyAuth: vi.fn(async () => false) });
    const cap = createBrowserCapability(host, scope);

    const applied = await cap.withBrowser(
      { storageStateId: "ss-1" },
      async (s) => s.authApplied,
    );

    // The claim still succeeds — degrading to an unauthenticated browser is
    // the established behaviour — but the feature can tell.
    expect(applied).toBe(false);
  });

  it("is false when injection throws, rather than propagating", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const host = makeHost({
      applyAuth: vi.fn(async () => {
        throw new Error("EB refused the cookie jar");
      }),
    });
    const cap = createBrowserCapability(host, scope);

    const applied = await cap.withBrowser(
      { storageStateId: "ss-1" },
      async (s) => s.authApplied,
    );

    expect(applied).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it("is true when the host applied it", async () => {
    const { browser } = fakeBrowser();
    connectOverCDP.mockResolvedValue(browser as never);
    const cap = createBrowserCapability(makeHost(), scope);

    const applied = await cap.withBrowser(
      { storageStateId: "ss-1" },
      async (s) => s.authApplied,
    );

    expect(applied).toBe(true);
  });
});
