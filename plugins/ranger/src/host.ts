/**
 * The core surface ranger needs and core does not have yet.
 *
 * One method. `assertSafeOutboundUrl` is the SSRF guard on an operator-
 * supplied target URL — a boundary under `core-scope.md` §2 by any reading,
 * and this is the **fourth** plugin to declare it verbatim after `explorer`,
 * `app-map` and `api-test`. A `core/security` PR retiring this one method
 * would retire it in four plugins at once; see
 * `docs/architecture/plugin-migration-recipe.md` §1.5.
 *
 * Shaped as "do the thing" rather than "give me the primitive"
 * (recipe §3.1): the plugin has no `fetch`/`connect` of its own to forget the
 * check before, so there is nothing in the package to bypass it *with*.
 */
export interface RangerHost {
  /** Rejects with a human-readable message when the URL is unsafe. */
  assertSafeOutboundUrl(url: string): Promise<void>;
}
