import { describe, expect, it } from "vitest";
import {
  PRODUCT_METRICS_ACCOUNT_FIELD,
  PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET,
  PRODUCT_METRICS_PRODUCT_FIELD,
  product_metrics,
} from "./product_metrics";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const ACCOUNT_ID = IDS.account1;
const PARENT_LOC_ID = IDS.account2;
const CHILD_LOC_ID = IDS.account3;
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const CHILD_ACCOUNT_ID = to18("a0H000000000001");
const ROW_ID = to18("a0Q000000000001");

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
    objects: { product_metrics: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "product_metrics__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        {
          name: "products__v",
          type: "Object",
          object: { name: "product__v" },
          required: true,
        },
        {
          name: "detail_group__v",
          type: "Object",
          object: { name: "product__v" },
        },
        {
          name: "location__v",
          type: "Object",
          object: { name: "child_account__v" },
        },
        {
          name: "location_parent__v",
          type: "Object",
          object: { name: "account__v" },
        },
        {
          name: "location_child__v",
          type: "Object",
          object: { name: "account__v" },
        },
        {
          name: "external_id__v",
          type: "String",
          max_length: 255,
          unique: true,
        },
        { name: "segment__c", type: "Picklist", picklist: "segment__c" },
      ],
      { systemManagedName: true },
    ),
    {
      picklists: {
        segment__c: ["a__c", "b__c"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ROW_ID,
    Name: "PM-000123",
    [PRODUCT_METRICS_ACCOUNT_FIELD]: ACCOUNT_ID,
    [PRODUCT_METRICS_PRODUCT_FIELD]: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Location_vod__c: CHILD_ACCOUNT_ID,
    Location_Parent_vod__c: PARENT_LOC_ID,
    Location_Child_vod__c: CHILD_LOC_ID,
    External_ID_vod__c: "PM-EXT-1",
    Segment__c: "A",
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
    overrides?: Record<string, unknown>;
    products?: Record<string, string>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    product_metrics,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: {
        [ACCOUNT_ID]: "V0A1",
        [PARENT_LOC_ID]: "V0A2",
        [CHILD_LOC_ID]: "V0A3",
      },
      product: opts.products ?? {
        [PRODUCT_ID]: "V0P1",
        [DETAIL_GROUP_ID]: "V0P2",
      },
      child_account: { [CHILD_ACCOUNT_ID]: "V0H1" },
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
      custom: product_metrics.custom,
    }),
  };
}

describe("product_metrics module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(product_metrics).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.13 / §3.3 / §4.4 catalogue facts", () => {
    expect(product_metrics.source).toBe("Product_Metrics_vod__c");
    expect(product_metrics.target).toBe("product_metrics__v");
    expect(product_metrics.targetEvidence).toBe("DOC");
    expect(product_metrics.scope).toEqual({ kind: "full" });
    expect(product_metrics.countryOf).toEqual([{ kind: "account" }]);
    expect(product_metrics.dependsOn).toEqual([
      "account",
      "product",
      "child_account",
    ]);
    expect(product_metrics.selfRefs).toEqual([]);
    expect(product_metrics.deletePolicy).toBe("inactivate");
    expect(product_metrics.inactivate).toEqual([]);
    expect(product_metrics.createPolicy).toBe("create");
    expect(product_metrics.load.noTriggers).toBe(false);
    expect(product_metrics.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
      "external_id",
    ]);
    expect(product_metrics.match[1].keys?.map((k) => k.target)).toEqual([
      "account__v",
      "products__v",
    ]);
    expect(PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET).toBe("product__v");
    // customer metric columns are the payload of this object
    expect(product_metrics.optionDefaults?.customFields).toEqual({
      mode: "allMatching",
      include: [],
      exclude: [],
    });
    expect(product_metrics.notes).not.toContain("STUB");
  });

  it("carries every §6.3.13 row and the auto-number / master-detail Block S variants", () => {
    const byTarget = new Map(product_metrics.fields.map((f) => [f.target, f]));
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("products__v")).toMatchObject({
      source: "Products_vod__c",
      transform: { kind: "ref", objectKey: "product" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("detail_group__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "product" },
      required: "n",
    });
    expect(byTarget.get("location__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "child_account" },
      required: "n",
    });
    expect(byTarget.get("location_parent__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "account",
    });
    expect(byTarget.get("location_child__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "account",
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      transform: { kind: "copy" },
      required: "n",
    });
    // auto-number Name is gated by preserveAutoNumberName (§6.0.4)
    expect(byTarget.get("name__v")).toMatchObject({
      enabledBy: "preserveAutoNumberName",
      required: "n",
    });
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.has("local_currency__sys")).toBe(false);
    expect(byTarget.has("object_type__v.api_name__v")).toBe(false);
    expect(new Set(product_metrics.fields.map((f) => f.target)).size).toBe(
      product_metrics.fields.length,
    );
  });

  it("transforms a realistic row (auto-number name skipped by default)", () => {
    const { mapping, result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ROW_ID,
      account__v: { $fk: { object: "account", sfdcId: ACCOUNT_ID } },
      products__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      location__v: {
        $fk: { object: "child_account", sfdcId: CHILD_ACCOUNT_ID },
      },
      location_parent__v: {
        $fk: { object: "account", sfdcId: PARENT_LOC_ID },
      },
      location_child__v: { $fk: { object: "account", sfdcId: CHILD_LOC_ID } },
      external_id__v: "PM-EXT-1",
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.payload.name__v).toBeUndefined();
    expect(mapping.fields.some((f) => f.target === "name__v")).toBe(false);
    expect(result.secondPass).toEqual({});
    expect(JSON.stringify(result.payload)).not.toContain("V0");
    // 6 business FKs + created_by__v/modified_by__v user references
    expect(result.fkEdges).toHaveLength(8);
    expect(
      result.fkEdges.filter((e) => e.targetObjectKey !== "user"),
    ).toHaveLength(6);
  });

  it("carries the auto-number Name with preserveAutoNumberName", () => {
    const { result } = run(sampleRow(), {
      overrides: { preserveAutoNumberName: true },
    });
    expect(result.payload.name__v).toBe("PM-000123");
  });

  it("reports an unresolved required product as pending_fk and drops an unresolved optional lookup", () => {
    const { result } = run(sampleRow(), { products: {} });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "products__v", objectKey: "product", sfdcId: PRODUCT_ID },
    ]);
    expect(result.payload.products__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
    // optional detail group: omitted, recorded for the FK-consistency pass (§3.5)
    expect(result.payload.detail_group__v).toBeUndefined();
    expect(result.unresolvedOptionalFks).toEqual([
      {
        field: "detail_group__v",
        objectKey: "product",
        sfdcId: DETAIL_GROUP_ID,
      },
    ]);
  });

  it("lets the overlay re-target products__v to product__v (preflight fallback)", () => {
    const { mapping, result } = run(sampleRow(), {
      overrides: {
        fields: {
          override: [
            {
              target: "products__v",
              source: "Products_vod__c",
              transform: "ref(product)",
            },
          ],
          remove: ["products__v"],
          add: [
            {
              source: "Products_vod__c",
              target: PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET,
              transform: "ref(product)",
              required: "Y",
            },
          ],
        },
      },
    });
    expect(mapping.fields.some((f) => f.target === "products__v")).toBe(false);
    expect(result.payload.product__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
  });

  it("materialises customFields defaults and config overrides", () => {
    expect(run(sampleRow()).mapping.options.customFields.mode).toBe(
      "allMatching",
    );
    expect(
      run(sampleRow(), { overrides: { customFields: { mode: "none" } } })
        .mapping.options.customFields.mode,
    ).toBe("none");
  });

  it("is full scope (no predicate)", () => {
    const { mapping } = run(sampleRow());
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "full",
    });
    expect(mapping.options.deletePolicy).toBe("inactivate");
  });
});
