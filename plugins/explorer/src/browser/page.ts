import type { DrivablePage } from "@lastest/contracts";

/**
 * What explorer does with the page core hands it.
 *
 * `core-scope.md` §5 draws the line here explicitly: core owns claim, release,
 * deadline, metering, credential injection and stream grants; `goto`, `click`
 * and DOM reads are orchestration and stay with the feature. So this file
 * exists — and it is deliberately *not* pushed into core, even though that
 * would be convenient, because the boundary was set on purpose.
 *
 * `ExplorerPage` is just `DrivablePage`, which resolves to Playwright's `Page`
 * for anything compiled alongside `@lastest/core-browser` — every build of this
 * repo. So the plugin gets full driver typing with no `playwright` entry in its
 * own manifest, and core keeps control of the driver version: an upgrade is one
 * core PR rather than twenty plugin PRs. Without core-browser in the program
 * the slot stays `unknown`, which fails closed rather than silently degrading.
 *
 * Spike S3 counted ~14 distinct Playwright operations across every direct-CDP
 * feature in the repo. This directory is explorer's share of them, and
 * `qa-agent` and `quickstart` will want the same ones — at which point it is
 * the seed of `libs/browser-kit`. It is not one yet: extracting a shared
 * abstraction from a single example is how you get an abstraction shaped like
 * one caller.
 */
export type ExplorerPage = DrivablePage;

export const ACTION_TIMEOUT_MS = 10_000;
export const SETTLE_TIMEOUT_MS = 5_000;
export const NAV_TIMEOUT_MS = 30_000;

/** Navigate and let SPA content render, without failing the run on a slow tail. */
export async function gotoAndSettle(
  page: ExplorerPage,
  url: string,
  settleMs = SETTLE_TIMEOUT_MS,
): Promise<void> {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  // `networkidle` is a best-effort hint, not a contract: an app with a polling
  // websocket never reaches it, and letting the timeout expire is the correct
  // outcome there rather than an error.
  await page
    .waitForLoadState("networkidle", { timeout: settleMs })
    .catch(() => {});
}
