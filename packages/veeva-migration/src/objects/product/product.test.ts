import { describe, expect, it } from "vitest";
import {
  PRODUCT_BOOLEAN_FIELDS,
  PRODUCT_PARENT_FIELD,
  PRODUCT_THUMBNAIL_BLOB,
  PRODUCT_TYPE_DEFAULTS,
  parentProduct,
  product,
  renameProductFlag,
  requireDiscussion,
} from "./product";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { renamePicklistValue } from "../../transform/rename";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
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
const PARENT_ID = to18("a0P000000000001");
const CHILD_ID = to18("a0P000000000002");

function makeConfig(productOverrides: Record<string, unknown> = {}) {
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
    objects: { product: productOverrides },
    countries: { US: {} },
  });
}

const PRODUCT_TYPE_VALUES = Object.values(PRODUCT_TYPE_DEFAULTS);

function metadata(opts: { requireDiscussionBoolean?: boolean } = {}) {
  return resolveMetadata(
    buildVaultMetadata("product__v", [
      {
        name: "product_type__v",
        type: "Picklist",
        picklist: "product_type__v",
      },
      {
        name: "parent_product__v",
        type: "Object",
        object: { name: "product__v" },
      },
      { name: "external_id__v", type: "String", max_length: 100 },
      { name: "vexternal_id__v", type: "String", max_length: 100 },
      { name: "master_align_id__v", type: "String", max_length: 100 },
      {
        name: "manufacturer__v",
        type: "Picklist",
        picklist: "manufacturer__v",
      },
      {
        name: "therapeutic_area__v",
        type: "Picklist",
        picklist: "therapeutic_area__v",
      },
      { name: "company_product__v", type: "Boolean" },
      { name: "controlled_substance__v", type: "Boolean" },
      { name: "active__v", type: "Boolean" },
      opts.requireDiscussionBoolean
        ? { name: "require_discussion__v", type: "Boolean" }
        : {
            name: "require_discussion__v",
            type: "Picklist",
            picklist: "require_discussion__v",
          },
      { name: "schedule__v", type: "String", max_length: 10 },
      { name: "cost__v", type: "Number", scale: 2 },
      { name: "product_value__v", type: "Number", scale: 2 },
      { name: "display_order__v", type: "Number", scale: 0 },
      { name: "description__v", type: "String", max_length: 1500 },
      { name: "product_thumbnail__v", type: "LongText" },
      { name: "country__v", type: "Object", object: { name: "country__v" } },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        product_type__v: PRODUCT_TYPE_VALUES,
        manufacturer__v: ["acme__v"],
        therapeutic_area__v: ["oncology__v"],
        require_discussion__v: ["no__v", "yes__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "a0P000000000002",
    Name: "  Cholecap 10mg ",
    Product_Type_vod__c: "Detail",
    [PRODUCT_PARENT_FIELD]: PARENT_ID,
    External_ID_vod__c: "EXT-CHOLECAP-10",
    VExternal_Id_vod__c: "VEXT-0001",
    Master_Align_Id_vod__c: "ALIGN-9",
    Product_Identifier_vod__c: "NDC-0001",
    Manufacturer_vod__c: "Acme",
    Therapeutic_Area_vod__c: "Oncology",
    Company_Product_vod__c: "true",
    Controlled_Substance_vod__c: false,
    Active_vod__c: "true",
    Require_Discussion_vod__c: "Yes_vod",
    Schedule_vod__c: "C-II",
    Restricted_States_vod__c: "CA;NY",
    Cost_vod__c: "12.345",
    Product_Value_vod__c: 100,
    CurrencyIsoCode: "USD",
    Display_Order_vod__c: "3",
    Sort_Code_vod__c: "A1",
    Description_vod__c: "Statin",
    Product_Thumbnail_vod__c: "data:image/png;base64,AAAA",
    No_Promo_Items_vod__c: "true",
    zvod_Custom_Text_vod__c: "layout",
    Country_vod__c: IDS.countryUS,
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
  opts: {
    product?: Record<string, unknown>;
    knownParent?: boolean;
    requireDiscussionBoolean?: boolean;
  } = {},
) {
  const config = makeConfig(opts.product);
  const mapping = materialise(product, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const ids = buildIdResolver(
    { product: opts.knownParent === false ? {} : { [PARENT_ID]: "V0P1" } },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({
        requireDiscussionBoolean: opts.requireDiscussionBoolean,
      }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: product.custom,
    }),
  };
}

describe("product module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(product).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(product.source).toBe("Product_vod__c");
    expect(product.target).toBe("product__v");
    expect(product.targetEvidence).toBe("OBS");
    expect(product.scope).toEqual({ kind: "full" });
    expect(product.countryOf).toEqual([{ kind: "global" }]);
    expect(product.dependsOn).toEqual([]);
    expect(product.deletePolicy).toBe("inactivate");
    expect(product.inactivate).toEqual([{ field: "active__v", value: false }]);
    expect(product.createPolicy).toBe("create");
    expect(product.load.noTriggers).toBe(false);
    // hierarchy: depth order by the self parent + pass-2 fallback
    expect(product.depthOrderBy).toBe("Parent_Product_vod__c");
    expect(product.load.depthOrderBy).toBe("Parent_Product_vod__c");
    expect(product.selfRefs).toEqual([
      { target: "parent_product__v", source: "Parent_Product_vod__c" },
    ]);
    expect(product.objectTypes).toEqual({});
    expect(product.states).toEqual({});
    expect(product.blobs).toEqual({ [PRODUCT_THUMBNAIL_BLOB]: "optional" });
    // Block S: multi-currency + status derived from Active_vod__c = false
    expect(product.blockS.currency).toBe(true);
    expect(product.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
  });

  it("maps every §6.3.5 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(product.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "OBS",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("product_type__v")).toMatchObject({
      source: "Product_Type_vod__c",
      required: "y?",
      evidence: "DOC",
      transform: { kind: "picklist", mapKey: "product.productType" },
    });
    expect(byTarget.get("parent_product__v")).toMatchObject({
      source: "Parent_Product_vod__c",
      required: "n",
      evidence: "DOC",
      transform: { kind: "custom", fnName: "parentProduct" },
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      evidence: "OBS",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("vexternal_id__v")).toMatchObject({
      source: "VExternal_Id_vod__c",
      evidence: "UNV",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("master_align_id__v")).toMatchObject({
      source: "Master_Align_Id_vod__c",
      transform: { kind: "copy" },
    });
    expect(byTarget.get("product_identifier__v")).toMatchObject({
      source: "Product_Identifier_vod__c",
      transform: { kind: "copy" },
    });
    for (const [t, key] of [
      ["manufacturer__v", "product.manufacturer"],
      ["therapeutic_area__v", "product.therapeuticArea"],
      ["therapeutic_class__v", "product.therapeuticClass"],
      ["sample_u_m__v", "product.sampleUM"],
      ["inventory_order_uom__v", "product.inventoryOrderUom"],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        countryConfigurable: true,
        transform: { kind: "picklist", mapKey: key },
      });
    // 15 boolean flags, renamed mechanically
    expect(PRODUCT_BOOLEAN_FIELDS).toHaveLength(15);
    for (const src of PRODUCT_BOOLEAN_FIELDS)
      expect(byTarget.get(renameProductFlag(src)), src).toMatchObject({
        source: src,
        required: "n",
        evidence: "UNV",
        transform: { kind: "bool" },
      });
    expect(byTarget.get("active__v")).toMatchObject({
      source: "Active_vod__c",
      transform: { kind: "bool" },
    });
    expect(byTarget.get("require_discussion__v")).toMatchObject({
      source: "Require_Discussion_vod__c",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "requireDiscussion" },
    });
    expect(byTarget.get("schedule__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "text", max: 10 },
    });
    expect(byTarget.get("restricted_states__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "text", max: 100 },
    });
    expect(byTarget.get("sample_quantity_picklist__v")).toMatchObject({
      transform: { kind: "longtext" },
    });
    for (const t of [
      "quantity_per_case__v",
      "inventory_quantity_per_case__v",
      "product_value__v",
      "cost__v",
      "display_order__v",
    ])
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "number" },
      });
    for (const t of ["sort_code__v", "description__v", "distributor__v"])
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "text" },
      });
    expect(byTarget.get("local_currency__sys")).toMatchObject({
      source: "CurrencyIsoCode",
      transform: { kind: "currency" },
    });
    expect(byTarget.get("product_thumbnail__v")).toMatchObject({
      source: "Product_Thumbnail_vod__c",
      evidence: "UNV",
      blobName: PRODUCT_THUMBNAIL_BLOB,
      transform: { kind: "deferredBlob", blobName: PRODUCT_THUMBNAIL_BLOB },
    });
    for (const src of ["No_Promo_Items_vod__c", "zvod_Custom_Text_vod__c"])
      expect(
        product.fields.find((f) => f.source === src),
        src,
      ).toMatchObject({ required: "-", transform: { kind: "skip" } });
    expect(byTarget.get("country__v")).toMatchObject({
      source: "Country_vod__c",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      unverifiedSource: true,
      transform: { kind: "country", mode: "ref" },
    });
    // status__v derived from Active_vod__c (§6.0.4), switchable off
    expect(byTarget.get("status__v")).toMatchObject({
      source: "Active_vod__c",
      disabledBy: "statusFromFlag",
      transform: { kind: "statusFromFlag", sourceFlag: "Active_vod__c" },
    });
    // every UNV target survives as a row (preflight prunes, the module never omits)
    expect(
      product.fields.filter((f) => f.evidence === "UNV").length,
    ).toBeGreaterThan(30);
  });

  it("carries the §3.3 match precedence: external id → vexternal id → (name, type) same country", () => {
    expect(product.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "external_id",
      "name_type",
    ]);
    expect(product.match[1].keys).toEqual([
      { target: "external_id__v", source: "External_ID_vod__c" },
    ]);
    expect(product.match[2]).toMatchObject({
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
      evidence: "UNV",
    });
    expect(product.match[3]).toMatchObject({
      sameCountry: true,
      keys: [
        { target: "name__v", source: "Name" },
        { target: "product_type__v", source: "Product_Type_vod__c" },
      ],
    });
    const { mapping } = run(sampleRow());
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "active__v", value: false },
    ]);
  });

  it("product type defaults follow the §6.0.2 plain-English rule and are overridable per country", () => {
    for (const [src, tgt] of Object.entries(PRODUCT_TYPE_DEFAULTS))
      expect(renamePicklistValue(src), src).toBe(tgt);
    expect(product.picklists["product.productType"]).toEqual(
      PRODUCT_TYPE_DEFAULTS,
    );
    expect(product.picklists["product.requireDiscussion"]).toEqual({
      No_vod: "no__v",
      Yes_vod: "yes__v",
    });
    const config = parseConfig({
      version: 1,
      source: {
        loginUrl: "https://x.my.salesforce.com",
        auth: {
          kind: "jwt",
          clientId: "c",
          username: "u",
          privateKeyPath: "k",
        },
      },
      target: {
        vaultDns: "x.veevavault.com",
        auth: { kind: "password", username: "u", password: "p" },
        migrationUserId: 1,
      },
      countries: {
        US: {
          picklists: { "product.productType": { Detail: "detail_us__v" } },
        },
      },
    });
    const mapping = materialise(product, resolveCountry(config, "US"), config, {
      now: NOW,
    });
    expect(mapping.picklists["product.productType"].Detail).toBe(
      "detail_us__v",
    );
    expect(mapping.picklists["product.productType"].Sample).toBe("sample__v");
  });

  it("transforms a realistic Product_vod__c row (parent resolved in pass 1 by depth order)", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: CHILD_ID,
      name__v: "Cholecap 10mg",
      product_type__v: "detail__v",
      parent_product__v: { $fk: { object: "product", sfdcId: PARENT_ID } },
      external_id__v: "EXT-CHOLECAP-10",
      vexternal_id__v: "VEXT-0001",
      master_align_id__v: "ALIGN-9",
      product_identifier__v: "NDC-0001",
      manufacturer__v: "acme__v",
      therapeutic_area__v: "oncology__v",
      company_product__v: true,
      controlled_substance__v: false,
      active__v: true,
      require_discussion__v: "yes__v",
      schedule__v: "C-II",
      restricted_states__v: "CA;NY",
      cost__v: 12.35,
      product_value__v: 100,
      local_currency__sys: "USD",
      display_order__v: 3,
      sort_code__v: "A1",
      description__v: "Statin",
      country__v: "V0C000000000101",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // active product → status__v omitted (Vault defaults active__v)
    expect(r.payload.status__v).toBeUndefined();
    // thumbnail goes to the blob pass, never the pass-1 payload
    expect(r.payload.product_thumbnail__v).toBeUndefined();
    expect(r.blobs).toEqual({
      product_thumbnail__v: "data:image/png;base64,AAAA",
    });
    // skipped columns never reach the payload
    expect(r.payload.no_promo_items__v).toBeUndefined();
    expect(r.payload.zvod_custom_text__v).toBeUndefined();
    // parent known → nothing left for pass 2
    expect(r.secondPass).toEqual({});
    expect(r.fkEdges).toContainEqual({
      field: "parent_product__v",
      targetObjectKey: "product",
      targetSfdcId: PARENT_ID,
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toEqual([]);
  });

  it("defers an unknown parent to pass 2 (depth ordering not possible) instead of failing", () => {
    const { result: r } = run(sampleRow(), { knownParent: false });
    expect(r.status).toBe("ok");
    expect(r.payload.parent_product__v).toBeUndefined();
    expect(r.secondPass).toEqual({
      parent_product__v: { $fk: { object: "product", sfdcId: PARENT_ID } },
    });
    expect(r.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({
        field: "parent_product__v",
        objectKey: "product",
        sfdcId: PARENT_ID,
        secondPass: true,
      }),
    );
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "second_pass",
        code: "PARENT_PRODUCT_SECOND_PASS",
      }),
    );
  });

  it("inactivates: Active_vod__c = false → status__v = inactive__v and active__v = false", () => {
    const { result: r } = run(sampleRow({ Active_vod__c: "false" }));
    expect(r.status).toBe("ok");
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.active__v).toBe(false);

    // objects.product.statusFromFlag = false drops the derivation, keeps the flag
    const off = run(sampleRow({ Active_vod__c: "false" }), {
      product: { statusFromFlag: false },
    });
    expect(off.result.payload.status__v).toBeUndefined();
    expect(off.result.payload.active__v).toBe(false);
  });

  it("require_discussion__v follows the target type (picklist or boolean)", () => {
    const pick = run(sampleRow({ Require_Discussion_vod__c: "No_vod" }));
    expect(pick.result.payload.require_discussion__v).toBe("no__v");
    const bool = run(sampleRow({ Require_Discussion_vod__c: "No_vod" }), {
      requireDiscussionBoolean: true,
    });
    expect(bool.result.payload.require_discussion__v).toBe(false);
    const yes = run(sampleRow({ Require_Discussion_vod__c: "Yes_vod" }), {
      requireDiscussionBoolean: true,
    });
    expect(yes.result.payload.require_discussion__v).toBe(true);
  });

  it("fails the row on an unmapped product type under the default error policy, reports an unmatched country", () => {
    const bad = run(sampleRow({ Product_Type_vod__c: "Mystery Type" }));
    expect(bad.result.status).toBe("failed");
    expect(bad.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmapped_picklist",
        field: "product_type__v",
        code: "UNMAPPED_PICKLIST",
        fatal: true,
      }),
    );
    const country = run(sampleRow({ Country_vod__c: "a0C000000000XX1" }));
    expect(country.result.status).toBe("ok");
    expect(country.result.payload.country__v).toBeUndefined();
    expect(country.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "country__v",
        code: "VT_COUNTRY_UNMATCHED",
      }),
    );
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const { mapping } = run(sampleRow());
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
    expect(mapping.scope.spec).toEqual({ kind: "full" });
  });
});

describe("product helpers", () => {
  it("renameProductFlag applies the §6.0.2 field rule", () => {
    expect(renameProductFlag("Company_Product_vod__c")).toBe(
      "company_product__v",
    );
    expect(renameProductFlag("Pricing_Rule_Quantity_Bound_vod__c")).toBe(
      "pricing_rule_quantity_bound__v",
    );
  });

  it("parentProduct resolves in pass 1, defers otherwise, rejects bad ids, omits blanks", () => {
    const known = buildTransformContext({
      objectKey: "product",
      field: { target: "parent_product__v" },
      ids: buildIdResolver({ product: { [PARENT_ID]: "V0P1" } }),
    });
    const row: SourceRow = { Id: "a0P000000000002" };
    expect(parentProduct("a0P000000000001", row, known)).toEqual({
      value: { $fk: { object: "product", sfdcId: PARENT_ID } },
    });
    const unknown = buildTransformContext({
      objectKey: "product",
      field: { target: "parent_product__v" },
    });
    expect(parentProduct(PARENT_ID, row, unknown)).toMatchObject({
      omit: true,
      defer: "secondPass",
      deferredValue: { $fk: { object: "product", sfdcId: PARENT_ID } },
      unresolved: { objectKey: "product", sfdcId: PARENT_ID },
    });
    expect(parentProduct("not-an-id", row, unknown)).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "INVALID_ID" },
    });
    expect(parentProduct("", row, unknown)).toBeUndefined();
    expect(parentProduct(null, row, unknown)).toBeUndefined();
  });

  it("requireDiscussion maps Yes_vod/No_vod to booleans on a Boolean target and flags junk", () => {
    const ctx = buildTransformContext({
      objectKey: "product",
      field: { target: "require_discussion__v" },
      targetField: { type: "boolean", rawType: "Boolean" },
    });
    const row: SourceRow = { Id: "a0P000000000002" };
    expect(requireDiscussion("Yes_vod", row, ctx)).toBe(true);
    expect(requireDiscussion("No_vod", row, ctx)).toBe(false);
    expect(requireDiscussion("Maybe", row, ctx)).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "INVALID_BOOLEAN" },
    });
    expect(requireDiscussion(undefined, row, ctx)).toBeUndefined();
  });
});
