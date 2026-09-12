/**
 * §6.1 pass 2: self-reference / cyclic fields held back in `secondPass`
 * payloads are patched with `PUT /vobjects/{object}` by Vault `id` once the
 * referenced rows exist in the id map. Idempotent (§8.2): only the deferred
 * fields are sent, addressed by id.
 */
import type { PendingFk, RowResult } from "../types";
import type { VaultRow } from "../vault/types";
import { cutBatches } from "./batcher";
import type { LoaderRuntime } from "./context";
import {
  RefIndex,
  collectRefs,
  resolvePayload,
  type RefKey,
} from "./resolve-refs";
import { LoadCallError, errorMessageOf, errorTypeOf } from "./retry";
import type { LoadPlan, PayloadRow, SecondPassResult } from "./types";

export async function runSecondPass(
  rt: LoaderRuntime,
  rows: AsyncIterable<PayloadRow>,
  plan: LoadPlan,
): Promise<SecondPassResult> {
  const log = rt.log(plan);
  const result: SecondPassResult = {
    unit: plan.unit,
    patched: 0,
    failed: 0,
    unresolved: 0,
    unresolvedIds: [],
  };
  const withPatches = (async function* () {
    for await (const r of rows)
      if (r.secondPass && Object.keys(r.secondPass).length) yield r;
  })();
  const size = plan.mapping.load.batchSize ?? plan.batchSize;
  for await (const batch of cutBatches(withPatches, () => size)) {
    const batchNo = await rt.nextBatchNo(plan);
    const own = await rt.deps.store.idMap.bulkGet(
      plan.unit.objectKey,
      batch.map((r) => r.sfdcId),
    );
    const refs = new Map<RefKey, Set<string>>();
    for (const r of batch) collectRefs(r.secondPass!, refs);
    const index = await RefIndex.build(rt.deps.store, refs, {
      dryRun: plan.dryRun,
    });

    const sent: Array<{
      row: PayloadRow;
      vaultRow: VaultRow;
      fields: string[];
    }> = [];
    const pending: PendingFk[] = [];
    for (const row of batch) {
      const me = own.get(row.sfdcId);
      if (!me || (me.dryRun && !plan.dryRun)) {
        result.unresolved++;
        result.unresolvedIds.push(row.sfdcId);
        continue;
      }
      const resolved = resolvePayload(row.secondPass!, index);
      if (resolved.unresolved.length) {
        // §3.5: recorded as `pending_fk` diagnostics (field level) — the row itself stays loaded;
        // the engine re-tries once every unit landed, `verify --fk` re-points later
        result.unresolved++;
        result.unresolvedIds.push(row.sfdcId);
        for (const u of resolved.unresolved)
          pending.push({
            runId: plan.runId,
            objectKey: plan.unit.objectKey,
            country: plan.unit.country,
            sfdcId: row.sfdcId,
            field: u.field,
            targetObjectKey: u.objectKey,
            targetSfdcId: u.sfdcId,
            attempts: 1,
          });
        log.debug(
          {
            sfdc_id: row.sfdcId,
            fields: resolved.unresolved.map((u) => u.field),
          },
          "second-pass reference unresolved",
        );
      }
      const fields = Object.entries(resolved.row).filter(
        ([, v]) => v !== undefined,
      );
      if (!fields.length) continue;
      sent.push({
        row,
        vaultRow: { id: me.vaultId, ...Object.fromEntries(fields) },
        fields: fields.map(([k]) => k),
      });
    }
    if (pending.length && !plan.dryRun)
      await rt.deps.store.pendingFk.add(pending);
    if (!sent.length) continue;
    if (plan.dryRun) {
      result.patched += sent.length;
      continue;
    }
    const opts = rt.writeOptions(plan, batchNo);
    delete opts.idParam;
    let response;
    try {
      response = await rt.call(plan, () =>
        rt.deps.vault.update(
          plan.target.targetObject,
          sent.map((s) => s.vaultRow),
          opts,
        ),
      );
    } catch (e) {
      const type = e instanceof LoadCallError ? e.type : errorTypeOf(e);
      log.error({ err: e, batch_no: batchNo }, "second-pass batch failed");
      result.failed += sent.length;
      await rt.rowResults(
        sent.map((s) =>
          failedRow(plan, s.row, batchNo, type, errorMessageOf(e), rt.now()),
        ),
      );
      continue;
    }
    const failures: RowResult[] = [];
    const patched: Array<{ sfdcId: string; fields: string[] }> = [];
    response.data.forEach((rr, i) => {
      const s = sent[i];
      if (!s) return;
      if (rr.responseStatus === "FAILURE") {
        result.failed++;
        failures.push(
          failedRow(
            plan,
            s.row,
            batchNo,
            rr.errors?.[0]?.type ?? "SECOND_PASS_FAILED",
            rr.errors?.[0]?.message ?? "second-pass update failed",
            rt.now(),
          ),
        );
      } else {
        result.patched++;
        patched.push({ sfdcId: s.row.sfdcId, fields: s.fields });
      }
    });
    await rt.rowResults(failures);
    // a field patched on a retry closes its earlier pending_fk diagnostic
    const now = rt.now();
    for (const p of patched)
      for (const f of p.fields)
        await rt.deps.store.pendingFk.resolve(
          plan.runId,
          plan.unit.objectKey,
          p.sfdcId,
          f,
          now,
        );
    rt.noteBurst(plan);
    log.info(
      { batch_no: batchNo, rows: sent.length, failed: failures.length },
      "second-pass batch",
    );
  }
  return result;
}

function failedRow(
  plan: LoadPlan,
  row: PayloadRow,
  batchNo: number,
  type: string,
  message: string,
  now: string,
): RowResult {
  return {
    runId: plan.runId,
    objectKey: plan.unit.objectKey,
    country: plan.unit.country,
    sfdcId: row.sfdcId,
    batchNo,
    state: "failed",
    errorType: type,
    errorMessage: message,
    attempt: 1,
    payloadHash: row.sourceHash,
    updatedAt: now,
  };
}
