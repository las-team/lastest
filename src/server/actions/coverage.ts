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
import type { CoverageCellStatus, VaultConnectorConfig } from "@/lib/db/schema";
import type { SutProfiler } from "@lastest/coverage-model";
import { vaultBaseUrl } from "@/lib/connectors/vault-client";
import { connectorFetch } from "@/lib/connectors/fetch";

/** Full pass: profile sources, derive occurring cells, attribute historical
 *  runs, recompute weights. Safe to re-run — every step is idempotent.
 *
 *  Synchronous, and therefore for callers that genuinely need the result
 *  in-band (the API's `fresh=1`, tests). Anything driven by a click should use
 *  `startCoverageSyncAction`: a sync re-reads every data source and re-scores
 *  every cell, which is minutes on a large repo, and awaiting that in a server
 *  action holds the user's request open for all of it. */
export async function syncCoverageAction(
  repositoryId: string,
  opts: SyncOptions = {},
) {
  await requireRepoAccess(repositoryId);
  const result = await syncCoverage(repositoryId, opts);
  revalidatePath(`/coverage`);
  return result;
}

/** What a finished sync job reports back, mirrored onto the job row so the
 *  poller can render the same toast the synchronous action used to return. */
export interface CoverageSyncSummary {
  dimensionsProposed: number;
  dimensionsRejected: number;
  cellsUpserted: number;
  cellsPruned: number;
  attributionsRecorded: number;
}

/**
 * Start a coverage sync as a background job and return immediately.
 *
 * The UI polls `getCoverageSyncStatusAction`. Same work, same idempotence —
 * the only difference is who waits for it.
 */
export async function startCoverageSyncAction(
  repositoryId: string,
  opts: SyncOptions = {},
): Promise<{ jobId: string }> {
  await requireRepoAccess(repositoryId);
  const { createJob, completeJob, failJob } =
    await import("@/server/actions/jobs");
  const jobId = await createJob(
    "coverage_sync",
    "Coverage sync: profiling data sources",
    1,
    repositoryId,
    { environmentKey: opts.environmentKey ?? DEFAULT_COVERAGE_ENVIRONMENT },
  );

  // Fire-and-forget: the action returns as soon as the row exists.
  void (async () => {
    try {
      const result = await syncCoverage(repositoryId, opts);
      const summary: CoverageSyncSummary = {
        dimensionsProposed: result.dimensionsProposed,
        dimensionsRejected: result.dimensionsRejected.length,
        cellsUpserted: result.cellsUpserted,
        cellsPruned: result.cellsPruned,
        attributionsRecorded: result.attributionsRecorded,
      };
      await queries.updateBackgroundJob(jobId, {
        metadata: {
          environmentKey: result.environmentKey,
          summary,
          rejected: result.dimensionsRejected,
        },
      });
      await completeJob(jobId);
      revalidatePath(`/coverage`);
    } catch (err) {
      await failJob(
        jobId,
        err instanceof Error ? err.message : "Coverage sync failed",
      ).catch(() => {});
    }
  })();

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

export async function listCoverageCellsAction(
  repositoryId: string,
  opts: { environmentKey?: string; objectType?: string } = {},
) {
  await requireRepoAccess(repositoryId);
  return queries.getCoverageCells(repositoryId, opts);
}

type InlineConnection =
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
      paging?: { limitParam: string; offsetParam: string; pageSize: number };
    };

function buildInlineProfiler(connection: InlineConnection): SutProfiler {
  return connection.kind === "vault"
    ? new VaultProfiler(connection)
    : new RestProfiler(connection);
}

/**
 * Turn a stored connector into a profiler.
 *
 * Only the Vault methods produce one: profiling means running VQL, and the
 * Salesforce connectors here authenticate for a browser login or an OAuth token
 * rather than for a query API. Refusing explicitly beats returning a profiler
 * that fails at the first request with an unrelated error.
 */
async function resolveConnectorProfiler(
  repositoryId: string,
  connectorId: string,
): Promise<{ profiler: SutProfiler; environmentKey?: string }> {
  const resolved = await queries.getConnectorForConnection(connectorId);
  if (!resolved) throw new Error("Connector not found");
  const { connector, secrets } = resolved;
  if (connector.repositoryId !== repositoryId) {
    throw new Error("Forbidden: connector belongs to another repository");
  }
  if (connector.type !== "vault") {
    throw new Error(
      `Profiling needs a Veeva Vault connector — "${connector.label}" is a Salesforce connector.`,
    );
  }
  if (connector.authMethod !== "vault-password") {
    throw new Error(
      "Profiling needs a Vault connector that authenticates with a user name and password.",
    );
  }

  const config = connector.config as VaultConnectorConfig;
  const environment = connector.environmentId
    ? await queries.getEnvironment(connector.environmentId)
    : undefined;

  return {
    profiler: new VaultProfiler({
      baseUrl: vaultBaseUrl(config),
      apiVersion: config.apiVersion,
      username: secrets.username ?? "",
      password: secrets.password ?? "",
      fetchImpl: connectorFetch,
    }),
    environmentKey: environment?.key,
  };
}

/**
 * P4: profile real record distributions from the system under test.
 *
 * Two ways in. `connectorId` names a stored Vault/Salesforce connector — the
 * normal path now that the environment model exists, and the only one the UI
 * offers, since it means a consultant types the sandbox URL and password once
 * rather than on every profiling call. The inline `connection` object remains
 * for callers that hold credentials they do not want stored at all; it is still
 * never persisted here.
 *
 * A connector also carries its environment, so profiled dimensions land under
 * that environment's key instead of the `'default'` bucket — which is what the
 * pre-placed `environment_key` column on every coverage row was waiting for.
 */
export async function profileFromSutAction(
  repositoryId: string,
  input: {
    objectType: string;
    fields: string[];
    where?: string;
    limit?: number;
    environmentKey?: string;
    /** A stored connector. Mutually exclusive with `connection`. */
    connectorId?: string;
    connection?:
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

  const resolved = input.connectorId
    ? await resolveConnectorProfiler(repositoryId, input.connectorId)
    : input.connection
      ? {
          profiler: buildInlineProfiler(input.connection),
          environmentKey: undefined,
        }
      : null;
  if (!resolved) {
    throw new Error("A connector or an inline connection is required");
  }
  const { profiler } = resolved;

  const connection = await profiler.testConnection();
  if (!connection.ok) {
    throw new Error(
      `Could not connect to ${profiler.label}: ${connection.error}`,
    );
  }

  // The caller may still pin an environment explicitly; otherwise the
  // connector's own environment decides where these counts belong.
  const environmentKey = input.environmentKey ?? resolved.environmentKey;

  const outcome = await profileFromSut({
    repositoryId,
    environmentKey,
    profiler,
    objectType: input.objectType.trim(),
    fields: input.fields,
    where: input.where,
    limit: input.limit,
  });

  // Profiled counts change every weight, so re-score before reporting.
  await recomputeWeights(repositoryId, { environmentKey });
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
