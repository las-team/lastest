import "server-only";

import {
  readLiveExplorerSession,
  type ExplorerFleetSession,
} from "@lastest/plugin-explorer";
import { getLogger } from "@/lib/logger";

const log = getLogger("ExplorerReads");

/**
 * Reverse read into the `explorer` plugin's own sessions, for the Agents
 * console.
 *
 * The mirror image of `share-reads.ts`, for the same reason: the console lists
 * every agent working a repo, the Explorer is one of them, and
 * `explorer_sessions` is not a table core may select from (`core-scope.md` §6).
 * `src/lib/core/` is the one place in `src/` that legitimately imports plugins,
 * so the read crosses here and nowhere else.
 *
 * What comes back is a projection, not the row — the plugin decides what core
 * is allowed to know (`plugins/explorer/src/fleet.ts` explains why, including
 * the encrypted credential the row carries and this one does not).
 *
 * Like `share-reads.ts` this deliberately does NOT import `./runtime`: the
 * plugin resolves its own wiring, and `src/instrumentation.ts` awaits
 * `getPluginRuntime()` before the server serves a request, so by the time a
 * page calls this the explorer's wiring is already in place. If it somehow is
 * not, the console must still render — an agent roster missing one row beats a
 * 500 — so the failure is swallowed to `null` here rather than at every call
 * site.
 */
export type { ExplorerFleetSession };

export async function getLiveExplorerSession(
  repositoryId: string,
): Promise<ExplorerFleetSession | null> {
  try {
    return await readLiveExplorerSession(repositoryId);
  } catch (err) {
    log.warn(
      { err, repositoryId },
      "explorer fleet read failed; roster will show the Explorer as idle",
    );
    return null;
  }
}
