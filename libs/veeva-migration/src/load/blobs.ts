/**
 * §8.6 blob pass: fields marked `deferredBlob` (signatures, email bodies,
 * photos, thumbnails) are written after the row exists, with `PUT` by Vault
 * `id`, in batches capped at `performance.blobBatchBytes` (default 64 MB)
 * and 500 rows. Per-blob policy (`objects.<key>.blobs.<name>`):
 *   required   → a missing/oversized target fails the row (`BLOB_TARGET_MISSING`/`BLOB_TOO_LONG`)
 *   optional   → dropped with a diagnostic (default)
 *   attachment → `POST /vobjects/{object}/{id}/attachments` (needs `allow_attachments`)
 *   skip       → never sent
 */
import type { BlobPolicy, Payload, RowResult } from "../types";
import type { VaultRow } from "../vault/types";
import { VAULT_MAX_BATCH } from "./batcher";
import type { LoaderRuntime } from "./context";
import { errorMessageOf, errorTypeOf } from "./retry";
import type { BatchOutcome, LoadPlan, LoadResult } from "./types";

export const DEFAULT_BLOB_BATCH_BYTES = 64 * 1024 * 1024;

export interface BlobRow {
  sfdcId: string;
  blobs: Payload;
}

export function blobNameOf(plan: LoadPlan, field: string): string {
  return plan.mapping.fields.find((f) => f.target === field)?.blobName ?? field;
}

export function blobPolicyOf(plan: LoadPlan, field: string): BlobPolicy {
  const name = blobNameOf(plan, field);
  const p = plan.mapping.options.blobs?.[name];
  return p ?? "optional";
}

function byteLength(v: unknown): number {
  return typeof v === "string" ? Buffer.byteLength(v, "utf8") : 8;
}

function decodeAttachment(v: string): Uint8Array {
  // base64 when it looks like base64, otherwise raw text
  return /^[A-Za-z0-9+/=\r\n]+$/.test(v) && v.length % 4 === 0
    ? new Uint8Array(Buffer.from(v, "base64"))
    : new Uint8Array(Buffer.from(v, "utf8"));
}

export async function runBlobs(
  rt: LoaderRuntime,
  rows: AsyncIterable<BlobRow>,
  plan: LoadPlan,
): Promise<LoadResult> {
  const log = rt.log(plan);
  const cap = rt.opts.blobBatchBytes ?? DEFAULT_BLOB_BATCH_BYTES;
  const result: LoadResult = {
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
  const fields = plan.target.metadata.fields;
  let batch: Array<{ sfdcId: string; row: VaultRow; vaultId: string }> = [];
  let attachments: Array<{
    sfdcId: string;
    vaultId: string;
    field: string;
    value: string;
  }> = [];
  let bytes = 0;
  let batchNo = 0;
  let pendingLookup: BlobRow[] = [];

  const flush = async () => {
    if (!batch.length && !attachments.length) return;
    batchNo = await rt.nextBatchNo(plan);
    const started = Date.now();
    const outcome: BatchOutcome = {
      batchNo,
      rows: batch.length + attachments.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      pendingFk: 0,
      elapsedMs: 0,
    };
    const results: RowResult[] = [];
    if (!plan.dryRun && batch.length) {
      const opts = rt.writeOptions(plan, batchNo);
      delete opts.idParam;
      try {
        const res = await rt.call(plan, () =>
          rt.deps.vault.update(
            plan.target.targetObject,
            batch.map((b) => b.row),
            opts,
          ),
        );
        res.data.forEach((rr, i) => {
          const b = batch[i];
          if (!b) return;
          if (rr.responseStatus === "FAILURE") {
            outcome.failed++;
            results.push(
              rowResult(
                plan,
                b.sfdcId,
                batchNo,
                "failed",
                rr.errors?.[0]?.type ?? "BLOB_FAILED",
                rr.errors?.[0]?.message ?? "blob update failed",
                rt.now(),
                b.vaultId,
              ),
            );
          } else if (rr.responseStatus === "WARNING") outcome.unchanged++;
          else outcome.updated++;
        });
      } catch (e) {
        outcome.failed += batch.length;
        results.push(
          ...batch.map((b) =>
            rowResult(
              plan,
              b.sfdcId,
              batchNo,
              "failed",
              errorTypeOf(e),
              errorMessageOf(e),
              rt.now(),
              b.vaultId,
            ),
          ),
        );
        log.error({ err: e, batch_no: batchNo }, "blob batch failed");
      }
    } else if (plan.dryRun) outcome.updated += batch.length;

    for (const a of attachments) {
      if (plan.dryRun) {
        outcome.updated++;
        continue;
      }
      if (!rt.deps.vault.addAttachment) {
        outcome.failed++;
        results.push(
          rowResult(
            plan,
            a.sfdcId,
            batchNo,
            "failed",
            "ATTACHMENTS_UNSUPPORTED",
            "client has no addAttachment",
            rt.now(),
            a.vaultId,
          ),
        );
        continue;
      }
      try {
        await rt.call(plan, () =>
          rt.deps.vault.addAttachment!(plan.target.targetObject, a.vaultId, {
            name: `${a.field}.bin`,
            content: decodeAttachment(a.value),
          }),
        );
        outcome.updated++;
      } catch (e) {
        outcome.failed++;
        results.push(
          rowResult(
            plan,
            a.sfdcId,
            batchNo,
            "failed",
            errorTypeOf(e),
            errorMessageOf(e),
            rt.now(),
            a.vaultId,
          ),
        );
      }
    }
    outcome.elapsedMs = Date.now() - started;
    outcome.burstRemaining = rt.noteBurst(plan);
    await rt.rowResults(results);
    result.batches.push(outcome);
    result.updated += outcome.updated;
    result.unchanged += outcome.unchanged;
    result.failed += outcome.failed;
    log.info(
      { batch_no: batchNo, rows: outcome.rows, bytes, failed: outcome.failed },
      "blob batch",
    );
    batch = [];
    attachments = [];
    bytes = 0;
  };

  const process = async (items: BlobRow[]) => {
    if (!items.length) return;
    const idRows = await rt.deps.store.idMap.bulkGet(
      plan.unit.objectKey,
      items.map((i) => i.sfdcId),
    );
    for (const item of items) {
      const idRow = idRows.get(item.sfdcId);
      if (!idRow || idRow.dryRun || idRow.deletedAt) {
        result.skipped++;
        continue;
      }
      const row: VaultRow = { id: idRow.vaultId };
      let rowBytes = 0;
      let failed: string | undefined;
      for (const [field, value] of Object.entries(item.blobs)) {
        if (value === null || value === undefined || typeof value === "object")
          continue;
        const policy = blobPolicyOf(plan, field);
        if (policy === "skip") continue;
        const meta = fields[field];
        const text = String(value);
        if (policy === "attachment") {
          if (!plan.target.metadata.allowAttachments) {
            failed = `BLOB_ATTACHMENTS_DISABLED:${field}`;
            break;
          }
          attachments.push({
            sfdcId: item.sfdcId,
            vaultId: idRow.vaultId,
            field,
            value: text,
          });
          continue;
        }
        if (!meta) {
          if (policy === "required") {
            failed = `BLOB_TARGET_MISSING:${field}`;
            break;
          }
          continue;
        }
        if (meta.maxLength !== undefined && text.length > meta.maxLength) {
          if (policy === "required") {
            failed = `BLOB_TOO_LONG:${field}`;
            break;
          }
          log.debug(
            { sfdc_id: item.sfdcId, field },
            "optional blob dropped: too long for target",
          );
          continue;
        }
        row[field] = value;
        rowBytes += byteLength(value);
      }
      if (failed) {
        const [type, field] = failed.split(":");
        result.failed++;
        await rt.rowResults([
          rowResult(
            plan,
            item.sfdcId,
            batchNo + 1,
            "failed",
            type,
            `blob ${field} cannot be loaded under policy required`,
            rt.now(),
            idRow.vaultId,
          ),
        ]);
        continue;
      }
      if (Object.keys(row).length <= 1) {
        if (!attachments.some((a) => a.sfdcId === item.sfdcId))
          result.skipped++;
        continue;
      }
      if (
        batch.length >= VAULT_MAX_BATCH ||
        (bytes + rowBytes > cap && batch.length)
      )
        await flush();
      batch.push({ sfdcId: item.sfdcId, row, vaultId: idRow.vaultId });
      bytes += rowBytes;
    }
  };

  for await (const item of rows) {
    pendingLookup.push(item);
    if (pendingLookup.length >= VAULT_MAX_BATCH) {
      await process(pendingLookup);
      pendingLookup = [];
    }
  }
  await process(pendingLookup);
  await flush();
  return result;
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
