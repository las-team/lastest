import { describe, expect, it } from "vitest";
import {
  EM_EVENT_CLOSED_STATUSES,
  EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE,
  EM_EVENT_CONFIG_NAME_SOURCE,
  EM_EVENT_OBJECT_TYPES,
  EM_EVENT_OPEN_PREDICATE,
  EM_EVENT_STATES,
  EM_EVENT_STATUS,
  EM_EVENT_TIMEZONE_DEFAULTED_CODE,
  EM_EVENT_TIMEZONE_FROM_OWNER_CODE,
  EM_EVENT_TIMEZONE_INVALID_CODE,
  EM_VENDOR_REF_DROPPED_CODE,
  EVENT_COUNTRY_FALLBACK_SOURCE,
  EVENT_TIME_ZONE_SOURCE,
  OWNER_TIME_ZONE_SOURCE,
  VT_EM_CONFIG_UNMATCHED_CODE,
  VT_TIMEZONE_VALUE_MISSING_CODE,
  chooseEventTimezone,
  configurationMapOf,
  em_event,
  eventConfiguration,
  eventStage,
  eventTimezoneSource,
  isValidTimezone,
  localWallClock,
} from "./em_event";
import { validateObjectModule } from "../types";
import {
  computeCutoffDate,
  materialise,
  resolveCountry,
} from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { buildColumnList } from "../../extract/columns";
import {
  IDS,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildDescribe,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to15, to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = computeCutoffDate(NOW, 24);
const EVENT_1 = to18("a0E000000000001");
const PARENT = to18("a0E000000000002");
const VENUE = to18("a0V000000000001");
const VENUE_UNKNOWN = to18("a0V000000000009");
const CATALOG = to18("a0T000000000001");
const CONFIG = to18("a0F000000000001");
const VENDOR = to18("a0W000000000001");
const PRODUCT = to18("a0P000000000001");

function config(objects: Record<string, unknown> = {}) {
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
    countries: { US: {} },
    objects,
  });
}

const TIMEZONE_VALUES = [
  "america_new_york__sys",
  "europe_berlin__sys",
  "asia_tokyo__sys",
];

function metadata() {
  const ref = (name: string, object: string, required = false) => ({
    name,
    type: "Object",
    object: { name: object },
    required,
    relationship_type: "reference",
  });
  return resolveMetadata(
    buildVaultMetadata(
      "em_event__v",
      [
        { name: "event_display_name__v", type: "String", max_length: 80 },
        {
          name: "em_event_status__v",
          type: "Picklist",
          picklist: "em_event_status__v",
          required: true,
        },
        { name: "stage__v", type: "Picklist", picklist: "stage__v" },
        { name: "start_time__v", type: "DateTime", required: true },
        { name: "end_time__v", type: "DateTime" },
        { name: "start_date__v", type: "Date" },
        { name: "end_date__v", type: "Date" },
        { name: "start_time_local__v", type: "DateTime" },
        { name: "end_time_local__v", type: "DateTime" },
        { name: "time_zone__v", type: "Picklist", picklist: "time_zone__v" },
        ref("country__v", "country__v"),
        { name: "location__v", type: "String", max_length: 255 },
        { name: "city__v", type: "String", max_length: 80 },
        ref("venue__v", "em_venue__v"),
        ref("vendor__v", "em_vendor__v"),
        ref("topic__v", "em_catalog__v"),
        ref("event_configuration__v", "em_event_configuration__v"),
        ref("parent_event__v", "em_event__v"),
        { name: "parent_event_id__v", type: "String", max_length: 18 },
        { name: "external_id__v", type: "String", max_length: 100 },
        { name: "stub_sfdc_id__v", type: "String", max_length: 18 },
        { name: "description__v", type: "LongText" },
        { name: "estimated_attendance__v", type: "Number", scale: 0 },
        { name: "estimated_cost__v", type: "Number", scale: 2 },
        {
          name: "local_currency__sys",
          type: "Picklist",
          picklist: "local_currency__sys",
        },
        { name: "publish_event__v", type: "Boolean" },
        {
          name: "event_format__v",
          type: "Picklist",
          picklist: "event_format__v",
        },
        ref("product__v", "product__v"),
        ref("account__v", "account__v"),
        ref("ownerid__v", "user__sys"),
        { name: "mobile_id__v", type: "String", max_length: 100 },
      ],
      {
        objectTypes: Object.values(EM_EVENT_OBJECT_TYPES),
        lifecycles: ["em_event_lifecycle__v"],
      },
    ),
    {
      picklists: {
        em_event_status__v: [...new Set(Object.values(EM_EVENT_STATUS))],
        time_zone__v: TIMEZONE_VALUES,
        event_format__v: ["in_person__v", "virtual__v"],
        status__v: ["active__v", "inactive__v"],
      },
      lifecycle: {
        name: "em_event_lifecycle__v",
        states: [...new Set(Object.values(EM_EVENT_STATES))],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    em_venue: { [VENUE]: "V0V000000000001" },
    em_catalog: { [CATALOG]: "V0T000000000001" },
    em_event: { [PARENT]: "V0E000000000002" },
    product: { [PRODUCT]: "V0P000000000001" },
    account: { [IDS.account1]: "V0A000000000001" },
  },
  { [SAMPLE_USER_ID]: 11 },
);

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: EVENT_1,
    IsDeleted: false,
    Name: "Spring Symposium",
    "RecordType.DeveloperName": "Speaker_Program_vod",
    Event_Display_Name_vod__c: "Spring Symposium 2025",
    Status_vod__c: "Approved_vod",
    Start_Time_vod__c: "2025-03-10T18:00:00.000Z",
    End_Time_vod__c: "2025-03-10T21:00:00.000Z",
    [EVENT_TIME_ZONE_SOURCE]: "America/New_York",
    Country_vod__c: IDS.countryUS,
    Location_vod__c: "Hilton Boston",
    City_vod__c: "Boston",
    Venue_vod__c: VENUE,
    Vendor_vod__c: VENDOR,
    Topic_vod__c: CATALOG,
    Event_Configuration_vod__c: CONFIG,
    [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "CFG-SP",
    [EM_EVENT_CONFIG_NAME_SOURCE]: "Speaker Program",
    Parent_Event_vod__c: PARENT,
    External_ID_vod__c: "EV-001",
    Stub_SFDC_Id_vod__c: "",
    Description_vod__c: "Evening symposium\r\nwith dinner",
    Estimated_Attendance_vod__c: "25",
    Estimated_Cost_vod__c: "1200.5",
    CurrencyIsoCode: "USD",
    Publish_Event_vod__c: "true",
    Product_vod__c: PRODUCT,
    Account_vod__c: IDS.account1,
    Event_Format_vod__c: "In_Person_vod",
    Mobile_ID_vod__c: "7d2c5f4e-e001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-01-04T10:11:12.000Z",
    LastModifiedDate: "2025-03-02T03:04:05.000Z",
    SystemModstamp: "2025-03-02T03:04:05.000Z",
    ...extra,
  };
}

function mapping(objects: Record<string, unknown> = {}) {
  const cfg = config(objects);
  return materialise(em_event, resolveCountry(cfg, "US"), cfg, { now: NOW });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: buildCountryContext(),
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: em_event.custom,
    ...overrides,
  };
}

describe("em_event module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_event).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(em_event.source).toBe("EM_Event_vod__c");
    expect(em_event.target).toBe("em_event__v");
    expect(em_event.targetEvidence).toBe("OBS");
    expect(em_event.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Start_Time_vod__c", type: "datetime" }],
      openPredicate: EM_EVENT_OPEN_PREDICATE,
      retentionFamily: "tov",
    });
    expect(EM_EVENT_OPEN_PREDICATE).toContain(
      "End_Time_vod__c >= {cutoffDateTime}",
    );
    for (const s of EM_EVENT_CLOSED_STATUSES)
      expect(EM_EVENT_OPEN_PREDICATE).toContain(`'${s}'`);
    expect(em_event.countryOf).toEqual([
      { kind: "field", path: "Country_vod__r.Alpha_2_Code_vod__c" },
    ]);
    expect(em_event.dependsOn).toEqual([
      "country",
      "user",
      "em_venue",
      "em_catalog",
      "product",
      "account",
    ]);
    expect(em_event.selfRefs).toEqual([
      { target: "parent_event__v", source: "Parent_Event_vod__c" },
    ]);
    expect(em_event.partitionBy).toEqual({
      field: "Parent_Event_vod__c",
      order: ["null", "notNull"],
    });
    expect(em_event.load).toMatchObject({
      noTriggers: true,
      partitionBy: { field: "Parent_Event_vod__c" },
    });
    expect(em_event.deletePolicy).toBe("ignore");
    expect(em_event.inactivate).toEqual([]); // status__v = inactive__v only when overridden to inactivate
    expect(em_event.createPolicy).toBe("create");
    expect(em_event.blockS.currency).toBe(true);
    expect(em_event.blockS.objectType).toBe(true);
    expect(em_event.objectTypes).toEqual(EM_EVENT_OBJECT_TYPES);
    expect(em_event.states).toEqual(EM_EVENT_STATES);
    expect(em_event.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      "natural_key",
    ]);
    expect(em_event.match[3].keys).toEqual([
      { target: "stub_sfdc_id__v", source: "Stub_SFDC_Id_vod__c" },
    ]);
    expect(em_event.configObjects).toEqual(["em_event_configuration"]);
    expect(em_event.optionDefaults).toEqual({
      configurationMap: false,
      stageMap: false,
      ownerTimezoneLookup: false,
    });
    expect(em_event.notes).not.toContain("STUB");
  });

  it("carries every §6.3.22 row with its transform, requirement and evidence", () => {
    const byTarget = new Map(em_event.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "object_type__v.api_name__v",
      "name__v",
      "event_display_name__v",
      "em_event_status__v",
      "state__v",
      "stage__v",
      "start_time__v",
      "end_time__v",
      "start_date__v",
      "end_date__v",
      "start_time_local__v",
      "end_time_local__v",
      "time_zone__v",
      "time_zone__v.event",
      "time_zone__v.owner",
      "country__v",
      "country__v.event_country",
      "location__v",
      "location_address__v",
      "location_address_line_2__v",
      "city__v",
      "state_province__v",
      "postal_code__v",
      "address__v",
      "venue__v",
      "vendor__v",
      "topic__v",
      "event_configuration__v",
      "event_configuration__v.external_id",
      "event_configuration__v.name",
      "parent_event__v",
      "parent_event_id__v",
      "external_id__v",
      "kol_external_id__v",
      "stub_mobile_id__v",
      "stub_sfdc_id__v",
      "description__v",
      "sponsor__v",
      "web_source__v",
      "disclaimer__v",
      "cancellation_reason__v",
      "last_comment__v",
      "estimated_attendance__v",
      "actual_attendance__v",
      "invited_attendees__v",
      "walk_in_count__v",
      "online_registrant_count__v",
      "attendees_requesting_meals__v",
      "attendees_with_meals__v",
      "hcps_with_meals__v",
      "estimated_cost__v",
      "committed_cost__v",
      "actual_cost__v",
      "actual_meal_cost_per_person__v",
      "flat_fee_expense__v",
      "failed_expense__v",
      "local_currency__sys",
      "attendee_reconciliation_complete__v",
      "publish_event__v",
      "qr_sign_in_enabled__v",
      "meal_optin_for_qr_signin__v",
      "account_attendee_fields__v",
      "contact_attendee_fields__v",
      "user_attendee_fields__v",
      "walk_in_fields__v",
      "prescriber_walk_in_fields__v",
      "non_prescriber_walk_in_fields__v",
      "other_walk_in_fields__v",
      "online_registration_fields__v",
      "event_format__v",
      "meal_type__v",
      "event_identifier__v",
      "program_type__v",
      "product__v",
      "account__v",
      "registration_url__v",
      "sign_in_url__v",
      "key_contact__v",
      "key_contact_name__v",
      "key_contact_email__v",
      "key_contact_phone__v",
      "location_type__v",
      "country_user__v",
      "assigned_host__v",
      "av_equipment__v",
      "content_length__v",
      "vault_external_id__v",
      "vault_binder_path__v",
      "engage_webinar__v",
      "cvent_event_id__v",
      "external_id_on24__v",
      "event_type__v",
      "virtual_event_type__v",
      "ownerid__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "mobile_id__v",
      "lock__v",
      "override_lock__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    // same-target rows replaced the Block S defaults exactly once
    for (const t of [
      "legacy_crm_id__v",
      "name__v",
      "external_id__v",
      "ownerid__v",
    ])
      expect(
        em_event.fields.filter((f) => f.target === t),
        t,
      ).toHaveLength(1);
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      required: "K",
      evidence: "OBS",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      required: "Y",
      transform: { kind: "objectType", mapKey: "em_event.objectType" },
      countryConfigurable: true,
    });
    expect(byTarget.get("em_event_status__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "em_event.status" },
    });
    expect(byTarget.get("state__v")).toMatchObject({
      required: "Y",
      transform: { kind: "state", mapKey: "em_event.state" },
    });
    expect(byTarget.get("stage__v")).toMatchObject({
      enabledBy: "stageMap",
      transform: { kind: "custom", fnName: "eventStage" },
    });
    expect(byTarget.get("start_time__v")).toMatchObject({
      required: "Y",
      transform: { kind: "datetime" },
    });
    for (const t of [
      "start_date__v",
      "end_date__v",
      "start_time_local__v",
      "end_time_local__v",
      "time_zone__v",
    ])
      expect(byTarget.get(t)?.transform, t).toEqual({
        kind: "custom",
        fnName: "emEventLocalTimes",
      });
    expect(byTarget.get("time_zone__v.event")).toMatchObject({
      source: EVENT_TIME_ZONE_SOURCE,
      unverifiedSource: true,
    });
    expect(byTarget.get("time_zone__v.owner")).toMatchObject({
      source: OWNER_TIME_ZONE_SOURCE,
      optionalSource: true,
      enabledBy: "ownerTimezoneLookup",
    });
    // the Event_Country_vod__c fallback sits inside the primary row so a
    // required country__v is satisfied before REQUIRED_MISSING is evaluated
    expect(byTarget.get("country__v")).toMatchObject({
      source: "Country_vod__c",
      required: "y?",
      transform: { kind: "custom", fnName: "eventCountry" },
    });
    expect(byTarget.get("country__v.event_country")).toMatchObject({
      source: EVENT_COUNTRY_FALLBACK_SOURCE,
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "custom", fnName: "eventCountry" },
    });
    expect(byTarget.get("venue__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_venue",
    });
    expect(byTarget.get("vendor__v")).toMatchObject({
      evidence: "OBS",
      transform: { kind: "custom", fnName: "vendorRefDropped" },
    });
    expect(byTarget.get("topic__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_catalog",
    });
    expect(byTarget.get("event_configuration__v")).toMatchObject({
      required: "y?",
      countryConfigurable: true,
      transform: { kind: "custom", fnName: "eventConfiguration" },
    });
    expect(byTarget.get("parent_event__v")?.transform).toEqual({
      kind: "secondPass",
      inner: { kind: "ref", objectKey: "em_event" },
    });
    expect(byTarget.get("parent_event_id__v")?.transform).toEqual({
      kind: "copy",
    });
    expect(byTarget.get("description__v")?.transform).toEqual({
      kind: "longtext",
    });
    expect(byTarget.get("cancellation_reason__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "em_event.cancellationReason",
    });
    expect(byTarget.get("last_comment__v")?.evidence).toBe("UNV");
    expect(byTarget.get("estimated_cost__v")).toMatchObject({
      transform: { kind: "number" },
      sourceType: "currency",
    });
    expect(byTarget.get("local_currency__sys")?.transform).toEqual({
      kind: "currency",
    });
    expect(byTarget.get("publish_event__v")?.transform).toEqual({
      kind: "bool",
    });
    expect(byTarget.get("walk_in_fields__v")?.transform).toEqual({
      kind: "longtext",
    });
    expect(byTarget.get("product__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "product" },
      unverifiedSource: true,
    });
    expect(byTarget.get("account__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "account",
    });
    for (const t of ["key_contact__v", "country_user__v", "assigned_host__v"])
      expect(byTarget.get(t)?.transform, t).toEqual({ kind: "refUser" });
    expect(byTarget.get("event_type__v")).toMatchObject({
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "picklist", mapKey: "em_event.eventType" },
    });
    expect(byTarget.get("virtual_event_type__v")?.evidence).toBe("UNV");
    expect(byTarget.get("ownerid__v")).toMatchObject({
      required: "y?",
      evidence: "OBS",
      transform: { kind: "refUser" },
    });
    expect(em_event.picklists["em_event.status"]).toEqual(EM_EVENT_STATUS);
    for (const f of em_event.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is dated on Start_Time_vod__c with the open-item term and the tov family", () => {
    const m = mapping();
    expect(m.scope.spec.kind).toBe("dated");
    expect(m.scope.retentionFamily).toBe("tov");
    expect(m.scope.historyMonths).toBe(24);
    const built = buildScopePredicate(m.scope, { now: NOW });
    expect(built.cutoffDate).toBe(CUTOFF);
    expect(built.dateTerm).toBe(`Start_Time_vod__c >= ${CUTOFF}T00:00:00Z`);
    expect(built.predicate).toBe(
      `(Start_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR ((End_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR (Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))`,
    );
    // ToV retention widens the window (EU: 60 months)
    const cfg = parseConfig({
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
      countries: { DE: { scope: { tovRetentionMonths: 60 } } },
    });
    const de = materialise(em_event, resolveCountry(cfg, "DE"), cfg, {
      now: NOW,
    });
    expect(de.scope.historyMonths).toBe(60);
    expect(buildScopePredicate(de.scope, { now: NOW }).cutoffDate).toBe(
      computeCutoffDate(NOW, 60),
    );
  });

  it("selects the selector-row columns and drops the opt-in owner timezone path by default", () => {
    const describe = buildDescribe("EM_Event_vod__c", [
      { name: "Name", type: "string" },
      { name: "Status_vod__c", type: "picklist" },
      { name: "Start_Time_vod__c", type: "datetime" },
      { name: "End_Time_vod__c", type: "datetime" },
      { name: EVENT_TIME_ZONE_SOURCE, type: "picklist" },
      {
        name: "Event_Configuration_vod__c",
        type: "reference",
        referenceTo: ["EM_Event_Configuration_vod__c"],
        relationshipName: "Event_Configuration_vod__r",
      },
      {
        name: "Parent_Event_vod__c",
        type: "reference",
        referenceTo: ["EM_Event_vod__c"],
        relationshipName: "Parent_Event_vod__r",
      },
    ]);
    const cols = buildColumnList(mapping(), { describe, columns: [] });
    expect(cols.columns).toContain(EVENT_TIME_ZONE_SOURCE);
    expect(cols.columns).toContain(EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE);
    expect(cols.columns).toContain(EM_EVENT_CONFIG_NAME_SOURCE);
    expect(cols.columns).not.toContain(OWNER_TIME_ZONE_SOURCE);
    expect(
      mapping({ em_event: { ownerTimezoneLookup: true } }).fields.some(
        (f) => f.source === OWNER_TIME_ZONE_SOURCE,
      ),
    ).toBe(true);
    expect(cols.fkColumns).toContainEqual(
      expect.objectContaining({
        column: "Parent_Event_vod__c",
        targetObjectKey: "em_event",
      }),
    );
  });

  it("transforms a row: object type, status + state, UTC and local times, refs, currency, vendor dropped, parent deferred", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.objectType).toBe("speaker_program__v");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: EVENT_1,
      "object_type__v.api_name__v": "speaker_program__v",
      name__v: "Spring Symposium",
      event_display_name__v: "Spring Symposium 2025",
      em_event_status__v: "approved__v",
      state__v: "approved_state__v",
      start_time__v: "2025-03-10T18:00:00.000Z",
      end_time__v: "2025-03-10T21:00:00.000Z",
      // America/New_York is on EDT (UTC−4) on 2025-03-10
      start_time_local__v: "2025-03-10T14:00:00.000Z",
      end_time_local__v: "2025-03-10T17:00:00.000Z",
      start_date__v: "2025-03-10",
      end_date__v: "2025-03-10",
      time_zone__v: "america_new_york__sys",
      country__v: "V0C000000000101",
      location__v: "Hilton Boston",
      city__v: "Boston",
      venue__v: { $fk: { object: "em_venue", sfdcId: VENUE } },
      topic__v: { $fk: { object: "em_catalog", sfdcId: CATALOG } },
      "event_configuration__v.external_id__v": "CFG-SP",
      parent_event_id__v: PARENT,
      external_id__v: "EV-001",
      description__v: "Evening symposium\nwith dinner",
      estimated_attendance__v: 25,
      estimated_cost__v: 1200.5,
      local_currency__sys: "USD",
      publish_event__v: true,
      product__v: { $fk: { object: "product", sfdcId: PRODUCT } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      event_format__v: "in_person__v",
      mobile_id__v: "7d2c5f4e-e001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-01-04T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.vendor__v).toBeUndefined();
    expect(r.payload.stage__v).toBeUndefined();
    expect(r.payload.parent_event__v).toBeUndefined();
    expect(r.payload.event_configuration__v).toBeUndefined();
    expect(r.payload["time_zone__v.event"]).toBeUndefined();
    expect(r.payload["country__v.event_country"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({
      parent_event__v: { $fk: { object: "em_event", sfdcId: PARENT } },
    });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "vendor__v",
        code: EM_VENDOR_REF_DROPPED_CODE,
        value: VENDOR,
      }),
    );
    expect(
      r.diagnostics.some((d) => d.code === EM_EVENT_TIMEZONE_DEFAULTED_CODE),
    ).toBe(false);
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "parent_event__v",
      targetObjectKey: "em_event",
      targetSfdcId: PARENT,
    });
  });

  it("reports an unresolved required FK as pending_fk and fails on a missing / unmapped status", () => {
    const pending = applyMapping(
      row({ Venue_vod__c: VENUE_UNKNOWN }),
      mapping({ em_event: { required: { venue__v: true } } }),
      applyCtx(),
    );
    expect(pending.status).toBe("pending_fk");
    expect(pending.payload.venue__v).toEqual({
      $fk: { object: "em_venue", sfdcId: VENUE_UNKNOWN },
    });
    expect(pending.unresolvedRequiredFks).toEqual([
      { field: "venue__v", objectKey: "em_venue", sfdcId: VENUE_UNKNOWN },
    ]);
    // optional lookup unresolved → omitted, recorded
    const optional = applyMapping(
      row({ Venue_vod__c: VENUE_UNKNOWN }),
      mapping(),
      applyCtx(),
    );
    expect(optional.status).toBe("ok");
    expect(optional.payload.venue__v).toBeUndefined();
    expect(optional.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({ field: "venue__v", objectKey: "em_venue" }),
    );
    const missing = applyMapping(
      row({ Status_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "em_event_status__v",
    });
    const unmapped = applyMapping(
      row({ Status_vod__c: "Weird_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(unmapped.status).toBe("failed");
    expect(unmapped.failure?.field).toBe("em_event_status__v");
    // customer plain-English value via the country overlay (status + state)
    const overlay = applyMapping(
      row({ Status_vod__c: "In Draft" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: {
            "em_event.status": { "In Draft": "requested__v" },
            "em_event.state": { "In Draft": "requested_state__v" },
          },
        }),
      }),
    );
    expect(overlay.status).toBe("ok");
    expect(overlay.payload.em_event_status__v).toBe("requested__v");
    expect(overlay.payload.state__v).toBe("requested_state__v");
  });

  it("resolves event_configuration__v via the map, the External_ID, then the Name, else VT_EM_CONFIG_UNMATCHED", () => {
    const byVaultId = applyMapping(
      row(),
      mapping({
        em_event: { configurationMap: { [to15(CONFIG)]: "V0F000000000001" } },
      }),
      applyCtx(),
    );
    expect(byVaultId.payload.event_configuration__v).toBe("V0F000000000001");
    expect(
      byVaultId.payload["event_configuration__v.external_id__v"],
    ).toBeUndefined();
    const byExternal = applyMapping(
      row(),
      mapping({
        em_event: { configurationMap: { [CONFIG]: "external_id:CFG-X" } },
      }),
      applyCtx(),
    );
    expect(byExternal.payload["event_configuration__v.external_id__v"]).toBe(
      "CFG-X",
    );
    const byName = applyMapping(
      row({ [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "" }),
      mapping(),
      applyCtx(),
    );
    expect(byName.payload["event_configuration__v.name__v"]).toBe(
      "Speaker Program",
    );
    const unmatched = applyMapping(
      row({
        [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "",
        [EM_EVENT_CONFIG_NAME_SOURCE]: null,
      }),
      mapping(),
      applyCtx(),
    );
    // §6.1 / §6.3.22: a configuration reference without a Vault match is
    // blocking — the row is held for review even though the target field is
    // not required, rather than loaded unconfigured
    expect(unmatched.status).toBe("failed");
    expect(unmatched.failure).toMatchObject({
      code: VT_EM_CONFIG_UNMATCHED_CODE,
      field: "event_configuration__v",
    });
    expect(unmatched.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "event_configuration__v",
        code: VT_EM_CONFIG_UNMATCHED_CODE,
        value: CONFIG,
        fatal: true,
      }),
    );
    const required = applyMapping(
      row({
        [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "",
        [EM_EVENT_CONFIG_NAME_SOURCE]: "",
      }),
      mapping({ em_event: { required: { event_configuration__v: true } } }),
      applyCtx(),
    );
    expect(required.status).toBe("failed");
    expect(required.failure?.code).toBe(VT_EM_CONFIG_UNMATCHED_CODE);
    // explicit opt-out: required.event_configuration__v = false → counted, not fatal
    const optedOut = applyMapping(
      row({
        [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "",
        [EM_EVENT_CONFIG_NAME_SOURCE]: "",
      }),
      mapping({ em_event: { required: { event_configuration__v: false } } }),
      applyCtx(),
    );
    expect(optedOut.status).toBe("ok");
    expect(optedOut.payload.event_configuration__v).toBeUndefined();
    expect(optedOut.diagnostics).toContainEqual(
      expect.objectContaining({
        code: VT_EM_CONFIG_UNMATCHED_CODE,
        fatal: false,
      }),
    );
    // no configuration at all → nothing emitted
    const none = applyMapping(
      row({
        Event_Configuration_vod__c: "",
        [EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE]: "",
        [EM_EVENT_CONFIG_NAME_SOURCE]: "",
      }),
      mapping(),
      applyCtx(),
    );
    expect(none.status).toBe("ok");
    expect(none.payload["event_configuration__v.name__v"]).toBeUndefined();
  });

  it("chooses the timezone (event → owner → country default) and validates the value name", () => {
    const defaulted = applyMapping(
      row({ [EVENT_TIME_ZONE_SOURCE]: "" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({ defaultTimezone: "Europe/Berlin" }),
      }),
    );
    expect(defaulted.status).toBe("ok");
    expect(defaulted.payload).toMatchObject({
      time_zone__v: "europe_berlin__sys",
      start_time_local__v: "2025-03-10T19:00:00.000Z", // CET (UTC+1)
      start_date__v: "2025-03-10",
    });
    expect(defaulted.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        field: "time_zone__v",
        code: EM_EVENT_TIMEZONE_DEFAULTED_CODE,
        value: "Europe/Berlin",
      }),
    );
    expect(
      defaulted.diagnostics.filter(
        (d) => d.code === EM_EVENT_TIMEZONE_DEFAULTED_CODE,
      ),
    ).toHaveLength(1);
    const fromOwner = applyMapping(
      row({
        [EVENT_TIME_ZONE_SOURCE]: null,
        [OWNER_TIME_ZONE_SOURCE]: "Asia/Tokyo",
      }),
      mapping(),
      applyCtx(),
    );
    expect(fromOwner.payload).toMatchObject({
      time_zone__v: "asia_tokyo__sys",
      end_time_local__v: "2025-03-11T06:00:00.000Z",
      end_date__v: "2025-03-11",
    });
    expect(fromOwner.diagnostics).toContainEqual(
      expect.objectContaining({ code: EM_EVENT_TIMEZONE_FROM_OWNER_CODE }),
    );
    const invalid = applyMapping(
      row({ [EVENT_TIME_ZONE_SOURCE]: "Mars/Olympus_Mons" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({ defaultTimezone: "Asia/Tokyo" }),
      }),
    );
    expect(invalid.payload.time_zone__v).toBe("asia_tokyo__sys");
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({
        code: EM_EVENT_TIMEZONE_INVALID_CODE,
        value: "Mars/Olympus_Mons",
      }),
    );
    // value name unknown to the target picklist → omitted, non-fatal
    const unknownName = applyMapping(
      row({ [EVENT_TIME_ZONE_SOURCE]: "Pacific/Auckland" }),
      mapping(),
      applyCtx(),
    );
    expect(unknownName.status).toBe("ok");
    expect(unknownName.payload.time_zone__v).toBeUndefined();
    expect(unknownName.payload.start_time_local__v).toBe(
      "2025-03-11T07:00:00.000Z",
    );
    expect(unknownName.diagnostics).toContainEqual(
      expect.objectContaining({ code: VT_TIMEZONE_VALUE_MISSING_CODE }),
    );
    // country crosswalk em_event.timeZone wins over the derived name
    const crosswalked = applyMapping(
      row({ [EVENT_TIME_ZONE_SOURCE]: "Pacific/Auckland" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: {
            "em_event.timeZone": { "Pacific/Auckland": "asia_tokyo__sys" },
          },
        }),
      }),
    );
    expect(crosswalked.payload.time_zone__v).toBe("asia_tokyo__sys");
  });

  it("falls back to Event_Country_vod__c for country__v and loads stage__v only through stageMap", () => {
    const fallback = applyMapping(
      row({ Country_vod__c: "", Event_Country_vod__c: IDS.countryDE }),
      mapping(),
      applyCtx(),
    );
    expect(fallback.status).toBe("ok");
    expect(fallback.payload.country__v).toBe("V0C000000000102");
    const primaryWins = applyMapping(
      row({ Event_Country_vod__c: IDS.countryDE }),
      mapping(),
      applyCtx(),
    );
    expect(primaryWins.payload.country__v).toBe("V0C000000000101");
    const iso = applyMapping(
      row({ Country_vod__c: "", Event_Country_vod__c: "de" }),
      mapping(),
      applyCtx(),
    );
    expect(iso.payload.country__v).toBe("V0C000000000102");
    expect(iso.payload["country__v.event_country"]).toBeUndefined();
    // country__v required on the target (the y? case): the fallback must
    // satisfy it — a second mapping row would come too late
    const meta = metadata();
    const requiredMeta = {
      ...meta,
      fields: {
        ...meta.fields,
        country__v: { ...meta.fields.country__v, required: true },
      },
    };
    const requiredFallback = applyMapping(
      row({ Country_vod__c: "", Event_Country_vod__c: IDS.countryDE }),
      mapping(),
      applyCtx({ metadata: requiredMeta }),
    );
    expect(requiredFallback.status).toBe("ok");
    expect(requiredFallback.failure).toBeUndefined();
    expect(requiredFallback.payload.country__v).toBe("V0C000000000102");
    const requiredNone = applyMapping(
      row({ Country_vod__c: "", Event_Country_vod__c: "" }),
      mapping(),
      applyCtx({ metadata: requiredMeta }),
    );
    expect(requiredNone.status).toBe("failed");
    expect(requiredNone.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "country__v",
    });
    // unknown country id → unresolved marker (not silently dropped)
    const unknown = applyMapping(
      row({ Country_vod__c: "", Event_Country_vod__c: "zz" }),
      mapping(),
      applyCtx(),
    );
    expect(unknown.payload.country__v).toBeUndefined();
    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({ field: "country__v" }),
    );
    const staged = applyMapping(
      row(),
      mapping({ em_event: { stageMap: { Approved_vod: "planning__v" } } }),
      applyCtx(),
    );
    expect(staged.payload.stage__v).toBe("planning__v");
    const stagedUnknown = applyMapping(
      row({ Status_vod__c: "Closed_vod" }),
      mapping({ em_event: { stageMap: { Approved_vod: "planning__v" } } }),
      applyCtx(),
    );
    expect(stagedUnknown.status).toBe("ok");
    expect(stagedUnknown.payload.stage__v).toBeUndefined();
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [EVENT_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});

describe("em_event custom transforms", () => {
  it("localWallClock handles DST, invalid zones and unparsable instants", () => {
    expect(
      localWallClock("2025-03-10T18:00:00.000Z", "America/New_York"),
    ).toEqual({
      date: "2025-03-10",
      datetime: "2025-03-10T14:00:00",
    });
    expect(
      localWallClock("2025-01-15T18:00:00.000Z", "America/New_York"),
    ).toEqual({
      date: "2025-01-15",
      datetime: "2025-01-15T13:00:00",
    });
    expect(localWallClock("2025-03-10T23:30:00.000Z", "Asia/Tokyo")).toEqual({
      date: "2025-03-11",
      datetime: "2025-03-11T08:30:00",
    });
    expect(localWallClock("2025-03-10T00:30:00.000Z", "UTC")?.datetime).toBe(
      "2025-03-10T00:30:00",
    );
    expect(
      localWallClock("2025-03-10T18:00:00.000Z", "Mars/Olympus_Mons"),
    ).toBeUndefined();
    expect(localWallClock("not-a-date", "UTC")).toBeUndefined();
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Nowhere/Land")).toBe(false);
  });

  it("chooseEventTimezone / eventTimezoneSource honour the prefix and the fallback chain", () => {
    const ctx = {
      country: buildCountryContext({ defaultTimezone: "Europe/Paris" }),
    };
    expect(
      eventTimezoneSource({ Id: EVENT_1, Event_Time_Zone__c: "Asia/Seoul" }),
    ).toBe("Asia/Seoul");
    expect(chooseEventTimezone({ Id: EVENT_1 }, ctx)).toEqual({
      tz: "Europe/Paris",
      origin: "country",
      invalid: [],
    });
    expect(
      chooseEventTimezone(
        { Id: EVENT_1, [OWNER_TIME_ZONE_SOURCE]: "America/Chicago" },
        ctx,
      ),
    ).toMatchObject({ tz: "America/Chicago", origin: "owner" });
    expect(
      chooseEventTimezone(
        {
          Id: EVENT_1,
          [EVENT_TIME_ZONE_SOURCE]: "Bad/Zone",
          [OWNER_TIME_ZONE_SOURCE]: "Worse/Zone",
        },
        ctx,
      ),
    ).toEqual({
      tz: "Europe/Paris",
      origin: "country",
      invalid: ["Bad/Zone", "Worse/Zone"],
    });
    expect(
      chooseEventTimezone(
        { Id: EVENT_1 },
        { country: buildCountryContext({ defaultTimezone: "" }) },
      ),
    ).toMatchObject({ tz: "UTC", origin: "country" });
  });

  it("configurationMapOf normalises 15-char keys and eventConfiguration ignores selector rows", () => {
    expect(configurationMapOf({ configurationMap: false })).toBeUndefined();
    expect(configurationMapOf({})).toBeUndefined();
    expect(
      configurationMapOf({
        configurationMap: { [to15(CONFIG)]: "V1", other: "", x: 3 },
      }),
    ).toEqual({ [CONFIG]: "V1" });
    const selector = buildTransformContext({
      objectKey: "em_event",
      field: {
        source: EM_EVENT_CONFIG_NAME_SOURCE,
        target: "event_configuration__v.name",
      },
    });
    expect(
      eventConfiguration("Speaker Program", { Id: EVENT_1 }, selector),
    ).toBeUndefined();
    const primary = buildTransformContext({
      objectKey: "em_event",
      field: {
        source: "Event_Configuration_vod__c",
        target: "event_configuration__v",
      },
      mapping: {
        options: {
          ...selector.mapping.options,
          configurationMap: { [CONFIG]: "V9" },
        },
      },
    });
    expect(eventConfiguration(to15(CONFIG), { Id: EVENT_1 }, primary)).toEqual({
      value: "V9",
    });
    expect(eventConfiguration("", { Id: EVENT_1 }, primary)).toBeUndefined();
  });

  it("eventStage reads only a configured map", () => {
    const ctx = buildTransformContext({
      objectKey: "em_event",
      field: { source: "Status_vod__c", target: "stage__v" },
    });
    expect(eventStage("Approved_vod", { Id: EVENT_1 }, ctx)).toBeUndefined();
    const mapped = buildTransformContext({
      objectKey: "em_event",
      field: { source: "Status_vod__c", target: "stage__v" },
      mapping: {
        options: {
          ...ctx.mapping.options,
          stageMap: { Approved_vod: "planning__v" },
        },
      },
    });
    expect(eventStage("Approved_vod", { Id: EVENT_1 }, mapped)).toEqual({
      value: "planning__v",
    });
    expect(eventStage("Closed_vod", { Id: EVENT_1 }, mapped)).toBeUndefined();
    expect(eventStage("", { Id: EVENT_1 }, mapped)).toBeUndefined();
  });
});
