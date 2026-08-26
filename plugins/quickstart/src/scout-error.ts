/**
 * Classifying why a scout step failed, and saying so actionably.
 *
 * A scout step can fail three ways, and they are not interchangeable to the
 * person reading the panel:
 *
 *   - **It never got a browser.** The pool was at capacity, or — far more
 *     often in a dev checkout — pods were provisioned but never became ready
 *     because the EB image was never imported. Only core can tell those apart
 *     (it needs pool health), so this case routes through
 *     `QuickstartHost.describeBrowserClaimFailure`.
 *   - **It got a browser and ran out of time.** `withBrowser` tore the session
 *     down at the deadline. The generic message names a duration but not the
 *     lever, and the lever is real: the deadline is `min(what the plugin asked
 *     for, what the plan allows)`, so on a small plan the fix is an upgrade and
 *     on a large one it is `SCOUT_DEADLINE_MS`.
 *   - **The AI loop itself failed.** Its own message is the best available.
 *
 * `kind` is returned alongside the text because the caller branches on it:
 * a scout that never got a browser is a different outcome from a scout that
 * ran and failed, and `qs_scout_authed` treats them differently (see
 * `actions.ts`).
 */

import type { BrowserErrorName } from "@lastest/contracts";

import type { QuickstartHost } from "./host";

/**
 * Matching on `err.name` rather than `instanceof`: the error classes live in
 * `@lastest/core-browser`, which is composition-root code this package may not
 * import. The annotation is what keeps that from being a bare string on both
 * sides — see `BrowserErrorName`'s own header in `@lastest/contracts`.
 */
const NO_BROWSER: BrowserErrorName = "NoBrowserAvailableError";
const DEADLINE_EXCEEDED: BrowserErrorName = "BrowserDeadlineExceededError";

export type ScoutFailureKind =
  /** Never got a browser. Nothing ran. */
  | "no_browser"
  /** Got a browser, exceeded the wall-clock budget, was torn down. */
  | "deadline"
  /** Got a browser; the AI loop failed on its own terms. */
  | "loop";

export interface ScoutFailure {
  kind: ScoutFailureKind;
  message: string;
}

export async function describeScoutError(
  host: QuickstartHost,
  err: unknown,
): Promise<ScoutFailure> {
  if (err instanceof Error && err.name === NO_BROWSER) {
    return {
      kind: "no_browser",
      message: await host
        .describeBrowserClaimFailure(err)
        .catch(() => err.message),
    };
  }
  if (err instanceof Error && err.name === DEADLINE_EXCEEDED) {
    return {
      kind: "deadline",
      message: `${err.message}. The scout ran too long — this budget is the smaller of what QuickStart asks for and what the team's plan allows, so an upgrade raises it.`,
    };
  }
  return {
    kind: "loop",
    message: err instanceof Error ? err.message : String(err),
  };
}
