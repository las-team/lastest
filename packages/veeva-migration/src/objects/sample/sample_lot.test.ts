import { describe, expect, it } from "vitest";
import {
  SAMPLE_LOT_EXPECTED_ROLLUP_CODE,
  SAMPLE_LOT_ROLLUP_SOURCE,
  SAMPLE_LOT_UM_DEFAULTS,
  expectedRollup,
  readExpectedRollup,
  sample_lot,
} from "./sample_lot";
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
const LOT_ID = to18("a0L000000000001");
const PRODUCT_ID = to18("a0P000000000001");

function makeConfig(overrides: Record<string, unknown> = {}) {
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
    objects: { sample_lot: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("sample_lot__v", [
      {
        name: "product__v",
        type: "Object",
        object: { name: "product__v" },
        required: true,
      },
      { name: "sample__v", type: "String", max_length: 100, required: true },
      { name: "sample_lot_id__v", type: "String", max_length: 200 },
      { name: "expiration_date__v", type: "Date" },
      { name: "active__v", type: "Boolean" },
      { name: "suppress_lot__v", type: "Boolean" },
      { name: "allocated_quantity__v", type: "Number", scale: 0 },
      { name: "u_m__v", type: "Picklist", picklist: "u_m__v" },
      { name: "batch_lot_id__v", type: "String", max_length: 100 },
      { name: "calculated_quantity__v", type: "Number", scale: 0 },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "external_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        u_m__v: Object.values(SAMPLE_LOT_UM_DEFAULTS),
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: LOT_ID,
    Name: "  LOT-2026-001 ",
    Product_vod__c: PRODUCT_ID,
    Sample_vod__c: "Cholecap 10mg",
    Sample_Lot_Id_vod__c: "SLID-0001",
    Expiration_Date_vod__c: "2027-01-31",
    Active_vod__c: "true",
    Suppress_Lot_vod__c: "false",
    Allocated_Quantity_vod__c: "100",
    U_M_vod__c: "Cases",
    Batch_Lot_Id_vod__c: "BATCH-9",
    [SAMPLE_LOT_ROLLUP_SOURCE]: "42",
    Mobile_ID_vod__c: "mob-1",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2021-02-03T04:05:06.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { config?: Record<string, unknown>; knownProduct?: boolean } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    sample_lot,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    { product: opts.knownProduct === false ? {} : { [PRODUCT_ID]: "V0P1" } },
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
      custom: sample_lot.custom,
    }),
  };
}

describe("sample_lot module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(sample_lot).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(sample_lot.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(sample_lot.source).toBe("Sample_Lot_vod__c");
    expect(sample_lot.target).toBe("sample_lot__v");
    expect(sample_lot.targetEvidence).toBe("DOC");
    expect(sample_lot.scope).toEqual({ kind: "full" });
    expect(sample_lot.countryOf).toEqual([{ kind: "user", field: "OwnerId" }]);
    expect(sample_lot.dependsOn).toEqual(["product", "user"]);
    expect(sample_lot.deletePolicy).toBe("inactivate");
    expect(sample_lot.inactivate).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(sample_lot.createPolicy).toBe("create");
    expect(sample_lot.load.noTriggers).toBe(true);
    expect(sample_lot.selfRefs).toEqual([]);
    expect(sample_lot.objectTypes).toEqual({});
    expect(sample_lot.states).toEqual({});
    expect(sample_lot.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    // §3.3: sample_lot_id__v → legacy id → (name, product, owner)
    expect(sample_lot.match.map((m) => m.method)).toEqual([
      "external_id",
      "legacy_id",
      "natural_key",
    ]);
    expect(sample_lot.match[0].keys).toEqual([
      { target: "sample_lot_id__v", source: "Sample_Lot_Id_vod__c" },
    ]);
    expect(sample_lot.match[2].keys?.map((k) => k.target)).toEqual([
      "name__v",
      "product__v",
      "ownerid__v",
    ]);
  });

  it("maps every §6.3.18 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(sample_lot.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "DOC",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      source: "Product_vod__c",
      required: "Y",
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("sample__v")).toMatchObject({
      source: "Sample_vod__c",
      required: "Y",
      evidence: "DOC",
      transform: { kind: "text", max: 100 },
    });
    expect(byTarget.get("sample_lot_id__v")).toMatchObject({
      source: "Sample_Lot_Id_vod__c",
      required: "n",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("expiration_date__v")).toMatchObject({
      source: "Expiration_Date_vod__c",
      evidence: "UNV",
      transform: { kind: "date" },
    });
    for (const [t, src] of [
      ["active__v", "Active_vod__c"],
      ["suppress_lot__v", "Suppress_Lot_vod__c"],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        source: src,
        required: "n",
        evidence: "UNV",
        transform: { kind: "bool" },
      });
    expect(byTarget.get("allocated_quantity__v")).toMatchObject({
      source: "Allocated_Quantity_vod__c",
      countryConfigurable: true,
      transform: { kind: "number" },
    });
    expect(byTarget.get("u_m__v")).toMatchObject({
      source: "U_M_vod__c",
      countryConfigurable: true,
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "sample_lot.um" },
    });
    expect(byTarget.get("batch_lot_id__v")).toMatchObject({
      source: "Batch_Lot_Id_vod__c",
      optionalSource: true,
      transform: { kind: "copy" },
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      source: "OwnerId",
      required: "y?",
      evidence: "UNV",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("calculated_quantity__v")).toMatchObject({
      source: SAMPLE_LOT_ROLLUP_SOURCE,
      required: "-",
      evidence: "DOC",
      transform: { kind: "custom", fnName: "expectedRollup" },
    });
    // Block S status derivation present
    expect(byTarget.get("status__v")).toMatchObject({
      transform: { kind: "statusFromFlag", sourceFlag: "Active_vod__c" },
    });
    expect(sample_lot.picklists["sample_lot.um"]).toEqual(
      SAMPLE_LOT_UM_DEFAULTS,
    );
  });

  it("transforms a realistic lot row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: LOT_ID,
      name__v: "LOT-2026-001",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      sample__v: "Cholecap 10mg",
      sample_lot_id__v: "SLID-0001",
      expiration_date__v: "2027-01-31",
      active__v: true,
      suppress_lot__v: false,
      allocated_quantity__v: 100,
      u_m__v: "cases__v",
      batch_lot_id__v: "BATCH-9",
      mobile_id__v: "mob-1",
      last_device__v: "data_load__v",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
    });
    // active lot: platform status omitted (Vault defaults active__v)
    expect(result.payload.status__v).toBeUndefined();
    // roll-up never loaded, but carried as the expected value
    expect(result.payload.calculated_quantity__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        code: SAMPLE_LOT_EXPECTED_ROLLUP_CODE,
        field: "calculated_quantity__v",
        value: "42",
      }),
    );
    expect(result.fkEdges).toContainEqual({
      field: "product__v",
      targetObjectKey: "product",
      targetSfdcId: PRODUCT_ID,
    });
  });

  it("derives status__v = inactive__v from Active_vod__c = false (§6.0.4 / §4.4)", () => {
    const { result } = run(sampleRow({ Active_vod__c: "false" }));
    expect(result.status).toBe("ok");
    expect(result.payload.status__v).toBe("inactive__v");
    expect(result.payload.active__v).toBe(false);
    // disabled per object
    const off = run(sampleRow({ Active_vod__c: "false" }), {
      config: { statusFromFlag: false },
    });
    expect(off.result.payload.status__v).toBeUndefined();
  });

  it("reports an unresolved required product as pending_fk", () => {
    const { result } = run(sampleRow(), { knownProduct: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "product__v", objectKey: "product", sfdcId: PRODUCT_ID },
    ]);
    expect(result.payload.product__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
  });

  it("fails a row whose required lot number is missing", () => {
    const { result } = run(sampleRow({ Sample_vod__c: "" }));
    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("REQUIRED_MISSING");
    expect(result.failure?.field).toBe("sample__v");
  });

  it("is unscoped (full) — no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    const build = buildScopePredicate(mapping.scope, { now: NOW });
    expect(build.kind).toBe("full");
    expect(build.predicate).toBeUndefined();
  });

  describe("expectedRollup", () => {
    it("reads numeric strings and numbers, ignores blanks and junk", () => {
      expect(
        readExpectedRollup({ Id: "x", [SAMPLE_LOT_ROLLUP_SOURCE]: "12" }),
      ).toBe(12);
      expect(
        readExpectedRollup({ Id: "x", [SAMPLE_LOT_ROLLUP_SOURCE]: -3 }),
      ).toBe(-3);
      expect(
        readExpectedRollup({ Id: "x", [SAMPLE_LOT_ROLLUP_SOURCE]: "" }),
      ).toBe(undefined);
      expect(readExpectedRollup({ Id: "x" })).toBeUndefined();
      expect(
        readExpectedRollup({ Id: "x", [SAMPLE_LOT_ROLLUP_SOURCE]: "n/a" }),
      ).toBeUndefined();
    });
    it("never emits a value; records a non-fatal diagnostic when present", () => {
      const ctx = buildTransformContext({
        objectKey: "sample_lot",
        field: {
          source: SAMPLE_LOT_ROLLUP_SOURCE,
          target: "calculated_quantity__v",
        },
      });
      const r = expectedRollup(
        "7",
        { Id: "x", [SAMPLE_LOT_ROLLUP_SOURCE]: "7" },
        ctx,
      );
      expect(r).toMatchObject({
        omit: true,
        diagnostic: { code: SAMPLE_LOT_EXPECTED_ROLLUP_CODE, value: "7" },
      });
      expect(
        (r as { diagnostic?: { fatal?: boolean } }).diagnostic?.fatal,
      ).toBeFalsy();
      expect(expectedRollup("", { Id: "x" }, ctx)).toEqual({ omit: true });
    });
  });
});
