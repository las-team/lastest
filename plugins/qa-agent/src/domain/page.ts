import type { DrivablePage } from "@lastest/contracts";

/**
 * The page QA Agent drives, and where it comes from.
 *
 * Before this migration `crawl.ts`, `explore.ts` and `auth.ts` each took a
 * `cdpUrl: string` and called `chromium.connectOverCDP(cdpUrl)` themselves.
 * Those were three of the six direct-CDP call sites RFC §1.1 named as the
 * concrete instance of what R4 forbids, and the last three still standing.
 * They now take a `QaPage` that core claimed, injected credentials into,
 * metered and will close — the plugin never sees a pod address and cannot
 * outlive or leak an EB.
 *
 * `QaPage` is `DrivablePage`, which resolves to Playwright's `Page` for
 * anything compiled alongside `@lastest/core-browser` — every build of this
 * repo — so the plugin gets full driver typing with no `playwright` entry in
 * its own manifest. Without core-browser in the program the slot stays
 * `unknown`, which fails closed.
 *
 * **This is the second caller `plugins/explorer/src/browser/page.ts` predicted**
 * ("`qa-agent` and `quickstart` will want the same ones — at which point it is
 * the seed of `libs/browser-kit`"). `gotoAndSettle` below is byte-for-byte the
 * shape explorer already has. It is deliberately duplicated rather than
 * promoted here, for recipe §5's reason: a promotion done *inside* a migration
 * turns into a host-port method or an ad-hoc package shaped like whoever moved
 * last. `libs/browser-kit` is now a two-caller case with a concrete surface —
 * the ~6 operations both files share — and wants its own pass.
 */
export type QaPage = DrivablePage;

export const PAGE_NAV_TIMEOUT_MS = 30_000;
export const PAGE_SETTLE_TIMEOUT_MS = 8_000;

/** Navigate, then give the page a bounded chance to settle before scraping it. */
export async function gotoAndSettle(
  page: QaPage,
  url: string,
  settleMs = PAGE_SETTLE_TIMEOUT_MS,
): Promise<void> {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_NAV_TIMEOUT_MS,
  });
  await page
    .waitForLoadState("networkidle", { timeout: settleMs })
    .catch(() => {});
}
