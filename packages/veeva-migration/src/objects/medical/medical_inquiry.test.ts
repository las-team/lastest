import { describe, expect, it } from "vitest";
import {
  COUNTRY_ALIASES,
  COUNTRY_SOURCE,
  GROUP_IDENTIFIER_SOURCE,
  GROUP_IDENTIFIER_TARGET,
  INQUIRY_TEXT_SOURCE,
  INQUIRY_TEXT_TARGET,
  MEDICAL_INQUIRY_ACCOUNT_FIELD,
  MEDICAL_INQUIRY_CALL_FIELD,
  MEDICAL_INQUIRY_DELIVERY_METHOD,
  MEDICAL_INQUIRY_FULFILLMENT_STATUS,
  MEDICAL_INQUIRY_GROUP_IDENTIFIER_MATCH,
  MEDICAL_INQUIRY_OPEN_PREDICATE,
  MEDICAL_INQUIRY_STATES,
  MEDICAL_INQUIRY_STATUS,
  MI_COUNTRY_UNNORMALISED_CODE,
  MI_INQUIRY_TEXT_FROM_RICH_CODE,
  RICH_INQUIRY_TEXT_SOURCE,
  inquiryState,
  inquiryText,
  medical_inquiry,
  normaliseCountry,
  normaliseCountryValue,
  richInquiryText,
} from "./medical_inquiry";
import { validateObjectModule } from "../types";
import { loadOrder } from "../registry";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { matchRows } from "../../load/matcher";
import type { LoadPlan } from "../../load/types";
import type { ResolvedTarget } from "../../preflight/types";
import { hashObject } from "../../hash";
import {
  FakeVaultClient,
  IDS,
  MemoryStateStore,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildMaterialisedMapping,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const INQUIRY_ID = to18("a0Q000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const LIFECYCLE = {
  name: "medical_inquiry_lifecycle__v",
  states: Object.values(MEDICAL_INQUIRY_STATES),
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
    objects: { medical_inquiry: overrides },
    countries: { US: {} },
  });
}

type CountryTargetType = "Object" | "Picklist" | "String";

function metadata(
  opts: {
    lifecycled?: boolean;
    countryType?: CountryTargetType;
    inquiryTextRequired?: boolean;
  } = {},
) {
  const lifecycled = opts.lifecycled ?? true;
  const countryType = opts.countryType ?? "Object";
  const countryField =
    countryType === "Object"
      ? {
          name: "country__v",
          type: "Object",
          object: { name: "country__v" },
        }
      : countryType === "Picklist"
        ? { name: "country__v", type: "Picklist", picklist: "country__v" }
        : { name: "country__v", type: "String", max_length: 80 };
  return resolveMetadata(
    buildVaultMetadata(
      "medical_inquiry__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        { name: "call2__v", type: "Object", object: { name: "call2__v" } },
        {
          name: "assign_to_user__v",
          type: "Object",
          object: { name: "user__sys" },
        },
        {
          name: INQUIRY_TEXT_TARGET,
          type: "LongText",
          ...(opts.inquiryTextRequired ? { required: true } : {}),
        },
        { name: "product__v", type: "Object", object: { name: "product__v" } },
        {
          name: "medical_inquiry_status__v",
          type: "Picklist",
          picklist: "medical_inquiry_status__v",
          required: true,
        },
        {
          name: "fulfillment_status__v",
          type: "Picklist",
          picklist: "fulfillment_status__v",
        },
        { name: "fulfillment_created__v", type: "Boolean" },
        { name: "previously_submitted__v", type: "Boolean" },
        {
          name: "delivery_method__v",
          type: "Picklist",
          picklist: "delivery_method__v",
        },
        { name: "email__v", type: "String", max_length: 80 },
        { name: "phone_number__v", type: "String", max_length: 40 },
        { name: "fax_number__v", type: "String", max_length: 40 },
        { name: "address_line_1__v", type: "String", max_length: 255 },
        { name: "address_line_2__v", type: "String", max_length: 255 },
        { name: "city__v", type: "String", max_length: 80 },
        {
          name: "state_province__v",
          type: "Picklist",
          picklist: "state_province__v",
        },
        { name: "zip__v", type: "String", max_length: 20 },
        countryField,
        { name: "group_identifier__v", type: "String", max_length: 100 },
        { name: "group_count__v", type: "Number", scale: 0 },
        { name: "entity_reference_id__v", type: "String", max_length: 20 },
        { name: "signature__v", type: "LongText", max_length: 131072 },
        { name: "signature_date__v", type: "DateTime" },
        { name: "disclaimer__v", type: "LongText" },
        { name: "request_receipt__v", type: "Boolean" },
        { name: "receipt_email__v", type: "String", max_length: 80 },
        { name: "submitted_by_mobile__v", type: "Boolean" },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "mobile_id__v", type: "String", max_length: 100 },
      ],
      { lifecycles: lifecycled ? [LIFECYCLE.name] : [] },
    ),
    {
      picklists: {
        medical_inquiry_status__v: Object.values(MEDICAL_INQUIRY_STATUS),
        fulfillment_status__v: Object.values(
          MEDICAL_INQUIRY_FULFILLMENT_STATUS,
        ),
        delivery_method__v: Object.values(MEDICAL_INQUIRY_DELIVERY_METHOD),
        state_province__v: ["ma__v", "ny__v"],
        country__v: ["united_states__v", "germany__v"],
        status__v: ["active__v", "inactive__v"],
      },
      lifecycle: lifecycled ? LIFECYCLE : undefined,
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: INQUIRY_ID,
    IsDeleted: false,
    Name: "MI-000123",
    [MEDICAL_INQUIRY_ACCOUNT_FIELD]: IDS.account1,
    [MEDICAL_INQUIRY_CALL_FIELD]: IDS.call1,
    Assign_To_User_vod__c: SAMPLE_USER_ID_2,
    [INQUIRY_TEXT_SOURCE]: "Is Cholecap safe with grapefruit?\r\nPatient asks.",
    [RICH_INQUIRY_TEXT_SOURCE]:
      "<p>Is <b>Cholecap</b> safe with grapefruit?</p>",
    Product_vod__c: PRODUCT_ID,
    Status_vod__c: "Submitted_vod",
    Fulfillment_Status_vod__c: "Assigned_vod",
    Fulfillment_Created_vod__c: "true",
    Previously_Submitted_vod__c: "false",
    Delivery_Method_vod__c: "Email_vod",
    Email_vod__c: "dr.doe@example.org",
    Phone_Number_vod__c: "+1 617 555 0100",
    Fax_Number_vod__c: "+1 617 555 0101",
    Address_Line_1_vod__c: "1 Main St",
    Address_Line_2_vod__c: "Suite 2",
    City_vod__c: "Cambridge",
    State_vod__c: "MA",
    Zip_vod__c: "02139",
    [COUNTRY_SOURCE]: "United States",
    Group_Identifier_vod__c: "GRP-0001",
    Group_Count_vod__c: "2",
    Entity_Reference_Id_vod__c: "ERI-1",
    Signature_vod__c: "iVBORw0KGgo=",
    Signature_Date_vod__c: "2025-03-04T10:30:00.000Z",
    Disclaimer_vod__c: "Medical information only",
    Request_Receipt_vod__c: "true",
    Receipt_Email_vod__c: "dr.doe@example.org",
    Submitted_By_Mobile_vod__c: "true",
    zvod_Delivery_Method_vod__c: "x",
    zvod_Disclaimer_vod__c: "x",
    Mobile_ID_vod__c: "7d2c5f4e-mi-0001",
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
    lifecycled?: boolean;
    countryType?: CountryTargetType;
    calls?: Record<string, string>;
    accounts?: Record<string, string>;
    inquiryTextRequired?: boolean;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    medical_inquiry,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: opts.accounts ?? { [IDS.account1]: "V0A1" },
      call2: opts.calls ?? { [IDS.call1]: "V0K1" },
      product: { [PRODUCT_ID]: "V0P1" },
    },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({
        lifecycled: opts.lifecycled,
        countryType: opts.countryType,
        inquiryTextRequired: opts.inquiryTextRequired,
      }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: medical_inquiry.custom,
    }),
  };
}

describe("medical_inquiry module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(medical_inquiry).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.29 / §3.3 / §4.4 catalogue facts and the call2 cycle", () => {
    expect(medical_inquiry.source).toBe("Medical_Inquiry_vod__c");
    expect(medical_inquiry.target).toBe("medical_inquiry__v");
    expect(medical_inquiry.targetEvidence).toBe("DOC");
    expect(medical_inquiry.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "CreatedDate", type: "datetime" }],
      openPredicate: MEDICAL_INQUIRY_OPEN_PREDICATE,
    });
    expect(MEDICAL_INQUIRY_OPEN_PREDICATE).toContain(
      "Status_vod__c != 'Closed'",
    );
    expect(MEDICAL_INQUIRY_OPEN_PREDICATE).toContain(
      "Fulfillment_Status_vod__c != 'Completed_vod'",
    );
    expect(medical_inquiry.countryOf).toEqual([{ kind: "account" }]);
    expect(medical_inquiry.dependsOn).toEqual([
      "account",
      "user",
      "product",
      "call2",
    ]);
    expect(medical_inquiry.selfRefs).toEqual([
      { target: "call2__v", source: "Call2_vod__c", objectKey: "call2" },
    ]);
    expect(medical_inquiry.deletePolicy).toBe("ignore");
    expect(medical_inquiry.inactivate).toEqual([]);
    expect(medical_inquiry.createPolicy).toBe("create");
    expect(medical_inquiry.load.noTriggers).toBe(true);
    expect(medical_inquiry.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    // group_identifier__v is shared by grouped inquiries: never a default key
    expect(
      medical_inquiry.match.flatMap((m) => m.keys ?? []).map((k) => k.target),
    ).not.toContain(GROUP_IDENTIFIER_TARGET);
    expect(MEDICAL_INQUIRY_GROUP_IDENTIFIER_MATCH).toMatchObject({
      method: "natural_key",
      keys: [
        { target: GROUP_IDENTIFIER_TARGET, source: GROUP_IDENTIFIER_SOURCE },
      ],
      requireUnique: true,
    });
    expect(medical_inquiry.objectTypes).toEqual({});
    expect(medical_inquiry.states).toEqual(MEDICAL_INQUIRY_STATES);
    expect(medical_inquiry.blobs).toEqual({ signature: "optional" });
    expect(medical_inquiry.blockS.statusFromFlag).toBeUndefined();
    expect(medical_inquiry.notes).not.toContain("STUB");
    // the selfRef breaks the call2 ↔ medical_inquiry cycle (§6.1 steps 15/16)
    const steps = loadOrder([
      { key: "account", dependsOn: [], selfRefs: [] },
      { key: "user", dependsOn: [], selfRefs: [] },
      { key: "product", dependsOn: [], selfRefs: [] },
      medical_inquiry,
      {
        key: "call2",
        dependsOn: ["account", "user", "product", "medical_inquiry"],
        selfRefs: [],
      },
    ]);
    const level = (k: string) =>
      steps.findIndex((s) => s.keys.includes(k as never));
    expect(level("medical_inquiry")).toBeLessThan(level("call2"));
    expect(steps[level("medical_inquiry")].pass2).toContainEqual({
      objectKey: "medical_inquiry",
      target: "call2__v",
      source: "Call2_vod__c",
      refKey: "call2",
    });
  });

  it("carries every §6.3.29 row with its transform, evidence and skips", () => {
    const byTarget = new Map(medical_inquiry.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "account__v",
      "call2__v",
      "assign_to_user__v",
      INQUIRY_TEXT_TARGET,
      `${INQUIRY_TEXT_TARGET}.rich`,
      "product__v",
      "medical_inquiry_status__v",
      "state__v",
      "fulfillment_status__v",
      "fulfillment_created__v",
      "previously_submitted__v",
      "delivery_method__v",
      "email__v",
      "phone_number__v",
      "fax_number__v",
      "address_line_1__v",
      "address_line_2__v",
      "city__v",
      "state_province__v",
      "zip__v",
      "country__v",
      "group_identifier__v",
      "group_count__v",
      "entity_reference_id__v",
      "signature__v",
      "signature_date__v",
      "disclaimer__v",
      "request_receipt__v",
      "receipt_email__v",
      "submitted_by_mobile__v",
      "ownerid__v",
      "mobile_id__v",
      "zvod_delivery_method__v",
      "zvod_disclaimer__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "DOC",
    });
    expect(byTarget.get("call2__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "call2" },
      },
      required: "n",
      evidence: "UNV",
    });
    expect(byTarget.get("assign_to_user__v")?.transform).toEqual({
      kind: "refUser",
    });
    // the fallback lives in the documented row (a required target is satisfied before REQUIRED_MISSING)
    expect(byTarget.get(INQUIRY_TEXT_TARGET)).toMatchObject({
      source: INQUIRY_TEXT_SOURCE,
      transform: { kind: "custom", fnName: "inquiryText" },
      required: "y?",
      evidence: "UNV",
      unverifiedSource: true,
    });
    expect(byTarget.get(`${INQUIRY_TEXT_TARGET}.rich`)).toMatchObject({
      source: RICH_INQUIRY_TEXT_SOURCE,
      transform: { kind: "custom", fnName: "richInquiryText" },
      unverifiedSource: true,
      optionalSource: true,
    });
    expect(byTarget.get("product__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "product" },
      evidence: "DOC",
    });
    expect(byTarget.get("medical_inquiry_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "medical_inquiry.status" },
      required: "Y",
    });
    expect(byTarget.get("state__v")?.transform).toEqual({
      kind: "custom",
      fnName: "inquiryState",
    });
    expect(byTarget.get("fulfillment_status__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "medical_inquiry.fulfillmentStatus",
    });
    expect(byTarget.get("delivery_method__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "medical_inquiry.deliveryMethod" },
      evidence: "DOC",
      countryConfigurable: true,
    });
    expect(byTarget.get("state_province__v")).toMatchObject({
      source: "State_vod__c",
      transform: { kind: "picklist", mapKey: "medical_inquiry.addressState" },
      countryConfigurable: true,
    });
    expect(byTarget.get("country__v")).toMatchObject({
      source: COUNTRY_SOURCE,
      transform: { kind: "custom", fnName: "normaliseCountry" },
      countryConfigurable: true,
    });
    expect(byTarget.get("group_identifier__v")?.transform).toEqual({
      kind: "copy",
    });
    expect(byTarget.get("group_count__v")?.transform).toEqual({
      kind: "number",
    });
    expect(byTarget.get("signature__v")).toMatchObject({
      transform: { kind: "deferredBlob", blobName: "signature" },
      blobName: "signature",
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
    });
    for (const target of ["zvod_delivery_method__v", "zvod_disclaimer__v"])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "skip" },
        required: "-",
      });
    expect(medical_inquiry.picklists["medical_inquiry.status"]).toEqual(
      MEDICAL_INQUIRY_STATUS,
    );
    expect(MEDICAL_INQUIRY_STATUS).toEqual({
      New_vod: "new__v",
      Saved_vod: "saved__v",
      Submitted_vod: "submitted__v",
      Closed: "closed__v",
    });
    expect(medical_inquiry.picklists["medical_inquiry.deliveryMethod"]).toEqual(
      MEDICAL_INQUIRY_DELIVERY_METHOD,
    );
    for (const f of medical_inquiry.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: call2 deferred to pass 2, state when lifecycled, crosswalks, country to a reference", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: INQUIRY_ID,
      name__v: "MI-000123",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      assign_to_user__v: { $user: SAMPLE_USER_ID_2 },
      [INQUIRY_TEXT_TARGET]: "Is Cholecap safe with grapefruit?\nPatient asks.",
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      medical_inquiry_status__v: "submitted__v",
      state__v: "submitted_state__v",
      fulfillment_status__v: "assigned__v",
      fulfillment_created__v: true,
      previously_submitted__v: false,
      delivery_method__v: "email__v",
      email__v: "dr.doe@example.org",
      phone_number__v: "+1 617 555 0100",
      fax_number__v: "+1 617 555 0101",
      address_line_1__v: "1 Main St",
      address_line_2__v: "Suite 2",
      city__v: "Cambridge",
      state_province__v: "ma__v",
      zip__v: "02139",
      // country(ref) through the crosswalk — the one Vault id allowed in a payload (§2.3)
      country__v: "V0C000000000101",
      group_identifier__v: "GRP-0001",
      group_count__v: 2,
      entity_reference_id__v: "ERI-1",
      signature_date__v: "2025-03-04T10:30:00.000Z",
      disclaimer__v: "Medical information only",
      request_receipt__v: true,
      receipt_email__v: "dr.doe@example.org",
      submitted_by_mobile__v: true,
      mobile_id__v: "7d2c5f4e-mi-0001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-04T10:00:00.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // pass 1 never carries call2__v; the deferred ref waits for pass 2
    expect(result.payload.call2__v).toBeUndefined();
    expect(result.secondPass).toEqual({
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
    });
    expect(result.blobs).toEqual({ signature__v: "iVBORw0KGgo=" });
    expect(result.payload.signature__v).toBeUndefined();
    expect(result.payload.zvod_delivery_method__v).toBeUndefined();
    expect(result.payload[`${INQUIRY_TEXT_TARGET}.rich`]).toBeUndefined();
    expect(result.payload.status__v).toBeUndefined();
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.fkEdges).toContainEqual({
      field: "call2__v",
      targetObjectKey: "call2",
      targetSfdcId: IDS.call1,
    });
  });

  it("keeps an unresolved call in pass 2 as an optional pending edge and omits state__v on an unlifecycled target", () => {
    const { result } = run(sampleRow(), { calls: {} });
    expect(result.status).toBe("ok");
    expect(result.secondPass.call2__v).toEqual({
      $fk: { object: "call2", sfdcId: IDS.call1 },
    });
    expect(result.unresolvedOptionalFks).toContainEqual({
      field: "call2__v",
      objectKey: "call2",
      sfdcId: IDS.call1,
      secondPass: true,
    });
    const { result: plain } = run(sampleRow(), { lifecycled: false });
    expect(plain.status).toBe("ok");
    expect(plain.payload.state__v).toBeUndefined();
    expect(plain.payload.medical_inquiry_status__v).toBe("submitted__v");
    // an unmapped status is fatal on a lifecycled target (state required to land)
    const { result: unknownStatus } = run(
      sampleRow({ Status_vod__c: "Archived" }),
    );
    expect(unknownStatus.status).toBe("failed");
  });

  it("reports an unresolved required account as pending_fk", () => {
    const { result } = run(
      sampleRow({ [MEDICAL_INQUIRY_ACCOUNT_FIELD]: IDS.account4 }),
    );
    expect(result.status).toBe("pending_fk");
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
  });

  it("falls back to the rich inquiry text only when the documented column is empty", () => {
    const { result } = run(sampleRow({ [INQUIRY_TEXT_SOURCE]: "" }));
    expect(result.status).toBe("ok");
    expect(result.payload[INQUIRY_TEXT_TARGET]).toBe(
      "Is Cholecap safe with grapefruit?",
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: MI_INQUIRY_TEXT_FROM_RICH_CODE }),
    );
    const absent = sampleRow();
    delete absent[INQUIRY_TEXT_SOURCE];
    const { result: fromRich } = run(absent);
    expect(fromRich.payload[INQUIRY_TEXT_TARGET]).toBe(
      "Is Cholecap safe with grapefruit?",
    );
    const { result: none } = run(
      sampleRow({ [INQUIRY_TEXT_SOURCE]: "", [RICH_INQUIRY_TEXT_SOURCE]: "" }),
    );
    expect(none.status).toBe("ok");
    expect(none.payload[INQUIRY_TEXT_TARGET]).toBeUndefined();
    // the documented text wins and is not counted as taken from the rich column
    const { result: documented } = run(sampleRow());
    expect(documented.payload[INQUIRY_TEXT_TARGET]).toBe(
      "Is Cholecap safe with grapefruit?\nPatient asks.",
    );
    expect(documented.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: MI_INQUIRY_TEXT_FROM_RICH_CODE }),
    );
    // whitespace-only documented text counts as missing
    const { result: blank } = run(sampleRow({ [INQUIRY_TEXT_SOURCE]: "   " }));
    expect(blank.payload[INQUIRY_TEXT_TARGET]).toBe(
      "Is Cholecap safe with grapefruit?",
    );
  });

  it("satisfies a vault-required inquiry_text__v from the rich column instead of failing REQUIRED_MISSING", () => {
    const { result } = run(sampleRow({ [INQUIRY_TEXT_SOURCE]: "" }), {
      inquiryTextRequired: true,
    });
    expect(result.status).toBe("ok");
    expect(result.failure).toBeUndefined();
    expect(result.payload[INQUIRY_TEXT_TARGET]).toBe(
      "Is Cholecap safe with grapefruit?",
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: MI_INQUIRY_TEXT_FROM_RICH_CODE }),
    );
    // both columns empty on a required target still fails (nothing to send)
    const { result: none } = run(
      sampleRow({ [INQUIRY_TEXT_SOURCE]: "", [RICH_INQUIRY_TEXT_SOURCE]: "" }),
      { inquiryTextRequired: true },
    );
    expect(none.status).toBe("failed");
    expect(none.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: INQUIRY_TEXT_TARGET,
    });
  });

  it("keeps the MI_INQUIRY_TEXT_FROM_RICH count when the rich text truncates", () => {
    const long = `<p>${"x".repeat(40000)}</p>`;
    const { result } = run(
      sampleRow({
        [INQUIRY_TEXT_SOURCE]: "",
        [RICH_INQUIRY_TEXT_SOURCE]: long,
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.payload[INQUIRY_TEXT_TARGET]).toBe("x".repeat(32000));
    const fromRich = result.diagnostics.filter(
      (d) => d.code === MI_INQUIRY_TEXT_FROM_RICH_CODE,
    );
    expect(fromRich).toHaveLength(1);
    expect(fromRich[0]).toMatchObject({
      kind: "truncated",
      field: INQUIRY_TEXT_TARGET,
    });
    expect(fromRich[0].detail).toContain("40000 > 32000");
    expect(fromRich[0].fatal).toBeUndefined();
  });

  it("never matches two inquiries of the same group to each other's Vault record", async () => {
    const A = to18("a0Q000000000011");
    const B = to18("a0Q000000000012");
    const meta = buildVaultMetadata("medical_inquiry__v", [
      { name: "legacy_crm_id__v", type: "String" },
      { name: "mobile_id__v", type: "String" },
      { name: GROUP_IDENTIFIER_TARGET, type: "String", max_length: 100 },
    ]);
    const vault = new FakeVaultClient();
    vault.addObject(meta, [
      {
        id: "V0MI1",
        legacy_crm_id__v: A,
        mobile_id__v: "mob-A",
        [GROUP_IDENTIFIER_TARGET]: "GRP-0001",
      },
    ]);
    await vault.authenticate();
    const store = new MemoryStateStore(vault.vaultDns);
    // member A was loaded by an earlier run; B is a new member of the same group
    await store.seedIdMap("medical_inquiry", meta.name, { [A]: "V0MI1" });
    const target: ResolvedTarget = {
      objectKey: "medical_inquiry",
      targetObject: meta.name,
      legacyIdField: "legacy_crm_id__v",
      metadata: resolveMetadata(meta),
      rawMetadata: meta,
      objectTypes: [],
      picklists: {},
      replicateable: true,
      columns: [],
    };
    const planFor = (match: LoadPlan["mapping"]["match"]): LoadPlan => ({
      runId: "run-2",
      unit: { objectKey: "medical_inquiry", country: "US" },
      mapping: buildMaterialisedMapping({
        objectKey: "medical_inquiry",
        sourceObject: medical_inquiry.source,
        targetObject: meta.name,
        fields: [],
        match,
      }),
      target,
      runDir: "/nonexistent",
      dryRun: true,
      migrationMode: true,
      unchangedFieldBehavior: "AlwaysIgnore",
      batchSize: 500,
      batchWallTimeMs: 60000,
    });
    const payload = {
      legacy_crm_id__v: B,
      mobile_id__v: "mob-B",
      [GROUP_IDENTIFIER_TARGET]: "GRP-0001",
    };
    const rows = [
      {
        sfdcId: B,
        systemModstamp: "2026-01-01T00:00:00.000Z",
        payload,
        sourceHash: hashObject(payload),
        diagnostics: [],
        source: { Id: B, [GROUP_IDENTIFIER_SOURCE]: "GRP-0001" },
      },
    ];
    const deps = { vault, store };
    const outcome = await matchRows(rows, planFor(medical_inquiry.match), deps);
    expect(outcome.hits.size).toBe(0);
    expect(outcome.findings).toEqual([]);
    expect(await store.idMap.get("medical_inquiry", B)).toBeUndefined();
    // the opt-in rule is exactly what would have merged B into A
    const optIn = await matchRows(
      rows,
      planFor([
        ...medical_inquiry.match,
        MEDICAL_INQUIRY_GROUP_IDENTIFIER_MATCH,
      ]),
      deps,
    );
    expect(optIn.hits.get(B)).toMatchObject({
      vaultId: "V0MI1",
      method: "natural_key",
      mergedInto: A,
    });
  });

  it("normalises Country_vod__c to ISO-2 first and renders it per target type", () => {
    const { result: iso } = run(sampleRow({ [COUNTRY_SOURCE]: "de" }));
    expect(iso.payload.country__v).toBe("V0C000000000102");
    const { result: text } = run(sampleRow({ [COUNTRY_SOURCE]: "Germany" }), {
      countryType: "String",
    });
    expect(text.payload.country__v).toBe("DE");
    const { result: pick } = run(sampleRow({ [COUNTRY_SOURCE]: "USA" }), {
      countryType: "Picklist",
    });
    expect(pick.payload.country__v).toBe("united_states__v");
    // unknown name: verbatim on a text target with a count, omitted on a reference
    const { result: unknownText } = run(
      sampleRow({ [COUNTRY_SOURCE]: "Atlantis" }),
      { countryType: "String" },
    );
    expect(unknownText.status).toBe("ok");
    expect(unknownText.payload.country__v).toBe("Atlantis");
    expect(unknownText.diagnostics).toContainEqual(
      expect.objectContaining({ code: MI_COUNTRY_UNNORMALISED_CODE }),
    );
    const { result: unknownRef } = run(
      sampleRow({ [COUNTRY_SOURCE]: "Atlantis" }),
    );
    expect(unknownRef.status).toBe("ok");
    expect(unknownRef.payload.country__v).toBeUndefined();
    // a recognised code outside the crosswalk stays out of a reference target
    const { result: notCrosswalked } = run(
      sampleRow({ [COUNTRY_SOURCE]: "FR" }),
    );
    expect(notCrosswalked.status).toBe("ok");
    expect(notCrosswalked.payload.country__v).toBeUndefined();
    expect(notCrosswalked.diagnostics).toContainEqual(
      expect.objectContaining({ code: "VT_COUNTRY_UNMATCHED", value: "FR" }),
    );
  });

  it("is dated on CreatedDate with the open-item term and an explicit cutoff literal", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.historyMonths).toBe(24);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    const build = buildScopePredicate(mapping.scope, { now: NOW });
    expect(build.kind).toBe("dated");
    expect(build.dateTerm).toBe("CreatedDate >= 2024-09-07T00:00:00Z");
    expect(build.openTerm).toBe(MEDICAL_INQUIRY_OPEN_PREDICATE);
    expect(build.predicate).toBe(
      `(CreatedDate >= 2024-09-07T00:00:00Z) OR (${MEDICAL_INQUIRY_OPEN_PREDICATE})`,
    );
    expect(mapping.countryOf).toEqual([{ kind: "account" }]);
    expect(mapping.states).toEqual(MEDICAL_INQUIRY_STATES);
    expect(mapping.selfRefs).toEqual(medical_inquiry.selfRefs);
    // lifecycled object: type changes are blocked by default (§2.5.6)
    expect(mapping.options.allowTypeChange).toBe(false);
  });
});

describe("medical_inquiry custom transforms", () => {
  it("normaliseCountryValue accepts alpha-2, alpha-3/aliases and English names", () => {
    expect(normaliseCountryValue(" us ")).toBe("US");
    expect(normaliseCountryValue("USA")).toBe("US");
    expect(normaliseCountryValue("United  States")).toBe("US");
    expect(normaliseCountryValue("united kingdom")).toBe("GB");
    expect(normaliseCountryValue("UK")).toBe("GB");
    expect(normaliseCountryValue("Deutschland")).toBe("DE");
    expect(normaliseCountryValue("Japan")).toBe("JP");
    expect(normaliseCountryValue("")).toBeUndefined();
    expect(normaliseCountryValue(null)).toBeUndefined();
    expect(normaliseCountryValue("Atlantis")).toBeUndefined();
    expect(COUNTRY_ALIASES.GBR).toBe("GB");
  });

  it("normaliseCountry renders per target type", () => {
    const row = { Id: INQUIRY_ID };
    const text = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: COUNTRY_SOURCE, target: "country__v" },
      targetField: { type: "string", rawType: "String", maxLength: 80 },
    });
    expect(normaliseCountry("Germany", row, text)).toEqual({ value: "DE" });
    expect(normaliseCountry("", row, text)).toBeUndefined();
    expect(normaliseCountry("Atlantis", row, text)).toMatchObject({
      value: "Atlantis",
      diagnostic: { kind: "custom", code: MI_COUNTRY_UNNORMALISED_CODE },
    });
    const ref = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: COUNTRY_SOURCE, target: "country__v" },
      targetField: {
        type: "object",
        rawType: "Object",
        referenceObject: "country__v",
      },
    });
    expect(normaliseCountry("United States", row, ref)).toEqual({
      value: "V0C000000000101",
    });
    expect(normaliseCountry("Atlantis", row, ref)).toMatchObject({
      omit: true,
    });
    const pick = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: COUNTRY_SOURCE, target: "country__v" },
      targetField: {
        type: "picklist",
        rawType: "Picklist",
        picklistValues: ["germany__v", "united_states__v"],
      },
    });
    expect(normaliseCountry("DEU", row, pick)).toEqual({ value: "germany__v" });
    // no picklistValue on the crosswalk entry → derivation from the ISO code, validated against the target
    const noPick = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: COUNTRY_SOURCE, target: "country__v" },
      targetField: {
        type: "picklist",
        rawType: "Picklist",
        picklistValues: ["fr__v"],
      },
      country: buildCountryContext({ countries: [{ iso2: "FR" }] }),
    });
    expect(normaliseCountry("France", row, noPick)).toEqual({ value: "fr__v" });
  });

  it("inquiryState emits only on a lifecycled target and inquiryText only when the documented text is empty", () => {
    const lifecycled = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: "Status_vod__c", target: "state__v" },
      metadata: { lifecycle: LIFECYCLE },
      mapping: { states: { ...MEDICAL_INQUIRY_STATES } },
    });
    expect(inquiryState("Closed", { Id: INQUIRY_ID }, lifecycled)).toEqual({
      value: "closed_state__v",
      targetField: "state__v",
    });
    expect(inquiryState("", { Id: INQUIRY_ID }, lifecycled)).toBeUndefined();
    expect(
      inquiryState("Archived", { Id: INQUIRY_ID }, lifecycled),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_LIFECYCLE_STATE_MISSING", fatal: true },
    });
    const plain = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: "Status_vod__c", target: "state__v" },
      mapping: { states: { ...MEDICAL_INQUIRY_STATES } },
    });
    expect(inquiryState("Closed", { Id: INQUIRY_ID }, plain)).toBeUndefined();

    const textCtx = buildTransformContext({
      objectKey: "medical_inquiry",
      field: { source: INQUIRY_TEXT_SOURCE, target: INQUIRY_TEXT_TARGET },
      targetField: {
        name: INQUIRY_TEXT_TARGET,
        type: "longtext",
        rawType: "LongText",
        maxLength: 32000,
      },
    });
    expect(
      inquiryText(
        "",
        {
          Id: INQUIRY_ID,
          [RICH_INQUIRY_TEXT_SOURCE]: "<p>Hello <b>world</b></p>",
        },
        textCtx,
      ),
    ).toMatchObject({
      value: "Hello world",
      diagnostic: { kind: "custom", code: MI_INQUIRY_TEXT_FROM_RICH_CODE },
    });
    expect(
      inquiryText(
        "Documented\r\ntext",
        { Id: INQUIRY_ID, [RICH_INQUIRY_TEXT_SOURCE]: "<p>Hello</p>" },
        textCtx,
      ),
    ).toEqual({ value: "Documented\ntext" });
    expect(inquiryText("", { Id: INQUIRY_ID }, textCtx)).toBeUndefined();
    expect(inquiryText(undefined, { Id: INQUIRY_ID }, textCtx)).toBeUndefined();
    // truncated rich text keeps the FROM_RICH code with the truncation detail
    expect(
      inquiryText(
        "",
        { Id: INQUIRY_ID, [RICH_INQUIRY_TEXT_SOURCE]: "y".repeat(32001) },
        textCtx,
      ),
    ).toMatchObject({
      value: "y".repeat(32000),
      diagnostic: {
        kind: "truncated",
        code: MI_INQUIRY_TEXT_FROM_RICH_CODE,
        detail: expect.stringContaining("32001 > 32000"),
      },
    });
    // the selector row never emits
    expect(
      richInquiryText("<p>Hello</p>", { Id: INQUIRY_ID }, textCtx),
    ).toBeUndefined();
  });
});
