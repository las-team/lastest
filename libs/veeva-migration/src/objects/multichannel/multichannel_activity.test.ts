import { describe, expect, it } from "vitest";
import {
  MULTICHANNEL_ACTIVITY_DEVICE_FIELDS,
  MULTICHANNEL_ACTIVITY_OBJECT_TYPES,
  multichannel_activity,
} from "./multichannel_activity";
import { validateObjectModule } from "../types";
import { loadOrder, OBJECT_MODULES } from "../registry";
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
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = "2024-09-07";
const ACTIVITY_ID = to18("a0N000000000001");
const PARENT_ACTIVITY_ID = to18("a0N000000000002");
const SENT_EMAIL_ID = to18("a0S000000000001");
const PRODUCT_ID = to18("a0P000000000001");
const DETAIL_GROUP_ID = to18("a0P000000000002");
const MEDICAL_EVENT_ID = to18("a0E000000000001");
const EVENT_ATTENDEE_ID = to18("a0T000000000001");
const EXT_ID_MAP_ID = to18("a0B000000000001");

function config(overrides: Record<string, unknown> = {}) {
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
    objects: { multichannel_activity: { ...overrides } },
    countries: { US: {} },
  });
}

const METADATA = resolveMetadata(
  buildVaultMetadata(
    "multichannel_activity__v",
    [
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      { name: "call__v", type: "Object", object: { name: "call2__v" } },
      {
        name: "sent_email__v",
        type: "Object",
        object: { name: "sent_email__v" },
      },
      { name: "product__v", type: "Object", object: { name: "product__v" } },
      {
        name: "detail_group__v",
        type: "Object",
        object: { name: "product__v" },
      },
      {
        name: "medical_event__v",
        type: "Object",
        object: { name: "medical_event__v" },
      },
      {
        name: "event_attendee__v",
        type: "Object",
        object: { name: "event_attendee__v" },
      },
      { name: "organizer__v", type: "Object", object: { name: "user__sys" } },
      {
        name: "multichannel_activity__v",
        type: "Object",
        object: { name: "multichannel_activity__v" },
      },
      { name: "start_datetime__v", type: "DateTime", required: true },
      { name: "total_duration__v", type: "Number", scale: 0 },
      { name: "session_id__v", type: "String", max_length: 255 },
      { name: "territory__v", type: "String", max_length: 255 },
      { name: "saved_for_later__v", type: "Boolean" },
      { name: "site__v", type: "String", max_length: 255 },
      { name: "account_external_id_map__v", type: "String", max_length: 255 },
      { name: "record_type_name__v", type: "String", max_length: 255 },
      {
        name: "vexternal_id__v",
        type: "String",
        max_length: 255,
        unique: true,
      },
      { name: "device__v", type: "String", max_length: 255 },
      { name: "device_type__v", type: "String", max_length: 255 },
      { name: "location_latitude__v", type: "String", max_length: 255 },
      { name: "location_longitude__v", type: "String", max_length: 255 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ],
    { objectTypes: Object.values(MULTICHANNEL_ACTIVITY_OBJECT_TYPES) },
  ),
);

function activityRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ACTIVITY_ID,
    Name: "MCA-000001",
    "RecordType.DeveloperName": "CLM_vod",
    Account_vod__c: IDS.account1,
    Call_vod__c: IDS.call1,
    Sent_Email_vod__c: SENT_EMAIL_ID,
    Product_vod__c: PRODUCT_ID,
    Detail_Group_vod__c: DETAIL_GROUP_ID,
    Medical_Event_vod__c: MEDICAL_EVENT_ID,
    Event_Attendee_vod__c: EVENT_ATTENDEE_ID,
    Organizer_vod__c: SAMPLE_USER_ID_2,
    Multichannel_Activity_vod__c: PARENT_ACTIVITY_ID,
    Start_DateTime_vod__c: "2025-03-04T10:05:00.000Z",
    Total_Duration_vod__c: "125",
    Session_Id_vod__c: "sess-1",
    Territory_vod__c: "US-NE-01",
    Saved_For_Later_vod__c: "true",
    Site_vod__c: "Boston",
    Account_External_ID_Map_vod__c: EXT_ID_MAP_ID,
    Record_Type_Name_vod__c: "CLM",
    VExternal_Id_vod__c: "VEXT-1",
    Device_vod__c: "iPad",
    Device_Type_vod__c: "tablet",
    Mobile_ID_vod__c: "mob-mca-1",
    OwnerId: SAMPLE_USER_ID,
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
    overrides?: Record<string, unknown>;
    knownAccount?: boolean;
    knownCall?: boolean;
    knownParent?: boolean;
  } = {},
) {
  const cfg = config(opts.overrides);
  const mapping = materialise(
    multichannel_activity,
    resolveCountry(cfg, "US"),
    cfg,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: opts.knownAccount === false ? {} : { [IDS.account1]: "V0A1" },
      call2: opts.knownCall === false ? {} : { [IDS.call1]: "V0K1" },
      sent_email: { [SENT_EMAIL_ID]: "V0S1" },
      product: { [PRODUCT_ID]: "V0P1", [DETAIL_GROUP_ID]: "V0P2" },
      medical_event: { [MEDICAL_EVENT_ID]: "V0E1" },
      event_attendee: { [EVENT_ATTENDEE_ID]: "V0T1" },
      multichannel_activity:
        opts.knownParent === false ? {} : { [PARENT_ACTIVITY_ID]: "V0N2" },
    },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: METADATA,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: multichannel_activity.custom,
    }),
  };
}

describe("multichannel_activity module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(multichannel_activity).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(multichannel_activity.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.3.43 / §3.3 / §4.4 catalogue facts", () => {
    expect(multichannel_activity.source).toBe("Multichannel_Activity_vod__c");
    expect(multichannel_activity.target).toBe("multichannel_activity__v");
    expect(multichannel_activity.targetEvidence).toBe("UNV");
    expect(multichannel_activity.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Start_DateTime_vod__c", type: "datetime" }],
    });
    expect(multichannel_activity.countryOf).toEqual([
      { kind: "account" },
      { kind: "user", field: "Organizer_vod__c" },
      { kind: "user", field: "OwnerId" },
    ]);
    expect(multichannel_activity.dependsOn).toEqual([
      "account",
      "call2",
      "sent_email",
      "product",
      "medical_event",
      "event_attendee",
      "user",
    ]);
    expect(multichannel_activity.selfRefs).toEqual([
      {
        target: "multichannel_activity__v",
        source: "Multichannel_Activity_vod__c",
      },
    ]);
    expect(multichannel_activity.deletePolicy).toBe("ignore");
    expect(multichannel_activity.inactivate).toEqual([]);
    expect(multichannel_activity.createPolicy).toBe("create");
    expect(multichannel_activity.load).toMatchObject({ noTriggers: true });
    expect(multichannel_activity.objectTypes).toEqual({
      CLM_vod: "clm__v",
      Cobrowse_vod: "cobrowse__v",
      Engage_vod: "engage__v",
    });
    expect(multichannel_activity.blockS).toMatchObject({ objectType: true });
    expect(multichannel_activity.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
    ]);
    expect(multichannel_activity.match[1]).toMatchObject({
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
    });
    expect(multichannel_activity.optionDefaults).toEqual({
      loadDeviceFields: false,
    });
  });

  it("orders after call2 and before its lines; the call2 cobrowse patch is a pass-2 edge", () => {
    const steps = loadOrder(OBJECT_MODULES);
    const stepOf = (key: string) =>
      steps.findIndex((s) => s.keys.includes(key as never));
    expect(stepOf("multichannel_activity")).toBeGreaterThan(stepOf("call2"));
    expect(stepOf("multichannel_activity")).toBeGreaterThan(
      stepOf("sent_email"),
    );
    expect(stepOf("multichannel_activity_line")).toBeGreaterThan(
      stepOf("multichannel_activity"),
    );
  });

  it("maps every §6.3.43 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(
      multichannel_activity.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      transform: {
        kind: "objectType",
        mapKey: "multichannel_activity.objectType",
      },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      required: "y?",
      evidence: "UNV",
      transform: { kind: "ref", objectKey: "account" },
    });
    // rename exception: Call_vod__c → call__v (ref → call2)
    expect(byTarget.get("call__v")).toMatchObject({
      source: "Call_vod__c",
      required: "n",
      transform: { kind: "ref", objectKey: "call2" },
    });
    for (const [t, key] of [
      ["sent_email__v", "sent_email"],
      ["product__v", "product"],
      ["detail_group__v", "product"],
      ["medical_event__v", "medical_event"],
      ["event_attendee__v", "event_attendee"],
    ] as const)
      expect(byTarget.get(t)).toMatchObject({
        required: "n",
        evidence: "UNV",
        transform: { kind: "ref", objectKey: key },
      });
    expect(byTarget.get("organizer__v")).toMatchObject({
      source: "Organizer_vod__c",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("multichannel_activity__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "multichannel_activity" },
      },
    });
    expect(byTarget.get("start_datetime__v")).toMatchObject({
      required: "Y",
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("total_duration__v")).toMatchObject({
      transform: { kind: "number" },
    });
    for (const t of ["session_id__v", "territory__v", "site__v"])
      expect(byTarget.get(t)).toMatchObject({ transform: { kind: "text" } });
    expect(byTarget.get("saved_for_later__v")).toMatchObject({
      transform: { kind: "bool" },
    });
    // text copy, never a reference
    expect(byTarget.get("account_external_id_map__v")).toMatchObject({
      source: "Account_External_ID_Map_vod__c",
      transform: { kind: "text" },
    });
    expect(byTarget.get("record_type_name__v")).toMatchObject({
      transform: { kind: "text" },
      countryConfigurable: true,
    });
    expect(byTarget.get("vexternal_id__v")).toMatchObject({
      source: "VExternal_Id_vod__c",
      transform: { kind: "copy" },
    });
    for (const { target } of MULTICHANNEL_ACTIVITY_DEVICE_FIELDS)
      expect(byTarget.get(target)).toMatchObject({
        unverifiedSource: true,
        optionalSource: true,
        enabledBy: "loadDeviceFields",
        transform: { kind: "copy" },
      });
    expect(byTarget.has("status__v")).toBe(false);
  });

  it("transforms an activity row (FKs deferred, organizer user, object type, self-ref in pass 2)", () => {
    const { result } = run(activityRow());
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("clm__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ACTIVITY_ID,
      name__v: "MCA-000001",
      "object_type__v.api_name__v": "clm__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      call__v: { $fk: { object: "call2", sfdcId: IDS.call1 } },
      sent_email__v: { $fk: { object: "sent_email", sfdcId: SENT_EMAIL_ID } },
      product__v: { $fk: { object: "product", sfdcId: PRODUCT_ID } },
      detail_group__v: { $fk: { object: "product", sfdcId: DETAIL_GROUP_ID } },
      medical_event__v: {
        $fk: { object: "medical_event", sfdcId: MEDICAL_EVENT_ID },
      },
      event_attendee__v: {
        $fk: { object: "event_attendee", sfdcId: EVENT_ATTENDEE_ID },
      },
      organizer__v: { $user: SAMPLE_USER_ID_2 },
      ownerid__v: { $user: SAMPLE_USER_ID },
      start_datetime__v: "2025-03-04T10:05:00.000Z",
      total_duration__v: 125,
      session_id__v: "sess-1",
      territory__v: "US-NE-01",
      saved_for_later__v: true,
      site__v: "Boston",
      account_external_id_map__v: EXT_ID_MAP_ID,
      record_type_name__v: "CLM",
      vexternal_id__v: "VEXT-1",
      mobile_id__v: "mob-mca-1",
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-04T10:31:00.000Z",
      last_device__v: "data_load__v",
    });
    // self reference: omitted in pass 1, carried for pass 2
    expect(result.payload.multichannel_activity__v).toBeUndefined();
    expect(result.secondPass).toEqual({
      multichannel_activity__v: {
        $fk: { object: "multichannel_activity", sfdcId: PARENT_ACTIVITY_ID },
      },
    });
    expect(result.fkEdges).toContainEqual({
      field: "multichannel_activity__v",
      targetObjectKey: "multichannel_activity",
      targetSfdcId: PARENT_ACTIVITY_ID,
    });
    // device columns off by default
    expect(result.payload.device__v).toBeUndefined();
    expect(result.payload.device_type__v).toBeUndefined();
    expect(result.blobs).toEqual({});
    expect(result.diagnostics.some((d) => d.fatal)).toBe(false);
  });

  it("loads the device / geo columns only with loadDeviceFields", () => {
    const { mapping, result } = run(activityRow(), {
      overrides: { loadDeviceFields: true },
    });
    expect(mapping.fields.some((f) => f.target === "device__v")).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.payload.device__v).toBe("iPad");
    expect(result.payload.device_type__v).toBe("tablet");
  });

  it("reports an unknown account as pending_fk and unknown optional refs as omitted", () => {
    const pending = run(activityRow(), { knownAccount: false });
    expect(pending.result.status).toBe("pending_fk");
    expect(pending.result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account1 },
    ]);

    const optional = run(activityRow(), {
      knownCall: false,
      knownParent: false,
    });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.call__v).toBeUndefined();
    expect(optional.result.unresolvedOptionalFks).toContainEqual({
      field: "call__v",
      objectKey: "call2",
      sfdcId: IDS.call1,
    });
    // pass-2 patch of a not-yet-loaded parent is retried after the step
    expect(optional.result.unresolvedOptionalFks).toContainEqual({
      field: "multichannel_activity__v",
      objectKey: "multichannel_activity",
      sfdcId: PARENT_ACTIVITY_ID,
      secondPass: true,
    });
  });

  it("scope: dated on Start_DateTime_vod__c (2y, no open term)", () => {
    const { mapping } = run(activityRow());
    expect(mapping.scope.cutoffDate).toBe(CUTOFF);
    expect(mapping.scope.historyMonths).toBe(24);
    const build = buildScopePredicate(mapping.scope);
    expect(build.kind).toBe("dated");
    expect(build.openTerm).toBeUndefined();
    expect(build.predicate).toBe(
      `Start_DateTime_vod__c >= ${CUTOFF}T00:00:00Z`,
    );
  });
});
