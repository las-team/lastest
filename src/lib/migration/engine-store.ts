/**
 * Read side of `@lastest/veeva-migration`'s own state store.
 *
 * The engine keeps its state in a `veeva_migration` schema in the SAME
 * Postgres the app uses. The console reads it directly rather than mirroring
 * it into app tables, so a unit grid can never disagree with the run that
 * produced it. Nothing here writes.
 *
 * SERVER-ONLY: `PostgresStateStore.connect` opens its own `postgres` client.
 * Every helper opens one, reads, and closes it. That is a connection per call,
 * which is fine at this page's traffic (a console a handful of leads open) and
 * is the honest alternative to a module-level pool that would outlive a
 * serverless invocation.
 *
 * `@lastest/veeva-migration` is imported lazily in every function. Its barrel
 * pulls in the 46 object modules, the transform registry and `postgres`; a
 * top-level import would put all of that in the module graph of any page that
 * so much as renders a badge.
 */

import "server-only";
import { getLogger } from "@/lib/logger";
import type {
  Finding,
  IdMapRow,
  ReconciliationRow,
  RowResult,
  RunRecord,
  StoredFinding,
  Watermark,
} from "@lastest/veeva-migration";

const log = getLogger("Migration");

/** Engine schema namespace. Matches the package default; stated, not implied. */
export const ENGINE_SCHEMA = "veeva_migration";

export interface EngineStoreTarget {
  vaultDns: string;
  databaseUrl: string;
}

/**
 * Open the engine store, run `fn`, close it — even when `fn` throws.
 *
 * `PostgresStateStore.connect` migrates the schema on open, so the first call
 * on a fresh database creates the tables. That is deliberate: the console can
 * render "no runs yet" for a project whose engine schema does not exist,
 * without a separate provisioning step.
 */
async function withEngineStore<T>(
  target: EngineStoreTarget,
  fn: (store: import("@lastest/veeva-migration").StateStore) => Promise<T>,
): Promise<T> {
  const { PostgresStateStore } = await import("@lastest/veeva-migration");
  const store = await PostgresStateStore.connect({
    vaultDns: target.vaultDns,
    databaseUrl: target.databaseUrl,
    schema: ENGINE_SCHEMA,
  });
  try {
    return await fn(store);
  } finally {
    await store.close().catch((err) => {
      log.warn({ err }, "engine state store did not close cleanly");
    });
  }
}

/**
 * Every helper below returns a null-ish value rather than throwing when the
 * engine schema is missing or unreachable.
 *
 * The console renders around a migration that has never run — that is its
 * first screen — and a page that 500s because `veeva_migration.runs` does not
 * exist yet would make the empty state unreachable. Failures are logged, not
 * swallowed silently.
 */
async function safely<T>(
  what: string,
  target: EngineStoreTarget | null,
  fallback: T,
  fn: (store: import("@lastest/veeva-migration").StateStore) => Promise<T>,
): Promise<T> {
  if (!target?.databaseUrl || !target.vaultDns) return fallback;
  try {
    return await withEngineStore(target, fn);
  } catch (err) {
    log.warn(
      { err, what, vaultDns: target.vaultDns },
      "engine store read failed",
    );
    return fallback;
  }
}

export function engineTarget(
  vaultDns: string | null | undefined,
): EngineStoreTarget | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!vaultDns || !databaseUrl) return null;
  return { vaultDns, databaseUrl };
}

export async function getEngineRun(
  target: EngineStoreTarget | null,
  engineRunId: string,
): Promise<RunRecord | undefined> {
  return safely("run", target, undefined, (s) => s.runs.get(engineRunId));
}

export async function listEngineFindings(
  target: EngineStoreTarget | null,
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
  target: EngineStoreTarget | null,
  engineRunId: string,
): Promise<StoredFinding[]> {
  return safely("previousFindings", target, [], (s) =>
    s.findings.previous(engineRunId),
  );
}

export async function listReconciliation(
  target: EngineStoreTarget | null,
  engineRunId: string,
): Promise<ReconciliationRow[]> {
  return safely("reconciliation", target, [], (s) =>
    s.reconciliation.list(engineRunId),
  );
}

export async function listWatermarks(
  target: EngineStoreTarget | null,
): Promise<Watermark[]> {
  return safely("watermarks", target, [], (s) => s.watermarks.list());
}

export async function listFrozenCountries(
  target: EngineStoreTarget | null,
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
  target: EngineStoreTarget | null,
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
  target: EngineStoreTarget | null,
  objectKey: string,
  sfdcId: string,
): Promise<IdMapRow | undefined> {
  return safely("idMap", target, undefined, (s) =>
    s.idMap.get(objectKey as never, sfdcId),
  );
}

/** The other side: Vault id -> Salesforce id. */
export async function lookupCrosswalkByVaultId(
  target: EngineStoreTarget | null,
  vaultObject: string,
  vaultId: string,
): Promise<IdMapRow | undefined> {
  return safely("idMapReverse", target, undefined, (s) =>
    s.idMap.byVaultId(vaultObject, vaultId),
  );
}

/** A page of the crosswalk for one unit — what the demo's `id-map` printed. */
export async function sampleCrosswalk(
  target: EngineStoreTarget | null,
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
  target: EngineStoreTarget | null,
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

/** Everything the console needs from the engine, over ONE connection. */
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
 * The per-read helpers above each open their own connection, which is fine for
 * a one-off lookup and wrong for a page render — six of them would open six.
 * The console calls this instead.
 *
 * `engineRunId` is optional: a project whose first preflight has not run yet
 * still has watermarks and frozen countries worth showing.
 */
export async function readConsoleEngineData(
  target: EngineStoreTarget | null,
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
