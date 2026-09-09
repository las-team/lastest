/**
 * §4.3 step 5 / §4.4 deletes. Last-wins: a delete event older than the
 * `SystemModstamp` seen for the same id in this window is stale (an update
 * after undelete keeps the row). Policies:
 *  - `delete`      → `DELETE /vobjects/{obj}` by Vault id (≤ 500 per call);
 *  - `inactivate`  → `PUT` of `status__v = inactive__v` plus the module's
 *                    inactivation field set (`options.inactivateBy`), in
 *                    migration mode;
 *  - `ignore`      → no target change, listed in the report.
 * Every applied delete sets `id_map.deleted_at` (row kept, §4.4) so an
 * undelete re-links to the same Vault id.
 */
import { to18 } from "../transform/ids";
import type { IdMapRow, RowResult } from "../types";
import type { VaultBulkResponse, VaultRow } from "../vault/types";
import { VAULT_MAX_BATCH } from "./batcher";
import type { LoaderRuntime } from "./context";
import { errorMessageOf, errorTypeOf } from "./retry";
import type { DeleteRequest, DeleteResult, LoadPlan } from "./types";

export interface DeleteCandidate {
  sfdcId: string;
  deletedDate: string;
  idRow: IdMapRow;
}

/** Ids not applied, with the reason (report input). */
export interface IgnoredDelete {
  sfdcId: string;
  reason:
    | "policy_ignore"
    | "update_after_delete"
    | "not_mapped"
    | "already_deleted"
    | "merged";
}

export interface DeleteOutcome extends DeleteResult {
  ignoredDetail: IgnoredDelete[];
}

/** Dedupe by id keeping the latest `deletedDate`. */
export function latestDeletes(
  ids: DeleteRequest["ids"],
): Array<{ sfdcId: string; deletedDate: string }> {
  const m = new Map<string, string>();
  for (const { sfdcId, deletedDate } of ids) {
    const id = to18(sfdcId);
    const prev = m.get(id);
    if (prev === undefined || prev < deletedDate) m.set(id, deletedDate);
  }
  return [...m].map(([sfdcId, deletedDate]) => ({ sfdcId, deletedDate }));
}

export async function runDeletes(
  rt: LoaderRuntime,
  req: DeleteRequest,
  plan: LoadPlan,
): Promise<DeleteOutcome> {
  const log = rt.log(plan);
  const ids = latestDeletes(req.ids);
  const out: DeleteOutcome = {
    unit: plan.unit,
    routed: ids.length,
    applied: 0,
    ignored: 0,
    pending: 0,
    failed: 0,
    ignoredDetail: [],
  };
  if (!ids.length) return out;
  const ignore = (sfdcId: string, reason: IgnoredDelete["reason"]) => {
    out.ignored++;
    out.ignoredDetail.push({ sfdcId, reason });
  };
  if (req.policy === "ignore") {
    for (const { sfdcId } of ids) ignore(sfdcId, "policy_ignore");
    log.info({ routed: out.routed }, "deletes ignored by policy");
    return out;
  }
  const idRows = await rt.deps.store.idMap.bulkGet(
    plan.unit.objectKey,
    ids.map((i) => i.sfdcId),
  );
  const candidates: DeleteCandidate[] = [];
  for (const { sfdcId, deletedDate } of ids) {
    const seen = req.seenModstamps?.get(sfdcId);
    if (seen && seen > deletedDate) {
      ignore(sfdcId, "update_after_delete");
      continue;
    }
    const idRow = idRows.get(sfdcId);
    if (!idRow || idRow.dryRun) {
      ignore(sfdcId, "not_mapped");
      continue;
    }
    if (idRow.mergedInto) {
      ignore(sfdcId, "merged");
      continue;
    }
    if (idRow.deletedAt) {
      ignore(sfdcId, "already_deleted");
      continue;
    }
    candidates.push({ sfdcId, deletedDate, idRow });
  }
  if (!candidates.length) return out;
  if (plan.dryRun) {
    out.applied += candidates.length;
    return out;
  }

  const inactivateFields: VaultRow = { status__v: "inactive__v" };
  for (const f of plan.mapping.options.inactivateBy)
    if (plan.target.metadata.fields[f.field]) inactivateFields[f.field] = f.value;
  const state = req.policy === "delete" ? "deleted" : "inactivated";

  let batchNo = 0;
  for (let i = 0; i < candidates.length; i += VAULT_MAX_BATCH) {
    const batch = candidates.slice(i, i + VAULT_MAX_BATCH);
    batchNo++;
    const opts = rt.writeOptions(plan, batchNo);
    let response: VaultBulkResponse;
    try {
      response = await rt.call(plan, () =>
        req.policy === "delete"
          ? rt.deps.vault.deleteRecords(
              plan.target.targetObject,
              batch.map((c) => c.idRow.vaultId),
              { referenceId: opts.referenceId, migrationMode: opts.migrationMode },
            )
          : rt.deps.vault.update(
              plan.target.targetObject,
              batch.map((c) => ({ id: c.idRow.vaultId, ...inactivateFields })),
              {
                migrationMode: true,
                noTriggers: opts.noTriggers,
                referenceId: opts.referenceId,
              },
            ),
      );
    } catch (e) {
      log.error({ err: e, batch_no: batchNo }, "delete batch failed");
      out.failed += batch.length;
      await rt.rowResults(
        batch.map((c) =>
          rowResult(plan, c.sfdcId, batchNo, "failed", errorTypeOf(e), errorMessageOf(e), rt.now()),
        ),
      );
      continue;
    }
    const results: RowResult[] = [];
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const rr = response.data[j];
      const notFound =
        rr?.responseStatus === "FAILURE" &&
        /not found|does not exist/i.test(rr.errors?.[0]?.message ?? "");
      if (!rr || rr.responseStatus === "FAILURE") {
        if (notFound && req.policy === "delete") {
          // already gone in Vault: the delete is effectively applied
          out.applied++;
          await rt.deps.store.idMap.markDeleted(plan.unit.objectKey, c.sfdcId, c.deletedDate);
          results.push(rowResult(plan, c.sfdcId, batchNo, state, null, null, rt.now(), c.idRow.vaultId));
          continue;
        }
        out.failed++;
        results.push(
          rowResult(
            plan,
            c.sfdcId,
            batchNo,
            "failed",
            rr?.errors?.[0]?.type ?? "DELETE_FAILED",
            rr?.errors?.[0]?.message ?? "no row result",
            rt.now(),
            c.idRow.vaultId,
          ),
        );
        continue;
      }
      out.applied++;
      await rt.deps.store.idMap.markDeleted(plan.unit.objectKey, c.sfdcId, c.deletedDate);
      results.push(rowResult(plan, c.sfdcId, batchNo, state, null, null, rt.now(), c.idRow.vaultId));
    }
    await rt.rowResults(results);
    rt.noteBurst(plan);
    log.info(
      { batch_no: batchNo, rows: batch.length, policy: req.policy, applied: out.applied, failed: out.failed },
      "delete batch",
    );
  }
  return out;
}

function rowResult(
  plan: LoadPlan,
  sfdcId: string,
  batchNo: number,
  state: RowResult["state"],
  errorType: string | null,
  errorMessage: string | null,
  now: string,
  vaultId?: string,
): RowResult {
  return {
    runId: plan.runId,
    objectKey: plan.unit.objectKey,
    country: plan.unit.country,
    sfdcId,
    batchNo,
    state,
    errorType,
    errorMessage,
    attempt: 1,
    vaultId: vaultId ?? null,
    updatedAt: now,
  };
}
