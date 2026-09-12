import { describe, expect, it } from "vitest";
import {
  CALL2_DISCUSSION_OBJECT_TYPES,
  call2_discussion,
} from "./call2_discussion";
import {
  CALL2_OPEN_PREDICATE,
  CONTACT_REF_DROPPED_CODE,
  OUT_OF_SCOPE_REF_DROPPED_CODE,
} from "./call2";
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
const CUTOFF = "2024-09-07";
const DISCUSSION_ID = to18("a0E000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const MEDICAL_EVENT_ID = to18("a0N000000000001");
const STRATEGY_ID = to18("a0Y000000000001");
const CONTACT_ID = "003000000000001AAA";

const config = parseConfig({
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
  countries: { US: {} },
});

const OBJECT_TYPE_NAMES = Object.values(CALL2_DISCUSSION_OBJECT_TYPES);

const metadata = resolveMetadata(
  buildVaultMetadata(
    "call2_discussion__v",
    [
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
      { name: "product__v", type: "Object", object: { name: "product__v" } },
      {
        name: "detail_group__v",
        type: "Object",
        object: { name: "product__v" },
      },
      { name: "account__v", type: "Object", object: { name: "account__v" } },
      { name: "user__v", type: "Object", object: { name: "user__sys" } },
      { name: "call_date__v", type: "Date" },
      {
        name: "medical_event__v",
        type: "Object",
        object: { name: "medical_event__v" },
      },
      { name: "discussion__v", type: "LongText" },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ],
    { objectTypes: OBJECT_TYPE_NAMES },
  ),
  {
    picklists: { attendee_type__v: ["person_account__v", "user__v"] },
    objectTypes: Object.fromEntries(OBJECT_TYPE_NAMES.map((t) => [t, {}])),
  },
);

function discussionRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: DISCUSSION_ID,
    Name: "CDI-000001",
    "RecordType.DeveloperName": "CallReport_vod",
    Call2_vod__c: IDS.call1,
    Product_vod__c: PRODUCT_ID,
    Account_vod__c: IDS.account1,
    User_vod__c: SAMPLE_USER_ID,
    Call_Date_vod__c: "2025-03-04",
    Product_Strategy_vod__c: STRATEGY_ID,
    Medical_Event_vod__c: MEDICAL_EVENT_ID,
    Discussion_vod__c: "Discussed dosing <b>schedule</b>",
    Attendee_Type_vod__c: "Person_Account_vod",
    zvod_Product_Map_vod__c: "layout",
    Mobile_ID_vod__c: "mob-disc-1",
    CreatedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T10:31:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-03-04T10:31:00.000Z",
    ...extra,
  };
}

function run(row: SourceRow, opts: { knownCall?: boolean } = {}) {
  const mapping = materialise(
    call2_discussion,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      call2: opts.knownCall === false ? {} : { [IDS.call1]: "V0K1" },
      product: { [PRODUCT_ID]: "V0P1" },
      account: { [IDS.account1]: "V0A1" },
      medical_event: { [MEDICAL_EVENT_ID]: "V0N1" },
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
      custom: call2_discussion.custom,
    }),
  };
}

describe("call2_discussion module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(call2_discussion).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(call2_discussion.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.32 / §4.4 catalogue facts", () => {
    expect(call2_discussion.source).toBe("Call2_Discussion_vod__c");
    expect(call2_discussion.target).toBe("call2_discussion__v");
    expect(call2_discussion.targetEvidence).toBe("DOC");
    expect(call2_discussion.scope).toEqual({
      kind: "via-parent",
      parentKey: "call2",
      parentField: "Call2_vod__r.Call_Date_vod__c",
      type: "date",
    });
    expect(call2_discussion.countryOf).toEqual([
      { kind: "parent", key: "call2", field: "Call2_vod__c" },
    ]);
    expect(call2_discussion.dependsOn).toEqual([
      "call2",
      "product",
      "account",
      "user",
      "medical_event",
    ]);
    expect(call2_discussion.deletePolicy).toBe("delete");
    expect(call2_discussion.createPolicy).toBe("create");
    expect(call2_discussion.load).toMatchObject({ noTriggers: true });
    expect(call2_discussion.objectTypes).toEqual({
      CallReport_vod: "call_report__v",
      Event_vod: "event__v",
      MSLMeetingBrief_vod: "mslmeetingbrief__v",
      MeetingBrief_vod: "meetingbrief__v",
      Medical_Discussion_vod: "medical_discussion__v",
    });
    expect(call2_discussion.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      objectType: true,
    });
    expect(call2_discussion.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
  });

  it("maps every §6.3.32 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(call2_discussion.fields.map((f) => [f.target, f]));
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      transform: { kind: "objectType", mapKey: "call2_discussion.objectType" },
    });
    expect(byTarget.get("call2__v")).toMatchObject({
      required: "Y",
      transform: { kind: "ref", objectKey: "call2" },
    });
    for (const t of ["product__v", "detail_group__v"])
      expect(byTarget.get(t)).toMatchObject({
        required: "n",
        evidence: "DOC",
        transform: { kind: "ref", objectKey: "product" },
      });
    expect(byTarget.get("account__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("user__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("account__v.contact")).toMatchObject({
      source: "Contact_vod__c",
      transform: { kind: "custom", fnName: "contactRef" },
    });
    expect(byTarget.get("call_date__v")).toMatchObject({
      transform: { kind: "date" },
    });
    for (const t of [
      "product_strategy__v",
      "product_tactic__v",
      "account_tactic__v",
    ])
      expect(byTarget.get(t)).toMatchObject({
        required: "-",
        transform: { kind: "custom", fnName: "outOfScopeRef" },
      });
    expect(byTarget.get("medical_event__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "ref", objectKey: "medical_event" },
    });
    expect(byTarget.get("discussion__v")).toMatchObject({
      countryConfigurable: true,
      transform: { kind: "longtext" },
    });
    expect(byTarget.get("zvod_product_map__v")).toMatchObject({
      required: "-",
      transform: { kind: "skip" },
    });
    expect(byTarget.has("ownerid__v")).toBe(false);
  });

  it("transforms a discussion row", () => {
    const { result } = run(discussionRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: DISCUSSION_ID,
      "object_type__v.api_name__v": "call_report__v",
      call2__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      user__v: { $user: SAMPLE_USER_ID },
      call_date__v: "2025-03-04",
      medical_event__v: {
        $fk: { object: "medical_event", sfdcId: MEDICAL_EVENT_ID },
      },
      discussion__v: "Discussed dosing <b>schedule</b>",
      attendee_type__v: "person_account__v",
      mobile_id__v: "mob-disc-1",
    });
    expect(result.objectType).toBe("call_report__v");
    expect(result.payload.name__v).toBeUndefined();
    expect(result.payload.product_strategy__v).toBeUndefined();
    expect(result.payload.zvod_product_map__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "product_strategy__v",
        code: OUT_OF_SCOPE_REF_DROPPED_CODE,
        value: STRATEGY_ID,
      }),
    );
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
  });

  it("drops a contact-only discussion reference and reports an unknown parent as pending_fk", () => {
    const contact = run(
      discussionRow({ Account_vod__c: null, Contact_vod__c: CONTACT_ID }),
    ).result;
    expect(contact.status).toBe("ok");
    expect(contact.payload.account__v).toBeUndefined();
    expect(contact.diagnostics).toContainEqual(
      expect.objectContaining({ code: CONTACT_REF_DROPPED_CODE }),
    );
    const pending = run(discussionRow(), { knownCall: false }).result;
    expect(pending.status).toBe("pending_fk");
    expect(pending.unresolvedRequiredFks).toEqual([
      { field: "call2__v", objectKey: "call2", sfdcId: IDS.call1 },
    ]);
  });

  it("scope: through the parent's call date", () => {
    const { mapping } = run(discussionRow());
    expect(mapping.scope.cutoffDate).toBe(CUTOFF);
    expect(
      buildScopePredicate(mapping.scope, {
        parentOpenPredicate: CALL2_OPEN_PREDICATE,
      }).predicate,
    ).toBe(
      `(Call2_vod__r.Call_Date_vod__c >= ${CUTOFF}) OR (Call2_vod__r.Status_vod__c = 'Planned_vod')`,
    );
  });
});
