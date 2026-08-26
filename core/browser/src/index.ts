/**
 * `@lastest/core-browser` — EB lifecycle.
 *
 * Core under `core-scope.md` §2 for **capacity** (a leaked or over-allocated EB
 * is stolen from every other tenant), **money** (run-minutes and plan-derived
 * hold limits) and **credentials** (storage state is resolved and injected
 * here, never handed to a plugin).
 *
 * Scope is deliberately lifecycle-only (§5). `goto`, `click`, DOM snapshots and
 * evidence accumulation are orchestration: the feature does them however it
 * likes, on the page core hands over. The honest form of the guarantee this
 * buys is:
 *
 *   > No plugin can leak, outlive, over-allocate, or escape the tenancy of an
 *   > EB.
 *
 * Not "no plugin can do anything unexpected in a browser" — `page.evaluate`
 * alone makes that false, and pretending otherwise would be theatre.
 */

// Must be first: fills the contract's `DrivablePage` slot with Playwright's
// `Page` for every consumer of this package.
import "./page-type";

export type { Page } from "./page-type";

export {
  createBrowserCapability,
  createBrowserFactory,
  type BrowserFactoryOptions,
  type BrowserScope,
  type CoreBrowserSession,
} from "./browser";

export {
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_DEADLINE_MS,
  MAX_HOLD_MS,
  maxHoldFor,
  type BrowserHost,
  type ClaimedEb,
  type HostClaimRequest,
} from "./host";

export {
  BrowserDeadlineExceededError,
  BrowserSessionClosedError,
  DeadlineExtensionRefusedError,
  NoBrowserAvailableError,
} from "./errors";

export { Deadline } from "./deadline";
