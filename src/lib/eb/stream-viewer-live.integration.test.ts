/**
 * Runtime verification for §3 "EB stream viewer / live embedded browser view"
 * (core-plugin-refactor-test-plan.md, P0 row).
 *
 * `src/lib/eb/stream-grant.test.ts` and `src/lib/eb/front-proxy.test.ts`
 * already cover the crypto layer (grant validity/expiry/tamper) and a
 * spawned front-proxy instance talking to a *stub* EB stream endpoint. What
 * neither covers, and what this file adds: claiming a REAL EB from the live
 * pool service, minting its grant through the real `toProxyStreamUrl()` /
 * `claimEmbeddedBrowserForAgent()` code path (not a hand-built payload), and
 * driving the WebSocket upgrade against the app's OWN already-running
 * front-proxy at :3000 — not a disposable proxy instance spun up for the
 * test. This is the actual seam a live viewer session rides.
 *
 * Prerequisites: `pnpm dev` (app on :3000) and `pnpm dev:pool` both running.
 * Run with `pnpm test:integration`.
 */
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimEmbeddedBrowserForAgent } from "@/lib/eb/claim-for-agent";
import { releasePoolEB } from "@/server/actions/embedded-sessions";
import { toProxyStreamUrl } from "@/lib/eb/stream-url";
import { signStreamGrant } from "@/lib/eb/stream-grant";
import { getPoolStatus } from "@lastest/pool-service/client";

const APP_ORIGIN = process.env.LASTEST_URL || "http://localhost:3000";
const WS_ORIGIN = APP_ORIGIN.replace(/^http/, "ws");

async function poolHeadroom(): Promise<number> {
  const status = await getPoolStatus();
  return status ? status.max - status.size : 99;
}

/** Manual poll (not `expect.poll`, which vitest restricts to inside a test —
 *  this needs to run in `beforeAll`). */
async function waitForHeadroom(min: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await poolHeadroom()) >= min) return;
    if (Date.now() > deadline) throw new Error("pool never freed up headroom");
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Open a WS through the live front-proxy; resolves on 'open', rejects with
 *  the `ws` library's error (carries the HTTP status on a non-101 reject). */
function tryConnect(path: string, timeoutMs = 10_000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_ORIGIN}${path}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("connect timeout"));
    }, timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let claimed: Awaited<ReturnType<typeof claimEmbeddedBrowserForAgent>>;

beforeAll(async () => {
  await waitForHeadroom(1, 90_000);

  // No billTeamId: this test claims purely to exercise the stream path, not
  // to bill run-minutes against any team.
  claimed = await claimEmbeddedBrowserForAgent(60_000);
  if (!claimed) throw new Error("could not claim a real EB from the pool");
}, 120_000);

afterAll(async () => {
  if (claimed) await releasePoolEB(claimed.runnerId).catch(() => {});
});

describe("live EB stream viewer, end to end through the running front-proxy", () => {
  it("connects through :3000 to the claimed pod's real stream port with a grant minted by toProxyStreamUrl()", async () => {
    expect(claimed!.streamUrl).toMatch(/^wss?:\/\//); // raw pod address, pre-proxy
    const proxied = toProxyStreamUrl(
      claimed!.streamUrl,
      "",
      claimed!.instanceId,
    );
    expect(proxied).toMatch(/^\/api\/embedded\/stream\/ws\?g=/);

    const ws = await tryConnect(proxied!);
    try {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
    }
  }, 20_000);

  it("rejects an upgrade whose grant TTL has expired", async () => {
    // Same real pod address and instanceId as the live claim above, but
    // signed with an already-past expiry — exercises the exact code path
    // toProxyStreamUrl() uses, just with a manually-forced TTL.
    const url = new URL(claimed!.streamUrl);
    const savedTtl = process.env.EB_STREAM_GRANT_TTL_SECONDS;
    process.env.EB_STREAM_GRANT_TTL_SECONDS = "-1"; // parses as NaN-guarded → falls back... see below
    let expiredGrant: string | null;
    try {
      // signStreamGrant clamps a non-positive/NaN TTL back to the 1800s
      // default (see grantTtlMs()), so force expiry by minting normally, then
      // shift time doesn't exist — instead sign with a 1-second TTL and wait.
      process.env.EB_STREAM_GRANT_TTL_SECONDS = "1";
      expiredGrant = signStreamGrant(
        url.hostname,
        parseInt(url.port || "9223", 10),
        "expiry-test",
        claimed!.instanceId ?? "",
      );
    } finally {
      if (savedTtl === undefined)
        delete process.env.EB_STREAM_GRANT_TTL_SECONDS;
      else process.env.EB_STREAM_GRANT_TTL_SECONDS = savedTtl;
    }
    expect(expiredGrant).toBeTruthy();

    await new Promise((r) => setTimeout(r, 1_200)); // let the 1s TTL lapse

    await expect(
      tryConnect(
        `/api/embedded/stream/ws?g=${encodeURIComponent(expiredGrant!)}`,
      ),
    ).rejects.toThrow(/403/);
  }, 20_000);
});
