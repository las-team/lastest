import { describe, expect, it } from "vitest";
import {
  CALL2_SAMPLE_COLD_CHAIN_STATUS,
  CALL2_SAMPLE_DELIVERY_STATUS,
  call2SampleNoTriggers,
  call2_sample,
} from "./call2_sample";
import { CALL2_OPEN_PREDICATE } from "./call2";
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
const CUTOFF_24M = "2024-09-07";
const CUTOFF_60M = "2021-09-07";
const SAMPLE_ID = to18("a0S000000000001");
const PRODUCT_ID = to18("a0P000000000001");

function makeConfig(
  opts: { scope?: Record<string, unknown>; us?: Record<string, unknown> } = {},
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
    ...(opts.scope ? { scope: opts.scope } : {}),
    countries: { US: opts.us ?? {} },
  });
}

const metadata = resolveMetadata(
  buildVaultMetadata("call2_sample__v", [
    {
      name: "call2__v",
      type: "Object",
      object: { name: "call2__v" },
      required: true,
    },
    {
      name: "attendee_type__v",
      type: "Picklist",
      picklist: "attendee_type__v",
    },
    { name: "entity_reference_id__v", type: "String", max_length: 255 },
    { name: "call2_mobile_id__v", type: "String", max_length: 255 },
    {
      name: "product__v",
      type: "Object",
      object: { name: "product__v" },
      required: true,
    },
    { name: "account__v", type: "Object", object: { name: "account__v" } },
    { name: "call_date__v", type: "Date", required: true },
    { name: "quantity__v", type: "Number", scale: 0, required: true },
    { name: "lot__v", type: "String", max_length: 80 },
    { name: "amount__v", type: "Number", scale: 2 },
    { name: "product_value__v", type: "Number", scale: 2 },
    { name: "local_currency__sys", type: "Picklist" },
    { name: "manufacturer__v", type: "String", max_length: 255 },
    { name: "distributor__v", type: "String", max_length: 255 },
    {
      name: "delivery_status__v",
      type: "Picklist",
      picklist: "delivery_status__v",
    },
    {
      name: "cold_chain_status__v",
      type: "Picklist",
      picklist: "cold_chain_status__v",
    },
    { name: "apply_limit__v", type: "Boolean" },
    { name: "limit_applied__v", type: "Boolean" },
    { name: "custom_text__v", type: "String", max_length: 255 },
    { name: "tag_alert_number__v", type: "String", max_length: 255 },
    { name: "mobile_id__v", type: "String", max_length: 100 },
  ]),
  {
    picklists: {
      attendee_type__v: ["person_account__v"],
      delivery_status__v: Object.values(CALL2_SAMPLE_DELIVERY_STATUS),
      cold_chain_status__v: Object.values(CALL2_SAMPLE_COLD_CHAIN_STATUS),
    },
  },
);

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: SAMPLE_ID,
    Name: "CS-000001",
    Call2_vod__c: IDS.call1,
    Product_vod__c: PRODUCT_ID,
    Account_vod__c: IDS.account1,
    Call_Date_vod__c: "2025-03-04",
    Quantity_vod__c: "3",
    Lot_vod__c: "LOT-2026-001",
    Amount_vod__c: "10.5",
    Product_Value_vod__c: "31.5",
    CurrencyIsoCode: "USD",
    Manufacturer_vod__c: "Verteo",
    Distributor_vod__c: "ACME Dist",
    Delivery_Status_vod__c: "Delivered_vod",
    Cold_Chain_Status_vod__c: "In Range",
    Apply_Limit_vod__c: "true",
    Limit_Applied_vod__c: "false",
    Custom_Text_vod__c: "left with nurse",
    Tag_Alert_Number_vod__c: "TA-1",
    Attendee_Type_vod__c: "Person_Account_vod",
    Mobile_ID_vod__c: "mob-sample-1",
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    config?: Parameters<typeof makeConfig>[0];
    knownCall?: boolean;
    knownProduct?: boolean;
  } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    call2_sample,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      call2: opts.knownCall === false ? {} : { [IDS.call1]: "V0K1" },
      product: opts.knownProduct === false ? {} : { [PRODUCT_ID]: "V0P1" },
      account: { [IDS.account1]: "V0A1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: call2_sample.custom,
    }),
  };
}

describe("call2_sample module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(call2_sample).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(call2_sample.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.34 / §4.4 catalogue facts", () => {
    expect(call2_sample.source).toBe("Call2_Sample_vod__c");
    expect(call2_sample.target).toBe("call2_sample__v");
    expect(call2_sample.targetEvidence).toBe("UNV");
    expect(call2_sample.scope).toEqual({
      kind: "via-parent",
      parentKey: "call2",
      parentField: "Call2_vod__r.Call_Date_vod__c",
      type: "date",
      retentionFamily: "samples",
    });
    expect(call2_sample.countryOf).toEqual([
      { kind: "parent", key: "call2", field: "Call2_vod__c" },
    ]);
    expect(call2_sample.dependsOn).toEqual(["call2", "product", "account"]);
    expect(call2_sample.deletePolicy).toBe("delete");
    expect(call2_sample.inactivate).toEqual([]);
    expect(call2_sample.createPolicy).toBe("create");
    expect(call2_sample.load).toMatchObject({ noTriggers: true });
    // the strategy lives on objects.sample_transaction.load only (§6.3.34)
    expect(call2_sample.load.sampleStrategy).toBeUndefined();
    expect(call2_sample.load.fallbackStrategy).toBeUndefined();
    expect(call2_sample.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      currency: true,
    });
    expect(call2_sample.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
  });

  it("NoTriggers under every sample strategy except triggersOnCallSamples (§6.3.34)", () => {
    expect(call2SampleNoTriggers(undefined)).toBe(true);
    expect(call2SampleNoTriggers("noTriggersRecalc")).toBe(true);
    expect(call2SampleNoTriggers("noTriggersVerify")).toBe(true);
    expect(call2SampleNoTriggers("triggersOnTransactions")).toBe(true);
    expect(call2SampleNoTriggers("triggersOnCallSamples")).toBe(false);
  });

  it("maps every §6.3.34 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(call2_sample.fields.map((f) => [f.target, f]));
    expect(byTarget.get("call2__v")).toMatchObject({
      required: "Y",
      transform: { kind: "ref", objectKey: "call2" },
    });
    expect(byTarget.get("product__v")).toMatchObject({
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "product" },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      required: "n",
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("call_date__v")).toMatchObject({
      required: "Y",
      transform: { kind: "date" },
    });
    expect(byTarget.get("quantity__v")).toMatchObject({
      required: "Y",
      transform: { kind: "number" },
    });
    expect(byTarget.get("lot__v")).toMatchObject({
      source: "Lot_vod__c",
      transform: { kind: "text", max: 80 },
    });
    for (const t of ["amount__v", "product_value__v"])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "number" } });
    expect(byTarget.get("local_currency__sys")).toMatchObject({
      source: "CurrencyIsoCode",
      transform: { kind: "currency" },
    });
    for (const t of [
      "manufacturer__v",
      "distributor__v",
      "custom_text__v",
      "tag_alert_number__v",
    ])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "text" } });
    expect(byTarget.get("delivery_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "call2_sample.deliveryStatus" },
    });
    expect(byTarget.get("cold_chain_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "call2_sample.coldChainStatus" },
    });
    for (const t of ["apply_limit__v", "limit_applied__v"])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "bool" } });
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.get("name__v")).toMatchObject({
      enabledBy: "preserveAutoNumberName",
    });
    expect(call2_sample.picklists["call2_sample.deliveryStatus"]).toEqual(
      CALL2_SAMPLE_DELIVERY_STATUS,
    );
    expect(call2_sample.picklists["call2_sample.coldChainStatus"]).toEqual(
      CALL2_SAMPLE_COLD_CHAIN_STATUS,
    );
  });

  it("transforms a call sample row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: SAMPLE_ID,
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      call_date__v: "2025-03-04",
      quantity__v: 3,
      lot__v: "LOT-2026-001",
      amount__v: 10.5,
      product_value__v: 31.5,
      local_currency__sys: "USD",
      manufacturer__v: "Verteo",
      distributor__v: "ACME Dist",
      delivery_status__v: "delivered__v",
      cold_chain_status__v: "in_range__v",
      apply_limit__v: true,
      limit_applied__v: false,
      custom_text__v: "left with nurse",
      tag_alert_number__v: "TA-1",
      attendee_type__v: "person_account__v",
      mobile_id__v: "mob-sample-1",
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.payload.name__v).toBeUndefined();
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
    // a customer delivery status is derived by the rename rule and validated
    const unknown = run(
      sampleRow({ Delivery_Status_vod__c: "Lost_vod" }),
    ).result;
    expect(unknown.status).toBe("failed");
    expect(unknown.failure?.code).toBe("UNMAPPED_PICKLIST");
  });

  it("reports unresolved required references as pending_fk and missing required values as failed", () => {
    const pendingCall = run(sampleRow(), { knownCall: false }).result;
    expect(pendingCall.status).toBe("pending_fk");
    expect(pendingCall.unresolvedRequiredFks).toEqual([
      { field: "call2__v", objectKey: "call2", sfdcId: IDS.call1 },
    ]);
    const pendingProduct = run(sampleRow(), { knownProduct: false }).result;
    expect(pendingProduct.status).toBe("pending_fk");
    expect(pendingProduct.unresolvedRequiredFks).toEqual([
      { field: "product__v", objectKey: "product", sfdcId: PRODUCT_ID },
    ]);
    const noQuantity = run(sampleRow({ Quantity_vod__c: "" })).result;
    expect(noQuantity.status).toBe("failed");
    expect(noQuantity.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "quantity__v",
    });
  });

  it("scope: parent call date widened by the samples retention family", () => {
    const base = run(sampleRow()).mapping.scope;
    expect(base.retentionFamily).toBe("samples");
    expect(base.historyMonths).toBe(24);
    expect(base.cutoffDate).toBe(CUTOFF_24M);
    expect(
      buildScopePredicate(base, { parentOpenPredicate: CALL2_OPEN_PREDICATE })
        .predicate,
    ).toBe(
      `(Call2_vod__r.Call_Date_vod__c >= ${CUTOFF_24M}) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')`,
    );
    const us = run(sampleRow(), {
      config: { scope: { sampleRetentionMonths: 60 } },
    }).mapping.scope;
    expect(us.historyMonths).toBe(60);
    expect(us.cutoffDate).toBe(CUTOFF_60M);
    expect(buildScopePredicate(us).predicate).toBe(
      `Call2_vod__r.Call_Date_vod__c >= ${CUTOFF_60M}`,
    );
  });
});
