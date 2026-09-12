import type {
  Finding,
  IdMapRow,
  ReconciliationRow,
  RowResult,
  RunRecord,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration/types";

import type { VeevaMigrationDb } from "./data/db";
import { PluginDataStateStore } from "./store/plugin-data-store";

/**
 * The console's read side over the engine's state.
 *
 * This replaces `src/lib/migration/engine-store.ts`, and the differences are
 * the point of the migration:
 *
 *  - **No connection is opened.** The old module's every helper called
 *    `PostgresStateStore.connect`, which built a four-connection pool, ran the
 *    engine's DDL under an advisory lock, read, and closed again. Its own file
 *    comment called that "the honest alternative to a module-level pool"; it
 *    was also tenant-triggerable DDL on every page view. Here the store is a
 *    thin object over the handle `core/data` already owns, so
 *    `readConsoleEngineData` is genuinely one round trip per query and nothing
 *    else.
 *  - **No `DATABASE_URL`, no `vaultDns` from a form.** The old `engineTarget()`
 *    built its target from `process.env.DATABASE_URL` plus a Vault DNS string
 *    any team member could type into their own connector — which is how one
 *    tenant could read another's crosswalk. A store here is built from a
 *    project id the caller has already been authorised for.
 *  - **No lazy `await import`.** Every function in the old module deferred
 *    loading the engine barrel because the single `"."` export pulled in 46
 *    object modules, the transform registry and `postgres`. The engine now has
 *    an `exports` map and this file imports types only, plus the store.
 *
 * The `safely` wrapper is kept, for the reason the original gives: the console
 * renders around a migration that has never run — that is its first screen —
 * and a page that 500s because there are no engine rows yet would make the
 * empty state unreachable.
 */

export interface EngineReadTarget {
  readonly db: VeevaMigrationDb;
  readonly projectId: string;
  readonly vaultDns: string | null | undefined;
}

/** A read-only store for a project, or `null` when there is nothing to read. */
function storeFor(target: EngineReadTarget): PluginDataStateStore | null {
  if (!target.vaultDns) return null;
  return new PluginDataStateStore({
    db: target.db,
    projectId: target.projectId,
    vaultDns: target.vaultDns,
  });
}

async function safely<T>(
  what: string,
  target: EngineReadTarget,
  fallback: T,
  fn: (store: PluginDataStateStore) => Promise<T>,
): Promise<T> {
  const store = storeFor(target);
  if (!store) return fallback;
  try {
    return await fn(store);
  } catch (err) {
    console.warn(`[Migration] engine read failed: ${what}`, err);
    return fallback;
  }
}

export async function getEngineRun(
  target: EngineReadTarget,
  engineRunId: string,
): Promise<RunRecord | undefined> {
  return safely("run", target, undefined, (s) => s.runs.get(engineRunId));
}

export async function listEngineFindings(
  target: EngineReadTarget,
  engineRunId: string,
): Promise<StoredFinding[]> {
  return safely("findings", target, [], (s) => s.findings.list(engineRunId));
}

/**
 * Findings of the run before this one, for the "new since last preflight"
 * diff. A finding that has been there for three rehearsals reads differently
 * from one that appeared with today's mapping change.
 */
export async function listPreviousFindings(
  target: EngineReadTarget,
  engineRunId: string,
): Promise<StoredFinding[]> {
  return safely("previousFindings", target, [], (s) =>
    s.findings.previous(engineRunId),
  );
}

export async function listReconciliation(
  target: EngineReadTarget,
  engineRunId: string,
): Promise<ReconciliationRow[]> {
  return safely("reconciliation", target, [], (s) =>
    s.reconciliation.list(engineRunId),
  );
}

export async function listWatermarks(
  target: EngineReadTarget,
): Promise<Watermark[]> {
  return safely("watermarks", target, [], (s) => s.watermarks.list());
}

export async function listFrozenCountries(
  target: EngineReadTarget,
): Promise<Array<{ country: string; frozenAt: string }>> {
  return safely("countryStatus", target, [], (s) => s.countryStatus.list());
}

/**
 * Failed rows of a run, newest first, capped.
 *
 * `limit` exists because a bad mapping can fail a hundred thousand rows and
 * the error table is a diagnostic, not an export: the report file is where a
 * full list belongs (§8.5).
 */
export async function listFailedRows(
  target: EngineReadTarget,
  engineRunId: string,
  opts: {
    objectKey?: string;
    country?: string;
    errorType?: string;
    limit?: number;
  } = {},
): Promise<RowResult[]> {
  return safely("failedRows", target, [], (s) =>
    s.rowResults.query({
      runId: engineRunId,
      objectKey: opts.objectKey as never,
      country: opts.country,
      state: "failed",
      errorType: opts.errorType,
      limit: opts.limit ?? 200,
    }),
  );
}

/** One side of the crosswalk explorer: Salesforce id -> Vault id. */
export async function lookupCrosswalkBySfdcId(
  target: EngineReadTarget,
  objectKey: string,
  sfdcId: string,
): Promise<IdMapRow | undefined> {
  return safely("idMap", target, undefined, (s) =>
    s.idMap.get(objectKey as never, sfdcId),
  );
}

/** The other side: Vault id -> Salesforce id. */
export async function lookupCrosswalkByVaultId(
  target: EngineReadTarget,
  vaultObject: string,
  vaultId: string,
): Promise<IdMapRow | undefined> {
  return safely("idMapReverse", target, undefined, (s) =>
    s.idMap.byVaultId(vaultObject, vaultId),
  );
}

/** A page of the crosswalk for one unit — what the demo's `id-map` printed. */
export async function sampleCrosswalk(
  target: EngineReadTarget,
  objectKey: string,
  country: string | undefined,
  limit = 50,
): Promise<IdMapRow[]> {
  return safely("idMapSample", target, [], async (s) => {
    const out: IdMapRow[] = [];
    for await (const row of s.idMap.iterate(objectKey as never, country)) {
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  });
}

export async function countCrosswalk(
  target: EngineReadTarget,
  objectKey: string,
  country?: string,
): Promise<number> {
  return safely("idMapCount", target, 0, (s) =>
    s.idMap.count(objectKey as never, country),
  );
}

/** Roll a run's per-unit reconciliation into the numbers the rail shows. */
export function summariseReconciliation(rows: ReconciliationRow[]): {
  extracted: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  pendingFk: number;
  deleted: number;
  gate: "pass" | "fail" | "pending";
} {
  const total = {
    extracted: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    pendingFk: 0,
    deleted: 0,
  };
  for (const r of rows) {
    total.extracted += r.extracted ?? 0;
    total.created += r.created ?? 0;
    total.updated += r.updated ?? 0;
    total.unchanged += r.unchanged ?? 0;
    total.skipped += r.skipped ?? 0;
    total.failed += r.failed ?? 0;
    total.pendingFk += r.pendingFk ?? 0;
    total.deleted += r.deleted ?? 0;
  }
  // One failing unit fails the gate — §8.8 is tolerance zero, not a majority.
  const gate =
    rows.length === 0
      ? ("pending" as const)
      : rows.some((r) => r.status === "fail")
        ? ("fail" as const)
        : rows.every((r) => r.status === "pass")
          ? ("pass" as const)
          : ("pending" as const);
  return { ...total, gate };
}

export function countFindingsBySeverity(findings: Finding[]): {
  blocking: number;
  warning: number;
  info: number;
} {
  const out = { blocking: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

/** Everything the console needs from the engine. */
export interface ConsoleEngineData {
  findings: StoredFinding[];
  previousFindings: StoredFinding[];
  reconciliation: ReconciliationRow[];
  watermarks: Watermark[];
  frozenCountries: Array<{ country: string; frozenAt: string }>;
  failedRows: RowResult[];
}

const EMPTY_CONSOLE_DATA: ConsoleEngineData = {
  findings: [],
  previousFindings: [],
  reconciliation: [],
  watermarks: [],
  frozenCountries: [],
  failedRows: [],
};

/**
 * Read the focused run's detail plus the project-wide state in one go.
 *
 * `engineRunId` is optional: a project whose first preflight has not run yet
 * still has watermarks and frozen countries worth showing.
 */
export async function readConsoleEngineData(
  target: EngineReadTarget,
  engineRunId: string | null,
): Promise<ConsoleEngineData> {
  return safely("console", target, EMPTY_CONSOLE_DATA, async (store) => {
    const [watermarks, frozenCountries] = await Promise.all([
      store.watermarks.list(),
      store.countryStatus.list(),
    ]);
    if (!engineRunId) {
      return { ...EMPTY_CONSOLE_DATA, watermarks, frozenCountries };
    }
    const [findings, previousFindings, reconciliation, failedRows] =
      await Promise.all([
        store.findings.list(engineRunId),
        store.findings.previous(engineRunId),
        store.reconciliation.list(engineRunId),
        store.rowResults.query({
          runId: engineRunId,
          state: "failed",
          limit: 200,
        }),
      ]);
    return {
      findings,
      previousFindings,
      reconciliation,
      watermarks,
      frozenCountries,
      failedRows,
    };
  });
}
