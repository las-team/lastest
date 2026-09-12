import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedTarget } from "../preflight/types";
import {
  FakeVaultClient,
  MemoryStateStore,
  buildMaterialisedMapping,
  buildVaultMetadata,
  resolveMetadata,
} from "../testkit";
import { to18 } from "../transform/ids";
import type { BlobPolicy } from "../types";
import type { BlobRow } from "./blobs";
import { DefaultLoader } from "./loader";
import type { LoadPlan } from "./types";

const A1 = to18("a0K000000000001");
const A2 = to18("a0K000000000002");
const A3 = to18("a0K000000000003");
const UNMAPPED = to18("a0K000000000009");

function meta(allowAttachments = false) {
  return buildVaultMetadata(
    "call2__v",
    [
      { name: "signature__v", type: "LongText", max_length: 12 },
      { name: "email_html__v", type: "LongText", max_length: 100000 },
      { name: "notes__v", type: "LongText", max_length: 100000 },
    ],
    { allowAttachments },
  );
}

async function* stream<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i;
}

describe("blob pass (§8.6)", () => {
  let runDir: string;
  let vault: FakeVaultClient;
  let store: MemoryStateStore;
  let ids: Record<string, string>;

  const plan = (
    blobs: Record<string, BlobPolicy>,
    over: Partial<LoadPlan> = {},
    allowAttachments = false,
  ): LoadPlan => {
    const m = meta(allowAttachments);
    const metadata = resolveMetadata(m);
    const target: ResolvedTarget = {
      objectKey: "call2",
      targetObject: "call2__v",
      legacyIdField: "legacy_crm_id__v",
      metadata,
      rawMetadata: m,
      objectTypes: [],
      picklists: {},
      replicateable: true,
      columns: [],
    };
    const mapping = buildMaterialisedMapping({
      objectKey: "call2",
      sourceObject: "Call2_vod__c",
      targetObject: "call2__v",
      fields: [],
    });
    mapping.options = { ...mapping.options, blobs };
    return {
      runId: "run-1",
      unit: { objectKey: "call2", country: "US" },
      mapping,
      target,
      runDir,
      dryRun: false,
      migrationMode: true,
      unchangedFieldBehavior: "AlwaysIgnore",
      batchSize: 500,
      batchWallTimeMs: 60000,
      ...over,
    };
  };

  const loader = (opts: { blobBatchBytes?: number } = {}) =>
    new DefaultLoader(
      { vault, store, country: "US", targetObjectOf: () => "call2__v" },
      { retry: { sleep: async () => {}, policy: { maxAttempts: 2 } }, ...opts },
    );

  beforeEach(async () => {
    runDir = mkdtempSync(path.join(os.tmpdir(), "vm-blob-"));
    vault = new FakeVaultClient();
    vault.addObject(meta(true));
    await vault.authenticate();
    store = new MemoryStateStore(vault.vaultDns);
    const res = await vault.upsert(
      "call2__v",
      [A1, A2, A3].map((id) => ({
        legacy_crm_id__v: id,
        name__v: `call ${id}`,
      })),
      { idParam: "legacy_crm_id__v", migrationMode: true },
    );
    ids = Object.fromEntries(
      [A1, A2, A3].map((id, i) => [id, res.data[i].data!.id!]),
    );
    await store.seedIdMap("call2", "call2__v", ids, "US");
  });
  afterEach(() => rmSync(runDir, { recursive: true, force: true }));

  it("PUTs blobs by Vault id after the row exists; unmapped rows are skipped; skip policy never sends", async () => {
    const r = await loader().loadBlobs(
      stream<BlobRow>([
        { sfdcId: A1, blobs: { notes__v: "hello", email_html__v: "<b>x</b>" } },
        { sfdcId: A2, blobs: { notes__v: "world" } },
        { sfdcId: UNMAPPED, blobs: { notes__v: "nobody" } },
      ]),
      plan({ notes__v: "optional", email_html__v: "skip" }),
    );
    expect(r).toMatchObject({
      updated: 2,
      failed: 0,
      skipped: 1,
      unchanged: 0,
    });
    expect(r.batches).toHaveLength(1);
    const call = vault.calls.filter((c) => c.method === "update").at(-1)!;
    expect(call.args[0]).toBe("call2__v");
    expect(call.args[1]).toEqual([
      { id: ids[A1], notes__v: "hello" },
      { id: ids[A2], notes__v: "world" },
    ]);
    expect((call.headers as { idParam?: string }).idParam).toBeUndefined(); // by id, not idParam
    expect(vault.record("call2__v", ids[A1])).toMatchObject({
      notes__v: "hello",
    });
    expect(vault.record("call2__v", ids[A1])?.email_html__v).toBeUndefined();
  });

  it("optional blobs are dropped when the target is missing or too short; required ones fail the row", async () => {
    const r = await loader().loadBlobs(
      stream<BlobRow>([
        {
          sfdcId: A1,
          blobs: {
            signature__v: "way longer than twelve chars",
            photo__v: "img",
          },
        },
        { sfdcId: A2, blobs: { signature__v: "short", notes__v: "n" } },
      ]),
      plan({
        signature__v: "optional",
        photo__v: "optional",
        notes__v: "optional",
      }),
    );
    expect(r).toMatchObject({ updated: 1, failed: 0, skipped: 1 });
    expect(vault.record("call2__v", ids[A2])).toMatchObject({
      signature__v: "short",
      notes__v: "n",
    });

    const req = await loader().loadBlobs(
      stream<BlobRow>([
        { sfdcId: A1, blobs: { signature__v: "way longer than twelve chars" } },
        { sfdcId: A3, blobs: { photo__v: "img" } },
      ]),
      plan({ signature__v: "required", photo__v: "required" }),
    );
    expect(req).toMatchObject({ updated: 0, failed: 2 });
    expect(await store.rowResults.get("run-1", "call2", A1)).toMatchObject({
      state: "failed",
      errorType: "BLOB_TOO_LONG",
      vaultId: ids[A1],
    });
    expect(await store.rowResults.get("run-1", "call2", A3)).toMatchObject({
      state: "failed",
      errorType: "BLOB_TARGET_MISSING",
    });
  });

  it("attachment policy posts an attachment, only when the object allows attachments", async () => {
    const ok = await loader().loadBlobs(
      stream([{ sfdcId: A1, blobs: { signature_page__v: "aGVsbG8=" } }]),
      plan({ signature_page__v: "attachment" }, {}, true),
    );
    expect(ok).toMatchObject({ updated: 1, failed: 0 });
    const att = vault.calls.find((c) => c.method === "addAttachment")!;
    expect(att.args.slice(0, 3)).toEqual([
      "call2__v",
      ids[A1],
      "signature_page__v.bin",
    ]);
    expect(att.args[3]).toBe(5); // base64 "hello" decoded
    expect(vault.record("call2__v", ids[A1])?.__attachments).toEqual([
      "signature_page__v.bin",
    ]);

    const denied = await loader().loadBlobs(
      stream([{ sfdcId: A2, blobs: { signature_page__v: "x" } }]),
      plan({ signature_page__v: "attachment" }, {}, false),
    );
    expect(denied).toMatchObject({ updated: 0, failed: 1 });
    expect((await store.rowResults.get("run-1", "call2", A2))?.errorType).toBe(
      "BLOB_ATTACHMENTS_DISABLED",
    );
  });

  it("caps batches at performance.blobBatchBytes and 500 rows", async () => {
    const big = "x".repeat(40);
    const r = await loader({ blobBatchBytes: 100 }).loadBlobs(
      stream<BlobRow>(
        [A1, A2, A3].map((id) => ({ sfdcId: id, blobs: { notes__v: big } })),
      ),
      plan({ notes__v: "optional" }),
    );
    expect(r.updated).toBe(3);
    expect(r.batches.map((b) => b.rows)).toEqual([2, 1]);
    expect(vault.calls.filter((c) => c.method === "update")).toHaveLength(2);
  });

  it("dry-run sends nothing and simulates", async () => {
    const r = await loader().loadBlobs(
      stream([{ sfdcId: A1, blobs: { notes__v: "n" } }]),
      plan({ notes__v: "optional" }, { dryRun: true }),
    );
    expect(r).toMatchObject({ updated: 1, failed: 0 });
    expect(
      vault.calls.filter(
        (c) => c.method === "update" || c.method === "addAttachment",
      ),
    ).toHaveLength(0);
    expect(vault.record("call2__v", ids[A1])?.notes__v).toBeUndefined();
  });

  it("row-level failures from Vault are recorded per row without aborting the batch", async () => {
    vault.rowFailures.push({
      object: "call2__v",
      field: "id",
      value: ids[A1],
      type: "INVALID_DATA",
      message: "locked",
    });
    const r = await loader().loadBlobs(
      stream([
        { sfdcId: A1, blobs: { notes__v: "a" } },
        { sfdcId: A2, blobs: { notes__v: "b" } },
      ]),
      plan({ notes__v: "optional" }),
    );
    expect(r).toMatchObject({ updated: 1, failed: 1 });
    expect(await store.rowResults.get("run-1", "call2", A1)).toMatchObject({
      state: "failed",
      errorType: "INVALID_DATA",
    });
    expect(vault.record("call2__v", ids[A2])?.notes__v).toBe("b");
  });
});
