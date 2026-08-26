/**
 * Shims that must exist in the page before we inject any of *our* code into it.
 *
 * Playwright implements `page.evaluate(fn)` / `addInitScript(fn)` by calling
 * `fn.toString()` and evaluating that source inside the page. The source is
 * post-bundler, so anything the bundler injected into the function body has to
 * resolve in the page too — and esbuild's `keepNames` rewrites every named
 * function into a `__name(fn, "fn")` call so `fn.name` survives minification:
 *
 *     const helper = (x) => x + 1        ->  const helper = __name(x => x + 1, "helper")
 *     function named() {}                ->  function named() {} __name(named, "named")
 *
 * `__name` is a module-scope helper esbuild emits into the *Node* bundle. The
 * page never sees it, so every injected script that declares a named inner
 * function dies on `ReferenceError: __name is not defined`.
 *
 * This is not hypothetical or build-specific: tsx hard-codes `keepNames: true`
 * in its esbuild transform options with no opt-out, and tsx is how process-mode
 * EBs launch (`process-provisioner.ts`, the default provisioner in a dev
 * checkout). Under that provisioner every recording session died on the first
 * `browserRecordingScript` injection, and the inspector's selector extraction
 * (`selector-utils.ts`, 20+ named inner functions) failed the same way.
 *
 * The shim is an identity function — names are cosmetic once in the page.
 *
 * Deliberately a *string*, never a function: a function would itself be
 * serialised through `toString()` and could pick up the very rewrite it exists
 * to paper over.
 */

import type { BrowserContext, Page } from "playwright";

/** Assignment expression; idempotent, so re-running it is harmless. */
const SHIM_EXPRESSION =
  "globalThis.__name = globalThis.__name || function (fn) { return fn; }";

/** Statement form, for `addInitScript({ content })`. */
export const KEEP_NAMES_SHIM_SOURCE = `${SHIM_EXPRESSION};`;

/**
 * Expression form, for `page.evaluate(string)`. `void` keeps the completion
 * value undefined — returning the shim function itself would fail Playwright's
 * serialisation of the evaluate result.
 */
export const KEEP_NAMES_SHIM_EXPRESSION = `void (${SHIM_EXPRESSION})`;

/**
 * Contexts already carrying the init script. Re-attaching the recorder to a
 * context would otherwise stack a duplicate init script on every attach.
 */
const shimmedContexts = new WeakSet<BrowserContext>();

/**
 * Install the shim for every document created in `context` from now on. Call
 * immediately after `newContext()` and before `newPage()`: init scripts only
 * run for documents created after they are registered, and context-level
 * scripts run before page-level ones, so the shim lands ahead of anything else
 * we inject.
 */
export async function installKeepNamesShim(
  context: BrowserContext,
): Promise<void> {
  if (shimmedContexts.has(context)) return;
  shimmedContexts.add(context);
  try {
    await context.addInitScript({ content: KEEP_NAMES_SHIM_SOURCE });
  } catch (err) {
    // A closed context is not worth failing the caller over.
    shimmedContexts.delete(context);
    throw err;
  }
}

/**
 * Cover the document that is loaded *right now*, plus all future ones in the
 * same context. Needed when we inject into a page we did not create — e.g.
 * "record from here" attaches the recorder to the live debug page, whose
 * context (and current document) predate any shim of ours.
 */
export async function ensureKeepNamesShim(page: Page): Promise<void> {
  await installKeepNamesShim(page.context());
  // The current document may be `about:blank` or mid-navigation; a failure here
  // only means the next document (already covered by the init script above) is
  // the first one the caller can inject into.
  try {
    await page.evaluate(KEEP_NAMES_SHIM_EXPRESSION);
  } catch {
    // ignored — init script covers the next document
  }
}
