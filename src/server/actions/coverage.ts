"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import { getCoverageReport, type SyncOptions } from "@/lib/coverage/sync";
import { buildCoverageSpec, renderSpecMarkdown } from "@lastest/coverage-model";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";
import type { CoverageSyncSummary } from "@/lib/coverage/sync-job";

// Type-only re-export (erased at compile time, so the "async exports only"
// rule for server-action modules is unaffected) — the coverage client imports
// the summary shape from here alongside the actions that produce it.
export type { CoverageSyncSummary };
import type { CoverageCellStatus } from "@/lib/db/schema";

// There is deliberately NO synchronous sync action here. One existed
// (`syncCoverageAction`) with no UI caller — the API's `fresh=1` and the
// tests call `syncCoverage` / `ensureFreshCoverage` from the library directly
// — which left it reachable only as a raw RPC: an authenticated user looping
// it held one request open per minutes-long sync (synchronous CSV parse, one
// UPDATE per cell) inside the shared web process. Anything click-driven goes
// through `startCoverageSyncAction` below, which is deduped and detached.

/**
 * Start a coverage sync as a background job and return immediately.
 *
 * The UI polls `getCoverageSyncStatusAction`. Same work, same idempotence —
 * the only difference is who waits for it. Deduped per repo inside
 * `startCoverageSyncJob`: a second click (or a coinciding scheduler tick)
 * joins the in-flight job instead of racing a duplicate sync through
 * reconcile/prune.
 */
export async function startCoverageSyncAction(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ jobId: string }> {
  await requireRepoAccess(repositoryId);
  const { startCoverageSyncJob } = await import("@/lib/coverage/sync-job");
  const { jobId } = await startCoverageSyncJob(repositoryId, opts);
  return { jobId };
}

/** Poll target for `startCoverageSyncAction`. */
export async function getCoverageSyncStatusAction(jobId: string): Promise<{
  status: string;
  isComplete: boolean;
  error?: string;
  summary?: CoverageSyncSummary;
  rejected?: Array<{ objectType: string; field: string; reason: string }>;
}> {
  const { requireBackgroundJobOwnership } =
    await import("@/lib/auth/ownership");
  await requireBackgroundJobOwnership(jobId);
  const job = await queries.getBackgroundJob(jobId);
  const meta = (job?.metadata ?? {}) as {
    summary?: CoverageSyncSummary;
    rejected?: Array<{ objectType: string; field: string; reason: string }>;
  };
  return {
    status: job?.status ?? "unknown",
    isComplete: job?.status === "completed" || job?.status === "failed",
    error: job?.error ?? undefined,
    summary: meta.summary,
    rejected: meta.rejected,
  };
}

// There are deliberately NO read-only report/trend/list actions here, and no
// profile-only action. Five existed (`profileCoverageDimensionsAction`,
// `getCoverageReportAction`, `getCoverageTrendAction`,
// `listCoverageDimensionsAction`, `listCoverageCellsAction`) with no caller
// anywhere in the repo: reads reach the same data through the Coverage page's
// server component (`src/app/(app)/coverage/page.tsx` calls the queries and
// `coverageReportFrom` directly) and through `GET /api/v1/repos/:id/coverage`
// and `/data-coverage`, and profiling only ever happens as one stage of a sync
// (`profileDimensions` is called by `syncCoverage`, not by a click). A
// `"use server"` export is a live POST endpoint for every signed-in user that
// has to be auth-reviewed forever, so an unused one is pure liability — the
// policy is to delete it and re-add it with its first real caller, next to that
// caller's authorization story.

/** The full test specification — scope, acceptance criteria, per-object-type
 *  coverage matrix, documented exclusions, ranked outstanding work. */
export async function getCoverageSpecAction(
  repositoryId: string,
  opts: SyncOptions = {},
) {
  await requireRepoAccess(repositoryId);
  const environmentKey = opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT;
  const [{ report, stop }, cells, dimensions] = await Promise.all([
    getCoverageReport(repositoryId, opts),
    queries.getCoverageCells(repositoryId, { environmentKey }),
    queries.getCoverageDimensions(repositoryId, environmentKey),
  ]);
  const spec = buildCoverageSpec({
    repositoryId,
    environmentKey,
    report,
    stop,
    cells,
    dimensions,
    policy: opts.stopPolicy,
  });
  // Stamped here, not in the builder — the builder stays deterministic so the
  // same inputs always render an identical document.
  spec.generatedAt = new Date().toISOString();
  return { spec, markdown: renderSpecMarkdown(spec) };
}

export async function setCoverageDimensionEnabledAction(
  repositoryId: string,
  dimensionId: string,
  enabled: boolean,
) {
  await requireRepoAccess(repositoryId);
  // The id is client-supplied; the access check above authorizes the REPO. The
  // query matches on both, so a dimension belonging to another team is a
  // no-match rather than a silent cross-tenant write.
  const ok = await queries.setCoverageDimensionEnabled(
    repositoryId,
    dimensionId,
    enabled,
  );
  if (!ok) throw new Error("Dimension not found for this repository");
  revalidatePath(`/coverage`);
}

// P4's profile-from-SUT flow (`profileFromSut` + the Vault/REST profilers in
// `@/lib/coverage/profilers`) intentionally has NO server action wrapper. The
// one that existed (`profileFromSutAction`) had no UI caller, took a
// user-supplied base URL, and drove outbound HTTP with the profilers' default
// raw `fetch` — no SSRF guard, live as an RPC for any signed-in user. When the
// UI grows a profiling flow it should reach the profilers through the SUT
// connectors (PR #126), whose `connectorFetch` re-validates every hop, and run
// as a background job rather than inside a held-open request.

/** Excluding a cell requires a reason — that reason is the artifact that lets
 *  the QA agent justify what it deliberately did not test. */
export async function setCoverageCellStatusAction(
  repositoryId: string,
  cellId: string,
  status: CoverageCellStatus,
  excludedReason?: string,
) {
  await requireRepoAccess(repositoryId);
  if (status === "excluded" && !excludedReason?.trim()) {
    throw new Error("An exclusion reason is required");
  }
  // Repo-scoped for the same reason as the dimension toggle above.
  const ok = await queries.setCoverageCellStatus(
    repositoryId,
    cellId,
    status,
    excludedReason?.trim(),
  );
  if (!ok) throw new Error("Cell not found for this repository");
  revalidatePath(`/coverage`);
}
