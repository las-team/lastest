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
import type {
  DeleteRequest,
  DeleteResult,
  LoadPlan,
  MergeRequest,
  MergeResult,
} from "./types";

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

/**
 * Instant of an SFDC timestamp for ordering. The sources disagree on the
 * literal form (`…T10:00:00.000Z` from Bulk CSV / `SystemModstamp`,
 * `…T10:00:00.000+0000` or `+00:00` from the REST delete feed), so string
 * comparison would order equal instants by their suffix character.
 */
export function instantOf(ts: string): number {
  return Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/** `a` is strictly later than `b` (false when either is unparseable). */
export function isLater(a: string, b: string): boolean {
  const ia = instantOf(a);
  const ib = instantOf(b);
  return !Number.isNaN(ia) && !Number.isNaN(ib) && ia > ib;
}

/** Dedupe by id keeping the latest `deletedDate`. */
export function latestDeletes(
  ids: DeleteRequest["ids"],
): Array<{ sfdcId: string; deletedDate: string }> {
  const m = new Map<string, string>();
  for (const { sfdcId, deletedDate } of ids) {
    const id = to18(sfdcId);
    const prev = m.get(id);
    if (prev === undefined || isLater(deletedDate, prev))
      m.set(id, deletedDate);
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
    if (seen && isLater(seen, deletedDate)) {
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
    if (plan.target.metadata.fields[f.field])
      inactivateFields[f.field] = f.value;
  const state = req.policy === "delete" ? "deleted" : "inactivated";

  for (let i = 0; i < candidates.length; i += VAULT_MAX_BATCH) {
    const batch = candidates.slice(i, i + VAULT_MAX_BATCH);
    const batchNo = await rt.nextBatchNo(plan);
    const opts = rt.writeOptions(plan, batchNo);
    let response: VaultBulkResponse;
    try {
      response = await rt.call(plan, () =>
        req.policy === "delete"
          ? rt.deps.vault.deleteRecords(
              plan.target.targetObject,
              batch.map((c) => c.idRow.vaultId),
              {
                referenceId: opts.referenceId,
                migrationMode: opts.migrationMode,
              },
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
          rowResult(
            plan,
            c.sfdcId,
            batchNo,
            "failed",
            errorTypeOf(e),
            errorMessageOf(e),
            rt.now(),
          ),
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
          await rt.deps.store.idMap.markDeleted(
            plan.unit.objectKey,
            c.sfdcId,
            c.deletedDate,
          );
          results.push(
            rowResult(
              plan,
              c.sfdcId,
              batchNo,
              state,
              null,
              null,
              rt.now(),
              c.idRow.vaultId,
            ),
          );
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
      await rt.deps.store.idMap.markDeleted(
        plan.unit.objectKey,
        c.sfdcId,
        c.deletedDate,
      );
      results.push(
        rowResult(
          plan,
          c.sfdcId,
          batchNo,
          state,
          null,
          null,
          rt.now(),
          c.idRow.vaultId,
        ),
      );
    }
    await rt.rowResults(results);
    rt.noteBurst(plan);
    log.info(
      {
        batch_no: batchNo,
        rows: batch.length,
        policy: req.policy,
        applied: out.applied,
        failed: out.failed,
      },
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

/**
 * §3.4 a / §4.2 step 2: SFDC merge losers (`MasterRecordId` on the deleted
 * row) are recorded as `merged_into = survivor` in the id map and every
 * child whose stored FK (`fk_index`) pointed at the loser gets a PUT of that
 * field with the survivor's Vault id. The child's `source_hash` is cleared
 * so the next delta re-sends the full row (its own `SystemModstamp` never
 * moved). Runs after the delete policy was applied to the loser record.
 */
export async function runMerges(
  rt: LoaderRuntime,
  req: MergeRequest,
  plan: LoadPlan,
): Promise<MergeResult> {
  const log = rt.log(plan);
  const key = plan.unit.objectKey;
  const out: MergeResult = {
    unit: plan.unit,
    merged: 0,
    skipped: 0,
    childrenRepointed: 0,
    childrenFailed: 0,
  };
  if (!req.merges.length) return out;
  const byLoser = new Map<string, { survivor: string; deletedDate: string }>();
  for (const m of req.merges) {
    const loser = to18(m.loser);
    const prev = byLoser.get(loser);
    if (!prev || isLater(m.deletedDate, prev.deletedDate))
      byLoser.set(loser, {
        survivor: to18(m.survivor),
        deletedDate: m.deletedDate,
      });
  }
  const rows = await rt.deps.store.idMap.bulkGet(key, [
    ...new Set([
      ...byLoser.keys(),
      ...[...byLoser.values()].map((v) => v.survivor),
    ]),
  ]);
  const repoint: Array<{ loser: string; survivor: IdMapRow }> = [];
  for (const [loser, { survivor, deletedDate }] of byLoser) {
    const seen = req.seenModstamps?.get(loser);
    if (seen && isLater(seen, deletedDate)) {
      out.skipped++; // loser modified after the merge event (undelete) — last-wins
      continue;
    }
    const l = rows.get(loser);
    if (!l || l.dryRun || l.mergedInto) {
      out.skipped++;
      continue;
    }
    let s = rows.get(survivor);
    if (s?.mergedInto)
      s =
        rows.get(s.mergedInto) ??
        (await rt.deps.store.idMap.get(key, s.mergedInto));
    if (!s || s.dryRun || s.sfdcId === loser) {
      out.skipped++;
      log.warn(
        { loser, survivor },
        "merge survivor not in the id map — loser kept as deleted",
      );
      continue;
    }
    if (plan.dryRun) {
      out.merged++;
      continue;
    }
    await rt.deps.store.idMap.merge(key, loser, s.sfdcId, plan.runId);
    out.merged++;
    repoint.push({ loser, survivor: s });
  }
  if (plan.dryRun || !repoint.length) return out;

  for (const { loser, survivor } of repoint) {
    const children = await rt.deps.store.fkIndex.childrenOf(key, loser);
    const byObject = new Map<string, typeof children>();
    for (const c of children)
      (
        byObject.get(c.objectKey) ??
        byObject.set(c.objectKey, []).get(c.objectKey)!
      ).push(c);
    for (const [childKey, edges] of byObject) {
      const object = rt.deps.targetObjectOf(childKey as IdMapRow["objectKey"]);
      if (!object) {
        out.childrenFailed += edges.length;
        log.warn(
          { child: childKey, rows: edges.length },
          "merge fan-out: child object not resolved",
        );
        continue;
      }
      const childRows = await rt.deps.store.idMap.bulkGet(
        childKey as IdMapRow["objectKey"],
        [...new Set(edges.map((e) => e.sfdcId))],
      );
      const puts = new Map<
        string,
        { idRow: IdMapRow; row: VaultRow; fields: string[] }
      >();
      for (const e of edges) {
        const idRow = childRows.get(e.sfdcId);
        if (!idRow || idRow.dryRun || idRow.mergedInto || idRow.deletedAt)
          continue;
        const p =
          puts.get(e.sfdcId) ??
          puts
            .set(e.sfdcId, { idRow, row: { id: idRow.vaultId }, fields: [] })
            .get(e.sfdcId)!;
        p.row[e.field] = survivor.vaultId;
        p.fields.push(e.field);
      }
      const items = [...puts.values()];
      for (let i = 0; i < items.length; i += VAULT_MAX_BATCH) {
        const batch = items.slice(i, i + VAULT_MAX_BATCH);
        const batchNo = await rt.nextBatchNo(plan);
        const referenceId = `${plan.runId}:${childKey}:merge-${batchNo}`;
        let response: VaultBulkResponse;
        try {
          response = await rt.call(plan, () =>
            rt.deps.vault.update(
              object,
              batch.map((b) => b.row),
              { migrationMode: true, referenceId },
            ),
          );
        } catch (e) {
          out.childrenFailed += batch.length;
          log.error({ err: e, child: childKey }, "merge fan-out batch failed");
          await rt.rowResults(
            batch.map((b) =>
              childResult(
                plan,
                b.idRow,
                batchNo,
                "failed",
                errorTypeOf(e),
                errorMessageOf(e),
                rt.now(),
              ),
            ),
          );
          continue;
        }
        const results: RowResult[] = [];
        for (let j = 0; j < batch.length; j++) {
          const b = batch[j];
          const rr = response.data[j];
          if (!rr || rr.responseStatus === "FAILURE") {
            out.childrenFailed++;
            results.push(
              childResult(
                plan,
                b.idRow,
                batchNo,
                "failed",
                rr?.errors?.[0]?.type ?? "MERGE_FANOUT_FAILED",
                rr?.errors?.[0]?.message ?? "no row result",
                rt.now(),
              ),
            );
            continue;
          }
          out.childrenRepointed++;
          // the child row itself is unchanged in SFDC: clear the hash so the next delta re-sends it whole
          await rt.deps.store.idMap.setSourceHash(
            b.idRow.objectKey,
            b.idRow.sfdcId,
            "",
            plan.runId,
          );
          results.push(
            childResult(
              plan,
              b.idRow,
              batchNo,
              "loaded_updated",
              null,
              null,
              rt.now(),
            ),
          );
        }
        await rt.rowResults(results);
        rt.noteBurst(plan);
      }
      log.info(
        {
          loser,
          survivor: survivor.sfdcId,
          child: childKey,
          rows: items.length,
        },
        "merge fan-out",
      );
    }
  }
  return out;
}

function childResult(
  plan: LoadPlan,
  idRow: IdMapRow,
  batchNo: number,
  state: RowResult["state"],
  errorType: string | null,
  errorMessage: string | null,
  now: string,
): RowResult {
  return {
    runId: plan.runId,
    objectKey: idRow.objectKey,
    country: idRow.country,
    sfdcId: idRow.sfdcId,
    batchNo,
    state,
    errorType,
    errorMessage,
    attempt: 1,
    vaultId: idRow.vaultId,
    updatedAt: now,
  };
}
