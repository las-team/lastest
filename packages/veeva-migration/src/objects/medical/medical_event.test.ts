import { describe, expect, it } from "vitest";
import {
  MEDICAL_EVENT_ACCOUNT_FIELD,
  MEDICAL_EVENT_ADDRESS_FIELD,
  MEDICAL_EVENT_EM_EVENT_FIELD,
  MEDICAL_EVENT_OBJECT_TYPES,
  MEDICAL_EVENT_SCOPE_FIELD,
  medical_event,
} from "./medical_event";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_QUEUE_ID,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const EVENT_ID = to18("a0M000000000001");
const ADDRESS_ID = to18("a0T000000000001");
const EM_EVENT_ID = to18("a0E000000000001");

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
    objects: { medical_event: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "medical_event__v",
      [
        { name: "account__v", type: "Object", object: { name: "account__v" } },
        { name: "address__v", type: "Object", object: { name: "address__v" } },
        {
          name: "em_event__v",
          type: "Object",
          object: { name: "em_event__v" },
        },
        { name: "start_date__v", type: "Date", required: true },
        { name: "end_date__v", type: "Date" },
        { name: "start_time__v", type: "DateTime" },
        { name: "end_time__v", type: "DateTime" },
        { name: "active__v", type: "Boolean" },
        { name: "alternate_name__v", type: "String", max_length: 255 },
        { name: "event_display_name__v", type: "String", max_length: 80 },
        { name: "description__v", type: "LongText" },
        { name: "sponsor__v", type: "String", max_length: 255 },
        { name: "country_name__v", type: "String", max_length: 255 },
        { name: "web_source__v", type: "String", max_length: 255 },
        { name: "expense_amount__v", type: "Number", scale: 2 },
        {
          name: "expense_post_status__v",
          type: "Picklist",
          picklist: "expense_post_status__v",
        },
        {
          name: "expense_system_external_id__v",
          type: "String",
          max_length: 100,
        },
        { name: "concur_report_name__v", type: "String", max_length: 255 },
        { name: "submit_expense__v", type: "Boolean" },
        { name: "local_currency__sys", type: "Picklist" },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
      ],
      {
        objectTypes: [
          "speaker_program__v",
          "congress__v",
          "award__v",
          "medical_event__v",
        ],
      },
    ),
    {
      picklists: {
        expense_post_status__v: ["posted__v", "pending__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: EVENT_ID,
    IsDeleted: false,
    Name: "Cardiology Round Table 2025",
    "RecordType.DeveloperName": "Speaker_Program_vod",
    [MEDICAL_EVENT_ACCOUNT_FIELD]: IDS.account1,
    [MEDICAL_EVENT_ADDRESS_FIELD]: ADDRESS_ID,
    [MEDICAL_EVENT_EM_EVENT_FIELD]: EM_EVENT_ID,
    [MEDICAL_EVENT_SCOPE_FIELD]: "2025-03-04",
    End_Date_vod__c: "2025-03-05",
    Start_Time_vod__c: "2025-03-04T18:00:00.000+0000",
    End_Time_vod__c: "2025-03-05T02:30:00.000Z",
    Active_vod__c: "true",
    Alternate_Name_vod__c: "CRT 2025",
    Event_Display_Name_vod__c: "Cardiology Round Table",
    Description_vod__c: "Evening round table\r\nwith Q&A",
    Sponsor_vod__c: "Verteo",
    Country_Name_vod__c: "United States",
    Web_Source_vod__c: "web",
    Expense_Amount_vod__c: "1234.567",
    Expense_Post_Status_vod__c: "Posted_vod",
    Expense_System_External_ID_vod__c: "CONCUR-1",
    Concur_Report_Name_vod__c: "March events",
    Submit_Expense_vod__c: "false",
    CurrencyIsoCode: "USD",
    Status_vod__c: "Completed",
    Topic_vod__c: "Cardio",
    Mobile_ID_vod__c: "7d2c5f4e-me-0001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-02-01T10:11:12.000Z",
    LastModifiedDate: "2025-03-06T03:04:05.000Z",
    SystemModstamp: "2025-03-06T03:04:05.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { overrides?: Record<string, unknown>; accounts?: string[] } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    medical_event,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const accounts = Object.fromEntries(
    (opts.accounts ?? [IDS.account1]).map((id, i) => [id, `V0A${i + 1}`]),
  );
  const ids = buildIdResolver(
    {
      account: accounts,
      address: { [ADDRESS_ID]: "V0D1" },
      em_event: { [EM_EVENT_ID]: "V0E1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: medical_event.custom,
    }),
  };
}

describe("medical_event module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(medical_event).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.26 / §3.3 / §4.4 catalogue facts", () => {
    expect(medical_event.source).toBe("Medical_Event_vod__c");
    expect(medical_event.target).toBe("medical_event__v");
    expect(medical_event.targetEvidence).toBe("DOC");
    expect(medical_event.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Start_Date_vod__c", type: "date" }],
    });
    expect(medical_event.countryOf).toEqual([
      { kind: "account" },
      { kind: "user", field: "OwnerId" },
    ]);
    expect(medical_event.dependsOn).toEqual(["account", "address", "em_event"]);
    expect(medical_event.selfRefs).toEqual([]);
    expect(medical_event.deletePolicy).toBe("ignore");
    expect(medical_event.inactivate).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(medical_event.createPolicy).toBe("create");
    expect(medical_event.load.noTriggers).toBe(true);
    expect(medical_event.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(medical_event.match[1].keys).toEqual([
      { target: "mobile_id__v", source: "Mobile_ID_vod__c" },
    ]);
    expect(medical_event.objectTypes).toEqual(MEDICAL_EVENT_OBJECT_TYPES);
    expect(Object.keys(MEDICAL_EVENT_OBJECT_TYPES)).toHaveLength(8);
    expect(MEDICAL_EVENT_OBJECT_TYPES.Satellite_Symposium_vod).toBe(
      "satellite_symposium__v",
    );
    // Block S: status__v from Active_vod__c (§6.0.4), currency on
    expect(medical_event.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    expect(medical_event.blockS.currency).toBe(true);
    expect(medical_event.notes).not.toContain("STUB");
  });

  it("carries every §6.3.26 row with its evidence, required flag and skips", () => {
    const byTarget = new Map(medical_event.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "status__v",
      "account__v",
      "address__v",
      "em_event__v",
      "start_date__v",
      "end_date__v",
      "start_time__v",
      "end_time__v",
      "active__v",
      "alternate_name__v",
      "event_display_name__v",
      "description__v",
      "sponsor__v",
      "country_name__v",
      "web_source__v",
      "expense_amount__v",
      "expense_post_status__v",
      "expense_system_external_id__v",
      "concur_report_name__v",
      "submit_expense__v",
      "attendee_field_config__v",
      "cobrowse_meeting_id__v",
      "cobrowse_host_url__v",
      "cobrowse_attendee_url__v",
      "ownerid__v",
      "object_type__v.api_name__v",
      "local_currency__sys",
      "mobile_id__v",
      "medical_event_status__v",
      "topic__v",
      "zvod_cobrowse__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("name__v")).toMatchObject({
      required: "Y",
      evidence: "UNV",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "n",
      evidence: "UNV",
    });
    expect(byTarget.get("address__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "address",
    });
    expect(byTarget.get("em_event__v")?.transform).toEqual({
      kind: "ref",
      objectKey: "em_event",
    });
    expect(byTarget.get("start_date__v")).toMatchObject({
      transform: { kind: "date" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("start_time__v")?.transform).toEqual({
      kind: "datetime",
    });
    expect(byTarget.get("active__v")?.transform).toEqual({ kind: "bool" });
    expect(byTarget.get("description__v")?.transform).toEqual({
      kind: "longtext",
    });
    expect(byTarget.get("expense_amount__v")?.transform).toEqual({
      kind: "number",
    });
    expect(byTarget.get("expense_post_status__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "medical_event.expensePostStatus",
    });
    // the y? owner row replaced the Block S default
    expect(byTarget.get("ownerid__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
      evidence: "UNV",
    });
    expect(
      medical_event.fields.filter((f) => f.target === "ownerid__v"),
    ).toHaveLength(1);
    expect(byTarget.get("status__v")?.transform).toMatchObject({
      kind: "statusFromFlag",
      sourceFlag: "Active_vod__c",
    });
    // inferred source names are unverified + optional, never blocking
    for (const target of [
      "attendee_field_config__v",
      "cobrowse_meeting_id__v",
      "cobrowse_host_url__v",
      "cobrowse_attendee_url__v",
    ])
      expect(byTarget.get(target), target).toMatchObject({
        unverifiedSource: true,
        optionalSource: true,
        evidence: "UNV",
      });
    // formulas and the zvod marker are skipped
    for (const target of [
      "medical_event_status__v",
      "topic__v",
      "zvod_cobrowse__v",
    ])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "skip" },
        required: "-",
      });
    for (const f of medical_event.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: object type, refs, dates, currency, audit users", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("speaker_program__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: EVENT_ID,
      name__v: "Cardiology Round Table 2025",
      "object_type__v.api_name__v": "speaker_program__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      address__v: { $fk: { object: "address", sfdcId: ADDRESS_ID } },
      em_event__v: { $fk: { object: "em_event", sfdcId: EM_EVENT_ID } },
      start_date__v: "2025-03-04",
      end_date__v: "2025-03-05",
      start_time__v: "2025-03-04T18:00:00.000Z",
      end_time__v: "2025-03-05T02:30:00.000Z",
      active__v: true,
      alternate_name__v: "CRT 2025",
      event_display_name__v: "Cardiology Round Table",
      description__v: "Evening round table\nwith Q&A",
      sponsor__v: "Verteo",
      country_name__v: "United States",
      web_source__v: "web",
      expense_amount__v: 1234.57,
      expense_post_status__v: "posted__v",
      expense_system_external_id__v: "CONCUR-1",
      concur_report_name__v: "March events",
      submit_expense__v: false,
      local_currency__sys: "USD",
      mobile_id__v: "7d2c5f4e-me-0001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-02-01T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // active row: status__v omitted (Vault defaults active__v); formulas never loaded
    expect(result.payload.status__v).toBeUndefined();
    expect(result.payload.medical_event_status__v).toBeUndefined();
    expect(result.payload.topic__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.blobs).toEqual({});
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(
      result.fkEdges
        .filter((e) => e.targetObjectKey !== "user")
        .map((e) => e.field)
        .sort(),
    ).toEqual(["account__v", "address__v", "em_event__v"]);
  });

  it("derives status__v = inactive__v from Active_vod__c = false and honours statusFromFlag = false", () => {
    const { result } = run(sampleRow({ Active_vod__c: "false" }));
    expect(result.status).toBe("ok");
    expect(result.payload.active__v).toBe(false);
    expect(result.payload.status__v).toBe("inactive__v");
    const { result: disabled } = run(sampleRow({ Active_vod__c: "false" }), {
      overrides: { statusFromFlag: false },
    });
    expect(disabled.payload.active__v).toBe(false);
    expect(disabled.payload.status__v).toBeUndefined();
  });

  it("omits an unresolved optional account and keeps the row loadable (§3.5)", () => {
    const { result } = run(
      sampleRow({ [MEDICAL_EVENT_ACCOUNT_FIELD]: IDS.account3 }),
    );
    expect(result.status).toBe("ok");
    expect(result.payload.account__v).toBeUndefined();
    expect(result.unresolvedOptionalFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account3 },
    ]);
    expect(result.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account3,
    });
  });

  it("fails without the required start date and on an unknown object type", () => {
    const { result: noDate } = run(
      sampleRow({ [MEDICAL_EVENT_SCOPE_FIELD]: "" }),
    );
    expect(noDate.status).toBe("failed");
    expect(noDate.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "start_date__v",
    });
    const { result: badType } = run(
      sampleRow({ "RecordType.DeveloperName": "Workshop_vod" }),
    );
    expect(badType.status).toBe("failed");
    expect(badType.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("replaces a queue owner with the migration user (§3.4)", () => {
    const { result } = run(sampleRow({ OwnerId: SAMPLE_QUEUE_ID }));
    expect(result.status).toBe("ok");
    expect(result.payload.ownerid__v).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "queue_owner_replaced",
        code: "QUEUE_OWNER_REPLACED",
      }),
    );
  });

  it("is dated on Start_Date_vod__c with an explicit cutoff literal and no open term", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual(medical_event.scope);
    expect(mapping.scope.historyMonths).toBe(24);
    expect(mapping.scope.cutoffDate).toBe("2024-09-07");
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "dated",
      cutoffDate: "2024-09-07",
      dateTerm: "Start_Date_vod__c >= 2024-09-07",
      openTerm: undefined,
      predicate: "Start_Date_vod__c >= 2024-09-07",
    });
    expect(mapping.countryOf).toEqual([
      { kind: "account" },
      { kind: "user", field: "OwnerId" },
    ]);
    expect(mapping.options.deletePolicy).toBe("ignore");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "active__v", value: false },
    ]);
  });
});
