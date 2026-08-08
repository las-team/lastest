/**
 * Type-level proof that the `DrivablePage` slot is actually filled.
 *
 * This is not decoration. If `./page-type` were dropped — or the augmentation
 * stopped matching after a contracts edit — `session.page` would silently
 * degrade to `unknown` and every plugin's page call would stop being
 * type-checked, with no runtime symptom and no failing test. The
 * `@ts-expect-error` below fails the build if that happens.
 *
 * Checked by `pnpm types`, not vitest — there is nothing to run.
 */
import type { PluginContext } from "@lastest/contracts";
import type { Page } from "playwright";

import "./page-type";

declare const ctx: PluginContext<"browser">;

async function drives() {
  await ctx.browser.withBrowser({}, async (session) => {
    // Resolves to the real Playwright Page, in a file that never imports the
    // capability's implementation — which is the whole point: a plugin gets
    // full typing while core keeps control of the driver version.
    const page: Page = session.page;
    await page.goto("https://example.com");

    const isolated: Page = await session.isolatedPage();
    await isolated.click("#submit");

    // @ts-expect-error — a typo on a typed page must still be an error; if the
    // slot ever falls back to `unknown` this line stops erroring and fails.
    await page.gotoo("https://example.com");
  });
}
void drives;
