import { describe, expect, it } from "vitest";
import {
  SAMPLE_TRANSACTION_DISBURSEMENT_TYPE,
  SAMPLE_TRANSACTION_OBJECT_TYPES,
  SAMPLE_TRANSACTION_SIGNATURE_BLOB,
  SAMPLE_TRANSACTION_SNAPSHOT_FIELDS,
  SAMPLE_TRANSACTION_STATES,
  TRIGGERS_ON_CALL_SAMPLES_PREDICATE,
  accountRef,
  isDisbursement,
  rollupSign,
  sample_transaction,
  signedQuantity,
} from "./sample_transaction";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const TX_ID = to18("a0T000000000001");
const REF_TX_ID = to18("a0T000000000002");
const LOT_ID = to18("a0L000000000001");
const CALL_SAMPLE_ID = to18("a0S000000000001");

function makeConfig(
  opts: {
    sample_transaction?: Record<string, unknown>;
    scope?: Record<string, unknown>;
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
    ...(opts.scope ? { scope: opts.scope } : {}),
    objects: { sample_transaction: opts.sample_transaction ?? {} },
    countries: { US: opts.countries ?? {} },
  });
}

const OBJECT_TYPE_NAMES = Object.values(SAMPLE_TRANSACTION_OBJECT_TYPES);
const STATE_NAMES = Object.values(SAMPLE_TRANSACTION_STATES);

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "sample_transaction__v",
      [
        { name: "type__v", type: "Picklist", picklist: "type__v" },
        {
          name: "lot__v",
          type: "Object",
          object: { name: "sample_lot__v" },
          required: true,
        },
        { name: "account__v", type: "Object", object: { name: "account__v" } },
        { name: "quantity__v", type: "Number", scale: 0, required: true },
        { name: "confirmed_quantity__v", type: "Number", scale: 0 },
        { name: "u_m__v", type: "Picklist", picklist: "u_m__v" },
        {
          name: "sample_transaction_status__v",
          type: "Picklist",
          picklist: "sample_transaction_status__v",
        },
        { name: "call_date__v", type: "Date" },
        { name: "call_datetime__v", type: "DateTime" },
        { name: "call_name__v", type: "String", max_length: 100 },
        { name: "call2__v", type: "Object", object: { name: "call2__v" } },
        {
          name: "call_sample__v",
          type: "Object",
          object: { name: "call2_sample__v" },
        },
        {
          name: "transfer_to__v",
          type: "Object",
          object: { name: "user__sys" },
        },
        {
          name: "transferred_from__v",
          type: "Object",
          object: { name: "user__sys" },
        },
        {
          name: "adjust_for__v",
          type: "Object",
          object: { name: "user__sys" },
        },
        { name: "transfer_to_name__v", type: "String", max_length: 100 },
        { name: "transferred_from_name__v", type: "String", max_length: 100 },
        { name: "transferred_date__v", type: "Date" },
        { name: "adjusted_date__v", type: "Date" },
        { name: "submitted_date__v", type: "Date" },
        { name: "signature_date__v", type: "DateTime" },
        {
          name: "ref_transaction_id__v",
          type: "Object",
          object: { name: "sample_transaction__v" },
        },
        { name: "group_transaction_id__v", type: "String", max_length: 255 },
        { name: "shipment_id__v", type: "String", max_length: 100 },
        { name: "sample_card__v", type: "String", max_length: 100 },
        { name: "sample_card_reason__v", type: "String", max_length: 100 },
        { name: "reason__v", type: "Picklist", picklist: "reason__v" },
        { name: "return_to__v", type: "Picklist", picklist: "return_to__v" },
        { name: "received__v", type: "Boolean" },
        { name: "receipt_comments__v", type: "String", max_length: 1500 },
        { name: "comments__v", type: "String", max_length: 1500 },
        { name: "request_receipt__v", type: "Boolean" },
        {
          name: "cold_chain_status__v",
          type: "Picklist",
          picklist: "cold_chain_status__v",
        },
        { name: "tag_alert_number__v", type: "String", max_length: 100 },
        { name: "custom_text__v", type: "String", max_length: 100 },
        { name: "manufacturer__v", type: "String", max_length: 100 },
        { name: "distributor__v", type: "String", max_length: 100 },
        { name: "lot_name__v", type: "String", max_length: 100 },
        { name: "sample__v", type: "String", max_length: 100 },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "signature__v", type: "LongText" },
        ...SAMPLE_TRANSACTION_SNAPSHOT_FIELDS.map((f) =>
          f.transform === "date"
            ? { name: f.target, type: "Date" as const }
            : f.transform === "longtext"
              ? { name: f.target, type: "LongText" as const }
              : { name: f.target, type: "String" as const, max_length: 255 },
        ),
        { name: "mobile_id__v", type: "String", max_length: 100 },
        { name: "external_id__v", type: "String", max_length: 100 },
      ],
      {
        objectTypes: OBJECT_TYPE_NAMES,
        lifecycles: ["sample_transaction_lifecycle__c"],
      },
    ),
    {
      picklists: {
        type__v: OBJECT_TYPE_NAMES,
        u_m__v: ["cases__v", "boxes__v", "units__v"],
        sample_transaction_status__v: [
          "saved__v",
          "submitted__v",
          "in_progress__v",
        ],
        reason__v: ["damaged__v", "expired__v"],
        return_to__v: ["hq__v"],
        cold_chain_status__v: ["in_range__v", "not_in_range__v"],
        status__v: ["active__v", "inactive__v"],
      },
      objectTypes: Object.fromEntries(OBJECT_TYPE_NAMES.map((t) => [t, {}])),
      lifecycle: {
        name: "sample_transaction_lifecycle__c",
        states: STATE_NAMES,
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: TX_ID,
    Name: "ST-000123",
    "RecordType.DeveloperName": "Disbursement_vod",
    Type_vod__c: "Disbursement_vod",
    Lot_vod__c: LOT_ID,
    Account_vod__c: IDS.account1,
    Quantity_vod__c: "2",
    Confirmed_Quantity_vod__c: "",
    U_M_vod__c: "Units",
    Status_vod__c: "Submitted_vod",
    Call_Date_vod__c: "2026-03-01",
    Call_Datetime_vod__c: "2026-03-01T14:30:00.000+0000",
    Call_Name_vod__c: "Dr Ada Lovelace 2026-03-01",
    Call2_vod__c: IDS.call1,
    Call_Sample_vod__c: CALL_SAMPLE_ID,
    Submitted_Date_vod__c: "2026-03-01",
    Signature_Date_vod__c: "2026-03-01T14:35:00.000Z",
    Ref_Transaction_Id_vod__c: REF_TX_ID,
    Group_Transaction_Id_vod__c: "GRP-1",
    Reason_vod__c: "Damaged",
    Cold_Chain_Status_vod__c: "In Range",
    Received_vod__c: "true",
    Request_Receipt_vod__c: "false",
    Comments_vod__c: "  left at front desk ",
    Sample_vod__c: "Cholecap 10mg",
    Lot_Name_vod__c: "LOT-2026-001",
    Signature_vod__c: "data:image/png;base64,AAAA",
    Signature_Page_Display_Name_vod__c: "Ada Lovelace, MD",
    Address_Line_1_vod__c: "1 Main St",
    City_vod__c: "Boston",
    State_vod__c: "MA",
    Zip_vod__c: "02110",
    License_vod__c: "MA-12345",
    DEA_vod__c: "AB1234567",
    Disclaimer_vod__c: "PDMA text",
    Discrepancy_vod__c: "0",
    Inventory_Impact_Quantity_vod__c: "-2",
    Group_Identifier_vod__c: "x",
    Unlock_vod__c: "true",
    Mobile_ID_vod__c: "mob-tx-1",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2026-03-01T14:31:00.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2026-03-02T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    config?: Parameters<typeof makeConfig>[0];
    knownLot?: boolean;
    knownAccount?: boolean;
  } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    sample_transaction,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      sample_lot: opts.knownLot === false ? {} : { [LOT_ID]: "V0L1" },
      account: opts.knownAccount === false ? {} : { [IDS.account1]: "V0A1" },
      call2: { [IDS.call1]: "V0K1" },
      call2_sample: { [CALL_SAMPLE_ID]: "V0S1" },
      // the referenced transaction is not loaded yet (pass 2)
      sample_transaction: {},
    },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: sample_transaction.custom,
    }),
  };
}

describe("sample_transaction module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(sample_transaction).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(sample_transaction.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.1 / §4.4 / §6.3.35 catalogue facts", () => {
    expect(sample_transaction.source).toBe("Sample_Transaction_vod__c");
    expect(sample_transaction.target).toBe("sample_transaction__v");
    expect(sample_transaction.targetEvidence).toBe("DOC");
    expect(sample_transaction.scope).toEqual({
      kind: "dated",
      predicates: [
        { field: "Call_Date_vod__c", type: "date" },
        { field: "Transferred_Date_vod__c", type: "date" },
        { field: "Adjusted_Date_vod__c", type: "date" },
        { field: "Submitted_Date_vod__c", type: "date" },
        { field: "CreatedDate", type: "datetime" },
      ],
      retentionFamily: "samples",
    });
    expect(sample_transaction.countryOf).toEqual([
      { kind: "user", field: "OwnerId" },
      { kind: "account" },
    ]);
    expect(sample_transaction.dependsOn).toEqual([
      "sample_lot",
      "account",
      "user",
      "call2",
      "call2_sample",
    ]);
    expect(sample_transaction.selfRefs).toEqual([
      { target: "ref_transaction_id__v", source: "Ref_Transaction_Id_vod__c" },
    ]);
    expect(sample_transaction.deletePolicy).toBe("ignore");
    expect(sample_transaction.inactivate).toEqual([]);
    expect(sample_transaction.createPolicy).toBe("create");
    expect(sample_transaction.load).toMatchObject({
      noTriggers: true,
      sampleStrategy: "noTriggersRecalc",
      sampleTriggerRejectFallback: true,
    });
    expect(sample_transaction.objectTypes).toEqual(
      SAMPLE_TRANSACTION_OBJECT_TYPES,
    );
    expect(sample_transaction.states).toEqual(SAMPLE_TRANSACTION_STATES);
    expect(sample_transaction.blobs).toEqual({
      [SAMPLE_TRANSACTION_SIGNATURE_BLOB]: "optional",
    });
    expect(sample_transaction.blockS.name).toBe("autoNumber");
    expect(sample_transaction.blockS.objectType).toBe(true);
    expect(sample_transaction.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(TRIGGERS_ON_CALL_SAMPLES_PREDICATE).toBe(
      "Type_vod__c != 'Disbursement_vod'",
    );
  });

  it("maps every §6.3.35 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      sample_transaction.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      enabledBy: "preserveAutoNumberName",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: "RecordType.DeveloperName",
      required: "Y",
      transform: {
        kind: "objectType",
        mapKey: "sample_transaction.objectType",
      },
    });
    expect(byTarget.get("type__v")).toMatchObject({
      source: "Type_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "sample_transaction.type" },
    });
    expect(byTarget.get("lot__v")).toMatchObject({
      source: "Lot_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "sample_lot" },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      source: "Account_vod__c",
      required: "n",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "accountRef" },
    });
    expect(byTarget.get("quantity__v")).toMatchObject({
      source: "Quantity_vod__c",
      required: "Y",
      transform: { kind: "number" },
    });
    expect(byTarget.get("confirmed_quantity__v")).toMatchObject({
      required: "n",
      transform: { kind: "number" },
    });
    expect(byTarget.get("u_m__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "sample_transaction.um" },
    });
    expect(byTarget.get("sample_transaction_status__v")).toMatchObject({
      source: "Status_vod__c",
      required: "Y",
      transform: { kind: "picklist", mapKey: "sample_transaction.status" },
    });
    expect(byTarget.get("state__v")).toMatchObject({
      source: "Status_vod__c",
      required: "Y",
      transform: { kind: "state", mapKey: "sample_transaction.state" },
    });
    expect(byTarget.get("call_date__v")).toMatchObject({
      transform: { kind: "date" },
    });
    expect(byTarget.get("call_datetime__v")).toMatchObject({
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("call_name__v")).toMatchObject({
      transform: { kind: "text", max: 100 },
    });
    expect(byTarget.get("call2__v")).toMatchObject({
      optionalSource: true,
      transform: { kind: "ref", objectKey: "call2" },
    });
    expect(byTarget.get("call_sample__v")).toMatchObject({
      optionalSource: true,
      transform: { kind: "ref", objectKey: "call2_sample" },
    });
    for (const t of ["transfer_to__v", "transferred_from__v", "adjust_for__v"])
      expect(byTarget.get(t), t).toMatchObject({
        required: "n",
        evidence: "UNV",
        transform: { kind: "refUser" },
      });
    for (const t of ["transfer_to_name__v", "transferred_from_name__v"])
      expect(byTarget.get(t), t).toMatchObject({ transform: { kind: "text" } });
    for (const t of [
      "transferred_date__v",
      "adjusted_date__v",
      "submitted_date__v",
    ])
      expect(byTarget.get(t), t).toMatchObject({ transform: { kind: "date" } });
    expect(byTarget.get("signature_date__v")).toMatchObject({
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("ref_transaction_id__v")).toMatchObject({
      source: "Ref_Transaction_Id_vod__c",
      evidence: "UNV",
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "sample_transaction" },
      },
    });
    for (const t of [
      "group_transaction_id__v",
      "shipment_id__v",
      "sample_card__v",
      "sample_card_reason__v",
    ])
      expect(byTarget.get(t), t).toMatchObject({ transform: { kind: "copy" } });
    expect(byTarget.get("reason__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "sample_transaction.reason" },
    });
    expect(byTarget.get("return_to__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "sample_transaction.returnTo" },
    });
    expect(byTarget.get("cold_chain_status__v")).toMatchObject({
      transform: {
        kind: "picklist",
        mapKey: "sample_transaction.coldChainStatus",
      },
    });
    for (const t of ["received__v", "request_receipt__v"])
      expect(byTarget.get(t), t).toMatchObject({ transform: { kind: "bool" } });
    for (const t of [
      "receipt_comments__v",
      "comments__v",
      "tag_alert_number__v",
      "custom_text__v",
      "manufacturer__v",
      "distributor__v",
      "lot_name__v",
      "sample__v",
    ])
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "text" },
      });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      source: "OwnerId",
      required: "y?",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("signature__v")).toMatchObject({
      source: "Signature_vod__c",
      blobName: SAMPLE_TRANSACTION_SIGNATURE_BLOB,
      countryConfigurable: true,
      transform: {
        kind: "deferredBlob",
        blobName: SAMPLE_TRANSACTION_SIGNATURE_BLOB,
      },
    });
    // PDMA snapshot: every column present, verbatim, country-configurable
    for (const f of SAMPLE_TRANSACTION_SNAPSHOT_FIELDS)
      expect(byTarget.get(f.target), f.target).toMatchObject({
        source: f.source,
        required: "n",
        evidence: "UNV",
        countryConfigurable: true,
        transform: { kind: f.transform },
      });
    expect(byTarget.get("state_province__v")?.source).toBe("State_vod__c");
    expect(byTarget.get("license_status__v")?.unverifiedSource).toBe(true);
    expect(byTarget.get("dea_zip_4__v")?.unverifiedSource).toBe(true);
    // skips
    for (const src of [
      "zvod_Sample_Lines_vod__c",
      "Discrepancy_vod__c",
      "Inventory_Impact_Quantity_vod__c",
      "Group_Identifier_vod__c",
    ])
      expect(
        sample_transaction.fields.find((f) => f.source === src),
        src,
      ).toMatchObject({ required: "-", transform: { kind: "skip" } });
    // Unlock_vod__c follows its Block S row (gated by loadUnlockFlag)
    expect(byTarget.get("unlock__v")).toMatchObject({
      source: "Unlock_vod__c",
      enabledBy: "loadUnlockFlag",
    });
    // no target mapped twice
    expect(new Set(sample_transaction.fields.map((f) => f.target)).size).toBe(
      sample_transaction.fields.length,
    );
  });

  it("transforms a realistic disbursement row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("disbursement__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: TX_ID,
      "object_type__v.api_name__v": "disbursement__v",
      type__v: "disbursement__v",
      lot__v: { $fk: { object: "sample_lot", sfdcId: LOT_ID } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      quantity__v: 2,
      u_m__v: "units__v",
      sample_transaction_status__v: "submitted__v",
      state__v: "submitted_state__v",
      call_date__v: "2026-03-01",
      call_datetime__v: "2026-03-01T14:30:00.000Z",
      call_name__v: "Dr Ada Lovelace 2026-03-01",
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      call_sample__v: {
        $fk: { object: "call2_sample", sfdcId: CALL_SAMPLE_ID },
      },
      submitted_date__v: "2026-03-01",
      signature_date__v: "2026-03-01T14:35:00.000Z",
      group_transaction_id__v: "GRP-1",
      reason__v: "damaged__v",
      cold_chain_status__v: "in_range__v",
      received__v: true,
      request_receipt__v: false,
      comments__v: "left at front desk",
      sample__v: "Cholecap 10mg",
      lot_name__v: "LOT-2026-001",
      signature_page_display_name__v: "Ada Lovelace, MD",
      address_line_1__v: "1 Main St",
      city__v: "Boston",
      state_province__v: "MA",
      zip__v: "02110",
      license__v: "MA-12345",
      dea__v: "AB1234567",
      disclaimer__v: "PDMA text",
      mobile_id__v: "mob-tx-1",
      last_device__v: "data_load__v",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2026-03-01T14:31:00.000Z",
    });
    // auto-number name skipped by default; empty confirmed quantity omitted
    expect(result.payload.name__v).toBeUndefined();
    expect(result.payload.confirmed_quantity__v).toBeUndefined();
    // skipped / gated / deferred columns never reach the payload
    for (const t of [
      "discrepancy__v",
      "inventory_impact_quantity__v",
      "group_identifier__v",
      "zvod_sample_lines__v",
      "unlock__v",
      "signature__v",
      "ref_transaction_id__v",
      "status__v",
    ])
      expect(result.payload[t], t).toBeUndefined();
    // pass-2 patch kept aside with its FK edge; blob deferred
    expect(result.secondPass).toEqual({
      ref_transaction_id__v: {
        $fk: { object: "sample_transaction", sfdcId: REF_TX_ID },
      },
    });
    expect(result.unresolvedOptionalFks).toContainEqual({
      field: "ref_transaction_id__v",
      objectKey: "sample_transaction",
      sfdcId: REF_TX_ID,
      secondPass: true,
    });
    expect(result.blobs).toEqual({
      signature__v: "data:image/png;base64,AAAA",
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "deferred_blob",
        field: "signature__v",
        code: SAMPLE_TRANSACTION_SIGNATURE_BLOB,
      }),
    );
  });

  it("carries the SFDC auto-number name only with preserveAutoNumberName", () => {
    const { result } = run(sampleRow(), {
      config: { sample_transaction: { preserveAutoNumberName: true } },
    });
    expect(result.status).toBe("ok");
    expect(result.payload.name__v).toBe("ST-000123");
  });

  it("reports an unresolved required lot as pending_fk", () => {
    const { result } = run(sampleRow(), { knownLot: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "lot__v", objectKey: "sample_lot", sfdcId: LOT_ID },
    ]);
    expect(result.payload.lot__v).toEqual({
      $fk: { object: "sample_lot", sfdcId: LOT_ID },
    });
  });

  it("requires account__v on disbursements only (custom accountRef)", () => {
    const missing = run(sampleRow({ Account_vod__c: "" }));
    expect(missing.result.status).toBe("failed");
    expect(missing.result.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "account__v",
    });
    const receipt = run(
      sampleRow({
        "RecordType.DeveloperName": "Receipt_vod",
        Type_vod__c: "Receipt_vod",
        Account_vod__c: "",
        Call2_vod__c: "",
        Call_Sample_vod__c: "",
        Call_Date_vod__c: "",
      }),
    );
    expect(receipt.result.status).toBe("ok");
    expect(receipt.result.objectType).toBe("receipt__v");
    expect(receipt.result.payload.account__v).toBeUndefined();
    // unresolved account on a disbursement: optional path (omitted, edge kept)
    const unresolved = run(sampleRow(), { knownAccount: false });
    expect(unresolved.result.status).toBe("ok");
    expect(unresolved.result.payload.account__v).toBeUndefined();
    expect(unresolved.result.unresolvedOptionalFks).toContainEqual({
      field: "account__v",
      objectKey: "account",
      sfdcId: IDS.account1,
    });
  });

  it("fails on an unmapped lifecycle state (lifecycled object)", () => {
    // the business-status crosswalk knows the value; the lifecycle does not
    const { result } = run(sampleRow({ Status_vod__c: "Voided_vod" }), {
      config: {
        countries: {
          picklists: {
            "sample_transaction.status": { Voided_vod: "saved__v" },
          },
        },
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("VT_LIFECYCLE_STATE_MISSING");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmapped_picklist",
        field: "state__v",
        code: "VT_LIFECYCLE_STATE_MISSING",
        fatal: true,
      }),
    );
  });

  it("honours config picklist crosswalks and the reason derivation", () => {
    const { result } = run(sampleRow({ Reason_vod__c: "Expired" }), {
      config: {
        countries: {
          picklists: { "sample_transaction.reason": { Expired: "expired__v" } },
        },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.payload.reason__v).toBe("expired__v");
  });

  it("builds the OR-of-dates scope predicate with the samples retention widening", () => {
    const base = run(sampleRow());
    expect(base.mapping.scope.retentionFamily).toBe("samples");
    const build = buildScopePredicate(base.mapping.scope, { now: NOW });
    expect(build.kind).toBe("dated");
    expect(build.cutoffDate).toBe("2024-09-07");
    expect(build.predicate).toBe(
      [
        "Call_Date_vod__c >= 2024-09-07",
        "Transferred_Date_vod__c >= 2024-09-07",
        "Adjusted_Date_vod__c >= 2024-09-07",
        "Submitted_Date_vod__c >= 2024-09-07",
        "CreatedDate >= 2024-09-07T00:00:00Z",
      ].join(" OR "),
    );
    expect(build.openTerm).toBeUndefined();
    // US: sampleRetentionMonths 36 widens the window (§1.1 #3)
    const us = run(sampleRow(), {
      config: { countries: { scope: { sampleRetentionMonths: 36 } } },
    });
    const wide = buildScopePredicate(us.mapping.scope, { now: NOW });
    expect(wide.cutoffDate).toBe("2023-09-07");
    expect(wide.predicate).toContain("Call_Date_vod__c >= 2023-09-07");
  });

  it("materialises the sample strategy and blob policy from the overlay", () => {
    const base = run(sampleRow());
    expect(base.mapping.load.sampleStrategy).toBe("noTriggersRecalc");
    expect(base.mapping.load.noTriggers).toBe(true);
    expect(base.mapping.options.blobs).toEqual({ signature: "optional" });
    expect(base.mapping.options.allowTypeChange).toBe(false);
    const us = run(sampleRow(), {
      config: {
        countries: {
          objects: {
            sample_transaction: {
              blobs: { signature: "required" },
              load: {
                sampleStrategy: "noTriggersRecalc",
                fallbackStrategy: "triggersOnTransactions",
              },
            },
          },
        },
      },
    });
    expect(us.mapping.load.fallbackStrategy).toBe("triggersOnTransactions");
    expect(us.mapping.options.blobs).toEqual({ signature: "required" });
    const triggers = run(sampleRow(), {
      config: {
        sample_transaction: {
          load: { sampleStrategy: "triggersOnTransactions", noTriggers: false },
        },
      },
    });
    expect(triggers.mapping.load.sampleStrategy).toBe("triggersOnTransactions");
    expect(triggers.mapping.load.noTriggers).toBe(false);
  });

  describe("helpers", () => {
    it("isDisbursement prefers the record type, falls back to Type_vod__c", () => {
      expect(
        isDisbursement({
          Id: "x",
          "RecordType.DeveloperName": "Disbursement_vod",
        }),
      ).toBe(true);
      expect(
        isDisbursement({
          Id: "x",
          "RecordType.DeveloperName": "Receipt_vod",
          Type_vod__c: "Disbursement_vod",
        }),
      ).toBe(false);
      expect(
        isDisbursement({ Id: "x", Type_vod__c: " Disbursement_vod " }),
      ).toBe(true);
      expect(isDisbursement({ Id: "x" })).toBe(false);
      expect(SAMPLE_TRANSACTION_DISBURSEMENT_TYPE).toBe("Disbursement_vod");
    });

    it("rollupSign / signedQuantity follow §6.3.35 (receipt/transfer-in +, disbursement/transfer-out/return −, adjustment ±)", () => {
      expect(rollupSign("receipt__v")).toBe(1);
      expect(rollupSign("Receipt_vod")).toBe(1);
      expect(rollupSign("transfer__v", { transferIn: true })).toBe(1);
      expect(rollupSign("transfer__v")).toBe(-1);
      expect(rollupSign("disbursement__v")).toBe(-1);
      expect(rollupSign("return__v")).toBe(-1);
      expect(rollupSign("adjustment__v")).toBe(1);
      expect(rollupSign("unknown__v")).toBe(0);
      expect(signedQuantity("disbursement__v", "3")).toBe(-3);
      expect(signedQuantity("adjustment__v", -4)).toBe(-4);
      expect(signedQuantity("adjustment__v", 4)).toBe(4);
      expect(signedQuantity("Transfer_vod", 5, { transferIn: true })).toBe(5);
      expect(signedQuantity("receipt__v", "n/a")).toBe(0);
    });

    it("accountRef behaves like ref(account) when a value is present", () => {
      const ctx = buildTransformContext({
        objectKey: "sample_transaction",
        field: { source: "Account_vod__c", target: "account__v" },
        ids: buildIdResolver({ account: { [IDS.account1]: "V0A1" } }),
      });
      expect(accountRef(IDS.account1, sampleRow(), ctx)).toEqual({
        value: { $fk: { object: "account", sfdcId: IDS.account1 } },
      });
      expect(
        accountRef(
          "",
          sampleRow({
            Type_vod__c: "Receipt_vod",
            "RecordType.DeveloperName": "",
          }),
          ctx,
        ),
      ).toEqual({
        omit: true,
      });
      expect(accountRef(undefined, sampleRow(), ctx)).toMatchObject({
        omit: true,
        diagnostic: {
          code: "REQUIRED_MISSING",
          fatal: true,
          field: "account__v",
        },
      });
    });
  });
});
