/**
 * Runtime verification for §3 "URL Diff" (core-plugin-refactor-test-plan.md,
 * P1 row — untouched by this refactor).
 *
 * `captureUrl()` claims a real EB, dispatches a synthetic Playwright test
 * through the SAME `command:run_test` runner-command queue the runners P1
 * test exercises, and persists real artefacts under
 * `storage/url-diffs/<jobId>/<side>/`. This file drives it against a local
 * HTTP server (like `browser.integration.test.ts`'s probe origin) for real,
 * then runs `buildUrlDiff()` — the pure diff engine — over the results.
 *
 * EB usage is kept to two claims: one real capture pair for the "changed"
 * case (two visibly different pages), and a "no-change" case built by
 * diffing one real capture against itself — a legitimate exercise of the
 * diff engine (same real captured data, zero live-EB cost) rather than a
 * second redundant claim of a resource four agents are sharing.
 *
 * Prerequisites: `pnpm dev` + `pnpm dev:pool` running. Run with
 * `pnpm test:integration`.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { rm } from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureUrl } from "@/lib/url-diff/capture";
import { buildUrlDiff } from "@/lib/url-diff/engine";
import { STORAGE_DIRS } from "@/lib/storage/paths";
import { getPoolStatus } from "@lastest/pool-service/client";

let server: http.Server;
let origin: string;
const jobIds: string[] = [];

async function waitForHeadroom(min: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getPoolStatus();
    const headroom = status ? status.max - status.size : 99;
    if (headroom >= min) return;
    if (Date.now() > deadline) throw new Error("pool never freed up headroom");
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/v2") {
      res.end(
        "<!doctype html><title>v2</title><body style='background:#c00;margin:0'><h1>Version Two — a very different page</h1><p>Extra content that was not here before.</p></body>",
      );
    } else {
      res.end(
        "<!doctype html><title>v1</title><body style='background:#fff;margin:0'><h1>Version One</h1></body>",
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const jobId of jobIds) {
    await rm(path.join(STORAGE_DIRS["url-diffs"], jobId), {
      recursive: true,
      force: true,
    }).catch(() => {});
    // captureUrl() copies from the executor's source screenshot dir but never
    // deletes it — the source is saved under storage/screenshots/<jobId>/
    // since jobId doubles as the synthetic repositoryId namespace (see
    // capture.ts's `repositoryId: opts.jobId`). Clean that up too.
    await rm(path.join(STORAGE_DIRS.screenshots, jobId), {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
});

describe("captureUrl + buildUrlDiff against a live EB", () => {
  it("no-change case: diffing a real capture against itself is clean", async () => {
    await waitForHeadroom(1, 60_000);
    const jobId = uuid();
    jobIds.push(jobId);

    const capture = await captureUrl({
      url: `${origin}/`,
      jobId,
      side: "a",
      timeoutMs: 60_000,
    });
    expect(capture.screenshotAbsPath).toBeTruthy();

    const diff = await buildUrlDiff(capture, capture, jobId);
    expect(diff.visual.percentageDifference).toBe(0);
    expect(diff.visual.pixelDifference).toBe(0);
    expect(diff.dom.summary).toBeTruthy();
    expect(diff.network.added).toHaveLength(0);
    expect(diff.network.removed).toHaveLength(0);
    expect(diff.a11y).toBeTruthy();
  }, 90_000);

  it("changed case: two visibly different pages produce a non-trivial diff", async () => {
    await waitForHeadroom(1, 60_000);
    const jobId = uuid();
    jobIds.push(jobId);

    const captureA = await captureUrl({
      url: `${origin}/`,
      jobId,
      side: "a",
      timeoutMs: 60_000,
    });

    await waitForHeadroom(1, 60_000);
    const captureB = await captureUrl({
      url: `${origin}/v2`,
      jobId,
      side: "b",
      timeoutMs: 60_000,
    });

    const diff = await buildUrlDiff(captureA, captureB, jobId);
    expect(diff.visual.pixelDifference).toBeGreaterThan(0);
    expect(diff.visual.percentageDifference).toBeGreaterThan(0);
    expect(diff.primaryHostA).toBe(diff.primaryHostB); // same host, same origin
    // Page-text diff should notice the added copy, when text capture succeeded.
    if (captureA.pageTextRelPath && captureB.pageTextRelPath) {
      expect(diff.text).toBeTruthy();
    }
  }, 150_000);
});
