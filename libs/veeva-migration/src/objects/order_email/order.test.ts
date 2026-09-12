import { describe, expect, it } from "vitest";
import {
  CONTRACT_REF_DROPPED_CODE,
  ORDER_ACCOUNT_FIELD,
  ORDER_ADDRESS_SNAPSHOT_FIELDS,
  ORDER_DATE_FIELD,
  ORDER_OBJECT_TYPES,
  ORDER_OPEN_PREDICATE,
  ORDER_OUT_OF_SCOPE_REFS,
  ORDER_PARENT_FIELD,
  ORDER_SIGNATURE_BLOB,
  ORDER_STATES,
  ORDER_STATUS,
  OUT_OF_SCOPE_REF_DROPPED_CODE,
  order,
  outOfScopeRef,
} from "./order";
import { validateObjectModule } from "../types";
import { loadOrder } from "../registry";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
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
const ORDER_ID = to18("a0O000000000001");
const PARENT_ORDER_ID = to18("a0O000000000002");
const WHOLESALER_ID = IDS.account2;
const SHIP_ADDRESS_ID = to18("a0A000000000001");
const BILL_ADDRESS_ID = to18("a0A000000000002");
const CONTRACT_ID = to18("a0T000000000001");
const PAYER_ID = to18("a0X000000000001");
const LIFECYCLE = {
  name: "order_lifecycle__v",
  states: Object.values(ORDER_STATES),
};

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
    objects: { order: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "order__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        { name: "call2__v", type: "Object", object: { name: "call2__v" } },
        {
          name: "parent_order__v",
          type: "Object",
          object: { name: "order__v" },
        },
        {
          name: "wholesaler__v",
          type: "Object",
          object: { name: "account__v" },
        },
        {
          name: "ship_to_address__v",
          type: "Object",
          object: { name: "address__v" },
        },
        {
          name: "billing_address__v",
          type: "Object",
          object: { name: "address__v" },
        },
        { name: "order_date__v", type: "Date", required: true },
        { name: "delivery_date__v", type: "Date" },
        { name: "datetime__v", type: "DateTime" },
        { name: "signature_date__v", type: "DateTime" },
        {
          name: "order_status__v",
          type: "Picklist",
          picklist: "order_status__v",
          required: true,
        },
        { name: "master_order__v", type: "Boolean" },
        { name: "delivery_order__v", type: "Boolean" },
        { name: "order_list_amount__v", type: "Number", scale: 2 },
        { name: "order_net_amount__v", type: "Number", scale: 2 },
        { name: "order_discount__v", type: "Number", scale: 2 },
        { name: "order_free_goods__v", type: "Number", scale: 0 },
        { name: "order_total_quantity__v", type: "Number", scale: 0 },
        { name: "local_currency__sys", type: "String", max_length: 3 },
        ...ORDER_ADDRESS_SNAPSHOT_FIELDS.map((f) => ({
          name: f.target,
          type: "String",
          max_length: 255,
        })),
        { name: "notes__v", type: "LongText" },
        { name: "signature__v", type: "LongText", max_length: 131072 },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        { name: "lock__v", type: "Boolean" },
      ],
      {
        objectTypes: Object.values(ORDER_OBJECT_TYPES),
        lifecycles: [LIFECYCLE.name],
      },
    ),
    {
      picklists: {
        order_status__v: Object.values(ORDER_STATUS),
        status__v: ["active__v", "inactive__v"],
      },
      lifecycle: LIFECYCLE,
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ORDER_ID,
    IsDeleted: false,
    Name: "ORD-000042",
    "RecordType.DeveloperName": "Direct_vod",
    CurrencyIsoCode: "USD",
    [ORDER_ACCOUNT_FIELD]: IDS.account1,
    Call2_vod__c: IDS.call1,
    [ORDER_PARENT_FIELD]: PARENT_ORDER_ID,
    Wholesaler_vod__c: WHOLESALER_ID,
    Ship_To_Address_vod__c: SHIP_ADDRESS_ID,
    Billing_Address_vod__c: BILL_ADDRESS_ID,
    Contract_vod__c: CONTRACT_ID,
    Payer_vod__c: PAYER_ID,
    [ORDER_DATE_FIELD]: "2025-03-04",
    Delivery_Date_vod__c: "2025-03-10",
    DateTime_vod__c: "2025-03-04T10:30:00.000Z",
    Signature_Date_vod__c: "2025-03-04T10:31:00.000Z",
    Status_vod__c: "Submitted_vod",
    Lock_vod__c: "true",
    Master_Order_vod__c: "true",
    Delivery_Order_vod__c: "false",
    Order_List_Amount_vod__c: "1250.5",
    Order_Net_Amount_vod__c: "1100.25",
    Order_Discount_vod__c: "150.25",
    Order_Free_Goods_vod__c: "2",
    Order_Total_Quantity_vod__c: "12",
    Ship_To_Address_Line_1_vod__c: "1 Main St",
    Ship_To_City_vod__c: "Cambridge",
    Ship_To_State_vod__c: "MA",
    Ship_To_Zip_vod__c: "02139",
    Ship_To_Country_vod__c: "US",
    Billing_City_vod__c: "Boston",
    Notes_vod__c: "Deliver to the back door",
    Signature_vod__c: "iVBORw0KGgo=",
    List_Amount_vod__c: "1250.5",
    Net_Amount_vod__c: "1100.25",
    Ship_To_Address_Text_vod__c: "1 Main St, Cambridge",
    Total_Discount_vod__c: "150.25",
    zvod_Order_Lines_vod__c: "x",
    Mobile_ID_vod__c: "7d2c5f4e-order-0001",
    OwnerId: SAMPLE_USER_ID,
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
    accounts?: Record<string, string>;
    orders?: Record<string, string>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(order, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const ids = buildIdResolver(
    {
      account: opts.accounts ?? {
        [IDS.account1]: "V0A1",
        [WHOLESALER_ID]: "V0A2",
      },
      call2: { [IDS.call1]: "V0K1" },
      address: { [SHIP_ADDRESS_ID]: "V0D1", [BILL_ADDRESS_ID]: "V0D2" },
      order: opts.orders ?? { [PARENT_ORDER_ID]: "V0O2" },
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
      custom: order.custom,
    }),
  };
}

describe("order module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(order).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.38 / §3.3 / §4.4 catalogue facts and the self-reference", () => {
    expect(order.source).toBe("Order_vod__c");
    expect(order.target).toBe("order__v");
    expect(order.targetEvidence).toBe("DOC");
    expect(order.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Order_Date_vod__c", type: "date" }],
      openPredicate: ORDER_OPEN_PREDICATE,
    });
    expect(ORDER_OPEN_PREDICATE).toBe(
      "Status_vod__c NOT IN ('Submitted_vod', 'Voided_vod')",
    );
    expect(order.countryOf).toEqual([{ kind: "account" }]);
    expect(order.dependsOn).toEqual(["account", "call2", "address", "user"]);
    expect(order.selfRefs).toEqual([
      { target: "parent_order__v", source: "Parent_Order_vod__c" },
    ]);
    expect(order.objectTypes).toEqual({
      Direct_vod: "direct__v",
      Transfer_vod: "transfer__v",
    });
    expect(order.states).toEqual(ORDER_STATES);
    expect(order.deletePolicy).toBe("ignore");
    expect(order.inactivate).toEqual([]);
    expect(order.createPolicy).toBe("create");
    expect(order.load.noTriggers).toBe(true);
    expect(order.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(order.match[1]).toMatchObject({
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    });
    expect(order.blobs).toEqual({ [ORDER_SIGNATURE_BLOB]: "optional" });
    expect(order.blockS.currency).toBe(true);
    expect(order.blockS.objectType).toBe(true);
    expect(order.blockS.statusFromFlag).toBeUndefined();
    expect(order.notes).not.toContain("STUB");
    // the self-reference is patched in pass 2 (§6.1 step 19)
    const steps = loadOrder([
      { key: "account", dependsOn: [], selfRefs: [] },
      { key: "user", dependsOn: [], selfRefs: [] },
      { key: "address", dependsOn: ["account"], selfRefs: [] },
      { key: "call2", dependsOn: ["account", "user"], selfRefs: [] },
      order,
    ]);
    const level = (k: string) =>
      steps.findIndex((s) => s.keys.includes(k as never));
    expect(level("order")).toBeGreaterThan(level("call2"));
    expect(steps[level("order")].pass2).toContainEqual({
      objectKey: "order",
      target: "parent_order__v",
      source: "Parent_Order_vod__c",
      refKey: "order",
    });
  });

  it("carries every §6.3.38 row with its transform, evidence and skips", () => {
    const byTarget = new Map(order.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "account__v",
      "call2__v",
      "parent_order__v",
      "wholesaler__v",
      "ship_to_address__v",
      "billing_address__v",
      ...ORDER_OUT_OF_SCOPE_REFS.map((r) => r.target),
      "order_date__v",
      "delivery_date__v",
      "datetime__v",
      "signature_date__v",
      "order_status__v",
      "state__v",
      "lock__v",
      "master_order__v",
      "delivery_order__v",
      "order_list_amount__v",
      "order_net_amount__v",
      "order_discount__v",
      "order_free_goods__v",
      "order_total_quantity__v",
      "local_currency__sys",
      ...ORDER_ADDRESS_SNAPSHOT_FIELDS.map((f) => f.target),
      "notes__v",
      "signature__v",
      "ownerid__v",
      "object_type__v.api_name__v",
      "mobile_id__v",
      "list_amount__v",
      "net_amount__v",
      "ship_to_address_text__v",
      "total_discount__v",
      "zvod_order_lines__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("parent_order__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "order" },
      },
      required: "n",
    });
    expect(byTarget.get("wholesaler__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "account",
    });
    expect(byTarget.get("ship_to_address__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "address",
    });
    // §6.3.38 row 2 has no Vault target (`—`): the placeholder target is
    // marked target-less with required '-' so preflight keeps the count row
    for (const r of ORDER_OUT_OF_SCOPE_REFS)
      expect(byTarget.get(r.target), r.target).toMatchObject({
        source: r.source,
        transform: { kind: "custom", fnName: "outOfScopeRef" },
        required: "-",
        optionalSource: true,
        evidence: "UNV",
      });
    expect(byTarget.get("order_date__v")).toMatchObject({
      transform: { kind: "date" },
      required: "Y",
      evidence: "DOC",
    });
    expect(byTarget.get("datetime__v")?.transform).toEqual({
      kind: "datetime",
    });
    expect(byTarget.get("order_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "order.status" },
      required: "Y",
    });
    expect(byTarget.get("state__v")).toMatchObject({
      transform: { kind: "state", mapKey: "order.state" },
      required: "Y",
    });
    expect(byTarget.get("lock__v")?.transform).toEqual({ kind: "bool" });
    expect(byTarget.get("order_list_amount__v")?.transform).toEqual({
      kind: "number",
    });
    expect(byTarget.get("local_currency__sys")?.transform).toEqual({
      kind: "currency",
    });
    for (const f of ORDER_ADDRESS_SNAPSHOT_FIELDS)
      expect(byTarget.get(f.target), f.target).toMatchObject({
        transform: { kind: "text" },
        unverifiedSource: true,
        optionalSource: true,
      });
    expect(byTarget.get("signature__v")).toMatchObject({
      transform: { kind: "deferredBlob", blobName: ORDER_SIGNATURE_BLOB },
      blobName: ORDER_SIGNATURE_BLOB,
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: "RecordType.DeveloperName",
      transform: { kind: "objectType", mapKey: "order.objectType" },
    });
    for (const target of [
      "list_amount__v",
      "net_amount__v",
      "ship_to_address_text__v",
      "total_discount__v",
      "zvod_order_lines__v",
    ])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "skip" },
        required: "-",
      });
    expect(order.picklists["order.status"]).toEqual({
      Saved_vod: "saved__v",
      Submitted_vod: "submitted__v",
      Voided_vod: "voided__v",
    });
    for (const f of order.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: FKs deferred, parent order in pass 2, type/status/state, currency, blob, out-of-v1 refs counted", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ORDER_ID,
      name__v: "ORD-000042",
      "object_type__v.api_name__v": "direct__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      wholesaler__v: { $fk: { object: "account", sfdcId: WHOLESALER_ID } },
      ship_to_address__v: {
        $fk: { object: "address", sfdcId: SHIP_ADDRESS_ID },
      },
      billing_address__v: {
        $fk: { object: "address", sfdcId: BILL_ADDRESS_ID },
      },
      order_date__v: "2025-03-04",
      delivery_date__v: "2025-03-10",
      datetime__v: "2025-03-04T10:30:00.000Z",
      signature_date__v: "2025-03-04T10:31:00.000Z",
      order_status__v: "submitted__v",
      state__v: "submitted_state__v",
      lock__v: true,
      master_order__v: true,
      delivery_order__v: false,
      order_list_amount__v: 1250.5,
      order_net_amount__v: 1100.25,
      order_discount__v: 150.25,
      order_free_goods__v: 2,
      order_total_quantity__v: 12,
      local_currency__sys: "USD",
      ship_to_address_line_1__v: "1 Main St",
      ship_to_city__v: "Cambridge",
      ship_to_state__v: "MA",
      ship_to_zip__v: "02139",
      ship_to_country__v: "US",
      billing_city__v: "Boston",
      notes__v: "Deliver to the back door",
      mobile_id__v: "7d2c5f4e-order-0001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-04T10:00:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.objectType).toBe("direct__v");
    // pass 1 never carries the self reference; the deferred ref waits for pass 2
    expect(result.payload.parent_order__v).toBeUndefined();
    expect(result.secondPass).toEqual({
      parent_order__v: { $fk: { object: "order", sfdcId: PARENT_ORDER_ID } },
    });
    expect(result.blobs).toEqual({ signature__v: "iVBORw0KGgo=" });
    expect(result.payload.signature__v).toBeUndefined();
    // out-of-v1 lookups: omitted and counted
    expect(result.payload.contract__v).toBeUndefined();
    expect(result.payload.payer__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "contract__v",
        code: CONTRACT_REF_DROPPED_CODE,
        value: CONTRACT_ID,
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "payer__v",
        code: OUT_OF_SCOPE_REF_DROPPED_CODE,
        value: PAYER_ID,
      }),
    );
    // skips and platform status never land in the payload
    for (const target of [
      "list_amount__v",
      "net_amount__v",
      "ship_to_address_text__v",
      "total_discount__v",
      "zvod_order_lines__v",
      "status__v",
    ])
      expect(result.payload[target], target).toBeUndefined();
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.fkEdges).toContainEqual({
      field: "parent_order__v",
      targetObjectKey: "order",
      targetSfdcId: PARENT_ORDER_ID,
    });
  });

  it("reports an unresolved required account as pending_fk and keeps an unresolved parent order as an optional pass-2 edge", () => {
    const { result } = run(sampleRow({ [ORDER_ACCOUNT_FIELD]: IDS.account4 }));
    expect(result.status).toBe("pending_fk");
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
    const { result: noParent } = run(sampleRow(), { orders: {} });
    expect(noParent.status).toBe("ok");
    expect(noParent.secondPass.parent_order__v).toEqual({
      $fk: { object: "order", sfdcId: PARENT_ORDER_ID },
    });
    expect(noParent.unresolvedOptionalFks).toContainEqual({
      field: "parent_order__v",
      objectKey: "order",
      sfdcId: PARENT_ORDER_ID,
      secondPass: true,
    });
  });

  it("fails a row whose status has no lifecycle state or whose record type has no object type", () => {
    const { result: unknownStatus } = run(
      sampleRow({ Status_vod__c: "Archived_vod" }),
    );
    expect(unknownStatus.status).toBe("failed");
    const { result: unknownType } = run(
      sampleRow({ "RecordType.DeveloperName": "Consignment_vod" }),
    );
    expect(unknownType.status).toBe("failed");
    expect(unknownType.diagnostics).toContainEqual(
      expect.objectContaining({ code: "VT_OBJECT_TYPE_MISSING" }),
    );
  });

  it("is dated on Order_Date_vod__c with the open-item term and an explicit cutoff literal", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.historyMonths).toBe(24);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    const build = buildScopePredicate(mapping.scope, { now: NOW });
    expect(build.kind).toBe("dated");
    expect(build.dateTerm).toBe("Order_Date_vod__c >= 2024-09-07");
    expect(build.openTerm).toBe(ORDER_OPEN_PREDICATE);
    expect(build.predicate).toBe(
      `(Order_Date_vod__c >= 2024-09-07) OR (${ORDER_OPEN_PREDICATE})`,
    );
    expect(mapping.countryOf).toEqual([{ kind: "account" }]);
    expect(mapping.objectTypes).toEqual(ORDER_OBJECT_TYPES);
    expect(mapping.states).toEqual(ORDER_STATES);
    expect(mapping.selfRefs).toEqual(order.selfRefs);
    expect(mapping.options.blobs).toEqual({ signature: "optional" });
    // lifecycled object: type changes are blocked by default (§2.5.6)
    expect(mapping.options.allowTypeChange).toBe(false);
  });
});

describe("order custom transforms", () => {
  it("outOfScopeRef omits the value and counts it under the right code", () => {
    const row = { Id: ORDER_ID };
    const contract = buildTransformContext({
      objectKey: "order",
      field: { source: "Contract_vod__c", target: "contract__v" },
    });
    expect(outOfScopeRef(CONTRACT_ID, row, contract)).toEqual({
      omit: true,
      diagnostic: {
        kind: "out_of_scope_ref_dropped",
        field: "contract__v",
        code: CONTRACT_REF_DROPPED_CODE,
        value: CONTRACT_ID,
        detail: "Contract_vod__c references an object outside v1 (§6.2.1)",
      },
    });
    const payer = buildTransformContext({
      objectKey: "order",
      field: { source: "Payer_vod__c", target: "payer__v" },
    });
    expect(outOfScopeRef("a0X000000000001", row, payer)).toMatchObject({
      omit: true,
      diagnostic: { code: OUT_OF_SCOPE_REF_DROPPED_CODE, value: PAYER_ID },
    });
    expect(outOfScopeRef("", row, payer)).toBeUndefined();
    expect(outOfScopeRef(null, row, payer)).toBeUndefined();
  });
});
