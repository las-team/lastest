import { describe, expect, it } from "vitest";
import {
  CONTRACT_REF_DROPPED_CODE,
  EM_EVENT_SPEAKER_DEFAULT_STATUS,
  EM_EVENT_SPEAKER_OBJECT_TYPES,
  EM_EVENT_SPEAKER_SIGNATURE_BLOB,
  EM_EVENT_SPEAKER_SKIPPED_FORMULAS,
  EM_EVENT_SPEAKER_STATUS,
  SPEAKER_ACCOUNT_FORMULA_SOURCE,
  SPEAKER_ACCOUNT_NOT_EDITABLE_CODE,
  SPEAKER_ACCOUNT_SOURCE,
  contractRefDropped,
  em_event_speaker,
  fromSpeakerAccount,
  speakerStatus,
} from "./em_event_speaker";
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
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CUTOFF = computeCutoffDate(NOW, 24);
const ROW_1 = to18("a0Q000000000001");
const EVENT_1 = to18("a0E000000000001");
const SPEAKER_1 = to18("a0S000000000001");
const SPEAKER_UNKNOWN = to18("a0S000000000009");
const CONTRACT_1 = to18("800000000000001");

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

function metadata(accountEditable = true) {
  const ref = (
    name: string,
    object: string,
    extra: Record<string, unknown> = {},
  ) => ({
    name,
    type: "Object",
    object: { name: object },
    relationship_type: "reference",
    ...extra,
  });
  return resolveMetadata(
    buildVaultMetadata(
      "em_event_speaker__v",
      [
        ref("event__v", "em_event__v", { required: true }),
        ref("speaker__v", "em_speaker__v", { required: true }),
        ref("account__v", "account__v", { editable: accountEditable }),
        {
          name: "em_event_speaker_status__v",
          type: "Picklist",
          picklist: "em_event_speaker_status__v",
          required: true,
        },
        { name: "meal_opt_in__v", type: "Boolean" },
        { name: "meal_consumed__v", type: "Boolean" },
        {
          name: "rsvp_status__v",
          type: "Picklist",
          picklist: "rsvp_status__v",
        },
        { name: "did_attend__v", type: "Boolean" },
        { name: "session_title__v", type: "String", max_length: 255 },
        { name: "start_time__v", type: "DateTime" },
        { name: "signature__v", type: "LongText" },
        { name: "signature_datetime__v", type: "DateTime" },
        { name: "external_id__v", type: "String", max_length: 100 },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        ref("ownerid__v", "user__sys"),
      ],
      { objectTypes: Object.values(EM_EVENT_SPEAKER_OBJECT_TYPES) },
    ),
    {
      picklists: {
        em_event_speaker_status__v: Object.values(EM_EVENT_SPEAKER_STATUS),
        rsvp_status__v: ["accepted__v", "declined__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    em_event: { [EVENT_1]: "V0E000000000001" },
    em_speaker: { [SPEAKER_1]: "V0S000000000001" },
    account: { [IDS.account1]: "V0A000000000001" },
  },
  { [SAMPLE_USER_ID]: 11 },
);

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: ROW_1,
    IsDeleted: false,
    Name: "ES-0001",
    "RecordType.DeveloperName": "Event_Speaker_vod",
    Event_vod__c: EVENT_1,
    Speaker_vod__c: SPEAKER_1,
    Account_vod__c: IDS.account1,
    [SPEAKER_ACCOUNT_SOURCE]: IDS.account1,
    Status_vod__c: "Attended_vod",
    Meal_Opt_In_vod__c: "true",
    Meal_Consumed_vod__c: "false",
    RSVP_Status_vod__c: "Accepted_vod",
    Did_Attend_vod__c: "true",
    Contract_vod__c: CONTRACT_1,
    Session_Title_vod__c: "Advances in therapy",
    Start_Time_vod__c: "2025-03-10T18:30:00.000Z",
    Signature_vod__c: "iVBORw0KGgoAAAANSUhEUg==",
    Signature_Datetime_vod__c: "2025-03-10T20:45:00.000Z",
    External_ID_vod__c: "ES-001",
    Speaker_Name_vod__c: "Dr Jane Doe",
    Credentials_vod__c: "MD",
    Mobile_ID_vod__c: "7d2c5f4e-s001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-02-04T10:11:12.000Z",
    LastModifiedDate: "2025-03-11T03:04:05.000Z",
    SystemModstamp: "2025-03-11T03:04:05.000Z",
    ...extra,
  };
}

function mapping() {
  return materialise(em_event_speaker, resolveCountry(config, "US"), config, {
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
    custom: em_event_speaker.custom,
    ...overrides,
  };
}

describe("em_event_speaker module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_event_speaker).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(em_event_speaker.source).toBe("EM_Event_Speaker_vod__c");
    expect(em_event_speaker.target).toBe("em_event_speaker__v");
    expect(em_event_speaker.targetEvidence).toBe("OBS");
    expect(em_event_speaker.scope).toEqual({
      kind: "via-parent",
      parentKey: "em_event",
      parentField: "Event_vod__r.Start_Time_vod__c",
      type: "datetime",
      retentionFamily: "tov",
    });
    expect(em_event_speaker.countryOf).toEqual([
      { kind: "parent", key: "em_event", field: "Event_vod__c" },
    ]);
    expect(em_event_speaker.dependsOn).toEqual([
      "em_event",
      "em_speaker",
      "account",
    ]);
    expect(em_event_speaker.selfRefs).toEqual([]);
    expect(em_event_speaker.deletePolicy).toBe("ignore");
    expect(em_event_speaker.inactivate).toEqual([]);
    expect(em_event_speaker.createPolicy).toBe("create");
    expect(em_event_speaker.load.noTriggers).toBe(true);
    expect(em_event_speaker.objectTypes).toEqual({
      Event_Speaker_vod: "event_speaker__v",
    });
    expect(em_event_speaker.blobs).toEqual({ signature: "optional" });
    expect(em_event_speaker.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      "natural_key",
    ]);
    expect(em_event_speaker.match[3].keys?.map((k) => k.target)).toEqual([
      "event__v",
      "speaker__v",
    ]);
    expect(em_event_speaker.notes).not.toContain("STUB");
  });

  it("carries every §6.3.24 row with its transform, requirement and evidence", () => {
    const byTarget = new Map(em_event_speaker.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "object_type__v.api_name__v",
      "event__v",
      "speaker__v",
      "account__v",
      "account__v.formula",
      "account__v.speaker",
      "em_event_speaker_status__v",
      "meal_opt_in__v",
      "meal_preference__v",
      "meal_consumed__v",
      "rsvp_status__v",
      "did_attend__v",
      "walk_in_status__v",
      "contract__v",
      "session_title__v",
      "position__v",
      "workplace__v",
      "start_time__v",
      "end_time__v",
      "vessel_number__v",
      "signature__v",
      "signature_datetime__v",
      "external_id__v",
      "stub_mobile_id__v",
      "stub_sfdc_id__v",
      "speaker_name__v",
      "first_name__v",
      "last_name__v",
      "middle_name__v",
      "credentials__v",
      "title__v",
      "suffix__v",
      "nickname__v",
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
    expect(byTarget.get("speaker__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "ref", objectKey: "em_speaker" },
    });
    // primary row keyed on Speaker_vod__c (never calculated, never dropped
    // by preflight); the formula is a selector row that preflight may drop
    expect(byTarget.get("account__v")).toMatchObject({
      source: "Speaker_vod__c",
      required: "n",
      evidence: "OBS",
      transform: { kind: "custom", fnName: "fromSpeakerAccount" },
    });
    expect(byTarget.get("account__v.formula")).toMatchObject({
      source: SPEAKER_ACCOUNT_FORMULA_SOURCE,
      optionalSource: true,
      transform: { kind: "custom", fnName: "fromSpeakerAccount" },
    });
    expect(byTarget.get("account__v.speaker")).toMatchObject({
      source: SPEAKER_ACCOUNT_SOURCE,
      optionalSource: true,
    });
    expect(byTarget.get("em_event_speaker_status__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "custom", fnName: "speakerStatus" },
    });
    expect(byTarget.get("meal_opt_in__v")?.transform).toEqual({ kind: "bool" });
    expect(byTarget.get("meal_preference__v")).toMatchObject({
      evidence: "UNV",
      transform: {
        kind: "picklist",
        mapKey: "em_event_speaker.mealPreference",
      },
    });
    expect(byTarget.get("contract__v")).toMatchObject({
      evidence: "UNV",
      transform: { kind: "custom", fnName: "contractRefDropped" },
    });
    for (const t of [
      "session_title__v",
      "position__v",
      "workplace__v",
      "vessel_number__v",
    ])
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "text" },
      });
    for (const t of ["start_time__v", "end_time__v", "signature_datetime__v"])
      expect(byTarget.get(t), t).toMatchObject({
        evidence: "UNV",
        transform: { kind: "datetime" },
      });
    expect(byTarget.get("signature__v")).toMatchObject({
      evidence: "UNV",
      blobName: EM_EVENT_SPEAKER_SIGNATURE_BLOB,
      transform: { kind: "deferredBlob", blobName: "signature" },
    });
    expect(byTarget.get("external_id__v")?.evidence).toBe("OBS");
    expect(byTarget.get("stub_sfdc_id__v")).toMatchObject({
      evidence: "UNV",
      unverifiedSource: true,
      transform: { kind: "copy" },
    });
    for (const source of EM_EVENT_SPEAKER_SKIPPED_FORMULAS) {
      const f = em_event_speaker.fields.find((x) => x.source === source);
      expect(f, source).toBeDefined();
      expect(f?.transform).toEqual({ kind: "skip" });
      expect(f?.required).toBe("-");
    }
    expect(em_event_speaker.picklists["em_event_speaker.status"]).toEqual(
      EM_EVENT_SPEAKER_STATUS,
    );
    for (const f of em_event_speaker.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is scoped through the parent event and selects the speaker's account column", () => {
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
    expect(built.openTerm).toContain("Event_vod__r.Status_vod__c NOT IN");
    const describe = buildDescribe("EM_Event_Speaker_vod__c", [
      { name: "Name", type: "string" },
      {
        name: "Event_vod__c",
        type: "reference",
        referenceTo: ["EM_Event_vod__c"],
        relationshipName: "Event_vod__r",
      },
      {
        name: "Speaker_vod__c",
        type: "reference",
        referenceTo: ["EM_Speaker_vod__c"],
        relationshipName: "Speaker_vod__r",
      },
      { name: "Account_vod__c", type: "reference", referenceTo: ["Account"] },
      { name: "Status_vod__c", type: "picklist" },
      { name: "Speaker_Name_vod__c", type: "string", calculated: true },
    ]);
    const cols = buildColumnList(m, { describe, columns: [] });
    expect(cols.columns).toContain(SPEAKER_ACCOUNT_SOURCE);
    expect(cols.columns).not.toContain("Speaker_Name_vod__c");
    expect(cols.fkColumns).toContainEqual(
      expect.objectContaining({
        column: "Speaker_vod__c",
        targetObjectKey: "em_speaker",
      }),
    );
  });

  it("transforms a row: refs, account from the speaker, status, contract dropped, formulas skipped, blob deferred", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.objectType).toBe("event_speaker__v");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ROW_1,
      "object_type__v.api_name__v": "event_speaker__v",
      name__v: "ES-0001",
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_1 } },
      speaker__v: { $fk: { object: "em_speaker", sfdcId: SPEAKER_1 } },
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      em_event_speaker_status__v: "attended__v",
      meal_opt_in__v: true,
      meal_consumed__v: false,
      rsvp_status__v: "accepted__v",
      did_attend__v: true,
      session_title__v: "Advances in therapy",
      start_time__v: "2025-03-10T18:30:00.000Z",
      signature_datetime__v: "2025-03-10T20:45:00.000Z",
      external_id__v: "ES-001",
      mobile_id__v: "7d2c5f4e-s001",
      ownerid__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.contract__v).toBeUndefined();
    expect(r.payload.speaker_name__v).toBeUndefined();
    expect(r.payload.credentials__v).toBeUndefined();
    expect(r.payload.signature__v).toBeUndefined();
    expect(r.payload["account__v.speaker"]).toBeUndefined();
    expect(r.payload["account__v.formula"]).toBeUndefined();
    expect(r.blobs).toEqual({ signature__v: "iVBORw0KGgoAAAANSUhEUg==" });
    expect(r.secondPass).toEqual({});
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "contract__v",
        code: CONTRACT_REF_DROPPED_CODE,
        value: CONTRACT_1,
      }),
    );
    expect(r.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account1,
    });
  });

  it("writes account__v only when editable, falls back to the speaker's account, defaults the status", () => {
    const readOnly = applyMapping(
      row(),
      mapping(),
      applyCtx({ metadata: metadata(false) }),
    );
    expect(readOnly.status).toBe("ok");
    expect(readOnly.payload.account__v).toBeUndefined();
    expect(readOnly.diagnostics).toContainEqual(
      expect.objectContaining({ code: SPEAKER_ACCOUNT_NOT_EDITABLE_CODE }),
    );
    const fallback = applyMapping(
      row({ Account_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(fallback.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    const none = applyMapping(
      row({ Account_vod__c: "", [SPEAKER_ACCOUNT_SOURCE]: null }),
      mapping(),
      applyCtx(),
    );
    expect(none.status).toBe("ok");
    expect(none.payload.account__v).toBeUndefined();
    // preflight drops the calculated formula row (SF_FIELD_CALCULATED) and
    // its column is never selected — account__v must still be written
    const m = mapping();
    const dropped = {
      ...m,
      fields: m.fields.filter((f) => f.target !== "account__v.formula"),
    };
    const noFormula = row();
    delete noFormula[SPEAKER_ACCOUNT_FORMULA_SOURCE];
    const editable = applyMapping(noFormula, dropped, applyCtx());
    expect(editable.status).toBe("ok");
    expect(editable.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account1 },
    });
    const notEditable = applyMapping(
      noFormula,
      dropped,
      applyCtx({ metadata: metadata(false) }),
    );
    expect(notEditable.payload.account__v).toBeUndefined();
    expect(notEditable.diagnostics).toContainEqual(
      expect.objectContaining({ code: SPEAKER_ACCOUNT_NOT_EDITABLE_CODE }),
    );
    const defaulted = applyMapping(
      row({ Status_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(defaulted.status).toBe("ok");
    expect(defaulted.payload.em_event_speaker_status__v).toBe(
      EM_EVENT_SPEAKER_DEFAULT_STATUS,
    );
    const unmapped = applyMapping(
      row({ Status_vod__c: "No_Show_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(unmapped.status).toBe("failed");
    expect(unmapped.failure?.field).toBe("em_event_speaker_status__v");
    const overlay = applyMapping(
      row({ Status_vod__c: "No_Show_vod" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: {
            "em_event_speaker.status": { No_Show_vod: "cancelled__v" },
          },
        }),
      }),
    );
    expect(overlay.payload.em_event_speaker_status__v).toBe("cancelled__v");
  });

  it("reports an unresolved required speaker as pending_fk", () => {
    const pending = applyMapping(
      row({ Speaker_vod__c: SPEAKER_UNKNOWN }),
      mapping(),
      applyCtx(),
    );
    expect(pending.status).toBe("pending_fk");
    expect(pending.payload.speaker__v).toEqual({
      $fk: { object: "em_speaker", sfdcId: SPEAKER_UNKNOWN },
    });
    expect(pending.unresolvedRequiredFks).toEqual([
      { field: "speaker__v", objectKey: "em_speaker", sfdcId: SPEAKER_UNKNOWN },
    ]);
    const missing = applyMapping(
      row({ Speaker_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "speaker__v",
    });
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [ROW_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});

describe("em_event_speaker custom transforms", () => {
  const base = (): SourceRow => ({ Id: ROW_1 });
  const accountCtx = (editable: boolean, target = "account__v") =>
    buildTransformContext({
      objectKey: "em_event_speaker",
      field: { source: "Speaker_vod__c", target },
      metadata: {
        fields: {
          account__v: {
            name: "account__v",
            type: "object",
            rawType: "Object",
            referenceObject: "account__v",
            multiValue: false,
            required: false,
            unique: false,
            editable,
            active: true,
          },
        },
      },
      ids: buildIdResolver({ account: { [IDS.account1]: "V0A000000000001" } }),
    });

  it("fromSpeakerAccount emits ref(account) from the formula or the speaker column, editable targets only", () => {
    const withFormula = (extra: Record<string, unknown> = {}) => ({
      ...base(),
      [SPEAKER_ACCOUNT_FORMULA_SOURCE]: IDS.account1,
      ...extra,
    });
    expect(
      fromSpeakerAccount(SPEAKER_1, withFormula(), accountCtx(true)),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: IDS.account1 } },
    });
    // the formula wins over the speaker column when both are present
    expect(
      fromSpeakerAccount(
        SPEAKER_1,
        withFormula({ [SPEAKER_ACCOUNT_SOURCE]: IDS.account4 }),
        accountCtx(true),
      ),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: IDS.account1 } },
    });
    expect(
      fromSpeakerAccount(
        SPEAKER_1,
        { ...base(), [SPEAKER_ACCOUNT_SOURCE]: IDS.account1 },
        accountCtx(true),
      ),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: IDS.account1 } },
    });
    expect(
      fromSpeakerAccount(SPEAKER_1, base(), accountCtx(true)),
    ).toBeUndefined();
    // an overlay that keeps the formula as the row source still works
    const legacyLayout = {
      ...accountCtx(true),
      field: {
        ...accountCtx(true).field,
        source: SPEAKER_ACCOUNT_FORMULA_SOURCE,
      },
    };
    expect(
      fromSpeakerAccount(IDS.account1, base(), legacyLayout),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: IDS.account1 } },
    });
    expect(
      fromSpeakerAccount(SPEAKER_1, withFormula(), accountCtx(false)),
    ).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "custom",
        code: SPEAKER_ACCOUNT_NOT_EDITABLE_CODE,
        value: IDS.account1,
      },
    });
    // unresolved account → deferred ref with the unresolved marker (optional lookup → omitted by apply)
    expect(
      fromSpeakerAccount(
        SPEAKER_1,
        { ...base(), [SPEAKER_ACCOUNT_FORMULA_SOURCE]: IDS.account4 },
        accountCtx(true),
      ),
    ).toMatchObject({
      unresolved: { objectKey: "account", sfdcId: IDS.account4 },
    });
    // selector rows → nothing
    expect(
      fromSpeakerAccount(
        IDS.account1,
        withFormula(),
        accountCtx(true, "account__v.speaker"),
      ),
    ).toBeUndefined();
    expect(
      fromSpeakerAccount(
        IDS.account1,
        withFormula(),
        accountCtx(true, "account__v.formula"),
      ),
    ).toBeUndefined();
  });

  it("speakerStatus defaults to invited__v and otherwise crosswalks", () => {
    const ctx = buildTransformContext({
      objectKey: "em_event_speaker",
      field: { source: "Status_vod__c", target: "em_event_speaker_status__v" },
      targetField: {
        type: "picklist",
        picklistValues: Object.values(EM_EVENT_SPEAKER_STATUS),
      },
      mapping: {
        picklists: {
          "em_event_speaker.status": { ...EM_EVENT_SPEAKER_STATUS },
        },
      },
    });
    expect(speakerStatus("", base(), ctx)).toEqual({ value: "invited__v" });
    expect(speakerStatus(null, base(), ctx)).toEqual({ value: "invited__v" });
    expect(speakerStatus("Signed_vod", base(), ctx)).toEqual({
      value: "signed__v",
    });
    expect(speakerStatus("Nope_vod", base(), ctx)).toMatchObject({
      omit: true,
      diagnostic: { kind: "unmapped_picklist", fatal: true },
    });
  });

  it("contractRefDropped omits and counts", () => {
    const ctx = buildTransformContext({
      objectKey: "em_event_speaker",
      field: { source: "Contract_vod__c", target: "contract__v" },
    });
    expect(contractRefDropped("", base(), ctx)).toBeUndefined();
    expect(contractRefDropped(CONTRACT_1, base(), ctx)).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "out_of_scope_ref_dropped",
        field: "contract__v",
        code: CONTRACT_REF_DROPPED_CODE,
        value: CONTRACT_1,
      },
    });
  });
});
