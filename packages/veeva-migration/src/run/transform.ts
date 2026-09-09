/**
 * §2.3 transform runner: streams extract rows through `applyMapping`,
 * writes payload files (500 rows each, deferred references only), deferred
 * blobs, `row_results` (`transformed` | `skipped` | `failed`) and the
 * `fk_index` (§4.2), and reports diagnostics by code for the report.
 */
import type { ExtractFile, Extractor } from "../extract/types";
import { getLogger } from "../logger";
import { blobsDir, payloadDir, writePayloadFiles } from "../load/paths";
import type { PayloadRow } from "../load/types";
import type { StateStore } from "../store/types";
import {
  applyMapping,
  type ApplyContext,
  type ApplyResult,
} from "../transform/apply";
import type {
  CountryContext,
  FkIndexRow,
  IdResolver,
  MaterialisedMapping,
  ResolvedMetadata,
  RowResult,
  RunMode,
  SourceRow,
  Unit,
} from "../types";
import type { ObjectModule } from "../objects/types";

export interface TransformUnitInput {
  runId: string;
  unit: Unit;
  mapping: MaterialisedMapping;
  metadata: ResolvedMetadata;
  module?: ObjectModule;
  runDir: string;
  runMode: RunMode;
  files: readonly ExtractFile[];
  extractor: Extractor;
  store: StateStore;
  country: CountryContext;
  ids: IdResolver;
  migrationUserId?: number;
  orgId15?: string;
  dryRun?: boolean;
  /** Restrict to these ids (`retry-failed`). */
  onlyIds?: ReadonlySet<string>;
  /** Attach the raw source row to payload rows (match keys, §3.3). */
  keepSource?: boolean;
  /** Payload file prefix (`closure-r1-`, `p1-`) so several passes share one unit directory. */
  filePrefix?: string;
  now?: () => Date;
}

export interface TransformUnitResult {
  payloadFiles: string[];
  blobFiles: string[];
  transformed: number;
  skipped: number;
  failed: number;
  pendingFk: number;
  closureRows: number;
  /** id → SystemModstamp seen (delete last-wins, §4.3 step 5). */
  seenModstamps: Map<string, string>;
  /** diagnostic code → count. */
  diagnostics: Record<string, number>;
  skippedByReason: Record<string, number>;
  failedByCode: Record<string, number>;
  /** Rows with pass-2 fields. */
  secondPassRows: number;
}

/** Turn an `ApplyResult` into the loader's `PayloadRow`. */
export function toPayloadRow(
  r: ApplyResult,
  row: SourceRow,
  closure: boolean,
  keepSource: boolean,
): PayloadRow {
  const out: PayloadRow & { source?: Record<string, unknown> } = {
    sfdcId: r.sfdcId,
    systemModstamp:
      typeof row.SystemModstamp === "string" ? row.SystemModstamp : undefined,
    payload: r.payload,
    secondPass: Object.keys(r.secondPass).length ? r.secondPass : undefined,
    sourceHash: r.sourceHash,
    objectType: r.objectType,
    diagnostics: r.diagnostics,
    closure: closure || undefined,
  };
  if (keepSource) out.source = row;
  return out;
}

export async function transformUnit(
  input: TransformUnitInput,
): Promise<TransformUnitResult> {
  const log = getLogger("Transform", {
    run_id: input.runId,
    object_key: input.unit.objectKey,
    country: input.unit.country,
  });
  const now = input.now ?? (() => new Date());
  const ctx: ApplyContext = {
    country: input.country,
    metadata: input.metadata,
    ids: input.ids,
    migrationUserId: input.migrationUserId,
    orgId15: input.orgId15,
    runMode: input.runMode,
    custom: input.module?.custom,
  };
  const result: TransformUnitResult = {
    payloadFiles: [],
    blobFiles: [],
    transformed: 0,
    skipped: 0,
    failed: 0,
    pendingFk: 0,
    closureRows: 0,
    seenModstamps: new Map(),
    diagnostics: {},
    skippedByReason: {},
    failedByCode: {},
    secondPassRows: 0,
  };
  let rowResults: RowResult[] = [];
  let fkRows: FkIndexRow[] = [];
  const flushStore = async () => {
    if (rowResults.length) {
      await input.store.rowResults.upsert(rowResults);
      rowResults = [];
    }
    if (fkRows.length && !input.dryRun) {
      await input.store.fkIndex.put(fkRows);
      fkRows = [];
    }
  };
  const bump = (rec: Record<string, number>, key: string) =>
    (rec[key] = (rec[key] ?? 0) + 1);
  const blobRows: Array<{ sfdcId: string; blobs: PayloadRow["payload"] }> = [];

  const payloadRows = (async function* (): AsyncGenerator<PayloadRow> {
    for await (const { row, file } of input.extractor.readRows(input.files)) {
      if (input.onlyIds && !input.onlyIds.has(row.Id)) continue;
      const r = applyMapping(row, input.mapping, ctx);
      if (typeof row.SystemModstamp === "string")
        result.seenModstamps.set(r.sfdcId, row.SystemModstamp);
      for (const d of r.diagnostics) bump(result.diagnostics, d.code ?? d.kind);
      if (file.closure) result.closureRows++;
      const base = {
        runId: input.runId,
        objectKey: input.unit.objectKey,
        country: input.unit.country,
        sfdcId: r.sfdcId,
        attempt: 1,
        payloadHash: r.sourceHash,
        updatedAt: now().toISOString(),
      };
      if (r.status === "skipped") {
        result.skipped++;
        bump(result.skippedByReason, r.skipReason ?? "rule");
        rowResults.push({
          ...base,
          state: "skipped",
          errorType: r.skipReason ?? "rule",
          errorMessage: r.diagnostics.find((d) => d.fatal)?.detail ?? null,
        });
      } else if (r.status === "failed") {
        result.failed++;
        bump(result.failedByCode, r.failure?.code ?? "TRANSFORM_FAILED");
        rowResults.push({
          ...base,
          state: "failed",
          errorType: r.failure?.code ?? "TRANSFORM_FAILED",
          errorMessage: r.failure?.message ?? null,
        });
      } else {
        result.transformed++;
        if (r.status === "pending_fk") result.pendingFk++;
        if (Object.keys(r.secondPass).length) result.secondPassRows++;
        rowResults.push({ ...base, state: "transformed" });
        for (const e of r.fkEdges)
          fkRows.push({
            objectKey: input.unit.objectKey,
            sfdcId: r.sfdcId,
            field: e.field,
            targetObjectKey: e.targetObjectKey,
            targetSfdcId: e.targetSfdcId,
            runId: input.runId,
          });
        if (Object.keys(r.blobs).length)
          blobRows.push({ sfdcId: r.sfdcId, blobs: r.blobs });
        yield toPayloadRow(
          r,
          row,
          Boolean(file.closure),
          input.keepSource ?? true,
        );
      }
      if (rowResults.length >= 500 || fkRows.length >= 2000) await flushStore();
    }
  })();

  result.payloadFiles = await writePayloadFiles(
    payloadDir(input.runDir, input.unit),
    payloadRows,
    undefined,
    input.filePrefix,
  );
  await flushStore();
  if (blobRows.length) {
    const rows = blobRows.map(
      (b) =>
        ({
          sfdcId: b.sfdcId,
          payload: b.blobs,
          sourceHash: "",
          diagnostics: [],
        }) satisfies PayloadRow,
    );
    result.blobFiles = await writePayloadFiles(
      blobsDir(input.runDir, input.unit),
      rows,
      undefined,
      input.filePrefix,
    );
  }
  log.info(
    {
      transformed: result.transformed,
      skipped: result.skipped,
      failed: result.failed,
      pending_fk: result.pendingFk,
      closure: result.closureRows,
      files: result.payloadFiles.length,
      diagnostics: result.diagnostics,
    },
    "unit transformed",
  );
  return result;
}
