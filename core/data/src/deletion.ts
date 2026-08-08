import type { DeletionHook } from "@lastest/contracts";

/**
 * The cascade that the database no longer performs.
 *
 * `core-scope.md` §6 removes FKs from plugin tables to core tables, which
 * removes `ON DELETE CASCADE` with them. Deleting a team used to be one
 * statement; it is now a statement plus this loop. If this loop is not wired
 * into core's team/repo deletion path, "delete my account" silently leaves rows
 * behind — a GDPR problem that is invisible until someone audits it.
 *
 * `resolveRegistry` already refuses to boot a plugin that declares `schema`
 * without a hook. This is the other half: something has to actually call them.
 */

export interface DeletionTarget {
  readonly kind: "team" | "repo";
  readonly id: string;
}

export interface DeletablePlugin {
  readonly id: string;
  readonly deletion?: DeletionHook;
}

export interface DeletionFailure {
  readonly pluginId: string;
  readonly error: unknown;
}

export interface DeletionReport {
  readonly target: DeletionTarget;
  readonly ran: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly DeletionFailure[];
}

/**
 * Run every registered hook for one target.
 *
 * Three deliberate choices:
 *
 * - **Sequential, not parallel.** Deletion competes with live traffic for the
 *   same connection pool; twenty plugins deleting at once is a capacity
 *   incident, which is precisely what core exists to prevent.
 * - **One failure does not stop the rest.** A plugin whose hook throws must not
 *   prevent the other nineteen from cleaning up — partial deletion beats none.
 * - **Failures are returned, not thrown.** The caller decides whether to retry
 *   or alert. Hooks are documented as idempotent, so a retry is safe.
 */
export async function runDeletionHooks(
  plugins: readonly DeletablePlugin[],
  target: DeletionTarget,
): Promise<DeletionReport> {
  const ran: string[] = [];
  const skipped: string[] = [];
  const failed: DeletionFailure[] = [];

  for (const plugin of plugins) {
    const hook =
      target.kind === "team"
        ? plugin.deletion?.onTeamDeleted
        : plugin.deletion?.onRepoDeleted;
    if (!hook) {
      skipped.push(plugin.id);
      continue;
    }
    try {
      await hook.call(plugin.deletion, target.id);
      ran.push(plugin.id);
    } catch (error) {
      failed.push({ pluginId: plugin.id, error });
    }
  }

  return { target, ran, skipped, failed };
}
