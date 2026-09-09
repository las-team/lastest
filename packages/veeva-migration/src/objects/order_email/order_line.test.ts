import { describe, expect, it } from "vitest";
import {
  FK_TARGET_SWITCHED_CODE,
  ORDER_LINE_ORDER_FIELD,
  ORDER_LINE_PRODUCT_FIELD,
  ORDER_LINE_PRODUCT_GROUP_FIELD,
  ORDER_LINE_PRODUCT_GROUP_TARGET,
  ORDER_LINE_UM,
  ORDER_LINE_WILDCARD_FIELDS,
  order_line,
  productGroupRef,
} from "./order_line";
import { ORDER_OPEN_PREDICATE, order } from "./order";
import { validateObjectModule } from "../types";
import { loadOrder } from "../registry";
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
const LINE_ID = to18("a0L000000000001");
const ORDER_ID = to18("a0O000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const GROUP_PRODUCT_ID = to18("a0P000000000002");

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
    objects: { order_line: overrides },
    countries: { US: {} },
  });
}

function metadata(
  groupTarget: "product__v" | "product_group__v" = "product__v",
) {
  return resolveMetadata(
    buildVaultMetadata("order_line__v", [
      {
        name: "order__v",
        type: "Object",
        object: { name: "order__v" },
        required: true,
        relationship_type: "parent",
      },
      {
        name: "product__v",
        type: "Object",
        object: { name: "product__v" },
        required: true,
      },
      {
        name: ORDER_LINE_PRODUCT_GROUP_TARGET,
        type: "Object",
        object: { name: groupTarget },
      },
      { name: "quantity__v", type: "Number", scale: 0 },
      { name: "free_goods__v", type: "Number", scale: 0 },
      { name: "list_price__v", type: "Number", scale: 2 },
      { name: "net_price__v", type: "Number", scale: 2 },
      { name: "net_amount__v", type: "Number", scale: 2 },
      { name: "list_amount__v", type: "Number", scale: 2 },
      { name: "discount__v", type: "Number", scale: 2 },
      { name: "payment_terms__v", type: "String", max_length: 100 },
      { name: "u_m__v", type: "Picklist", picklist: "u_m__v" },
      { name: "product_identifier__v", type: "String", max_length: 100 },
      { name: "local_currency__sys", type: "String", max_length: 3 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        u_m__v: Object.values(ORDER_LINE_UM),
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: LINE_ID,
    IsDeleted: false,
    Name: "OL-000007",
    CurrencyIsoCode: "USD",
    [ORDER_LINE_ORDER_FIELD]: ORDER_ID,
    [ORDER_LINE_PRODUCT_FIELD]: PRODUCT_ID,
    [ORDER_LINE_PRODUCT_GROUP_FIELD]: GROUP_PRODUCT_ID,
    Quantity_vod__c: "12",
    Free_Goods_vod__c: "2",
    List_Price_vod__c: "104.2",
    Net_Price_vod__c: "91.69",
    Net_Amount_vod__c: "1100.25",
    List_Amount_vod__c: "1250.5",
    Discount_vod__c: "12.5",
    Payment_Terms_vod__c: "NET30",
    U_M_vod__c: "Boxes",
    Product_Identifier_vod__c: "SKU-0001",
    Delivery_Quantity_vod__c: "12",
    Mobile_ID_vod__c: "7d2c5f4e-line-0001",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:00:00.000Z",
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    SystemModstamp: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    groupTarget?: "product__v" | "product_group__v";
    orders?: Record<string, string>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    order_line,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      order: opts.orders ?? { [ORDER_ID]: "V0O1" },
      product: { [PRODUCT_ID]: "V0P1", [GROUP_PRODUCT_ID]: "V0P2" },
      product_group: { [GROUP_PRODUCT_ID]: "V0G2" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(opts.groupTarget),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: order_line.custom,
    }),
  };
}

describe("order_line module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(order_line).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.39 / §3.3 / §4.4 catalogue facts", () => {
    expect(order_line.source).toBe("Order_Line_vod__c");
    expect(order_line.target).toBe("order_line__v");
    expect(order_line.targetEvidence).toBe("DOC");
    expect(order_line.scope).toEqual({
      kind: "via-parent",
      parentKey: "order",
      parentField: "Order_vod__r.Order_Date_vod__c",
      type: "date",
    });
    expect(order_line.countryOf).toEqual([
      { kind: "parent", key: "order", field: "Order_vod__c" },
    ]);
    expect(order_line.dependsOn).toEqual(["order", "product", "product_group"]);
    expect(order_line.selfRefs).toEqual([]);
    expect(order_line.objectTypes).toEqual({});
    expect(order_line.states).toEqual({});
    expect(order_line.deletePolicy).toBe("delete");
    expect(order_line.inactivate).toEqual([]);
    expect(order_line.createPolicy).toBe("create");
    expect(order_line.load.noTriggers).toBe(true);
    expect(order_line.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(order_line.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      currency: true,
    });
    expect(order_line.notes).not.toContain("STUB");
    // loads after order and after the product catalogue (§6.1 steps 3/19)
    const steps = loadOrder([
      { key: "product", dependsOn: [], selfRefs: [] },
      { key: "product_group", dependsOn: ["product"], selfRefs: [] },
      { key: "account", dependsOn: [], selfRefs: [] },
      { key: "order", dependsOn: ["account"], selfRefs: [] },
      order_line,
    ]);
    const level = (k: string) =>
      steps.findIndex((s) => s.keys.includes(k as never));
    expect(level("order_line")).toBeGreaterThan(level("order"));
    expect(level("order_line")).toBeGreaterThan(level("product_group"));
  });

  it("carries every §6.3.39 row with its transform, evidence and skips", () => {
    const byTarget = new Map(order_line.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "order__v",
      "product__v",
      ORDER_LINE_PRODUCT_GROUP_TARGET,
      "quantity__v",
      "free_goods__v",
      "list_price__v",
      "net_price__v",
      "net_amount__v",
      "list_amount__v",
      ...ORDER_LINE_WILDCARD_FIELDS.map((f) => f.target),
      "u_m__v",
      "product_identifier__v",
      "local_currency__sys",
      "mobile_id__v",
      "delivery_quantity__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.get("name__v")).toMatchObject({
      enabledBy: "preserveAutoNumberName",
      required: "n",
    });
    expect(byTarget.get("order__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "order" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("product__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "product" },
      required: "Y",
    });
    expect(byTarget.get(ORDER_LINE_PRODUCT_GROUP_TARGET)).toMatchObject({
      source: ORDER_LINE_PRODUCT_GROUP_FIELD,
      transform: { kind: "custom", fnName: "productGroupRef" },
      evidence: "UNV",
    });
    expect(byTarget.get("quantity__v")?.transform).toEqual({ kind: "number" });
    expect(byTarget.get("u_m__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "order_line.um" },
      countryConfigurable: true,
    });
    expect(byTarget.get("product_identifier__v")?.transform).toEqual({
      kind: "text",
    });
    for (const f of ORDER_LINE_WILDCARD_FIELDS)
      expect(byTarget.get(f.target), f.target).toMatchObject({
        unverifiedSource: true,
        optionalSource: true,
      });
    expect(byTarget.get("delivery_quantity__v")).toMatchObject({
      transform: { kind: "skip" },
      required: "-",
    });
    expect(order_line.picklists["order_line.um"]).toEqual({
      Cases: "cases__v",
      Boxes: "boxes__v",
      Units: "units__v",
    });
    for (const f of order_line.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: parent/product FKs, product_group__v as ref(product), numbers, picklist, currency, no name", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: LINE_ID,
      order__v: { $fk: { object: "order", sfdcId: ORDER_ID } },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      [ORDER_LINE_PRODUCT_GROUP_TARGET]: {
        $fk: { object: "product", sfdcId: GROUP_PRODUCT_ID },
      },
      quantity__v: 12,
      free_goods__v: 2,
      list_price__v: 104.2,
      net_price__v: 91.69,
      net_amount__v: 1100.25,
      list_amount__v: 1250.5,
      discount__v: 12.5,
      payment_terms__v: "NET30",
      u_m__v: "boxes__v",
      product_identifier__v: "SKU-0001",
      local_currency__sys: "USD",
      mobile_id__v: "7d2c5f4e-line-0001",
      created_date__v: "2025-03-04T10:00:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    // auto-number name skipped by default; no owner on a master-detail child
    expect(result.payload.name__v).toBeUndefined();
    expect(result.payload.ownerid__v).toBeUndefined();
    expect(result.payload.delivery_quantity__v).toBeUndefined();
    expect(result.payload.status__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: FK_TARGET_SWITCHED_CODE }),
    );
    // preserveAutoNumberName carries the SFDC auto-number verbatim
    const { result: named } = run(sampleRow(), {
      overrides: { preserveAutoNumberName: true },
    });
    expect(named.payload.name__v).toBe("OL-000007");
  });

  it("switches product_group__v to ref(product_group) when the target references product_group__v", () => {
    const { result } = run(sampleRow(), { groupTarget: "product_group__v" });
    expect(result.status).toBe("ok");
    expect(result.payload[ORDER_LINE_PRODUCT_GROUP_TARGET]).toEqual({
      $fk: { object: "product_group", sfdcId: GROUP_PRODUCT_ID },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        field: ORDER_LINE_PRODUCT_GROUP_TARGET,
        code: FK_TARGET_SWITCHED_CODE,
      }),
    );
    expect(result.fkEdges).toContainEqual({
      field: ORDER_LINE_PRODUCT_GROUP_TARGET,
      targetObjectKey: "product_group",
      targetSfdcId: GROUP_PRODUCT_ID,
    });
  });

  it("reports an unresolved parent order as pending_fk", () => {
    const { result } = run(sampleRow(), { orders: {} });
    expect(result.status).toBe("pending_fk");
    expect(result.payload.order__v).toEqual({
      $fk: { object: "order", sfdcId: ORDER_ID },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "order__v", objectKey: "order", sfdcId: ORDER_ID },
    ]);
  });

  it("is scoped through the parent order's date and open-item term", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual(order_line.scope);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    const build = buildScopePredicate(mapping.scope, {
      now: NOW,
      parentOpenPredicate:
        order.scope.kind === "dated" ? order.scope.openPredicate : undefined,
    });
    expect(build.kind).toBe("via-parent");
    expect(build.dateTerm).toBe("Order_vod__r.Order_Date_vod__c >= 2024-09-07");
    expect(build.openTerm).toBe(
      "Order_vod__r.Status_vod__c NOT IN ('Submitted_vod', 'Voided_vod')",
    );
    expect(build.predicate).toBe(
      `(Order_vod__r.Order_Date_vod__c >= 2024-09-07) OR (Order_vod__r.${ORDER_OPEN_PREDICATE})`,
    );
    expect(mapping.countryOf).toEqual([
      { kind: "parent", key: "order", field: "Order_vod__c" },
    ]);
    expect(mapping.options.deletePolicy).toBe("delete");
  });
});

describe("order_line custom transforms", () => {
  const row = {
    Id: LINE_ID,
    [ORDER_LINE_PRODUCT_GROUP_FIELD]: GROUP_PRODUCT_ID,
  };
  const ids = buildIdResolver({
    product: { [GROUP_PRODUCT_ID]: "V0P2" },
    product_group: { [GROUP_PRODUCT_ID]: "V0G2" },
  });

  it("productGroupRef resolves through product by default", () => {
    const ctx = buildTransformContext({
      objectKey: "order_line",
      field: {
        source: ORDER_LINE_PRODUCT_GROUP_FIELD,
        target: ORDER_LINE_PRODUCT_GROUP_TARGET,
      },
      targetField: {
        type: "object",
        rawType: "Object",
        referenceObject: "product__v",
      },
      ids,
    });
    expect(productGroupRef(GROUP_PRODUCT_ID, row, ctx)).toEqual({
      value: { $fk: { object: "product", sfdcId: GROUP_PRODUCT_ID } },
    });
    expect(productGroupRef("", row, ctx)).toBeUndefined();
    // unknown target metadata (preflight not run) keeps the spec default
    const bare = buildTransformContext({
      objectKey: "order_line",
      field: {
        source: ORDER_LINE_PRODUCT_GROUP_FIELD,
        target: ORDER_LINE_PRODUCT_GROUP_TARGET,
      },
      ids,
    });
    expect(productGroupRef(GROUP_PRODUCT_ID, row, bare)).toEqual({
      value: { $fk: { object: "product", sfdcId: GROUP_PRODUCT_ID } },
    });
  });

  it("productGroupRef switches to product_group when the target says so, keeping unresolved diagnostics", () => {
    const ctx = buildTransformContext({
      objectKey: "order_line",
      field: {
        source: ORDER_LINE_PRODUCT_GROUP_FIELD,
        target: ORDER_LINE_PRODUCT_GROUP_TARGET,
      },
      targetField: {
        type: "object",
        rawType: "Object",
        referenceObject: "product_group__v",
      },
      ids,
    });
    expect(productGroupRef(GROUP_PRODUCT_ID, row, ctx)).toMatchObject({
      value: { $fk: { object: "product_group", sfdcId: GROUP_PRODUCT_ID } },
      diagnostic: { kind: "custom", code: FK_TARGET_SWITCHED_CODE },
    });
    const unresolved = productGroupRef(to18("a0P000000000009"), row, ctx);
    expect(unresolved).toMatchObject({
      value: {
        $fk: { object: "product_group", sfdcId: to18("a0P000000000009") },
      },
      unresolved: {
        objectKey: "product_group",
        sfdcId: to18("a0P000000000009"),
      },
    });
  });
});
