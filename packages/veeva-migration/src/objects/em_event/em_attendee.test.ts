import { describe, expect, it } from "vitest";
import {
  ACCOUNT_IS_PERSON_SOURCE,
  ATTENDEE_TYPE_FORMULA_SOURCE,
  ATTENDEE_TYPE_MAP_KEY,
  CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE,
  CONTACT_REF_DROPPED_CODE,
  EM_ATTENDEE_OBJECT_TYPES,
  EM_ATTENDEE_SIGNATURE_BLOB,
  EM_ATTENDEE_STATUS,
  EM_ATTENDEE_TYPE,
  EM_ATTENDEE_WALK_IN_STATUS,
  attendeeType,
  contactAttendee,
  contactRepointedToPersonAccount,
  deriveAttendeeSourceType,
  em_attendee,
} from "./em_attendee";
import { EM_EVENT_OPEN_PREDICATE } from "./em_event";
import { validateObjectModule } from "../types";
import {
  computeCutoffDate,
  materialise,
  resolveCountry,
} from "../../config/resolve";
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
const CUTOFF = computeCutoffDate(NOW, 24);
const ATT_1 = to18("a0A000000000001");
const EVENT_1 = to18("a0E000000000001");
const EVENT_UNKNOWN = to18("a0E000000000009");
const CONTACT_1 = "003000000000001AAA";

function config(countries: Record<string, unknown> = { US: {} }, objects = {}) {
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
    countries,
    objects,
  });
}

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
      "em_attendee__v",
      [
        ref("event__v", "em_event__v", true),
        ref("account__v", "account__v"),
        ref("user__v", "user__sys"),
        {
          name: "attendee_type__v",
          type: "Picklist",
          picklist: "attendee_type__v",
        },
        { name: "attendee_name__v", type: "String", max_length: 255 },
        { name: "first_name__v", type: "String", max_length: 80 },
        { name: "last_name__v", type: "String", max_length: 80 },
        { name: "email__v", type: "String", max_length: 255 },
        { name: "zip__v", type: "String", max_length: 20 },
        {
          name: "em_attendee_status__v",
          type: "Picklist",
          picklist: "em_attendee_status__v",
          required: true,
        },
        {
          name: "walk_in_status__v",
          type: "Picklist",
          picklist: "walk_in_status__v",
        },
        {
          name: "rsvp_status__v",
          type: "Picklist",
          picklist: "rsvp_status__v",
        },
        { name: "did_attend__v", type: "Boolean" },
        { name: "meal_opt_in__v", type: "Boolean" },
        { name: "signature__v", type: "LongText" },
        { name: "signature_datetime__v", type: "DateTime" },
        { name: "external_id__v", type: "String", max_length: 100 },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        ref("ownerid__v", "user__sys"),
      ],
      { objectTypes: Object.values(EM_ATTENDEE_OBJECT_TYPES) },
    ),
    {
      picklists: {
        attendee_type__v: [...new Set(Object.values(EM_ATTENDEE_TYPE))],
        em_attendee_status__v: Object.values(EM_ATTENDEE_STATUS),
        walk_in_status__v: Object.values(EM_ATTENDEE_WALK_IN_STATUS),
        rsvp_status__v: ["accepted__v", "declined__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    em_event: { [EVENT_1]: "V0E000000000001" },
    account: { [IDS.account1]: "V0A000000000001" },
  },
  { [SAMPLE_USER_ID]: 11 },
);

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: ATT_1,
    IsDeleted: false,
    Name: "Jane Doe",
    "RecordType.DeveloperName": "Attendee_vod",
    Event_vod__c: EVENT_1,
    Account_vod__c: IDS.account1,
    User_vod__c: "",
    Contact_vod__c: "",
    Attendee_Type_vod__c: "Person_Account_vod",
    Attendee_Name_vod__c: "Dr Jane Doe",
    First_Name_vod__c: "Jane",
    Last_Name_vod__c: "Doe",
    Email_vod__c: "jane@example.org",
    Zip_vod__c: "02110",
    Status_vod__c: "Invited_vod",
    Walk_In_Status_vod__c: "Needs_Reconciliation_vod",
    RSVP_Status_vod__c: "Accepted_vod",
    Did_Attend_vod__c: "true",
    Meal_Opt_In_vod__c: "false",
    Signature_vod__c: "iVBORw0KGgoAAAANSUhEUg==",
    Signature_Datetime_vod__c: "2025-03-10T20:15:00.000Z",
    External_ID_vod__c: "ATT-001",
    Mobile_ID_vod__c: "7d2c5f4e-a001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-02-04T10:11:12.000Z",
    LastModifiedDate: "2025-03-11T03:04:05.000Z",
    SystemModstamp: "2025-03-11T03:04:05.000Z",
    ...extra,
  };
}

function mapping(objects: Record<string, unknown> = {}) {
  const cfg = config({ US: {} }, objects);
  return materialise(em_attendee, resolveCountry(cfg, "US"), cfg, {
    now: NOW,
  });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: buildCountryContext(),
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: em_attendee.custom,
    ...overrides,
  };
}

describe("em_attendee module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_attendee).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(em_attendee.source).toBe("EM_Attendee_vod__c");
    expect(em_attendee.target).toBe("em_attendee__v");
    expect(em_attendee.targetEvidence).toBe("OBS");
    expect(em_attendee.scope).toEqual({
      kind: "via-parent",
      parentKey: "em_event",
      parentField: "Event_vod__r.Start_Time_vod__c",
      type: "datetime",
      retentionFamily: "tov",
    });
    expect(em_attendee.countryOf).toEqual([
      { kind: "parent", key: "em_event", field: "Event_vod__c" },
    ]);
    expect(em_attendee.dependsOn.slice(0, 3)).toEqual([
      "em_event",
      "account",
      "user",
    ]);
    expect(em_attendee.dependsOn).toContain("product");
    expect(em_attendee.dependsOn).toContain("em_catalog");
    expect(em_attendee.selfRefs).toEqual([]);
    expect(em_attendee.deletePolicy).toBe("ignore");
    expect(em_attendee.inactivate).toEqual([]);
    expect(em_attendee.createPolicy).toBe("create");
    expect(em_attendee.load.noTriggers).toBe(true);
    expect(em_attendee.objectTypes).toEqual({ Attendee_vod: "attendee__v" });
    expect(em_attendee.states).toEqual({});
    expect(em_attendee.blobs).toEqual({ signature: "optional" });
    expect(em_attendee.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      "natural_key",
      "natural_key",
    ]);
    // §3.3 `(event__v, account__v | user__v)` — two pairs, since exactly one
    // of account/user is ever set and a rule needs every key populated
    expect(em_attendee.match[3].keys).toEqual([
      { target: "event__v", source: "Event_vod__c" },
      { target: "account__v", source: "Account_vod__c" },
    ]);
    expect(em_attendee.match[4].keys).toEqual([
      { target: "event__v", source: "Event_vod__c" },
      { target: "user__v", source: "User_vod__c" },
    ]);
    expect(em_attendee.optionDefaults).toEqual({
      personAccountTypeLookup: false,
    });
    expect(em_attendee.notes).not.toContain("STUB");
  });

  it("carries every §6.3.23 row with its transform, requirement and evidence", () => {
    const byTarget = new Map(em_attendee.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "object_type__v.api_name__v",
      "event__v",
      "account__v",
      "user__v",
      "account__v.contact",
      "attendee_type__v",
      "attendee_type__v.formula",
      "attendee_type__v.account",
      "attendee_name__v",
      "first_name__v",
      "last_name__v",
      "title__v",
      "email__v",
      "phone__v",
      "address_line_1__v",
      "address_line_2__v",
      "city__v",
      "zip__v",
      "furigana__v",
      "credentials__v",
      "organization__v",
      "meal_preference__v",
      "prescriber__v",
      "state_province__v",
      "country__v",
      "em_attendee_status__v",
      "walk_in_status__v",
      "online_registration_status__v",
      "rsvp_status__v",
      "did_attend__v",
      "meal_opt_in__v",
      "meal_consumed__v",
      "start_time__v",
      "end_time__v",
      "signature__v",
      "signature_datetime__v",
      "signee__v",
      "external_id__v",
      "stub_mobile_id__v",
      "stub_sfdc_id__v",
      "vessel_number__v",
      "walk_in_reference_id__v",
      "entity_reference_id__v",
      "registration_disclaimer__v",
      "hcp__v",
      "employed__v",
      "profile_type__v",
      "postal_code__v",
      "address__v",
      "role__v",
      "product__v",
      "topic__v",
      "created_by__v",
      "modified_by__v",
      "ownerid__v",
      "mobile_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("event__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "ref", objectKey: "em_event" },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      required: "y?",
      transform: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("user__v")).toMatchObject({
      required: "y?",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("account__v.contact")).toMatchObject({
      source: "Contact_vod__c",
      transform: { kind: "custom", fnName: "contactAttendee" },
    });
    // primary row keyed on Id (never calculated, never dropped by preflight);
    // the formula is a selector row that preflight may drop
    expect(byTarget.get("attendee_type__v")).toMatchObject({
      source: "Id",
      required: "y?",
      transform: { kind: "custom", fnName: "attendeeType" },
    });
    expect(byTarget.get("attendee_type__v.formula")).toMatchObject({
      source: ATTENDEE_TYPE_FORMULA_SOURCE,
      optionalSource: true,
      transform: { kind: "custom", fnName: "attendeeType" },
    });
    expect(byTarget.get("attendee_type__v.account")).toMatchObject({
      source: ACCOUNT_IS_PERSON_SOURCE,
      optionalSource: true,
      enabledBy: "personAccountTypeLookup",
    });
    expect(byTarget.get("zip__v")?.source).toBe("Zip_vod__c");
    expect(byTarget.get("postal_code__v")).toMatchObject({
      source: "Postal_Code_vod__c",
      unverifiedSource: true,
    });
    for (const t of [
      "furigana__v",
      "credentials__v",
      "organization__v",
      "meal_preference__v",
      "prescriber__v",
      "state_province__v",
      "country__v",
    ]) {
      expect(byTarget.get(t)?.evidence, t).toBe("UNV");
      expect(byTarget.get(t)?.countryConfigurable, t).toBe(true);
    }
    expect(byTarget.get("em_attendee_status__v")).toMatchObject({
      required: "Y",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "em_attendee.status" },
    });
    expect(byTarget.get("walk_in_status__v")).toMatchObject({
      evidence: "OBS",
      transform: { kind: "picklist", mapKey: "em_attendee.walkInStatus" },
    });
    expect(byTarget.get("did_attend__v")?.transform).toEqual({ kind: "bool" });
    expect(byTarget.get("start_time__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("signature__v")).toMatchObject({
      evidence: "UNV",
      blobName: EM_ATTENDEE_SIGNATURE_BLOB,
      transform: { kind: "deferredBlob", blobName: "signature" },
    });
    expect(byTarget.get("signee__v")?.transform).toEqual({ kind: "text" });
    expect(byTarget.get("external_id__v")?.evidence).toBe("OBS");
    expect(byTarget.get("registration_disclaimer__v")).toMatchObject({
      evidence: "DOC",
      transform: { kind: "longtext" },
    });
    for (const t of [
      "hcp__v",
      "employed__v",
      "profile_type__v",
      "postal_code__v",
      "address__v",
      "role__v",
      "product__v",
      "topic__v",
    ]) {
      expect(byTarget.get(t)?.unverifiedSource, t).toBe(true);
      expect(byTarget.get(t)?.evidence, t).toBe("OBS");
    }
    expect(byTarget.get("product__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "product",
    });
    expect(byTarget.get("topic__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_catalog",
    });
    expect(em_attendee.picklists["em_attendee.status"]).toEqual(
      EM_ATTENDEE_STATUS,
    );
    expect(em_attendee.picklists[ATTENDEE_TYPE_MAP_KEY]).toEqual(
      EM_ATTENDEE_TYPE,
    );
    for (const f of em_attendee.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is scoped through the parent event (with its open term) and widened by tovRetentionMonths", () => {
    const m = mapping();
    expect(m.scope.spec.kind).toBe("via-parent");
    expect(m.scope.retentionFamily).toBe("tov");
    const built = buildScopePredicate(m.scope, {
      now: NOW,
      parentOpenPredicate: EM_EVENT_OPEN_PREDICATE,
    });
    expect(built.cutoffDate).toBe(CUTOFF);
    expect(built.dateTerm).toBe(
      `Event_vod__r.Start_Time_vod__c >= ${CUTOFF}T00:00:00Z`,
    );
    expect(built.predicate).toBe(
      `(Event_vod__r.Start_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR ((Event_vod__r.End_Time_vod__c >= ${CUTOFF}T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))`,
    );
    const cfg = config({ DE: { scope: { tovRetentionMonths: 60 } } });
    const de = materialise(em_attendee, resolveCountry(cfg, "DE"), cfg, {
      now: NOW,
    });
    expect(de.scope.historyMonths).toBe(60);
    expect(buildScopePredicate(de.scope, { now: NOW }).cutoffDate).toBe(
      computeCutoffDate(NOW, 60),
    );
    // the opt-in selector row is absent by default and present with the flag
    expect(m.fields.some((f) => f.source === ACCOUNT_IS_PERSON_SOURCE)).toBe(
      false,
    );
    expect(
      mapping({ em_attendee: { personAccountTypeLookup: true } }).fields.some(
        (f) => f.source === ACCOUNT_IS_PERSON_SOURCE,
      ),
    ).toBe(true);
  });

  it("transforms an account attendee: parent ref, account ref, explicit type, picklists, blob deferred", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.objectType).toBe("attendee__v");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ATT_1,
      "object_type__v.api_name__v": "attendee__v",
      name__v: "Jane Doe",
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_1 } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      attendee_type__v: "person_account__v",
      attendee_name__v: "Dr Jane Doe",
      first_name__v: "Jane",
      last_name__v: "Doe",
      email__v: "jane@example.org",
      zip__v: "02110",
      em_attendee_status__v: "invited__v",
      walk_in_status__v: "needs_reconciliation__v",
      rsvp_status__v: "accepted__v",
      did_attend__v: true,
      meal_opt_in__v: false,
      signature_datetime__v: "2025-03-10T20:15:00.000Z",
      external_id__v: "ATT-001",
      mobile_id__v: "7d2c5f4e-a001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.user__v).toBeUndefined();
    expect(r.payload.signature__v).toBeUndefined();
    expect(r.payload["account__v.contact"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.blobs).toEqual({ signature__v: "iVBORw0KGgoAAAANSUhEUg==" });
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "event__v",
      targetObjectKey: "em_event",
      targetSfdcId: EVENT_1,
    });
  });

  it("handles user and contact attendees (exactly-one rule, derived type, contact dropped or re-pointed)", () => {
    const user = applyMapping(
      row({
        Account_vod__c: "",
        User_vod__c: SAMPLE_USER_ID,
        Attendee_Type_vod__c: "",
      }),
      mapping(),
      applyCtx(),
    );
    expect(user.status).toBe("ok");
    expect(user.payload.user__v).toEqual({ $user: SAMPLE_USER_ID });
    expect(user.payload.account__v).toBeUndefined();
    expect(user.payload.attendee_type__v).toBe("user__v");

    const contact = applyMapping(
      row({
        Account_vod__c: "",
        Contact_vod__c: CONTACT_1,
        Attendee_Type_vod__c: "",
      }),
      mapping(),
      applyCtx(),
    );
    expect(contact.status).toBe("ok");
    expect(contact.payload.account__v).toBeUndefined();
    expect(contact.payload.attendee_type__v).toBe("contact__v");
    expect(contact.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "contact_ref_dropped",
        field: "account__v",
        code: CONTACT_REF_DROPPED_CODE,
        value: CONTACT_1,
      }),
    );

    const mapped = applyMapping(
      row({
        Account_vod__c: "",
        Contact_vod__c: CONTACT_1,
        Attendee_Type_vod__c: "",
      }),
      mapping(),
      applyCtx({
        ids: buildIdResolver(
          {
            em_event: { [EVENT_1]: "V0E000000000001" },
            account: { [CONTACT_1]: "V0A000000000077" },
          },
          { [SAMPLE_USER_ID]: 11 },
        ),
      }),
    );
    expect(mapped.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: CONTACT_1 },
    });
    expect(mapped.diagnostics).toContainEqual(
      expect.objectContaining({ code: CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE }),
    );
    // re-pointed to a person account → typed as one, even against the formula
    expect(mapped.payload.attendee_type__v).toBe("person_account__v");
    const mappedFormula = applyMapping(
      row({
        Account_vod__c: "",
        Contact_vod__c: CONTACT_1,
        Attendee_Type_vod__c: "Contact_vod",
      }),
      mapping(),
      applyCtx({
        ids: buildIdResolver(
          {
            em_event: { [EVENT_1]: "V0E000000000001" },
            account: { [CONTACT_1]: "V0A000000000077" },
          },
          { [SAMPLE_USER_ID]: 11 },
        ),
      }),
    );
    expect(mappedFormula.payload.attendee_type__v).toBe("person_account__v");
    // account set → the contact column is ignored, no drop counted
    const both = applyMapping(
      row({ Contact_vod__c: CONTACT_1 }),
      mapping(),
      applyCtx(),
    );
    expect(
      both.diagnostics.some((d) => d.code === CONTACT_REF_DROPPED_CODE),
    ).toBe(false);
    // business account derived when the formula is empty; person account with the opt-in flag
    const business = applyMapping(
      row({ Attendee_Type_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(business.payload.attendee_type__v).toBe("business_account__v");
    const person = applyMapping(
      row({ Attendee_Type_vod__c: "", [ACCOUNT_IS_PERSON_SOURCE]: "true" }),
      mapping({ em_attendee: { personAccountTypeLookup: true } }),
      applyCtx(),
    );
    expect(person.payload.attendee_type__v).toBe("person_account__v");
    expect(person.payload["attendee_type__v.account"]).toBeUndefined();
    expect(person.payload["attendee_type__v.formula"]).toBeUndefined();
  });

  it("still sets attendee_type__v when preflight dropped the calculated formula row", () => {
    // preflight drops any row whose source is calculated (SF_FIELD_CALCULATED)
    // and the column is then never selected — the primary row must not
    // depend on it
    const m = mapping();
    const dropped = {
      ...m,
      fields: m.fields.filter((f) => f.target !== "attendee_type__v.formula"),
    };
    expect(dropped.fields.some((f) => f.target === "attendee_type__v")).toBe(
      true,
    );
    const base = row();
    delete base[ATTENDEE_TYPE_FORMULA_SOURCE];
    const account = applyMapping(base, dropped, applyCtx());
    expect(account.status).toBe("ok");
    expect(account.payload.attendee_type__v).toBe("business_account__v");
    const user = applyMapping(
      { ...base, Account_vod__c: "", User_vod__c: SAMPLE_USER_ID },
      dropped,
      applyCtx(),
    );
    expect(user.payload.attendee_type__v).toBe("user__v");
    const contact = applyMapping(
      { ...base, Account_vod__c: "", Contact_vod__c: CONTACT_1 },
      dropped,
      applyCtx(),
    );
    expect(contact.payload.attendee_type__v).toBe("contact__v");
    // the formula wins when its column was selected
    const withFormula = applyMapping(
      { ...base, Attendee_Type_vod__c: "Group_Account_vod" },
      mapping(),
      applyCtx(),
    );
    expect(withFormula.payload.attendee_type__v).toBe("business_account__v");
    expect(withFormula.payload["attendee_type__v.formula"]).toBeUndefined();
    // required on the target → still satisfied without the formula column
    const meta = metadata();
    const required = applyMapping(
      base,
      dropped,
      applyCtx({
        metadata: {
          ...meta,
          fields: {
            ...meta.fields,
            attendee_type__v: {
              ...meta.fields.attendee_type__v,
              required: true,
            },
          },
        },
      }),
    );
    expect(required.status).toBe("ok");
    expect(required.payload.attendee_type__v).toBe("business_account__v");
  });

  it("reports an unresolved required parent as pending_fk and applies status crosswalks / policies", () => {
    const pending = applyMapping(
      row({ Event_vod__c: EVENT_UNKNOWN }),
      mapping(),
      applyCtx(),
    );
    expect(pending.status).toBe("pending_fk");
    expect(pending.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_UNKNOWN },
    });
    expect(pending.unresolvedRequiredFks).toEqual([
      { field: "event__v", objectKey: "em_event", sfdcId: EVENT_UNKNOWN },
    ]);
    const missing = applyMapping(
      row({ Status_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "em_attendee_status__v",
    });
    const overlay = applyMapping(
      row({ Status_vod__c: "No_Show_vod" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: { "em_attendee.status": { No_Show_vod: "cancelled__v" } },
        }),
      }),
    );
    expect(overlay.status).toBe("ok");
    expect(overlay.payload.em_attendee_status__v).toBe("cancelled__v");
    const bad = applyMapping(
      row({ Status_vod__c: "No_Show_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("em_attendee_status__v");
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [ATT_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});

describe("em_attendee custom transforms", () => {
  const base = (): SourceRow => ({ Id: ATT_1 });

  it("deriveAttendeeSourceType follows user → account (person/business) → contact", () => {
    expect(deriveAttendeeSourceType(base())).toBeUndefined();
    expect(
      deriveAttendeeSourceType({ ...base(), User_vod__c: SAMPLE_USER_ID }),
    ).toBe("User_vod");
    expect(
      deriveAttendeeSourceType({
        ...base(),
        User_vod__c: SAMPLE_USER_ID,
        Account_vod__c: IDS.account1,
      }),
    ).toBe("User_vod");
    expect(
      deriveAttendeeSourceType({ ...base(), Account_vod__c: IDS.account1 }),
    ).toBe("Business_Account_vod");
    expect(
      deriveAttendeeSourceType({
        ...base(),
        Account_vod__c: IDS.account1,
        [ACCOUNT_IS_PERSON_SOURCE]: true,
      }),
    ).toBe("Person_Account_vod");
    expect(
      deriveAttendeeSourceType({
        ...base(),
        Account_vod__c: IDS.account1,
        [ACCOUNT_IS_PERSON_SOURCE]: "false",
      }),
    ).toBe("Business_Account_vod");
    expect(
      deriveAttendeeSourceType({ ...base(), Contact_vod__c: CONTACT_1 }),
    ).toBe("Contact_vod");
  });

  it("attendeeType crosswalks the formula value and is silent on selector rows", () => {
    const ctx = buildTransformContext({
      objectKey: "em_attendee",
      field: { source: "Id", target: "attendee_type__v" },
      targetField: {
        type: "picklist",
        picklistValues: [
          "person_account__v",
          "business_account__v",
          "user__v",
          "contact__v",
        ],
      },
      mapping: {
        picklists: { [ATTENDEE_TYPE_MAP_KEY]: { ...EM_ATTENDEE_TYPE } },
      },
    });
    const formula = (v: string, extra: Record<string, unknown> = {}) => ({
      ...base(),
      [ATTENDEE_TYPE_FORMULA_SOURCE]: v,
      ...extra,
    });
    expect(attendeeType(ATT_1, formula("Group_Account_vod"), ctx)).toEqual({
      value: "business_account__v",
    });
    expect(
      attendeeType(ATT_1, { ...base(), User_vod__c: SAMPLE_USER_ID }, ctx),
    ).toEqual({
      value: "user__v",
    });
    expect(attendeeType(ATT_1, base(), ctx)).toBeUndefined();
    expect(attendeeType(ATT_1, formula("Robot_vod"), ctx)).toMatchObject({
      omit: true,
      diagnostic: { kind: "unmapped_picklist", fatal: true },
    });
    // an overlay that keeps the formula as the row source still works
    const legacyLayout = {
      ...ctx,
      field: { ...ctx.field, source: ATTENDEE_TYPE_FORMULA_SOURCE },
    };
    expect(attendeeType("User_vod", base(), legacyLayout)).toEqual({
      value: "user__v",
    });
    // contact re-pointed to a person account → person_account__v
    const repointed = buildTransformContext({
      objectKey: "em_attendee",
      field: { source: "Id", target: "attendee_type__v" },
      targetField: ctx.targetField,
      mapping: ctx.mapping,
      ids: buildIdResolver({ account: { [CONTACT_1]: "V0A000000000077" } }),
    });
    expect(
      attendeeType(
        ATT_1,
        formula("Contact_vod", { Contact_vod__c: CONTACT_1 }),
        repointed,
      ),
    ).toEqual({ value: "person_account__v" });
    expect(
      contactRepointedToPersonAccount(
        { ...base(), Contact_vod__c: CONTACT_1 },
        repointed,
      ),
    ).toBe(true);
    expect(
      contactRepointedToPersonAccount(
        { ...base(), Contact_vod__c: CONTACT_1 },
        ctx,
      ),
    ).toBe(false);
    expect(
      contactRepointedToPersonAccount(
        { ...base(), Contact_vod__c: CONTACT_1, Account_vod__c: IDS.account1 },
        repointed,
      ),
    ).toBe(false);
    const selector = buildTransformContext({
      objectKey: "em_attendee",
      field: {
        source: ACCOUNT_IS_PERSON_SOURCE,
        target: "attendee_type__v.account",
      },
    });
    expect(
      attendeeType(
        "true",
        { ...base(), Account_vod__c: IDS.account1 },
        selector,
      ),
    ).toBeUndefined();
  });

  it("contactAttendee drops unknown contacts, re-points mapped ones and validates the id", () => {
    const ctx = buildTransformContext({
      objectKey: "em_attendee",
      field: { source: "Contact_vod__c", target: "account__v.contact" },
    });
    expect(contactAttendee("", base(), ctx)).toBeUndefined();
    expect(
      contactAttendee(
        CONTACT_1,
        { ...base(), Account_vod__c: IDS.account1 },
        ctx,
      ),
    ).toBeUndefined();
    expect(contactAttendee(CONTACT_1, base(), ctx)).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "contact_ref_dropped",
        code: CONTACT_REF_DROPPED_CODE,
        value: CONTACT_1,
      },
    });
    expect(contactAttendee("not-an-id", base(), ctx)).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "INVALID_ID" },
    });
    expect(contactAttendee(IDS.account1, base(), ctx)).toMatchObject({
      diagnostic: { code: "INVALID_ID" },
    });
    const mapped = buildTransformContext({
      objectKey: "em_attendee",
      field: { source: "Contact_vod__c", target: "account__v.contact" },
      ids: buildIdResolver({ account: { [CONTACT_1]: "V0A000000000077" } }),
    });
    expect(contactAttendee(CONTACT_1, base(), mapped)).toMatchObject({
      value: { $fk: { object: "account", sfdcId: CONTACT_1 } },
      targetField: "account__v",
      diagnostic: { code: CONTACT_MAPPED_TO_PERSON_ACCOUNT_CODE },
    });
  });
});
