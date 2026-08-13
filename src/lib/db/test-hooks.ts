/**
 * Domain notifications the query layer raises, and nothing more.
 *
 * ### Why this file exists
 *
 * `createTest()` used to end with:
 *
 * ```ts
 * import("@/lib/gamification/hooks").then((m) => m.onTestCreated(id, …))
 * ```
 *
 * — core reaching into a feature. That is the one direction §3 of
 * `docs/architecture/core-plugin-refactor.md` forbids outright ("core must not
 * know a plugin exists"), and it was invisible to `pnpm arch`, which walks
 * *plugin* imports rather than core's. The dynamic `import()` was not hiding
 * it deliberately — it was there to break a module-eval cycle
 * (queries → hooks → auth → queries) — but the effect was the same: the
 * strongest coupling in the gamification feature was the one nothing counted.
 *
 * So the dependency is inverted. Core declares the port; whoever owns features
 * fills it. `src/lib/core/runtime.ts` (the composition root, the one place
 * allowed to know both sides) registers the gamification plugin's listener
 * inside `getPluginRuntime()`, which `src/instrumentation.ts` already awaits at
 * boot for exactly this class of wiring.
 *
 * ### Why a listener rather than moving the call to the callers
 *
 * `createTest` has ~30 call sites. Threading "and also award points" through
 * every one of them would be a rewrite (RFC §2 says this is a move, not a
 * rewrite) and would silently drop attribution wherever one was missed. One
 * registration point is both smaller and safer.
 *
 * ### The failure mode, stated
 *
 * If nothing registers, `notifyTestCreated` is a no-op — no award, no error.
 * That is the same outcome the old dynamic `import()` produced when it threw
 * (it ended in `.catch(() => {})`), so this is not a new silent path. It is
 * bounded by `getPluginRuntime()` running at boot before any request.
 */

import type { BotKind } from "./schema";

export interface TestCreatedEvent {
  readonly testId: string;
  /** Creator supplied by the caller, if it already knew one. */
  readonly createdByUserId: string | null;
  readonly createdByBotId: string | null;
  /**
   * "This test was authored by the <kind> agent" — for callers that know
   * *which* agent they are but not its per-team row id.
   *
   * Added so agent features do not have to resolve a bot id themselves. A bot
   * row is gamification's data; before this, `qa-agent`, `play-agent` and the
   * v1 API each called `getBotByKind()` to turn an agent kind into an id, and
   * once gamification became a package those calls would have been four
   * feature→feature imports. The listener resolves it now, on the side of the
   * boundary that owns the table.
   */
  readonly createdByAgent: BotKind | null;
}

export type TestCreatedListener = (event: TestCreatedEvent) => Promise<void>;

let listener: TestCreatedListener | null = null;

/**
 * Register the single listener. Called by the composition root; passing `null`
 * unregisters, which is only useful in tests.
 */
export function setTestCreatedListener(fn: TestCreatedListener | null): void {
  listener = fn;
}

/**
 * Fire-and-forget. Deliberately not awaited by `createTest` and deliberately
 * swallowing errors: test creation is a real business flow and a scoring
 * side-effect must never be able to fail it or slow it down.
 */
export function notifyTestCreated(event: TestCreatedEvent): void {
  listener?.(event).catch((err) => {
    console.error("[test-hooks] onTestCreated listener failed", err);
  });
}
