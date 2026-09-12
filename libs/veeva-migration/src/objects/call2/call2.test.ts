import { describe, expect, it } from "vitest";
import {
  CALL2_ADDRESS_TARGET_IS_OBJECT_CODE,
  CALL2_ATTENDEE_TYPES,
  CALL2_DEVICE_FIELDS,
  CALL2_LICENCE_SNAPSHOT_FIELDS,
  CALL2_OBJECT_TYPES,
  CALL2_OPEN_PREDICATE,
  CALL2_SHIP_SNAPSHOT_FIELDS,
  CALL2_SIGNATURE_BLOB,
  CALL2_SIGNATURE_PAGE_IMAGE_BLOB,
  CALL2_STATES,
  CALL2_STATUS,
  CALL2_ZVOD_FIELDS,
  CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE,
  CONTACT_REF_DROPPED_CODE,
  OUT_OF_SCOPE_REF_DROPPED_CODE,
  addressSnapshot,
  call2,
  call2ChildCommonRows,
  contactRef,
  outOfScopeRef,
} from "./call2";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { innerTransform } from "../../transform/spec";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_QUEUE_ID,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
  sampleCall2Rows,
  type VaultFieldSpec,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { ObjectModule, SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF_24M = "2024-09-07";
const CUTOFF_60M = "2021-09-07";

const ADDRESS_ID = to18("a0A000000000001");
const CHILD_ACCOUNT_ID = to18("a0B000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const INQUIRY_ID = to18("a0M000000000001");
const MC_ACTIVITY_ID = to18("a0X000000000001");
const CONTACT_ID = "003000000000001AAA";
const TERRITORY_VAULT_ID = "V0T000000000001";

function makeConfig(
  opts: {
    call2?: Record<string, unknown>;
    scope?: Record<string, unknown>;
    us?: Record<string, unknown>;
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
    objects: { call2: opts.call2 ?? {} },
    countries: { US: opts.us ?? {} },
  });
}

/** Vault field per mapping row, derived from the transform kind (overrides win). */
function vaultFieldsFor(
  mod: ObjectModule,
  overrides: Record<string, VaultFieldSpec> = {},
): VaultFieldSpec[] {
  const skip = new Set([
    "name__v",
    "status__v",
    "created_by__v",
    "created_date__v",
    "modified_by__v",
    "modified_date__v",
    "legacy_crm_id__v",
    "object_type__v.api_name__v",
    "state__v",
    "local_currency__sys",
  ]);
  const out: VaultFieldSpec[] = [];
  for (const f of mod.fields) {
    if (skip.has(f.target) || f.target.includes(".")) continue;
    if (overrides[f.target]) continue;
    const t = innerTransform(f.transform);
    const name = f.target;
    switch (t.kind) {
      case "skip":
        continue;
      case "longtext":
      case "deferredBlob":
        out.push({ name, type: "LongText" });
        break;
      case "bool":
        out.push({ name, type: "Boolean" });
        break;
      case "number":
        out.push({ name, type: "Number" });
        break;
      case "date":
        out.push({ name, type: "Date" });
        break;
      case "datetime":
        out.push({ name, type: "DateTime" });
        break;
      case "picklist":
        out.push({ name, type: "Picklist", picklist: name });
        break;
      case "ref":
        out.push({
          name,
          type: "Object",
          object: { name: `${t.objectKey}__v` },
        });
        break;
      case "refUser":
        out.push({ name, type: "Object", object: { name: "user__sys" } });
        break;
      case "territoryRef":
        out.push({ name, type: "Object", object: { name: "territory__v" } });
        break;
      case "text":
        out.push({ name, type: "String", max_length: t.max ?? 1500 });
        break;
      default:
        out.push({ name, type: "String", max_length: 1500 });
    }
  }
  return [...out, ...Object.values(overrides)];
}

const OBJECT_TYPE_NAMES = Object.values(CALL2_OBJECT_TYPES);
const STATE_NAMES = Object.values(CALL2_STATES);

function metadata(overrides: Record<string, VaultFieldSpec> = {}) {
  return resolveMetadata(
    buildVaultMetadata("call2__v", vaultFieldsFor(call2, overrides), {
      objectTypes: OBJECT_TYPE_NAMES,
      lifecycles: ["call2_lifecycle__c"],
    }),
    {
      picklists: {
        call2_status__v: Object.values(CALL2_STATUS),
        call_channel__v: ["face_to_face__v", "phone__v", "video__v"],
        attendee_type__v: Object.values(CALL2_ATTENDEE_TYPES).filter(
          (v): v is string => v !== null,
        ),
        call_type__v: ["detail_only__v", "detail_with_sample__v"],
        status__v: ["active__v", "inactive__v"],
      },
      objectTypes: Object.fromEntries(OBJECT_TYPE_NAMES.map((t) => [t, {}])),
      lifecycle: { name: "call2_lifecycle__c", states: STATE_NAMES },
    },
  );
}

/** The submitted 2025 US parent call of the testkit, enriched with the rows this module maps. */
function parentCall(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    ...sampleCall2Rows()[0],
    CurrencyIsoCode: "USD",
    Ship_To_Address_vod__c: ADDRESS_ID,
    Child_Account_vod__c: CHILD_ACCOUNT_ID,
    Medical_Inquiry_vod__c: INQUIRY_ID,
    Cobrowse_MC_Activity_vod__c: MC_ACTIVITY_ID,
    Error_Reference_Call_vod__c: IDS.call3,
    Remote_Meeting_vod__c: to18("a0R000000000001"),
    Product_Priority_1_vod__c: PRODUCT_ID,
    Address_vod__c: "1 Main St\nBoston MA 02110",
    Address_Line_1_vod__c: "1 Main St",
    City_vod__c: "Boston",
    State_vod__c: "MA",
    Zip_vod__c: "02110",
    Expense_Amount_vod__c: "12.5",
    Duration_vod__c: "30",
    Is_Sampled_Call_vod__c: "true",
    CLM_vod__c: false,
    License_vod__c: "MA-12345",
    Sample_Card_vod__c: "false",
    Check_In_Latitude_vod__c: "42.36",
    Signature_Page_Image_vod__c: "iVBORw0KGgoAAAANS",
    Entity_Display_Name_vod__c: "formula",
    zvod_Attendees_vod__c: "layout",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    config?: Parameters<typeof makeConfig>[0];
    knownAccount?: boolean;
    contactAsPersonAccount?: boolean;
    metadata?: ReturnType<typeof metadata>;
  } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(call2, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const accounts: Record<string, string> = {};
  if (opts.knownAccount !== false) {
    accounts[IDS.account1] = "V0A1";
    accounts[IDS.account2] = "V0A2";
    accounts[IDS.account3] = "V0A3";
  }
  if (opts.contactAsPersonAccount) accounts[CONTACT_ID] = "V0A9";
  const ids = buildIdResolver(
    {
      account: accounts,
      address: { [ADDRESS_ID]: "V0D1" },
      child_account: { [CHILD_ACCOUNT_ID]: "V0B1" },
      product: { [PRODUCT_ID]: "V0P1" },
      medical_inquiry: { [INQUIRY_ID]: "V0M1" },
      // parents loaded first: call1 is known, call3 (error reference) is not yet
      call2: { [IDS.call1]: "V0K1" },
      multichannel_activity: {},
    },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
    { "US-NE-01": TERRITORY_VAULT_ID },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: opts.metadata ?? metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: call2.custom,
    }),
  };
}

describe("call2 module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(call2).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(call2.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.1 / §4.4 / §3.3 catalogue facts", () => {
    expect(call2.source).toBe("Call2_vod__c");
    expect(call2.target).toBe("call2__v");
    expect(call2.targetEvidence).toBe("DOC");
    expect(call2.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Call_Date_vod__c", type: "date" }],
      openPredicate: CALL2_OPEN_PREDICATE,
    });
    expect(call2.countryOf).toEqual([
      { kind: "account" },
      { kind: "user", field: "User_vod__c" },
      { kind: "user", field: "OwnerId" },
    ]);
    for (const dep of [
      "account",
      "user",
      "address",
      "child_account",
      "product",
      "em_event",
      "medical_event",
      "medical_inquiry",
      "account_plan",
      "territory",
      "multichannel_activity",
    ])
      expect(call2.dependsOn).toContain(dep);
    expect(call2.selfRefs).toEqual([
      {
        target: "error_reference_call__v",
        source: "Error_Reference_Call_vod__c",
      },
      {
        target: "cobrowse_mc_activity__v",
        source: "Cobrowse_MC_Activity_vod__c",
        objectKey: "multichannel_activity",
      },
    ]);
    expect(call2.partitionBy).toEqual({
      field: "Parent_Call_vod__c",
      order: ["null", "notNull"],
    });
    expect(call2.load).toMatchObject({
      noTriggers: true,
      partitionBy: { field: "Parent_Call_vod__c", order: ["null", "notNull"] },
    });
    expect(call2.deletePolicy).toBe("ignore");
    expect(call2.inactivate).toEqual([]);
    expect(call2.createPolicy).toBe("create");
    expect(call2.objectTypes).toEqual(CALL2_OBJECT_TYPES);
    expect(call2.states).toEqual(CALL2_STATES);
    expect(call2.blobs).toEqual({
      [CALL2_SIGNATURE_BLOB]: "optional",
      [CALL2_SIGNATURE_PAGE_IMAGE_BLOB]: "optional",
    });
    expect(call2.blockS.currency).toBe(true);
    expect(call2.blockS.objectType).toBe(true);
    expect(call2.blockS.statusFromFlag).toBeUndefined();
    expect(call2.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(call2.optionDefaults).toEqual({
      loadCallType: false,
      loadDeviceFields: false,
    });
  });

  it("maps every §6.3.30 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(call2.fields.map((f) => [f.target, f]));
    const sources = new Set(call2.fields.map((f) => f.source));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "UNV",
      disabledBy: "preserveName",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: "RecordType.DeveloperName",
      required: "Y",
      transform: { kind: "objectType", mapKey: "call2.objectType" },
    });
    // `y?`, not `Y`: the [UNV] name must survive a describe miss as a
    // warning (row dropped), never block the unit (CONTRACTS §0, §5.2)
    expect(byTarget.get("call2_status__v")).toMatchObject({
      source: "Status_vod__c",
      required: "y?",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "call2.status" },
    });
    expect(byTarget.get("state__v")).toMatchObject({
      source: "Status_vod__c",
      required: "Y",
      transform: { kind: "state", mapKey: "call2.state" },
    });
    expect(byTarget.get("call_date__v")).toMatchObject({
      source: "Call_Date_vod__c",
      required: "Y",
      transform: { kind: "date" },
    });
    expect(byTarget.get("call_datetime__v")).toMatchObject({
      required: "y?",
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      source: "Account_vod__c",
      required: "y?",
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("account__v.contact")).toMatchObject({
      source: "Contact_vod__c",
      transform: { kind: "custom", fnName: "contactRef" },
    });
    expect(byTarget.get("user__v")).toMatchObject({
      source: "User_vod__c",
      required: "y?",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      source: "OwnerId",
      required: "y?",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("parent_call__v")).toMatchObject({
      source: "Parent_Call_vod__c",
      required: "n",
      transform: { kind: "ref", objectKey: "call2" },
    });
    expect(byTarget.get("parent_call_mobile_id__v")).toMatchObject({
      transform: { kind: "copy" },
    });
    expect(byTarget.get("child_account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "child_account" },
    });
    expect(byTarget.get("location_name__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("location__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
    });
    for (const t of [
      "ship_to_address__v",
      "parent_address__v",
      "dea_address__v",
    ])
      expect(byTarget.get(t)).toMatchObject({
        transform: { kind: "ref", objectKey: "address" },
      });
    expect(byTarget.get("ship_to_location__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("address__v")).toMatchObject({
      source: "Address_vod__c",
      transform: { kind: "custom", fnName: "addressSnapshot" },
    });
    // State_vod__c cannot target state__v (lifecycle) — §6.0.2 exception
    expect(byTarget.get("state_province__v")).toMatchObject({
      source: "State_vod__c",
      transform: { kind: "text", max: 10 },
    });
    expect(byTarget.get("territory__v")).toMatchObject({
      source: "Territory_vod__c",
      transform: { kind: "territoryRef" },
    });
    expect(byTarget.get("call_type__v")).toMatchObject({
      enabledBy: "loadCallType",
      transform: { kind: "picklist", mapKey: "call2.callType" },
    });
    expect(byTarget.get("call_channel__v")).toMatchObject({
      countryConfigurable: true,
      optionalSource: true,
      transform: { kind: "picklist", mapKey: "call2.callChannel" },
    });
    expect(byTarget.get("attendee_type__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "call2.attendeeType" },
    });
    expect(byTarget.get("em_event__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "em_event" },
    });
    expect(byTarget.get("medical_event__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "medical_event" },
    });
    expect(byTarget.get("medical_inquiry__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "medical_inquiry" },
    });
    expect(byTarget.get("account_plan__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account_plan" },
    });
    for (const t of [
      "remote_meeting__v",
      "suggestion__v",
      "supervising_physician__v",
    ])
      expect(byTarget.get(t)).toMatchObject({
        required: "-",
        transform: { kind: "custom", fnName: "outOfScopeRef" },
      });
    expect(byTarget.get("cobrowse_mc_activity__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "multichannel_activity" },
      },
    });
    expect(byTarget.get("error_reference_call__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "call2" },
      },
    });
    expect(byTarget.get("assigner__v")).toMatchObject({
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("assignment_datetime__v")).toMatchObject({
      transform: { kind: "datetime" },
    });
    for (const n of [1, 2, 3, 4, 5])
      expect(byTarget.get(`product_priority_${n}__v`)).toMatchObject({
        source: `Product_Priority_${n}_vod__c`,
        transform: { kind: "ref", objectKey: "product" },
      });
    expect(byTarget.get("signature__v")).toMatchObject({
      source: "Signature_vod__c",
      countryConfigurable: true,
      blobName: CALL2_SIGNATURE_BLOB,
      transform: { kind: "deferredBlob", blobName: CALL2_SIGNATURE_BLOB },
    });
    expect(byTarget.get("signature_page_image__v")).toMatchObject({
      blobName: CALL2_SIGNATURE_PAGE_IMAGE_BLOB,
      transform: { kind: "deferredBlob" },
    });
    expect(byTarget.get("signature_date__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("signature_timestamp__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("signature_location_latitude__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("location_services_status__v")).toMatchObject({
      transform: { kind: "text" },
    });
    for (const t of [
      "next_call_notes__v",
      "pre_call_notes__v",
      "call_comments__v",
    ])
      expect(byTarget.get(t)).toMatchObject({
        transform: { kind: "longtext" },
      });
    expect(byTarget.get("detailed_products__v")).toMatchObject({
      transform: { kind: "longtext" },
    });
    expect(byTarget.get("total_attendee__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("duration__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("subject__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("clm__v")).toMatchObject({
      source: "CLM_vod__c",
      evidence: "DOC",
      transform: { kind: "bool" },
    });
    for (const t of [
      "is_sampled_call__v",
      "submitted_by_mobile__v",
      "request_receipt__v",
      "no_disbursement__v",
      "incurred_expense__v",
    ])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "bool" } });
    expect(byTarget.get("receipt_email__v")).toMatchObject({
      transform: { kind: "text" },
    });
    for (const f of CALL2_LICENCE_SNAPSHOT_FIELDS)
      expect(byTarget.get(f.target)).toMatchObject({
        source: f.source,
        countryConfigurable: true,
        transform: { kind: f.transform },
      });
    for (const f of CALL2_SHIP_SNAPSHOT_FIELDS)
      expect(byTarget.get(f.target)).toMatchObject({
        source: f.source,
        unverifiedSource: true,
        optionalSource: true,
      });
    expect(byTarget.get("expense_amount__v")).toMatchObject({
      transform: { kind: "number" },
    });
    expect(byTarget.get("local_currency__sys")).toMatchObject({
      source: "CurrencyIsoCode",
      transform: { kind: "currency" },
    });
    for (const t of [
      "expense_attendee_type__v",
      "expense_post_status__v",
      "expense_system_external_id__v",
      "concur_report_name__v",
      "total_expense_attendees_count__v",
      "entity_reference_id__v",
    ])
      expect(byTarget.has(t)).toBe(true);
    for (const f of CALL2_DEVICE_FIELDS)
      expect(byTarget.get(f.target)).toMatchObject({
        source: f.source,
        enabledBy: "loadDeviceFields",
        unverifiedSource: true,
        transform: { kind: f.transform },
      });
    for (const s of [
      "Is_Parent_Call_vod__c",
      "Entity_Display_Name_vod__c",
      "Ship_To_Address_Text_vod__c",
      "Signature_on_Sync_vod__c",
      ...CALL2_ZVOD_FIELDS,
    ]) {
      const row = call2.fields.find((f) => f.source === s);
      expect(row, s).toMatchObject({
        required: "-",
        transform: { kind: "skip" },
      });
    }
    expect(byTarget.get("unlock__v")).toMatchObject({
      enabledBy: "loadUnlockFlag",
    });
    expect(sources.has("Mobile_ID_vod__c")).toBe(true);
    expect(sources.has("External_ID_vod__c")).toBe(true);
    // every UNV target is tagged so preflight can degrade it
    for (const f of call2.fields)
      if (f.required !== "-") expect(f.evidence, f.target).toBeDefined();
  });

  it("transforms a submitted parent call into a deferred-reference payload", () => {
    const { result } = run(parentCall());
    expect(result.status).toBe("ok");
    expect(result.failure).toBeUndefined();
    const p = result.payload;
    expect(p.legacy_crm_id__v).toBe(IDS.call1);
    expect(p.name__v).toBe("C-000001");
    expect(p["object_type__v.api_name__v"]).toBe("call_report__v");
    expect(result.objectType).toBe("call_report__v");
    expect(p.call2_status__v).toBe("submitted__v");
    expect(p.state__v).toBe("submitted_state__v");
    expect(p.call_date__v).toBe("2025-03-04");
    expect(p.call_datetime__v).toBe("2025-03-04T10:00:00.000Z");
    expect(p.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    expect(p.user__v).toEqual({ $user: SAMPLE_USER_ID });
    expect(p.ownerid__v).toEqual({ $user: SAMPLE_USER_ID });
    expect(p.created_by__v).toEqual({ $user: SAMPLE_USER_ID });
    expect(p.created_date__v).toBe("2025-03-04T10:31:00.000Z");
    expect(p.territory__v).toBe(TERRITORY_VAULT_ID);
    expect(p.call_channel__v).toBe("face_to_face__v");
    expect(p.ship_to_address__v).toEqual({
      $fk: { object: "address", sfdcId: ADDRESS_ID },
    });
    expect(p.child_account__v).toEqual({
      $fk: { object: "child_account", sfdcId: CHILD_ACCOUNT_ID },
    });
    expect(p.medical_inquiry__v).toEqual({
      $fk: { object: "medical_inquiry", sfdcId: INQUIRY_ID },
    });
    expect(p.product_priority_1__v).toEqual({
      $fk: { object: "product", sfdcId: PRODUCT_ID },
    });
    expect(p.address__v).toBe("1 Main St\nBoston MA 02110");
    expect(p.state_province__v).toBe("MA");
    expect(p.zip__v).toBe("02110");
    expect(p.detailed_products__v).toBe("Cholecap;Restolar");
    expect(p.next_call_notes__v).toBe("Follow up on samples");
    expect(p.expense_amount__v).toBe(12.5);
    expect(p.local_currency__sys).toBe("USD");
    expect(p.duration__v).toBe(30);
    expect(p.is_sampled_call__v).toBe(true);
    expect(p.clm__v).toBe(false);
    expect(p.license__v).toBe("MA-12345");
    expect(p.sample_card__v).toBe(false);
    expect(p.signature_date__v).toBe("2025-03-04T10:30:00.000Z");
    expect(p.mobile_id__v).toBe("7d2c5f4e-call-0001");
    expect(p.last_device__v).toBe("data_load__v");
    // never sent in pass 1
    expect(p.parent_call__v).toBeUndefined();
    expect(p.signature__v).toBeUndefined();
    expect(p.signature_page_image__v).toBeUndefined();
    expect(p.error_reference_call__v).toBeUndefined();
    expect(p.cobrowse_mc_activity__v).toBeUndefined();
    expect(p.remote_meeting__v).toBeUndefined();
    expect(p.call_type__v).toBeUndefined(); // loadCallType default false
    expect(p.check_in_latitude__v).toBeUndefined(); // loadDeviceFields default false
    expect(p.unlock__v).toBeUndefined(); // loadUnlockFlag default false
    expect(p.is_parent_call__v).toBeUndefined();
    expect(p.entity_display_name__v).toBeUndefined();
    expect(p.zvod_attendees__v).toBeUndefined();
    expect(p["account__v.contact"]).toBeUndefined();
    // pass 2 and blobs
    expect(result.secondPass).toEqual({
      error_reference_call__v: { $fk: { object: "call2", sfdcId: IDS.call3 } },
      cobrowse_mc_activity__v: {
        $fk: { object: "multichannel_activity", sfdcId: MC_ACTIVITY_ID },
      },
    });
    expect(result.unresolvedOptionalFks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "error_reference_call__v",
          objectKey: "call2",
          sfdcId: IDS.call3,
          secondPass: true,
        }),
        expect.objectContaining({
          field: "cobrowse_mc_activity__v",
          objectKey: "multichannel_activity",
          secondPass: true,
        }),
      ]),
    );
    expect(result.blobs).toEqual({
      signature__v: "iVBORw0KGgo=",
      signature_page_image__v: "iVBORw0KGgoAAAANS",
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "remote_meeting__v",
        code: OUT_OF_SCOPE_REF_DROPPED_CODE,
      }),
    );
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
    // no Vault id anywhere in the payload (§2.3) except the territory crosswalk
    for (const [k, v] of Object.entries(p))
      if (typeof v === "string" && k !== "territory__v")
        expect(v.startsWith("V0")).toBe(false);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run(parentCall()).result.sourceHash).toBe(result.sourceHash);
  });

  it("transforms a planned attendee row (parent known, attendee type crosswalked)", () => {
    const { result } = run(sampleCall2Rows()[1]);
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: IDS.call2,
      call2_status__v: "planned__v",
      state__v: "planned_state__v",
      parent_call__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      attendee_type__v: "person_account__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account3 } },
      user__v: { $user: SAMPLE_USER_ID_2 },
    });
    // Contact attendee rows: attendee type skipped (null crosswalk), row still loaded
    const contactRow = run({
      ...sampleCall2Rows()[1],
      Attendee_Type_vod__c: "Contact_vod",
    }).result;
    expect(contactRow.status).toBe("ok");
    expect(contactRow.payload.attendee_type__v).toBeUndefined();
  });

  it("reports an unresolved required account as pending_fk and keeps the deferred ref", () => {
    const required = metadata({
      account__v: {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
    });
    const { result } = run(parentCall(), {
      knownAccount: false,
      metadata: required,
    });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account1 },
    ]);
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    // optional when the metadata does not require it: omitted, re-pointed later
    const optional = run(parentCall(), { knownAccount: false }).result;
    expect(optional.status).toBe("ok");
    expect(optional.payload.account__v).toBeUndefined();
    expect(optional.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({ field: "account__v", objectKey: "account" }),
    );
  });

  it("replaces a queue owner by the rep and falls back for audit users", () => {
    const { result } = run(parentCall({ OwnerId: SAMPLE_QUEUE_ID }));
    expect(result.status).toBe("ok");
    expect(result.payload.ownerid__v).toEqual({ $user: SAMPLE_USER_ID });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "QUEUE_OWNER_REPLACED" }),
    );
    const unknownCreator = run(
      parentCall({ CreatedById: "005000000000009AAA" }),
    ).result;
    expect(unknownCreator.payload.created_by__v).toBe(1);
    expect(unknownCreator.diagnostics).toContainEqual(
      expect.objectContaining({ code: "AUDIT_USER_FALLBACK" }),
    );
  });

  it("call2_status__v: the target metadata decides the requirement (y?)", () => {
    // `state__v` is `Y` in the module; relax it so only the status row decides
    const config = { call2: { required: { state__v: false } } };
    const blank = parentCall({ Status_vod__c: null });
    // no business status, field not required by the vault: loaded without it
    const lax = run(blank, { config }).result;
    expect(lax.failure).toBeUndefined();
    expect(lax.status).toBe("ok");
    expect(lax.payload.call2_status__v).toBeUndefined();
    // the same row fails when the vault requires the field
    const strict = run(blank, {
      config,
      metadata: metadata({
        call2_status__v: {
          name: "call2_status__v",
          type: "Picklist",
          picklist: "call2_status__v",
          required: true,
        },
      }),
    }).result;
    expect(strict.status).toBe("failed");
    expect(strict.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "call2_status__v",
    });
    // a known status is written as before
    expect(run(parentCall()).result.payload.call2_status__v).toBe(
      "submitted__v",
    );
  });

  it("drops Contact_vod__c with CONTACT_REF_DROPPED unless the contact is a known person account", () => {
    const row = parentCall({
      Account_vod__c: null,
      Contact_vod__c: CONTACT_ID,
    });
    const dropped = run(row).result;
    expect(dropped.status).toBe("ok");
    expect(dropped.payload.account__v).toBeUndefined();
    expect(dropped.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "contact_ref_dropped",
        code: CONTACT_REF_DROPPED_CODE,
        value: CONTACT_ID,
      }),
    );
    const mapped = run(row, { contactAsPersonAccount: true }).result;
    expect(mapped.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: CONTACT_ID },
    });
    expect(mapped.diagnostics).toContainEqual(
      expect.objectContaining({ code: CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE }),
    );
    // the account wins when both are set
    const both = run(parentCall({ Contact_vod__c: CONTACT_ID })).result;
    expect(both.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    expect(
      both.diagnostics.some((d) => d.code === CONTACT_REF_DROPPED_CODE),
    ).toBe(false);
    expect(contactRef("", row, buildTransformContext())).toBeUndefined();
  });

  it("addressSnapshot: text verbatim, omitted and counted when the target is an object", () => {
    const objectTarget = metadata({
      address__v: {
        name: "address__v",
        type: "Object",
        object: { name: "address__v" },
      },
    });
    const { result } = run(parentCall(), { metadata: objectTarget });
    expect(result.status).toBe("ok");
    expect(result.payload.address__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: CALL2_ADDRESS_TARGET_IS_OBJECT_CODE,
        field: "address__v",
      }),
    );
    const ctx = buildTransformContext({
      objectKey: "call2",
      field: { source: "Address_vod__c", target: "address__v" },
      targetField: { name: "address__v", type: "longtext", maxLength: 2000 },
    });
    const long = "x".repeat(600);
    const r = addressSnapshot(long, { Id: IDS.call1 }, ctx);
    expect(r).toMatchObject({ value: "x".repeat(500) });
    expect(addressSnapshot(null, { Id: IDS.call1 }, ctx)).toBeUndefined();
    expect(outOfScopeRef("", { Id: IDS.call1 }, ctx)).toBeUndefined();
  });

  it("honours the objects.call2 flags: loadCallType, loadDeviceFields, loadUnlockFlag", () => {
    const off = run(parentCall()).mapping;
    const offTargets = new Set(off.fields.map((f) => f.target));
    expect(offTargets.has("call_type__v")).toBe(false);
    expect(offTargets.has("check_in_latitude__v")).toBe(false);
    expect(offTargets.has("unlock__v")).toBe(false);
    expect(off.options.loadCallType).toBe(false);
    expect(off.options.loadDeviceFields).toBe(false);

    const on = run(parentCall(), {
      config: {
        call2: {
          loadCallType: true,
          loadDeviceFields: true,
          loadUnlockFlag: true,
        },
      },
    });
    const onTargets = new Set(on.mapping.fields.map((f) => f.target));
    expect(onTargets.has("call_type__v")).toBe(true);
    expect(onTargets.has("check_in_latitude__v")).toBe(true);
    expect(onTargets.has("unlock__v")).toBe(true);
    expect(on.result.status).toBe("ok");
    expect(on.result.payload.call_type__v).toBe("detail_only__v");
    expect(on.result.payload.check_in_latitude__v).toBe(42.36);
    expect(on.result.payload.unlock__v).toBe(false);
    expect(on.mapping.mappingHash).not.toBe(off.mappingHash);
  });

  it("scope: Call_Date within the window OR planned; samplesIncludeCalls widens to the samples family", () => {
    const base = run(parentCall()).mapping.scope;
    expect(base.historyMonths).toBe(24);
    expect(base.cutoffDate).toBe(CUTOFF_24M);
    expect(base.retentionFamily).toBeUndefined();
    expect(buildScopePredicate(base).predicate).toBe(
      `(Call_Date_vod__c >= ${CUTOFF_24M}) OR (Status_vod__c = 'Planned_vod')`,
    );
    const us = run(parentCall(), {
      config: {
        scope: { sampleRetentionMonths: 60, samplesIncludeCalls: true },
      },
    }).mapping.scope;
    expect(us.retentionFamily).toBe("samples");
    expect(us.historyMonths).toBe(60);
    expect(us.cutoffDate).toBe(CUTOFF_60M);
    expect(buildScopePredicate(us).predicate).toBe(
      `(Call_Date_vod__c >= ${CUTOFF_60M}) OR (Status_vod__c = 'Planned_vod')`,
    );
  });

  it("exposes the shared child rows of the §6.3.31 preamble", () => {
    const rows = call2ChildCommonRows("call2_detail");
    expect(rows.map((r) => r.target)).toEqual([
      "call2__v",
      "attendee_type__v",
      "entity_reference_id__v",
      "call2_mobile_id__v",
      "is_parent_call__v",
    ]);
    expect(rows[0]).toMatchObject({
      source: "Call2_vod__c",
      transform: "ref(call2)",
      required: "Y",
      evidence: "DOC",
    });
    expect(rows[1].transform).toBe("picklist(call2_detail.attendeeType)");
  });
});
