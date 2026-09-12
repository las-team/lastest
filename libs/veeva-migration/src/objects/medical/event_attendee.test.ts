import { describe, expect, it } from "vitest";
import {
  CONTACT_REF_DROPPED_CODE,
  CONTACT_TO_PERSON_ACCOUNT_CODE,
  EVENT_ATTENDEE_ACCOUNT_FIELD,
  EVENT_ATTENDEE_CONTACT_FIELD,
  EVENT_ATTENDEE_PARENT_FIELD,
  EVENT_ATTENDEE_PARENT_SCOPE_PATH,
  EVENT_ATTENDEE_POSITION,
  EVENT_ATTENDEE_STATUS,
  EVENT_ATTENDEE_USER_FIELD,
  contactRefDropped,
  event_attendee,
} from "./event_attendee";
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
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const ATTENDEE_ID = to18("a0N000000000001");
const EVENT_ID = to18("a0M000000000001");
const EVENT_ID_2 = to18("a0M000000000002");
const EM_ATTENDEE_ID = to18("a0F000000000001");
const EM_SPEAKER_ID = to18("a0G000000000001");
const CONTACT_ID = to18("003000000000001");

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

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("event_attendee__v", [
      {
        name: "medical_event__v",
        type: "Object",
        object: { name: "medical_event__v" },
        required: true,
      },
      { name: "account__v", type: "Object", object: { name: "account__v" } },
      { name: "user__v", type: "Object", object: { name: "user__sys" } },
      {
        name: "em_attendee__v",
        type: "Object",
        object: { name: "em_attendee__v" },
      },
      {
        name: "em_event_speaker__v",
        type: "Object",
        object: { name: "em_event_speaker__v" },
      },
      {
        name: "event_attendee_status__v",
        type: "Picklist",
        picklist: "event_attendee_status__v",
      },
      { name: "position__v", type: "Picklist", picklist: "position__v" },
      {
        name: "walk_in_status__v",
        type: "Picklist",
        picklist: "walk_in_status__v",
      },
      { name: "start_date__v", type: "Date" },
      { name: "talk_title__v", type: "String", max_length: 255 },
      { name: "first_name__v", type: "String", max_length: 80 },
      { name: "last_name__v", type: "String", max_length: 80 },
      { name: "email__v", type: "String", max_length: 80 },
      { name: "zip__v", type: "String", max_length: 20 },
      { name: "expense_amount__v", type: "Number", scale: 2 },
      { name: "signature__v", type: "LongText", max_length: 131072 },
      { name: "signature_datetime__v", type: "DateTime" },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        event_attendee_status__v: Object.values(EVENT_ATTENDEE_STATUS),
        position__v: Object.values(EVENT_ATTENDEE_POSITION),
        walk_in_status__v: ["walk_in__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: ATTENDEE_ID,
    IsDeleted: false,
    Name: "Jane Doe",
    [EVENT_ATTENDEE_PARENT_FIELD]: EVENT_ID,
    [EVENT_ATTENDEE_PARENT_SCOPE_PATH]: "2025-03-04",
    [EVENT_ATTENDEE_ACCOUNT_FIELD]: IDS.account1,
    [EVENT_ATTENDEE_USER_FIELD]: SAMPLE_USER_ID,
    EM_Attendee_vod__c: EM_ATTENDEE_ID,
    EM_Event_Speaker_vod__c: EM_SPEAKER_ID,
    Status_vod__c: "Did Not Attend",
    Position_vod__c: "Chair_Person_vod",
    Walk_In_Status_vod__c: "Walk_In_vod",
    Start_Date_vod__c: "2025-03-04",
    Talk_Title_vod__c: "Lipids in 2025",
    First_Name_vod__c: "Jane",
    Last_Name_vod__c: "Doe",
    Email_vod__c: "jane@example.org",
    Zip_vod__c: "02139",
    Expense_Amount_vod__c: "12.5",
    Signature_vod__c: "iVBORw0KGgo=",
    Signature_Datetime_vod__c: "2025-03-04T20:00:00.000Z",
    Mobile_ID_vod__c: "7d2c5f4e-ea-0001",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-04T21:00:00.000Z",
    LastModifiedDate: "2025-03-04T21:00:00.000Z",
    SystemModstamp: "2025-03-04T21:00:00.000Z",
    ...extra,
  };
}

function mapping() {
  return materialise(event_attendee, resolveCountry(config, "US"), config, {
    now: NOW,
  });
}

function ids(extraAccounts: Record<string, string> = {}) {
  return buildIdResolver(
    {
      medical_event: { [EVENT_ID]: "V0M1" },
      account: { [IDS.account1]: "V0A1", ...extraAccounts },
      em_attendee: { [EM_ATTENDEE_ID]: "V0F1" },
      em_event_speaker: { [EM_SPEAKER_ID]: "V0G1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: buildCountryContext(),
    metadata: metadata(),
    ids: ids(),
    migrationUserId: 1,
    runMode: "init" as const,
    custom: event_attendee.custom,
    ...overrides,
  };
}

describe("event_attendee module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(event_attendee).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.27 / §3.3 / §4.4 catalogue facts", () => {
    expect(event_attendee.source).toBe("Event_Attendee_vod__c");
    expect(event_attendee.target).toBe("event_attendee__v");
    expect(event_attendee.targetEvidence).toBe("OBS");
    expect(event_attendee.scope).toEqual({
      kind: "via-parent",
      parentKey: "medical_event",
      parentField: "Medical_Event_vod__r.Start_Date_vod__c",
      type: "date",
    });
    expect(event_attendee.countryOf).toEqual([
      { kind: "parent", key: "medical_event", field: "Medical_Event_vod__c" },
    ]);
    expect(event_attendee.dependsOn).toEqual([
      "medical_event",
      "account",
      "user",
      "em_attendee",
      "em_event_speaker",
    ]);
    expect(event_attendee.selfRefs).toEqual([]);
    expect(event_attendee.deletePolicy).toBe("ignore");
    expect(event_attendee.inactivate).toEqual([]);
    expect(event_attendee.createPolicy).toBe("create");
    expect(event_attendee.load.noTriggers).toBe(true);
    expect(event_attendee.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(event_attendee.blobs).toEqual({ signature: "optional" });
    expect(event_attendee.objectTypes).toEqual({});
    // master-detail child: no OwnerId, no statusFromFlag
    expect(event_attendee.blockS.ownerId).toBe(false);
    expect(event_attendee.blockS.statusFromFlag).toBeUndefined();
    expect(event_attendee.notes).not.toContain("STUB");
  });

  it("carries every §6.3.27 row, the explicit status crosswalk and the contact drop", () => {
    const byTarget = new Map(event_attendee.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "medical_event__v",
      "account__v",
      "user__v",
      "account__v.contact",
      "em_attendee__v",
      "em_event_speaker__v",
      "event_attendee_status__v",
      "position__v",
      "walk_in_status__v",
      "start_date__v",
      "talk_title__v",
      "first_name__v",
      "last_name__v",
      "email__v",
      "address_line_1__v",
      "city__v",
      "zip__v",
      "expense_amount__v",
      "expense_post_status__v",
      "cobrowse_attendee_url__v",
      "signature__v",
      "signature_datetime__v",
      "mobile_id__v",
      "local_currency__sys",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.get("medical_event__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "medical_event" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "y?",
    });
    expect(byTarget.get("user__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
    });
    expect(byTarget.get("account__v.contact")).toMatchObject({
      source: EVENT_ATTENDEE_CONTACT_FIELD,
      transform: { kind: "custom", fnName: "contactRefDropped" },
      required: "n",
    });
    expect(byTarget.get("em_attendee__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_attendee",
    });
    expect(byTarget.get("em_event_speaker__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_event_speaker",
    });
    expect(byTarget.get("event_attendee_status__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "event_attendee.status",
    });
    expect(byTarget.get("position__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "event_attendee.position",
    });
    expect(byTarget.get("signature__v")).toMatchObject({
      transform: { kind: "deferredBlob", blobName: "signature" },
      blobName: "signature",
    });
    expect(byTarget.get("signature_datetime__v")?.transform).toEqual({
      kind: "datetime",
    });
    // inferred name/contact/address/cobrowse sources never block preflight
    for (const target of [
      "first_name__v",
      "last_name__v",
      "email__v",
      "zip__v",
      "cobrowse_attendee_url__v",
    ])
      expect(byTarget.get(target), target).toMatchObject({
        unverifiedSource: true,
        optionalSource: true,
      });
    expect(event_attendee.picklists["event_attendee.status"]).toEqual(
      EVENT_ATTENDEE_STATUS,
    );
    expect(Object.keys(EVENT_ATTENDEE_STATUS)).toHaveLength(10);
    expect(event_attendee.picklists["event_attendee.position"]).toEqual(
      EVENT_ATTENDEE_POSITION,
    );
    for (const f of event_attendee.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a row: parent ref, account/user, EM links, crosswalks, blob deferred", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ATTENDEE_ID,
      name__v: "Jane Doe",
      medical_event__v: { $fk: { object: "medical_event", sfdcId: EVENT_ID } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      user__v: { $user: SAMPLE_USER_ID },
      em_attendee__v: {
        $fk: { object: "em_attendee", sfdcId: EM_ATTENDEE_ID },
      },
      em_event_speaker__v: {
        $fk: { object: "em_event_speaker", sfdcId: EM_SPEAKER_ID },
      },
      event_attendee_status__v: "did_not_attend__v",
      position__v: "chair_person__v",
      walk_in_status__v: "walk_in__v",
      start_date__v: "2025-03-04",
      talk_title__v: "Lipids in 2025",
      first_name__v: "Jane",
      last_name__v: "Doe",
      email__v: "jane@example.org",
      zip__v: "02139",
      expense_amount__v: 12.5,
      signature_datetime__v: "2025-03-04T20:00:00.000Z",
      mobile_id__v: "7d2c5f4e-ea-0001",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.signature__v).toBeUndefined();
    expect(r.blobs).toEqual({ signature__v: "iVBORw0KGgo=" });
    expect(r.payload.ownerid__v).toBeUndefined();
    expect(r.payload["account__v.contact"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(
      r.fkEdges
        .filter((e) => e.targetObjectKey !== "user")
        .map((e) => e.field)
        .sort(),
    ).toEqual([
      "account__v",
      "em_attendee__v",
      "em_event_speaker__v",
      "medical_event__v",
    ]);
  });

  it("reports an unresolved parent medical event as pending_fk with the deferred ref kept", () => {
    const r = applyMapping(
      row({ [EVENT_ATTENDEE_PARENT_FIELD]: EVENT_ID_2 }),
      mapping(),
      applyCtx(),
    );
    expect(r.status).toBe("pending_fk");
    expect(r.payload.medical_event__v).toEqual({
      $fk: { object: "medical_event", sfdcId: EVENT_ID_2 },
    });
    expect(r.unresolvedRequiredFks).toEqual([
      {
        field: "medical_event__v",
        objectKey: "medical_event",
        sfdcId: EVENT_ID_2,
      },
    ]);
    const missing = applyMapping(
      row({ [EVENT_ATTENDEE_PARENT_FIELD]: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "medical_event__v",
    });
  });

  it("drops a contact attendee with CONTACT_REF_DROPPED, or re-points it to a person account", () => {
    const dropped = applyMapping(
      row({
        [EVENT_ATTENDEE_ACCOUNT_FIELD]: "",
        [EVENT_ATTENDEE_CONTACT_FIELD]: CONTACT_ID,
      }),
      mapping(),
      applyCtx(),
    );
    expect(dropped.status).toBe("ok");
    expect(dropped.payload.account__v).toBeUndefined();
    expect(dropped.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "contact_ref_dropped",
        code: CONTACT_REF_DROPPED_CODE,
        value: CONTACT_ID,
      }),
    );
    const bridged = applyMapping(
      row({
        [EVENT_ATTENDEE_ACCOUNT_FIELD]: "",
        [EVENT_ATTENDEE_CONTACT_FIELD]: CONTACT_ID,
      }),
      mapping(),
      applyCtx({ ids: ids({ [CONTACT_ID]: "V0A9" }) }),
    );
    expect(bridged.status).toBe("ok");
    expect(bridged.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: CONTACT_ID },
    });
    expect(bridged.diagnostics).toContainEqual(
      expect.objectContaining({ code: CONTACT_TO_PERSON_ACCOUNT_CODE }),
    );
    // the account wins when both are present
    const both = applyMapping(
      row({ [EVENT_ATTENDEE_CONTACT_FIELD]: CONTACT_ID }),
      mapping(),
      applyCtx({ ids: ids({ [CONTACT_ID]: "V0A9" }) }),
    );
    expect(both.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    expect(both.diagnostics).toContainEqual(
      expect.objectContaining({ code: CONTACT_REF_DROPPED_CODE }),
    );
  });

  it("fails an unmapped attendee status under the error policy and accepts overlays", () => {
    const bad = applyMapping(
      row({ Status_vod__c: "Maybe" }),
      mapping(),
      applyCtx(),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("event_attendee_status__v");
    const overlay = applyMapping(
      row({ Status_vod__c: "Maybe" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: { "event_attendee.status": { Maybe: "invited__v" } },
        }),
      }),
    );
    expect(overlay.status).toBe("ok");
    expect(overlay.payload.event_attendee_status__v).toBe("invited__v");
  });

  it("is scoped through the parent's start date with an explicit cutoff literal", () => {
    const m = mapping();
    expect(m.scope.spec.kind).toBe("via-parent");
    expect(m.scope.cutoffDate).toBe("2024-09-07");
    expect(buildScopePredicate(m.scope, { now: NOW })).toEqual({
      kind: "via-parent",
      cutoffDate: "2024-09-07",
      dateTerm: "Medical_Event_vod__r.Start_Date_vod__c >= 2024-09-07",
      openTerm: undefined,
      predicate: "Medical_Event_vod__r.Start_Date_vod__c >= 2024-09-07",
    });
    expect(m.countryOf).toEqual([
      { kind: "parent", key: "medical_event", field: "Medical_Event_vod__c" },
    ]);
    expect(m.options.blobs).toEqual({ signature: "optional" });
  });
});

describe("event_attendee custom transforms", () => {
  it("contactRefDropped is a pure §3.4 policy", () => {
    const ctx = buildTransformContext({
      objectKey: "event_attendee",
      field: {
        source: EVENT_ATTENDEE_CONTACT_FIELD,
        target: "account__v.contact",
      },
    });
    expect(contactRefDropped("", { Id: ATTENDEE_ID }, ctx)).toBeUndefined();
    expect(
      contactRefDropped(CONTACT_ID, { Id: ATTENDEE_ID }, ctx),
    ).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "contact_ref_dropped",
        code: CONTACT_REF_DROPPED_CODE,
      },
    });
    expect(
      contactRefDropped(IDS.account1, { Id: ATTENDEE_ID }, ctx),
    ).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value", code: "NOT_A_CONTACT_ID" },
    });
    const bridged = buildTransformContext({
      objectKey: "event_attendee",
      field: {
        source: EVENT_ATTENDEE_CONTACT_FIELD,
        target: "account__v.contact",
      },
      ids: buildIdResolver({ account: { [CONTACT_ID]: "V0A9" } }),
    });
    expect(
      contactRefDropped(CONTACT_ID, { Id: ATTENDEE_ID }, bridged),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: CONTACT_ID } },
      targetField: "account__v",
    });
  });
});
