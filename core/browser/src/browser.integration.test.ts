/**
 * Runtime verification for `core/browser` against a live Embedded Browser.
 *
 * The unit tests mock `chromium.connectOverCDP` and a `BrowserHost`, so they
 * prove the lifecycle *logic* and nothing about whether it works. This file
 * claims a real EB through the real pool service, drives real Chromium over
 * real CDP, and — the part that actually matters — checks the pool slot comes
 * back afterwards in each of the ways a claim can end.
 *
 * It exercises the **app's own host adapter** (`appBrowserHost`), not a
 * stand-in, so what is verified is the whole seam: core's policy, the app's
 * primitives, the pool service, and Chromium.
 *
 * Prerequisites:
 *   docker compose up -d   # host postgres
 *   pnpm dev:pool          # EB pool service (process provisioner)
 *   pnpm --filter @lastest/embedded-browser exec playwright install chromium
 *
 * Run with `pnpm test:integration`.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import type { Logger, Plan, TeamRef } from "@lastest/contracts";
import { getPoolStatus } from "@lastest/pool-service/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { runners, teams } from "@/lib/db/schema";
import { appBrowserHost } from "@/lib/core/browser-host";

import { createBrowserCapability } from "./browser";
import { BrowserDeadlineExceededError } from "./errors";

const noop = () => {};
const log: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  // A failed release is the one thing this suite must never swallow — it is
  // precisely the leak the package exists to prevent.
  error: (...args: unknown[]) => console.error("[core/browser]", ...args),
};

let team: TeamRef;
let server: http.Server;
let origin: string;

/**
 * Live busy EBs, read from the database the pool actually claims against.
 *
 * `claimPoolEB` flips `runners.status` to `busy` and `releasePoolEB` flips it
 * back, so this is the real ledger rather than an in-memory counter that would
 * happily agree with a buggy implementation.
 */
async function busyEbs(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runners)
    .where(
      and(
        eq(runners.isSystem, true),
        eq(runners.type, "embedded"),
        eq(runners.status, "busy"),
      ),
    );
  return row?.n ?? 0;
}

/** Free slots in the pool, from the service's own live-backend ledger. */
async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  // Service unreachable — let the claim itself produce the real error rather
  // than stalling here on a number we cannot read.
  return status ? status.max - status.size : 99;
}

/**
 * Wait for the pool to have room before claiming.
 *
 * Process mode is 1-job-1-EB: `releasePoolEB` tears the child process down
 * *asynchronously* (fire-and-forget) and a released EB is destroyed rather than
 * recycled. So a claim issued immediately after a release can find the ledger
 * still at its cap, fail to provision, and then poll until the full 5-minute
 * claim timeout expires — which is exactly what happened on the first re-run of
 * this suite (one test took 490s and failed).
 *
 * That is a property of the provisioner, not of `core/browser`: the release
 * itself is correct and prompt (`runners.status` is back to `online`
 * immediately, which `busyEbs` asserts). Gating here keeps the suite measuring
 * the lifecycle rather than teardown latency.
 */
beforeEach(async () => {
  await expect
    .poll(poolHeadroom, { timeout: 90_000, interval: 500 })
    .toBeGreaterThanOrEqual(2);
}, 120_000);

beforeAll(async () => {
  // A real team, so metering writes against a real row rather than a
  // fabricated id.
  const [row] = await db
    .select({ id: teams.id, plan: teams.plan })
    .from(teams)
    .limit(1);
  if (!row) throw new Error("no teams in the dev database — cannot verify");
  team = {
    id: row.id,
    name: "itest team",
    slug: "itest-team",
    plan: (row.plan as Plan) ?? "free",
    entitlements: new Set<string>(),
  };

  // A real origin, so the page has real localStorage — which is what makes the
  // `isolatedPage` seeding check meaningful. Bound to loopback: in process
  // mode the EB is a child process on this same host.
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>probe</title><h1 id=x>probe</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const capability = () =>
  createBrowserCapability(appBrowserHost, { team, log }, { maxSwarm: 2 });

/**
 * Bounded claim wait. The production default is 5 minutes, which is right for a
 * user waiting on a queue and wrong for a test: it turns "the pool is wedged"
 * into an eight-minute hang instead of a legible failure.
 */
const CLAIM = { claimTimeoutMs: 60_000 } as const;

describe("withBrowser against a live EB", () => {
  it("hands over a working page and releases the slot afterwards", async () => {
    const before = await busyEbs();

    const title = await capability().withBrowser(
      { ...CLAIM },
      async (session) => {
        await session.page.goto(origin, { waitUntil: "domcontentloaded" });
        return session.page.title();
      },
    );

    expect(title).toBe("probe");
    // The claim came back. This is the guarantee the package exists for, and
    // the one a unit test with a mocked host cannot make.
    await expect.poll(busyEbs, { timeout: 20_000 }).toBe(before);
  });

  it("releases the slot when the callback throws", async () => {
    const before = await busyEbs();

    await expect(
      capability().withBrowser({ ...CLAIM }, async (session) => {
        await session.page.goto(origin, { waitUntil: "domcontentloaded" });
        throw new Error("plugin blew up mid-run");
      }),
    ).rejects.toThrow("plugin blew up mid-run");

    await expect.poll(busyEbs, { timeout: 20_000 }).toBe(before);
  });

  it("tears down and releases when the deadline expires", async () => {
    const before = await busyEbs();

    await expect(
      capability().withBrowser(
        { ...CLAIM, deadlineMs: 3_000 },
        async (session) => {
          await session.page.goto(origin, { waitUntil: "domcontentloaded" });
          // A plugin that forgot its own timeout.
          await new Promise((r) => setTimeout(r, 60_000));
          return "never";
        },
      ),
    ).rejects.toBeInstanceOf(BrowserDeadlineExceededError);

    // Capacity has to be recovered on expiry, not when the callback settles —
    // it never will.
    await expect.poll(busyEbs, { timeout: 20_000 }).toBe(before);
  });

  it("gives the plugin no way to reach the pod", async () => {
    const shape = await capability().withBrowser(
      { ...CLAIM },
      async (session) => ({
        keys: Object.keys(session),
        id: session.id,
        streamUrl: session.streamUrl,
      }),
    );

    expect(JSON.stringify(shape)).not.toMatch(/cdpUrl|runnerId|9222|9232/);
    // The stream URL, when present, is a signed grant path — never a ws:// pod
    // address.
    if (shape.streamUrl) {
      expect(shape.streamUrl).toMatch(/^\/api\/embedded\/stream\/ws\?g=/);
    }
  });
});

describe("isolatedPage against a live EB", () => {
  it("mints extra contexts on ONE browser, seeded from the live state", async () => {
    const before = await busyEbs();

    const result = await capability().withBrowser(
      { ...CLAIM },
      async (session) => {
        await session.page.goto(origin, { waitUntil: "domcontentloaded" });
        // State produced by *this run*, never persisted anywhere — exactly the
        // case `storageStateId` cannot express.
        await session.page.evaluate(() =>
          localStorage.setItem("probe-token", "abc123"),
        );

        const isolated = await session.isolatedPage();
        await isolated.goto(origin, { waitUntil: "domcontentloaded" });
        const seeded = await isolated.evaluate(() =>
          localStorage.getItem("probe-token"),
        );

        // A second isolated context must not see writes made in the first —
        // otherwise "isolated" is a lie.
        await isolated.evaluate(() => localStorage.setItem("only-here", "1"));
        const second = await session.isolatedPage();
        await second.goto(origin, { waitUntil: "domcontentloaded" });
        const leaked = await second.evaluate(() =>
          localStorage.getItem("only-here"),
        );

        return { seeded, leaked };
      },
    );

    // The whole point of the §3.2 contract addition: the isolated context
    // starts already logged in.
    expect(result.seeded).toBe("abc123");
    expect(result.leaked).toBeNull();

    // Three pages, ONE pool slot. Under `withBrowserSwarm` this would have
    // been three EBs and three streams of run-minutes.
    await expect.poll(busyEbs, { timeout: 20_000 }).toBe(before);
  });

  it("closes every isolated context even when the callback throws", async () => {
    const before = await busyEbs();

    await expect(
      capability().withBrowser({ ...CLAIM }, async (session) => {
        const isolated = await session.isolatedPage();
        await isolated.goto(origin, { waitUntil: "domcontentloaded" });
        throw new Error("mid-crawl failure");
      }),
    ).rejects.toThrow("mid-crawl failure");

    await expect.poll(busyEbs, { timeout: 20_000 }).toBe(before);
  });
});

describe("withBrowserSwarm against live EBs", () => {
  it("returns settled results in order and releases every claim", async () => {
    const before = await busyEbs();

    const results = await capability().withBrowserSwarm(
      { ...CLAIM, count: 2 },
      async (session, i) => {
        await session.page.goto(origin, { waitUntil: "domcontentloaded" });
        if (i === 1) throw new Error("branch 1 failed");
        return session.page.title();
      },
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    await expect.poll(busyEbs, { timeout: 30_000 }).toBe(before);
  });
});
