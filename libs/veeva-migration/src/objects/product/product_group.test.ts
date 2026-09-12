import { describe, expect, it } from "vitest";
import { product_group } from "./product_group";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const GROUP_ID = to18("a0Q000000000001");

const config = parseConfig({
  version: 1,
  source: {
    loginUrl: "https://x.my.salesforce.com",
    auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
  },
  target: {
    vaultDns: "x.veevavault.com",
    auth: { kind: "password", username: "u", password: "p" },
    migrationUserId: 1,
  },
  countries: { US: {} },
});

const metadata = resolveMetadata(
  buildVaultMetadata("product_group__v", [
    {
      name: "product__v",
      type: "Object",
      object: { name: "product__v" },
      required: true,
    },
    {
      name: "detail_group__v",
      type: "Object",
      object: { name: "product__v" },
      required: true,
    },
    { name: "external_id__v", type: "String", max_length: 100 },
  ]),
  { picklists: { status__v: ["active__v", "inactive__v"] } },
);

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0Q000000000001",
    Name: " Cholecap / Cardio group ",
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    External_ID_vod__c: "PG-0001",
    CreatedDate: "2021-02-03T04:05:06.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(row: SourceRow, known: Record<string, string>) {
  const mapping = materialise(
    product_group,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata,
      ids: buildIdResolver({ product: known }, { [SAMPLE_USER_ID]: 101 }),
      migrationUserId: 1,
      runMode: "init",
      custom: product_group.custom,
    }),
  };
}

const BOTH = { [PRODUCT_ID]: "V0P1", [DETAIL_GROUP_ID]: "V0P2" };

describe("product_group module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(product_group).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(product_group.source).toBe("Product_Group_vod__c");
    expect(product_group.target).toBe("product_group__v");
    expect(product_group.targetEvidence).toBe("UNV");
    expect(product_group.scope).toEqual({ kind: "full" });
    expect(product_group.countryOf).toEqual([{ kind: "global" }]);
    expect(product_group.dependsOn).toEqual(["product"]);
    expect(product_group.selfRefs).toEqual([]);
    expect(product_group.deletePolicy).toBe("delete");
    expect(product_group.inactivate).toEqual([]); // status__v = inactive__v only
    expect(product_group.createPolicy).toBe("create");
    expect(product_group.load.noTriggers).toBe(false);
    expect(product_group.objectTypes).toEqual({});
    expect(product_group.states).toEqual({});
    expect(product_group.blobs).toBeUndefined();
  });

  it("maps every §6.3.6 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(product_group.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("detail_group__v")).toMatchObject({
      source: "Detail_Group_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "text" },
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      required: "n",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    // Block S audit rows are present exactly once
    for (const t of [
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
    ])
      expect(
        product_group.fields.filter((f) => f.target === t),
        t,
      ).toHaveLength(1);
  });

  it("matches by legacy id then the (product__v, detail_group__v) pair (§3.3)", () => {
    expect(product_group.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
    ]);
    expect(product_group.match[1].keys?.map((k) => k.target)).toEqual([
      "product__v",
      "detail_group__v",
    ]);
  });

  it("transforms a realistic row with both parents resolved", () => {
    const { result: r } = run(sampleRow(), BOTH);
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: GROUP_ID,
      name__v: "Cholecap / Cardio group",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      external_id__v: "PG-0001",
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toEqual(
      expect.arrayContaining([
        {
          field: "product__v",
          targetObjectKey: "product",
          targetSfdcId: PRODUCT_ID,
        },
        {
          field: "detail_group__v",
          targetObjectKey: "product",
          targetSfdcId: DETAIL_GROUP_ID,
        },
      ]),
    );
  });

  it("holds the row as pending_fk when a required parent is not mapped yet (§3.5)", () => {
    const { result: r } = run(sampleRow(), { [PRODUCT_ID]: "V0P1" });
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      {
        field: "detail_group__v",
        objectKey: "product",
        sfdcId: DETAIL_GROUP_ID,
      },
    ]);
    // the deferred ref is kept for the retry, never dropped
    expect(r.payload.detail_group__v).toEqual({
      $fk: { object: "product", sfdcId: DETAIL_GROUP_ID },
    });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "detail_group__v",
        code: "UNRESOLVED_FK",
      }),
    );
  });

  it("fails a row that lacks a required parent altogether", () => {
    const { result: r } = run(sampleRow({ Product_vod__c: "" }), BOTH);
    expect(r.status).toBe("failed");
    expect(r.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "product__v",
    });
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow(), BOTH);
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});
