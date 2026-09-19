import { describe, expect, it } from "vitest";
import {
  SAMPLE_INVENTORY_ITEM_LOT_FIELDS,
  SAMPLE_INVENTORY_ITEM_LOT_REFERENCE,
  resolveLotLookupField,
  sample_inventory_item,
} from "./sample_inventory_item";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildColumnList, mappingFkColumns } from "../../extract/columns";
import { buildScopePredicate } from "../../extract/scope";
import {
  checkSourceUnit,
  classifyRow,
  createSourceContext,
} from "../../preflight/source";
import { FindingCollector } from "../../preflight/findings";
import {
  FakeSfdcClient,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildDescribe,
  buildIdResolver,
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

/** Describe of the item object whose lot lookup carries the given name. */
function itemDescribe(lotField: string) {
  return buildDescribe("Sample_Inventory_Item_vod__c", [
    { name: "Name", type: "string" },
    {
      name: "Sample_Inventory_vod__c",
      type: "reference",
      referenceTo: ["Sample_Inventory_vod__c"],
      relationshipName: "Sample_Inventory_vod__r",
    },
    { name: lotField, type: "reference", referenceTo: ["Sample_Lot_vod__c"] },
    { name: "Quantity_vod__c", type: "double" },
    {
      name: "Product_vod__c",
      type: "reference",
      referenceTo: ["Product_vod__c"],
    },
    { name: "Mobile_ID_vod__c", type: "string" },
  ]);
}

/** Parent describe (the via-parent scope path is resolved through it). */
function parentDescribe() {
  return buildDescribe("Sample_Inventory_vod__c", [
    { name: "Inventory_Date_Time_vod__c", type: "datetime" },
  ]);
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
    // no inert config knobs: the lot lookup is resolved at preflight / overridden per row
    expect(sample_inventory_item.optionDefaults).toBeUndefined();
    expect(sample_inventory_item.custom).toBeUndefined();
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
    // a real FK row (id-set collection, closure, FK classification) whose
    // describe miss is blocking — not an unverifiedSource info-drop
    expect(byTarget.get("lot__v")).toMatchObject({
      source: "Lot_vod__c",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      transform: { kind: "ref", objectKey: "sample_lot" },
    });
    expect(byTarget.get("lot__v")?.unverifiedSource).toBeFalsy();
    expect(byTarget.get("lot__v")?.optionalSource).toBeFalsy();
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

  it("fails a row without a lot (required master-detail reference)", () => {
    const none = run(sampleRow({ Lot_vod__c: "" }));
    expect(none.result.status).toBe("failed");
    expect(none.result.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "lot__v",
    });
  });

  it("exposes the lot lookup as an FK to id-set collection and preflight (§2.2 step 4, §5.1)", () => {
    const { mapping } = run(sampleRow());
    expect(mappingFkColumns(mapping)).toContainEqual({
      column: "Lot_vod__c",
      targetObjectKey: "sample_lot",
    });
    const row = mapping.fields.find((f) => f.target === "lot__v")!;
    expect(classifyRow(row, mapping)).toMatchObject({
      fk: true,
      requiredTarget: true,
    });
    const describe = itemDescribe("Lot_vod__c");
    const { columns, fkColumns } = buildColumnList(mapping, {
      describe,
      columns: [],
    });
    expect(columns).toContain("Lot_vod__c");
    expect(fkColumns).toContainEqual({
      column: "Lot_vod__c",
      targetObjectKey: "sample_lot",
      polymorphic: false,
    });
  });

  it("blocks preflight when the org has no Lot_vod__c instead of dropping the required lot silently", async () => {
    const { mapping } = run(sampleRow());
    // org names the lookup Sample_Lot_vod__c
    const describe = itemDescribe("Sample_Lot_vod__c");
    const sfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addDescribe(parentDescribe());
    const findings = new FindingCollector();
    const unit = { objectKey: "sample_inventory_item" as const, country: "US" };
    const res = await checkSourceUnit(
      createSourceContext(sfdc),
      unit,
      mapping,
      findings,
    );
    expect(res.drops.get("lot__v")).toBeUndefined();
    expect(findings.findings).toContainEqual(
      expect.objectContaining({
        severity: "blocking",
        code: "SF_FIELD_MISSING",
        objectKey: "sample_inventory_item",
        field: "lot__v",
      }),
    );
    expect(findings.hasBlocking(unit)).toBe(true);
    expect(
      findings.findings
        .filter((f) => f.severity === "blocking")
        .map((f) => f.field),
    ).toEqual(["lot__v"]);
    // the §6.3.37 rule names the field preflight should rewrite the row to
    expect(resolveLotLookupField(describe.fields)).toBe("Sample_Lot_vod__c");
  });

  it("loads through an overridden lookup name (objects.sample_inventory_item.fields.override)", async () => {
    const cfg = {
      sample_inventory_item: {
        fields: {
          override: [
            {
              source: "Sample_Lot_vod__c",
              target: "lot__v",
              transform: "ref(sample_lot)",
            },
          ],
        },
      },
    };
    const alt = run(
      sampleRow({ Lot_vod__c: undefined, Sample_Lot_vod__c: LOT_ID }),
      { config: cfg },
    );
    const row = alt.mapping.fields.find((f) => f.target === "lot__v")!;
    expect(row).toMatchObject({
      source: "Sample_Lot_vod__c",
      required: "Y",
      transform: { kind: "ref", objectKey: "sample_lot" },
    });
    expect(alt.result.status).toBe("ok");
    expect(alt.result.payload.lot__v).toEqual({
      $fk: { object: "sample_lot", sfdcId: LOT_ID },
    });
    // preflight and the column list follow the rewritten source
    const describe = itemDescribe("Sample_Lot_vod__c");
    const sfdc = new FakeSfdcClient()
      .addDescribe(describe)
      .addDescribe(parentDescribe());
    const findings = new FindingCollector();
    const unit = { objectKey: "sample_inventory_item" as const, country: "US" };
    const res = await checkSourceUnit(
      createSourceContext(sfdc),
      unit,
      alt.mapping,
      findings,
    );
    expect(findings.hasBlocking(unit)).toBe(false);
    expect(res.columns).toContain("Sample_Lot_vod__c");
    const { columns, fkColumns } = buildColumnList(alt.mapping, {
      describe,
      columns: res.columns,
    });
    expect(columns).toContain("Sample_Lot_vod__c");
    expect(columns).not.toContain("Lot_vod__c");
    expect(fkColumns).toContainEqual({
      column: "Sample_Lot_vod__c",
      targetObjectKey: "sample_lot",
      polymorphic: false,
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
    it("resolveLotLookupField picks the reference to Sample_Lot_vod__c regardless of name (§6.3.37)", () => {
      expect(SAMPLE_INVENTORY_ITEM_LOT_REFERENCE).toBe("Sample_Lot_vod__c");
      const parent = {
        name: "Sample_Inventory_vod__c",
        type: "reference" as const,
        referenceTo: ["Sample_Inventory_vod__c"],
      };
      const product = {
        name: "Product_vod__c",
        type: "reference" as const,
        referenceTo: ["Product_vod__c"],
      };
      const lot = (name: string) => ({
        name,
        type: "reference" as const,
        referenceTo: ["Sample_Lot_vod__c"],
      });
      expect(resolveLotLookupField([parent, product, lot("Lot_vod__c")])).toBe(
        "Lot_vod__c",
      );
      expect(
        resolveLotLookupField([parent, product, lot("Sample_Lot_vod__c")]),
      ).toBe("Sample_Lot_vod__c");
      // any name works when it is the only lot reference
      expect(
        resolveLotLookupField([parent, product, lot("Custom_Lot_Ref__c")]),
      ).toBe("Custom_Lot_Ref__c");
      // several: the known candidates win in order; ambiguous otherwise
      expect(
        resolveLotLookupField([
          lot("Custom_Lot_Ref__c"),
          lot("Sample_Lot_vod__c"),
          lot("Lot_vod__c"),
        ]),
      ).toBe("Lot_vod__c");
      expect(
        resolveLotLookupField([lot("Custom_A__c"), lot("Custom_B__c")]),
      ).toBeUndefined();
      // a non-reference field of the same name never qualifies; none → undefined
      expect(
        resolveLotLookupField([
          parent,
          { name: "Lot_vod__c", type: "string", referenceTo: [] },
        ]),
      ).toBeUndefined();
      expect(resolveLotLookupField([])).toBeUndefined();
    });
  });
});
