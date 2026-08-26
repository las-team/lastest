"use server";

import { revalidatePath } from "next/cache";
import * as queries from "@/lib/db/queries";
import { requireRepoAccess } from "@/lib/auth";
import {
  getCoverageReport,
  profileDimensions,
  recomputeWeights,
  syncCoverage,
  type SyncOptions,
} from "@/lib/coverage/sync";
import {
  profileFromSut,
  RestProfiler,
  VaultProfiler,
} from "@/lib/coverage/profilers";
import { buildCoverageSpec, renderSpecMarkdown } from "@lastest/coverage-model";
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

/** The coverage trend, oldest first. Points are written by sync and by build
 *  completion; pre-snapshot history is reconstructed from the attribution
 *  ledger and marked `source: 'backfill'`. */
export async function getCoverageTrendAction(
  repositoryId: string,
  opts: { environmentKey?: string; limit?: number } = {},
) {
  await requireRepoAccess(repositoryId);
  return queries.getCoverageTrend(repositoryId, opts);
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

/**
 * P4: profile real record distributions from the system under test.
 *
 * Credentials are taken per-call and never persisted here — storing SUT
 * credentials is a decision for the (not yet built) environment model, and
 * quietly writing them to a settings row now would be the wrong default for
 * exactly the regulated customers this exists for.
 */
export async function profileFromSutAction(
  repositoryId: string,
  input: {
    objectType: string;
    fields: string[];
    where?: string;
    limit?: number;
    environmentKey?: string;
    connection:
      | {
          kind: "vault";
          baseUrl: string;
          username: string;
          password: string;
          apiVersion?: string;
        }
      | {
          kind: "rest";
          urlTemplate: string;
          headers?: Record<string, string>;
          recordsPath?: string;
          paging?: {
            limitParam: string;
            offsetParam: string;
            pageSize: number;
          };
        };
  },
) {
  await requireRepoAccess(repositoryId);
  if (!input.objectType?.trim()) throw new Error("An object type is required");
  if (!input.fields?.length) throw new Error("At least one field is required");

  const profiler =
    input.connection.kind === "vault"
      ? new VaultProfiler(input.connection)
      : new RestProfiler(input.connection);

  const connection = await profiler.testConnection();
  if (!connection.ok) {
    throw new Error(
      `Could not connect to ${profiler.label}: ${connection.error}`,
    );
  }

  const outcome = await profileFromSut({
    repositoryId,
    environmentKey: input.environmentKey,
    profiler,
    objectType: input.objectType.trim(),
    fields: input.fields,
    where: input.where,
    limit: input.limit,
  });

  // Profiled counts change every weight, so re-score before reporting.
  await recomputeWeights(repositoryId, {
    environmentKey: input.environmentKey,
  });
  revalidatePath(`/coverage`);
  return outcome;
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
