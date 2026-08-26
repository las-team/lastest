import type { Page } from "playwright";

/**
 * Fill the contract's page slot with the real Playwright `Page`.
 *
 * This is the whole mechanism behind "plugins get full typing from core without
 * depending on the driver". `@lastest/contracts` declares
 * `DrivablePageTypeMap` with `default: unknown`; this augmentation replaces it
 * for every compilation that includes `@lastest/core-browser`, which is every
 * build of this repo.
 *
 * Keep this in its own module. Merged into a file with runtime exports it would
 * be easy to delete by accident while "cleaning up unused imports", and the
 * failure mode is silent: `session.page` quietly degrades to `unknown` and
 * every plugin's page call stops being type-checked.
 */
declare module "@lastest/contracts" {
  interface DrivablePageTypeMap {
    default: Page;
  }
}

export type { Page };
