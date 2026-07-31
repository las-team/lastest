"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import {
  getCoverageReport,
  profileDimensions,
  syncCoverage,
  type SyncOptions,
} from "@/lib/coverage/sync";
import { DEFAULT_COVERAGE_ENVIRONMENT } from "@/lib/db/schema";
import type { CoverageCellStatus } from "@/lib/db/schema";

/** Full pass: profile sources, derive occurring cells, attribute historical
 *  runs, recompute weights. Safe to re-run — every step is idempotent. */
export async function syncCoverageAction(
  repositoryId: string,
  opts: SyncOptions = {},
) {
  await requireRepoAccess(repositoryId);
  const result = await syncCoverage(repositoryId, opts);
  revalidatePath(`/coverage`);
  return result;
}

/** Profile only — proposes dimensions without deriving cells. Lets the user
 *  confirm which columns are real dimensions before the cell space is built. */
export async function profileCoverageDimensionsAction(
  repositoryId: string,
  opts: SyncOptions = {},
) {
  await requireRepoAccess(repositoryId);
  const { proposed, rejected, runsScanned } = await profileDimensions(
    repositoryId,
    opts,
  );
  revalidatePath(`/coverage`);
  return {
    proposed: proposed.length,
    rejected: rejected.map((r) => ({
      objectType: r.objectType,
      field: r.field,
      reason: r.rejectedReason ?? "rejected",
    })),
    runsScanned,
  };
}

export async function getCoverageReportAction(
  repositoryId: string,
  opts: SyncOptions = {},
) {
  await requireRepoAccess(repositoryId);
  return getCoverageReport(repositoryId, opts);
}

export async function listCoverageDimensionsAction(
  repositoryId: string,
  environmentKey: string = DEFAULT_COVERAGE_ENVIRONMENT,
) {
  await requireRepoAccess(repositoryId);
  return queries.getCoverageDimensions(repositoryId, environmentKey);
}

export async function setCoverageDimensionEnabledAction(
  repositoryId: string,
  dimensionId: string,
  enabled: boolean,
) {
  await requireRepoAccess(repositoryId);
  await queries.setCoverageDimensionEnabled(dimensionId, enabled);
  revalidatePath(`/coverage`);
}

export async function listCoverageCellsAction(
  repositoryId: string,
  opts: { environmentKey?: string; objectType?: string } = {},
) {
  await requireRepoAccess(repositoryId);
  return queries.getCoverageCells(repositoryId, opts);
}

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
  await queries.setCoverageCellStatus(cellId, status, excludedReason?.trim());
  revalidatePath(`/coverage`);
}
