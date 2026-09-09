import { describe, expect, it } from "vitest";
import {
  SAMPLE_INVENTORY_ITEM_LOT_FIELDS,
  lotRef,
  readLotId,
  sample_inventory_item,
} from "./sample_inventory_item";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const ITEM_ID = to18("a0J000000000001");
const INV_ID = to18("a0I000000000001");
const LOT_ID = to18("a0L000000000001");
const PRODUCT_ID = to18("a0P000000000001");

function makeConfig(
  opts: {
    sample_inventory_item?: Record<string, unknown>;
    countries?: Record<string, unknown>;
  } = {},
) {
  return parseConfig({
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
    objects: { sample_inventory_item: opts.sample_inventory_item ?? {} },
    countries: { US: opts.countries ?? {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("sample_inventory_item__v", [
      {
        name: "sample_inventory__v",
        type: "Object",
        object: { name: "sample_inventory__v" },
        required: true,
        relationship_type: "parent",
      },
      {
        name: "lot__v",
        type: "Object",
        object: { name: "sample_lot__v" },
        required: true,
      },
      { name: "quantity__v", type: "Number", scale: 0, required: true },
      {
        name: "product__v",
        type: "Object",
        object: { name: "product__v" },
        required: true,
      },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "external_id__v", type: "String", max_length: 100 },
    ]),
    { picklists: { status__v: ["active__v", "inactive__v"] } },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ITEM_ID,
    Name: " SII-000007 ",
    Sample_Inventory_vod__c: INV_ID,
    Lot_vod__c: LOT_ID,
    Quantity_vod__c: "15",
    Product_vod__c: PRODUCT_ID,
    Mobile_ID_vod__c: "mob-item-1",
    CreatedDate: "2026-02-15T09:05:00.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2026-02-16T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    config?: Parameters<typeof makeConfig>[0];
    knownLot?: boolean;
    knownInventory?: boolean;
  } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    sample_inventory_item,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      sample_inventory:
        opts.knownInventory === false ? {} : { [INV_ID]: "V0I1" },
      sample_lot: opts.knownLot === false ? {} : { [LOT_ID]: "V0L1" },
      product: { [PRODUCT_ID]: "V0P1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: sample_inventory_item.custom,
    }),
  };
}

describe("sample_inventory_item module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(sample_inventory_item).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(sample_inventory_item.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(sample_inventory_item.source).toBe("Sample_Inventory_Item_vod__c");
    expect(sample_inventory_item.target).toBe("sample_inventory_item__v");
    expect(sample_inventory_item.targetEvidence).toBe("UNV");
    expect(sample_inventory_item.scope).toEqual({
      kind: "via-parent",
      parentKey: "sample_inventory",
      parentField: "Sample_Inventory_vod__r.Inventory_Date_Time_vod__c",
      type: "datetime",
      retentionFamily: "samples",
    });
    expect(sample_inventory_item.countryOf).toEqual([
      {
        kind: "parent",
        key: "sample_inventory",
        field: "Sample_Inventory_vod__c",
      },
    ]);
    expect(sample_inventory_item.dependsOn).toEqual([
      "sample_inventory",
      "sample_lot",
      "product",
    ]);
    expect(sample_inventory_item.selfRefs).toEqual([]);
    expect(sample_inventory_item.deletePolicy).toBe("delete");
    expect(sample_inventory_item.inactivate).toEqual([]);
    expect(sample_inventory_item.createPolicy).toBe("create");
    expect(sample_inventory_item.load.noTriggers).toBe(true);
    expect(sample_inventory_item.objectTypes).toEqual({});
    expect(sample_inventory_item.states).toEqual({});
    expect(sample_inventory_item.blockS.ownerId).toBe(false);
    expect(sample_inventory_item.optionDefaults).toEqual({
      lotLookupField: "Lot_vod__c",
    });
    expect(sample_inventory_item.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(SAMPLE_INVENTORY_ITEM_LOT_FIELDS).toEqual([
      "Lot_vod__c",
      "Sample_Lot_vod__c",
    ]);
  });

  it("maps every §6.3.37 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      sample_inventory_item.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("sample_inventory__v")).toMatchObject({
      source: "Sample_Inventory_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "sample_inventory" },
    });
    expect(byTarget.get("sample_inventory__v")?.unverifiedSource).toBeFalsy();
    expect(byTarget.get("lot__v")).toMatchObject({
      source: "Lot_vod__c",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "custom", fnName: "lotRef" },
    });
    expect(byTarget.get("quantity__v")).toMatchObject({
      source: "Quantity_vod__c",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "number" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "ref", objectKey: "product" },
    });
    // master-detail child: no owner, no status derivation
    expect(byTarget.get("ownerid__v")).toBeUndefined();
    expect(byTarget.get("status__v")).toBeUndefined();
  });

  it("transforms a realistic item row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ITEM_ID,
      name__v: "SII-000007",
      sample_inventory__v: {
        $fk: { object: "sample_inventory", sfdcId: INV_ID },
      },
      lot__v: { $fk: { object: "sample_lot", sfdcId: LOT_ID } },
      quantity__v: 15,
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      mobile_id__v: "mob-item-1",
      last_device__v: "data_load__v",
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2026-02-15T09:05:00.000Z",
    });
    expect(result.payload.ownerid__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.fkEdges).toEqual(
      expect.arrayContaining([
        {
          field: "sample_inventory__v",
          targetObjectKey: "sample_inventory",
          targetSfdcId: INV_ID,
        },
        {
          field: "lot__v",
          targetObjectKey: "sample_lot",
          targetSfdcId: LOT_ID,
        },
        {
          field: "product__v",
          targetObjectKey: "product",
          targetSfdcId: PRODUCT_ID,
        },
      ]),
    );
  });

  it("resolves the lot through whichever lookup the org has (custom lotRef)", () => {
    // org names the lookup Sample_Lot_vod__c and has no Lot_vod__c column
    const alt = run(
      sampleRow({ Lot_vod__c: undefined, Sample_Lot_vod__c: LOT_ID }),
    );
    expect(alt.result.status).toBe("ok");
    expect(alt.result.payload.lot__v).toEqual({
      $fk: { object: "sample_lot", sfdcId: LOT_ID },
    });
    // configured lookup name wins
    const cfg = run(sampleRow({ Lot_vod__c: "", Lot_Ref__c: LOT_ID }), {
      config: { sample_inventory_item: { lotLookupField: "Lot_Ref__c" } },
    });
    expect(cfg.mapping.options.lotLookupField).toBe("Lot_Ref__c");
    expect(cfg.result.status).toBe("ok");
    expect(cfg.result.payload.lot__v).toEqual({
      $fk: { object: "sample_lot", sfdcId: LOT_ID },
    });
    // no lot anywhere: required → failed
    const none = run(sampleRow({ Lot_vod__c: "" }));
    expect(none.result.status).toBe("failed");
    expect(none.result.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "lot__v",
    });
  });

  it("reports an unresolved required lot / parent as pending_fk", () => {
    const lot = run(sampleRow(), { knownLot: false });
    expect(lot.result.status).toBe("pending_fk");
    expect(lot.result.unresolvedRequiredFks).toEqual([
      { field: "lot__v", objectKey: "sample_lot", sfdcId: LOT_ID },
    ]);
    expect(lot.result.payload.lot__v).toEqual({
      $fk: { object: "sample_lot", sfdcId: LOT_ID },
    });
    const parent = run(sampleRow(), { knownInventory: false });
    expect(parent.result.status).toBe("pending_fk");
    expect(parent.result.unresolvedRequiredFks).toEqual([
      {
        field: "sample_inventory__v",
        objectKey: "sample_inventory",
        sfdcId: INV_ID,
      },
    ]);
  });

  it("builds the via-parent scope predicate through the master-detail path", () => {
    const base = run(sampleRow());
    expect(base.mapping.scope.retentionFamily).toBe("samples");
    const build = buildScopePredicate(base.mapping.scope, { now: NOW });
    expect(build.kind).toBe("via-parent");
    expect(build.cutoffDate).toBe("2024-09-07");
    expect(build.predicate).toBe(
      "Sample_Inventory_vod__r.Inventory_Date_Time_vod__c >= 2024-09-07T00:00:00Z",
    );
    const us = run(sampleRow(), {
      config: { countries: { scope: { sampleRetentionMonths: 36 } } },
    });
    expect(buildScopePredicate(us.mapping.scope, { now: NOW }).predicate).toBe(
      "Sample_Inventory_vod__r.Inventory_Date_Time_vod__c >= 2023-09-07T00:00:00Z",
    );
  });

  describe("helpers", () => {
    it("readLotId prefers the configured field, then Lot_vod__c, then Sample_Lot_vod__c", () => {
      expect(
        readLotId({ Id: "x", Lot_vod__c: "a", Sample_Lot_vod__c: "b" }),
      ).toBe("a");
      expect(
        readLotId({ Id: "x", Lot_vod__c: "", Sample_Lot_vod__c: "b" }),
      ).toBe("b");
      expect(
        readLotId({ Id: "x", Lot_vod__c: "a", Custom__c: "c" }, "Custom__c"),
      ).toBe("c");
      expect(readLotId({ Id: "x" })).toBeUndefined();
      expect(readLotId({ Id: "x" }, 42)).toBeUndefined();
    });

    it("lotRef behaves like ref(sample_lot)", () => {
      const ctx = buildTransformContext({
        objectKey: "sample_inventory_item",
        field: { source: "Lot_vod__c", target: "lot__v" },
        ids: buildIdResolver({ sample_lot: { [LOT_ID]: "V0L1" } }),
      });
      expect(lotRef(LOT_ID, { Id: "x" }, ctx)).toEqual({
        value: { $fk: { object: "sample_lot", sfdcId: LOT_ID } },
      });
      expect(lotRef("", { Id: "x", Sample_Lot_vod__c: LOT_ID }, ctx)).toEqual({
        value: { $fk: { object: "sample_lot", sfdcId: LOT_ID } },
      });
      expect(lotRef("", { Id: "x" }, ctx)).toEqual({ omit: true });
      expect(lotRef("not-an-id", { Id: "x" }, ctx)).toMatchObject({
        omit: true,
        diagnostic: { code: "INVALID_ID" },
      });
    });
  });
});
