/**
 * `DefaultLoader` — §2.5.4 bulk upsert pipeline (§8.1–8.4, §3.3, §3.5,
 * §4.4, §6.1 pass 2, §8.6 blobs).
 *
 * Per batch (≤ 500 rows, deduped last-wins by `SystemModstamp`):
 *  1. resume: rows with a terminal `row_results` state in this run are skipped (§8.2);
 *  2. id map lookup; merged losers are skipped (`skipped(merged)`);
 *  3. hash skip: `source_hash == id_map.source_hash` → `loaded_unchanged` locally (§8.2);
 *  4. unmapped rows go through the §3.3 match precedence (VQL) before a create;
 *     `createPolicy = match-only` fails unmatched rows (`MATCH_ONLY_UNMATCHED`);
 *  5. deferred `$fk`/`$user`/`$composite` are resolved at send time; rows with
 *     an unresolved reference are parked in `pending_fk` (§8.4);
 *  6. an object-type change is routed through `changetype` + full PUT when
 *     `allowTypeChange`, else `failed(TYPE_CHANGE_BLOCKED)` (§2.5.6);
 *  7. rows already mapped (or created by us) are upserted by `idParam`;
 *     freshly matched rows are updated by Vault `id` so the legacy id gets
 *     stamped on the pre-existing record (§3.1 #1, #3);
 *  8. per-row results → `row_results` + `id_map` (+ `source_hash`); an outer
 *     `FAILURE` aborts the unit (structural, blocking finding), retryable
 *     transport errors are retried with backoff.
 *
 * A dry run performs the VQL match step only (id-map rows flagged `dry_run`)
 * and simulates the counts (§8.9).
 */
import type { Finding, IdMapRow, RowResult, RowState } from "../types";
import type { VaultBulkResponse, VaultRow } from "../vault/types";
import { AdaptiveBatchSize, cutBatches, shouldHashSkip } from "./batcher";
import { runBlobs, type BlobRow } from "./blobs";
import { LoaderRuntime, type LoaderOptions } from "./context";
import { throwIfCancelled } from "../cancel";
import { runDeletes, runMerges, type DeleteOutcome } from "./deletes";
import { matchRows, type MatchHit, type PayloadRowWithSource } from "./matcher";
import {
  enqueuePending,
  failPending,
  markPendingResolved,
  readPendingQueue,
  writePendingQueue,
  type PendingEntry,
} from "./pending";
import {
  RefIndex,
  collectRefs,
  resolvePayload,
  type RefKey,
  type UnresolvedRef,
} from "./resolve-refs";
import { LoadCallError, errorMessageOf, errorTypeOf } from "./retry";
import { runSecondPass } from "./second-pass";
import type {
  BatchOutcome,
  DeleteRequest,
  DeleteResult,
  LoadPlan,
  LoadResult,
  Loader,
  LoaderDeps,
  MergeRequest,
  MergeResult,
  PayloadRow,
  SecondPassResult,
} from "./types";
import { MATCHED_MARKER } from "./types";

export { MATCHED_MARKER };

const TERMINAL_STATES: readonly RowState[] = [
  "loaded_created",
  "loaded_updated",
  "loaded_unchanged",
  "skipped",
  "deleted",
  "inactivated",
];

interface LoadContext {
  /** Rows re-sent from the pending queue: sfdcId → queue entry. */
  fromPending?: Map<string, PendingEntry>;
  attempt: number;
}

interface Prepared {
  row: PayloadRow;
  idRow?: IdMapRow;
  hit?: MatchHit;
  vaultRow: VaultRow;
  /** How the row is sent. */
  op: "upsert" | "update" | "changetype";
}

function emptyResult(plan: LoadPlan): LoadResult {
  return {
    unit: plan.unit,
    batches: [],
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    pendingFk: 0,
    skipped: 0,
    typeChanged: 0,
  };
}

export class DefaultLoader implements Loader {
  readonly rt: LoaderRuntime;
  private readonly findings: Finding[] = [];

  constructor(deps: LoaderDeps, opts: LoaderOptions = {}) {
    this.rt = new LoaderRuntime(deps, opts);
  }

  /** Findings raised while loading (match warnings, structural aborts); cleared on read. */
  drainFindings(): Finding[] {
    return this.findings.splice(0);
  }

  // ------------------------------------------------------------------ load

  loadBatches(
    rows: AsyncIterable<PayloadRow>,
    plan: LoadPlan,
  ): Promise<LoadResult> {
    return this.loadRows(rows, plan, { attempt: 1 });
  }

  private async loadRows(
    rows: AsyncIterable<PayloadRow> | Iterable<PayloadRow>,
    plan: LoadPlan,
    ctx: LoadContext,
  ): Promise<LoadResult> {
    const log = this.rt.log(plan);
    const result = emptyResult(plan);
    const initial = plan.mapping.load.batchSize ?? plan.batchSize;
    const adaptive = new AdaptiveBatchSize(initial, {
      wallTimeMs: plan.batchWallTimeMs,
    });
    if (plan.mapping.load.strategy === "loader")
      log.warn(
        "load.strategy = loader is not implemented in v1; using direct /vobjects upserts",
      );
    const terminal = ctx.fromPending
      ? new Set<string>()
      : await this.terminalIds(plan);
    for await (const batch of cutBatches(rows, () => adaptive.current())) {
      // Between batches, never inside one: a cancelled run finishes the request
      // it has in flight so the Vault never sees a half-sent batch and the id
      // map stays consistent with what was actually written.
      throwIfCancelled(this.rt.opts.signal);
      const live = batch.filter((r) => !terminal.has(r.sfdcId));
      if (!live.length) continue;
      const batchNo = await this.rt.nextBatchNo(plan);
      const outcome = await this.sendBatch(live, plan, batchNo, ctx);
      result.batches.push(outcome);
      result.created += outcome.created;
      result.updated += outcome.updated;
      result.unchanged += outcome.unchanged;
      result.failed += outcome.failed;
      result.pendingFk += outcome.pendingFk;
      result.skipped += outcome.skippedRows ?? 0;
      result.typeChanged += outcome.typeChanged ?? 0;
      adaptive.record(outcome.elapsedMs);
      if (outcome.structuralError) {
        result.aborted = {
          reason: `${outcome.structuralError.type}: ${outcome.structuralError.message}`,
          batchNo,
        };
        this.findings.push({
          severity: "blocking",
          code: "LOAD_STRUCTURAL_FAILURE",
          objectKey: plan.unit.objectKey,
          country: plan.unit.country,
          detail: { batchNo, ...outcome.structuralError },
        });
        log.error(
          { batch_no: batchNo, error: outcome.structuralError },
          "unit aborted: structural failure",
        );
        break;
      }
    }
    return result;
  }

  private async terminalIds(plan: LoadPlan): Promise<Set<string>> {
    const rows = await this.rt.deps.store.rowResults.query({
      runId: plan.runId,
      objectKey: plan.unit.objectKey,
      country: plan.unit.country,
      state: [...TERMINAL_STATES],
    });
    return new Set(rows.map((r) => r.sfdcId));
  }

  private async sendBatch(
    batch: PayloadRow[],
    plan: LoadPlan,
    batchNo: number,
    ctx: LoadContext,
  ): Promise<BatchOutcome & { skippedRows?: number; typeChanged?: number }> {
    const rt = this.rt;
    const log = rt.log(plan);
    const started = Date.now();
    const now = rt.now();
    const out: BatchOutcome & { skippedRows: number; typeChanged: number } = {
      batchNo,
      rows: batch.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      pendingFk: 0,
      elapsedMs: 0,
      skippedRows: 0,
      typeChanged: 0,
    };
    const results: RowResult[] = [];
    const rr = (
      row: PayloadRow,
      state: RowState,
      extra: Partial<RowResult> = {},
    ): RowResult => ({
      runId: plan.runId,
      objectKey: plan.unit.objectKey,
      country: plan.unit.country,
      sfdcId: row.sfdcId,
      batchNo,
      state,
      attempt: ctx.attempt,
      payloadHash: row.sourceHash,
      updatedAt: now,
      ...extra,
    });
    const fail = (
      row: PayloadRow,
      type: string,
      message: string,
      vaultId?: string,
    ) => {
      out.failed++;
      results.push(
        rr(row, "failed", {
          errorType: type,
          errorMessage: message,
          vaultId: vaultId ?? null,
        }),
      );
    };

    // 2. id map
    const idRows = await rt.deps.store.idMap.bulkGet(
      plan.unit.objectKey,
      batch.map((r) => r.sfdcId),
    );
    const candidates: PayloadRow[] = [];
    const unmapped: PayloadRow[] = [];
    for (const row of batch) {
      const idRow = idRows.get(row.sfdcId);
      if (idRow?.mergedInto) {
        out.skippedRows++;
        results.push(
          rr(row, "skipped", {
            errorType: "merged",
            errorMessage: `merged into ${idRow.mergedInto}`,
            vaultId: idRow.vaultId,
          }),
        );
        continue;
      }
      // 3. hash skip
      if (shouldHashSkip(row, idRow)) {
        out.unchanged++;
        results.push(rr(row, "loaded_unchanged", { vaultId: idRow!.vaultId }));
        if (!plan.dryRun)
          await rt.deps.store.idMap.put({ ...idRow!, lastSeenRun: plan.runId });
        continue;
      }
      candidates.push(row);
      if (!idRow || idRow.dryRun) unmapped.push(row);
    }

    // 4. match before create
    let hits = new Map<string, MatchHit>();
    if (unmapped.length && plan.mapping.match.length) {
      const m = await matchRows(unmapped as PayloadRowWithSource[], plan, {
        vault: rt.deps.vault,
        store: rt.deps.store,
      });
      hits = m.hits;
      this.findings.push(...m.findings);
    }
    const matchOnly = plan.mapping.options.createPolicy === "match-only";
    const updateMatched = plan.mapping.options.updateMatched === true;

    // 5. resolve references at send time
    const refs = new Map<RefKey, Set<string>>();
    for (const r of candidates) collectRefs(r.payload, refs);
    const index = await RefIndex.build(rt.deps.store, refs, {
      dryRun: plan.dryRun,
    });
    const legacyField = plan.target.legacyIdField ?? plan.mapping.legacyIdField;
    const pending: PendingEntry[] = [];
    const prepared: Prepared[] = [];
    for (const row of candidates) {
      const idRow = idRows.get(row.sfdcId);
      const mapped = idRow && !idRow.dryRun ? idRow : undefined;
      const hit = hits.get(row.sfdcId);
      if (hit?.mergedInto) {
        out.skippedRows++;
        results.push(
          rr(row, "skipped", {
            errorType: "merged",
            errorMessage: `matched a record already mapped to ${hit.mergedInto}`,
            vaultId: hit.vaultId,
          }),
        );
        continue;
      }
      if (!mapped && !hit && matchOnly) {
        fail(
          row,
          "MATCH_ONLY_UNMATCHED",
          `no pre-existing ${plan.target.targetObject} record matched and createPolicy is match-only`,
        );
        continue;
      }
      if (!legacyField) {
        fail(
          row,
          "LEGACY_ID_FIELD_MISSING",
          "no legacy-id field resolved for the object (§3.2)",
        );
        continue;
      }
      const resolved = resolvePayload(row.payload, index);
      if (resolved.unresolved.length) {
        const prev = ctx.fromPending?.get(row.sfdcId);
        pending.push({
          row,
          unresolved: resolved.unresolved,
          attempts: (prev?.attempts ?? 0) + 1,
        });
        continue;
      }
      const vaultRow = resolved.row;
      if (
        vaultRow[legacyField] === undefined ||
        vaultRow[legacyField] === null
      ) {
        fail(row, "LEGACY_ID_MISSING", `payload has no ${legacyField} value`);
        continue;
      }
      // undelete of an inactivated row (§4.4): restore the platform status
      if (
        mapped?.deletedAt &&
        plan.mapping.options.deletePolicy === "inactivate" &&
        !("status__v" in vaultRow)
      )
        vaultRow.status__v = "active__v";

      // 6. object type change routing (§2.5.6) — for mapped rows and fresh matches alike:
      // a type difference never travels through a plain upsert/PUT
      const currentType = mapped?.objectType ?? hit?.objectType;
      const currentVaultId = mapped?.vaultId ?? hit?.vaultId;
      if (
        currentType &&
        currentVaultId &&
        row.objectType &&
        currentType !== row.objectType &&
        !(hit && matchOnly && !updateMatched)
      ) {
        if (!plan.mapping.options.allowTypeChange) {
          fail(
            row,
            "TYPE_CHANGE_BLOCKED",
            `object type ${currentType} → ${row.objectType} blocked by allowTypeChange = false`,
            currentVaultId,
          );
          continue;
        }
        prepared.push({
          row,
          idRow: mapped,
          hit,
          vaultRow: { ...vaultRow, id: currentVaultId },
          op: "changetype",
        });
        continue;
      }
      // 7. route: fresh match (legacy id not yet stamped) → PUT by id; else upsert by idParam
      if (hit) {
        if (matchOnly && !updateMatched) {
          // matched, never written: no source_hash bookkeeping — marked so reconciliation
          // keeps it out of the aggregate hash set (§2.8)
          out.unchanged++;
          results.push(
            rr(row, "loaded_unchanged", {
              vaultId: hit.vaultId,
              errorType: MATCHED_MARKER,
            }),
          );
          continue;
        }
        prepared.push({
          row,
          hit,
          vaultRow: { ...vaultRow, id: hit.vaultId },
          op: "update",
        });
        continue;
      }
      if (
        mapped &&
        matchOnly &&
        !updateMatched &&
        mapped.matchMethod !== "created"
      ) {
        out.unchanged++;
        results.push(
          rr(row, "loaded_unchanged", {
            vaultId: mapped.vaultId,
            errorType: mapped.sourceHash ? null : MATCHED_MARKER,
          }),
        );
        continue;
      }
      prepared.push({ row, idRow: mapped, vaultRow, op: "upsert" });
    }

    // pending queue (§8.4)
    if (pending.length) {
      out.pendingFk += pending.length;
      await enqueuePending(
        plan,
        rt.deps.store,
        pending,
        (rows) => rt.rowResults(rows),
        now,
      );
    }

    // dry run: simulate (§8.9); would-create rows get a `dry_run` id-map row so that
    // children simulated later in the same run resolve their references (purged at the next real run)
    if (plan.dryRun) {
      for (const p of prepared) {
        const wouldCreate = p.op === "upsert" && !p.idRow;
        // simulated outcome in row_results so the reconciliation row carries would_create / would_update
        results.push(
          rr(p.row, wouldCreate ? "loaded_created" : "loaded_updated", {
            vaultId:
              p.idRow?.vaultId ?? p.hit?.vaultId ?? `dry-run:${p.row.sfdcId}`,
            errorType: "dry_run",
          }),
        );
        if (wouldCreate) {
          out.created++;
          await rt.deps.store.idMap.put({
            objectKey: plan.unit.objectKey,
            sfdcId: p.row.sfdcId,
            vaultDns: rt.deps.store.vaultDns,
            vaultObject: plan.target.targetObject,
            vaultId: `dry-run:${p.row.sfdcId}`,
            country: plan.unit.country,
            matchMethod: "created",
            mergedInto: null,
            firstSeenRun: plan.runId,
            lastSeenRun: plan.runId,
            sourceHash: p.row.sourceHash,
            objectType: p.row.objectType ?? null,
            dryRun: true,
          });
        } else out.updated++;
        if (p.op === "changetype") out.typeChanged++;
      }
      out.elapsedMs = Date.now() - started;
      await rt.rowResults(results);
      log.info(
        {
          batch_no: batchNo,
          rows: batch.length,
          would_create: out.created,
          would_update: out.updated,
          pending_fk: out.pendingFk,
          failed: out.failed,
        },
        "dry-run batch simulated",
      );
      return out;
    }

    // 8. send
    const opts = rt.writeOptions(plan, batchNo);
    const groups: Array<{ op: Prepared["op"]; items: Prepared[] }> = [
      {
        op: "changetype",
        items: prepared.filter((p) => p.op === "changetype"),
      },
      { op: "upsert", items: prepared.filter((p) => p.op === "upsert") },
      { op: "update", items: prepared.filter((p) => p.op === "update") },
    ];
    let structural: BatchOutcome["structuralError"];
    for (const g of groups) {
      if (!g.items.length) continue;
      if (structural) {
        for (const p of g.items)
          fail(p.row, structural.type, structural.message);
        continue;
      }
      let response: VaultBulkResponse | undefined;
      try {
        if (g.op === "changetype") {
          if (!rt.deps.vault.changeType)
            throw new LoadCallError(
              "structural",
              "CHANGETYPE_UNSUPPORTED",
              "client has no changeType",
              1,
            );
          const ct = await rt.call(plan, () =>
            rt.deps.vault.changeType!(
              plan.target.targetObject,
              g.items.map((p) => ({
                id: (p.idRow ?? p.hit)!.vaultId,
                objectType: p.row.objectType!,
              })),
            ),
          );
          const ok = g.items.filter(
            (_, i) => ct.data[i]?.responseStatus !== "FAILURE",
          );
          g.items.forEach((p, i) => {
            const r = ct.data[i];
            if (r?.responseStatus === "FAILURE")
              fail(
                p.row,
                r.errors?.[0]?.type ?? "TYPE_CHANGE_FAILED",
                r.errors?.[0]?.message ?? "changetype failed",
                (p.idRow ?? p.hit)!.vaultId,
              );
          });
          out.typeChanged += ok.length;
          if (!ok.length) continue;
          const upd = { ...opts };
          delete upd.idParam;
          response = await rt.call(plan, () =>
            rt.deps.vault.update(
              plan.target.targetObject,
              ok.map((p) => p.vaultRow),
              { ...upd, migrationMode: true },
            ),
          );
          g.items = ok;
        } else if (g.op === "upsert") {
          response = await rt.call(plan, () =>
            rt.deps.vault.upsert(
              plan.target.targetObject,
              g.items.map((p) => p.vaultRow),
              opts,
            ),
          );
        } else {
          const upd = { ...opts };
          delete upd.idParam;
          response = await rt.call(plan, () =>
            rt.deps.vault.update(
              plan.target.targetObject,
              g.items.map((p) => p.vaultRow),
              upd,
            ),
          );
        }
      } catch (e) {
        const cls = e instanceof LoadCallError ? e.errorClass : "fatal";
        const type = errorTypeOf(
          e instanceof LoadCallError ? (e.cause ?? e) : e,
        );
        const message = errorMessageOf(e);
        if (cls === "retryable") {
          // budget exhausted → unit failed(transport)
          for (const p of g.items) fail(p.row, "TRANSPORT", message);
          structural = { type: "TRANSPORT", message };
        } else {
          for (const p of g.items) fail(p.row, type, message);
          structural = { type, message };
        }
        continue;
      }
      if (response.responseStatus === "FAILURE") {
        const err = response.errors?.[0];
        structural = {
          type: err?.type ?? "FAILURE",
          message:
            err?.message ?? response.responseMessage ?? "bulk call failed",
        };
        for (const p of g.items)
          fail(p.row, structural.type, structural.message);
        continue;
      }
      await this.recordRows(g, response, plan, batchNo, out, results, rr, fail);
    }

    out.elapsedMs = Date.now() - started;
    out.burstRemaining = rt.noteBurst(plan);
    if (structural) out.structuralError = structural;
    await rt.rowResults(results);
    if (ctx.fromPending) {
      const resolvedNow = prepared
        .filter((p) => ctx.fromPending!.has(p.row.sfdcId))
        .map((p) => ctx.fromPending!.get(p.row.sfdcId)!);
      await markPendingResolved(plan, rt.deps.store, resolvedNow, now);
    }
    log.info(
      {
        batch_no: batchNo,
        rows: batch.length,
        created: out.created,
        updated: out.updated,
        unchanged: out.unchanged,
        failed: out.failed,
        pending_fk: out.pendingFk,
        type_changed: out.typeChanged,
        elapsed_ms: out.elapsedMs,
        burst_remaining: out.burstRemaining,
      },
      "batch loaded",
    );
    return out;
  }

  private async recordRows(
    g: { op: Prepared["op"]; items: Prepared[] },
    response: VaultBulkResponse,
    plan: LoadPlan,
    batchNo: number,
    out: BatchOutcome,
    results: RowResult[],
    rr: (
      row: PayloadRow,
      state: RowState,
      extra?: Partial<RowResult>,
    ) => RowResult,
    fail: (
      row: PayloadRow,
      type: string,
      message: string,
      vaultId?: string,
    ) => void,
  ): Promise<void> {
    const rt = this.rt;
    const puts: IdMapRow[] = [];
    for (let i = 0; i < g.items.length; i++) {
      const p = g.items[i];
      const r = response.data[i];
      if (!r) {
        fail(
          p.row,
          "NO_ROW_RESULT",
          "response has fewer rows than the request",
        );
        continue;
      }
      if (r.responseStatus === "FAILURE" || r.responseStatus === "EXCEPTION") {
        fail(
          p.row,
          r.errors?.[0]?.type ?? "ROW_FAILED",
          r.errors?.[0]?.message ?? "row failed",
          p.idRow?.vaultId ?? p.hit?.vaultId,
        );
        continue;
      }
      const vaultId = r.data?.id ?? p.idRow?.vaultId ?? p.hit?.vaultId;
      if (!vaultId) {
        fail(p.row, "NO_VAULT_ID", "row result carries no id");
        continue;
      }
      let state: RowState;
      if (g.op === "upsert") {
        const event = r.data?.event ?? (p.idRow ? "update" : "create");
        state = event === "create" ? "loaded_created" : "loaded_updated";
      } else
        state =
          r.responseStatus === "WARNING"
            ? "loaded_unchanged"
            : "loaded_updated";
      if (state === "loaded_created") out.created++;
      else if (state === "loaded_updated") out.updated++;
      else out.unchanged++;
      results.push(rr(p.row, state, { vaultId }));
      puts.push({
        objectKey: plan.unit.objectKey,
        sfdcId: p.row.sfdcId,
        vaultDns: rt.deps.store.vaultDns,
        vaultObject: plan.target.targetObject,
        vaultId,
        country: p.idRow?.country ?? plan.unit.country,
        matchMethod: p.idRow?.matchMethod ?? p.hit?.method ?? "created",
        mergedInto: null,
        firstSeenRun: p.idRow?.firstSeenRun ?? plan.runId,
        lastSeenRun: plan.runId,
        sourceHash: p.row.sourceHash,
        verifiedHash: p.idRow?.verifiedHash ?? null,
        verifiedAt: p.idRow?.verifiedAt ?? null,
        deletedAt: null,
        // after a changetype/upsert the row's type is what Vault now holds; a matched
        // record that the payload does not type keeps the type Vault reported
        objectType:
          p.row.objectType ?? p.hit?.objectType ?? p.idRow?.objectType ?? null,
      });
    }
    for (const row of puts) await rt.deps.store.idMap.put(row);
  }

  // ------------------------------------------------------------- pass 2 …

  secondPass(
    rows: AsyncIterable<PayloadRow>,
    plan: LoadPlan,
  ): Promise<SecondPassResult> {
    return runSecondPass(this.rt, rows, plan);
  }

  async applyDeletes(
    req: DeleteRequest,
    plan: LoadPlan,
  ): Promise<DeleteResult> {
    const out = await this.applyDeletesDetailed(req, plan);
    const { ignoredDetail: _d, ...rest } = out;
    return rest;
  }

  /** §3.4 a / §4.2: `merged_into` for SFDC merge losers plus child fan-out PUTs. */
  applyMerges(req: MergeRequest, plan: LoadPlan): Promise<MergeResult> {
    return runMerges(this.rt, req, plan);
  }

  /** `applyDeletes` plus the per-id ignore reasons for the report. */
  applyDeletesDetailed(
    req: DeleteRequest,
    plan: LoadPlan,
  ): Promise<DeleteOutcome> {
    return runDeletes(this.rt, req, plan);
  }

  /** §8.4 one re-evaluation round of the pending queue. */
  async retryPending(plan: LoadPlan, round: number): Promise<LoadResult> {
    const entries = await readPendingQueue(plan);
    if (!entries.length) return emptyResult(plan);
    this.rt
      .log(plan)
      .info({ round, rows: entries.length }, "pending FK queue re-evaluated");
    await writePendingQueue(plan, []);
    const fromPending = new Map(entries.map((e) => [e.row.sfdcId, e] as const));
    return this.loadRows(
      entries.map((e) => e.row),
      plan,
      { fromPending, attempt: round + 1 },
    );
  }

  /** §8.4 leftovers → `failed(UNRESOLVED_FK)`; returns the number of rows failed. */
  async finalisePending(
    plan: LoadPlan,
  ): Promise<{ failed: number; targets: Record<string, string[]> }> {
    const entries = await failPending(
      plan,
      (rows) => this.rt.rowResults(rows),
      this.rt.now(),
    );
    const targets: Record<string, string[]> = {};
    for (const e of entries)
      for (const u of e.unresolved) {
        const list = (targets[u.objectKey] ??= []);
        if (list.length < 10) list.push(u.sfdcId);
      }
    if (entries.length)
      this.findings.push({
        severity: "warning",
        code: "UNRESOLVED_FK",
        objectKey: plan.unit.objectKey,
        country: plan.unit.country,
        detail: { rows: entries.length, targets },
        count: entries.length,
      });
    return { failed: entries.length, targets };
  }

  loadBlobs(rows: AsyncIterable<BlobRow>, plan: LoadPlan): Promise<LoadResult> {
    return runBlobs(this.rt, rows, plan);
  }

  /** Unresolved references of a queue entry (report helper). */
  static describeUnresolved(u: UnresolvedRef[]): string {
    return u.map((x) => `${x.field}→${x.objectKey}:${x.sfdcId}`).join(", ");
  }
}
