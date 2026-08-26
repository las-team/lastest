import "server-only";

/**
 * Reads into the coverage feature, for callers that are not core.
 *
 * `src/lib/coverage` is still a pseudo-plugin (see the `coverage` entry in
 * `tools/architecture/boundaries.mjs`), and so is `qa-agent` — so the QA
 * agent's action calling `ensureFreshCoverage` directly is a
 * feature -> feature edge, the one shape the boundary rules forbid outright.
 * The agent genuinely needs it: planning against a data space that moved since
 * the last human visit to the Coverage page is the exact failure the freshness
 * check exists to prevent.
 *
 * `src/lib/core/` is the composition root — the one place allowed to reach
 * every feature — so the call routes through here, the same shape
 * `share-reads.ts` and `data-sources-reads.ts` already use for reads across a
 * boundary, and the same one `src/lib/core/scheduler.ts` uses for the other
 * caller of this function. When coverage becomes `plugins/coverage`, this file
 * is what the QA agent's host port method is filled from.
 *
 * The import is dynamic for the same reason the scheduler's is: this keeps the
 * coverage model, its profilers and its query layer out of the QA agent's
 * import graph on every request that never asks for a budget.
 */

export async function ensureCoverageFresh(
  repositoryId: string,
  opts: { environmentKey?: string } = {},
): Promise<Awaited<
  ReturnType<typeof import("@/lib/coverage/sync").ensureFreshCoverage>
> | null> {
  try {
    const { ensureFreshCoverage } = await import("@/lib/coverage/sync");
    return await ensureFreshCoverage(repositoryId, opts);
  } catch (error) {
    // A missing or unbuildable coverage model must never block a QA run —
    // the planner falls back to its fixed cap, which is what it did before a
    // coverage model existed at all.
    console.error(
      `[coverage-reads] freshness check failed for repo ${repositoryId}:`,
      error,
    );
    return null;
  }
}
