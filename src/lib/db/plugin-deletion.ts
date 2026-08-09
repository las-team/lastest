import type { DeletionTarget } from "@lastest/core-data";

import { getLogger } from "@/lib/logger";

/**
 * The one line `deleteTeam` and `deleteRepository` must not forget.
 *
 * ## Why it lives in the query layer, not at the call sites
 *
 * `queries.deleteTeam` has three call sites today (`account.ts`, `users.ts`,
 * and whatever the next one is); `queries.deleteRepository` has one. Adding a
 * hook call to each is a convention, and a convention is exactly what
 * `core-scope.md` §6 says is not good enough here — the failure is silent, and
 * the thing left behind is an encrypted credential belonging to a user who
 * asked to be deleted. Putting it inside the function that owns the delete
 * makes it structural: a new caller gets the cascade whether or not its author
 * has read this file.
 *
 * ## Why the import is dynamic
 *
 * `src/lib/db` is core (`tools/architecture/boundaries.mjs` → `CORE_SRC_PATHS`)
 * and `src/lib/core/runtime.ts` is the composition root that knows every
 * plugin. A static import would (a) make the query layer's module graph pull in
 * the kernel, the browser factory and every registered plugin — for every
 * module that touches `@/lib/db/queries`, which is nearly all of them — and (b)
 * close a genuine ESM cycle, because `runtime.ts` statically imports
 * `@/lib/db/queries`. Deferring the edge to call time avoids both. It costs one
 * module resolution on a code path that already runs a multi-table delete.
 *
 * The composition root is still the only place that knows plugins exist; this
 * module knows only that *something* wants to be told about deletions.
 *
 * ## Ordering: core first, plugins second
 *
 * The opposite order is tempting (delete the dependents, then the parent — what
 * a real cascade does) and it is wrong here, because there is no transaction
 * spanning both. Core's delete runs on the app's handle;
 * a plugin hook runs on the scoped handle `core/data` gave it. They cannot be
 * one atomic unit, so one of two failure modes has to be chosen:
 *
 * - **Plugins first:** core's delete then fails or rolls back → the team is
 *   still live and its `explorer_knowledge.cred_password` values are gone.
 *   Unrecoverable (the user cannot re-derive them) and unjustified (nothing was
 *   deleted from the user's point of view).
 * - **Core first:** a hook then fails → the tenant is gone and some plugin rows
 *   survive as orphans. Bad, but detectable, loudly logged, and repairable —
 *   hooks are documented idempotent, so re-running one fixes it.
 *
 * The second is strictly the better failure. It also makes "a plugin hook that
 * throws must not abort core's own deletion" true by construction rather than
 * by `try`/`catch` discipline.
 *
 * Consequently this function **never throws** and never returns a rejected
 * promise; `runPluginDeletion` catches and logs. Callers can `await` it without
 * guarding.
 */
export async function cascadePluginDeletion(
  target: DeletionTarget,
): Promise<void> {
  try {
    const { runPluginDeletion } = await import("@/lib/core/runtime");
    await runPluginDeletion(target);
  } catch (err) {
    // `runPluginDeletion` already catches everything it can reach. This only
    // fires if the composition root itself fails to load — which would take
    // account deletion down with it if it escaped.
    getLogger("plugin-deletion").error(
      { err, kind: target.kind, targetId: target.id },
      "plugin deletion cascade could not be loaded — plugin rows are orphaned",
    );
  }
}
