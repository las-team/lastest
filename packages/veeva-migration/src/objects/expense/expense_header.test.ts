import { describe, expect, it } from "vitest";
import {
  EXPENSE_HEADER_OPEN_PREDICATE,
  EXPENSE_HEADER_PAYEE_MAP_KEY,
  EXPENSE_HEADER_STATUS_MAP_KEY,
  emEventOpenTerm,
  expense_header,
  payeeAuto,
} from "./expense_header";
import {
  EM_EVENT_CLOSED_STATUSES,
  EM_EVENT_OPEN_PREDICATE,
} from "../em_event/em_event";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";
type HeaderField = Parameters<typeof buildVaultMetadata>[1][number];

const NOW = new Date("2026-09-07T00:00:00Z");
const HEADER_1 = to18("a0H000000000001");
const EVENT_1 = to18("a0E000000000001");
const EVENT_UNKNOWN = to18("a0E000000000099");
const ATTENDEE_1 = to18("a0A000000000001");
const SPEAKER_1 = to18("a0S000000000001");
const VENUE_1 = to18("a0V000000000001");
const ACCOUNT_1 = "001000000000001AAA";
const CONTACT_1 = "003000000000001AAA";

function config(extra: Record<string, unknown> = {}) {
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
    ...extra,
  });
}

/** Target metadata; `payee__v` type is [UNV] so tests vary it. */
function metadata(opts: { payeeType?: "Picklist" | "String" } = {}) {
  const payeeField: HeaderField =
    opts.payeeType === "String"
      ? { name: "payee__v", type: "String", max_length: 255 }
      : { name: "payee__v", type: "Picklist", picklist: "payee__v" };
  const ref = (name: string, object: string): HeaderField => ({
    name,
    type: "Object",
    object: { name: object },
    relationship_type: "reference",
  });
  return resolveMetadata(
    buildVaultMetadata("expense_header__v", [
      { ...ref("event__v", "em_event__v"), required: true },
      payeeField,
      ref("incurred_expense_attendee__v", "em_attendee__v"),
      ref("incurred_expense_speaker__v", "em_event_speaker__v"),
      ref("incurred_expense_venue__v", "em_venue__v"),
      ref("payee_account__v", "account__v"),
      ref("payee_venue__v", "em_venue__v"),
      {
        name: "expense_header_status__v",
        type: "Picklist",
        picklist: "expense_header_status__v",
      },
      { name: "payment_date__v", type: "Date" },
      { name: "actual__v", type: "Number", scale: 2 },
      { name: "committed__v", type: "Number", scale: 2 },
      { name: "local_currency__sys", type: "Picklist" },
      ref("ownerid__v", "user__sys"),
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "external_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        payee__v: ["attendee__v", "speaker__v", "venue__v", "account__v"],
        expense_header_status__v: ["saved__v", "submitted__v", "approved__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    em_event: { [EVENT_1]: "V0E1" },
    em_attendee: { [ATTENDEE_1]: "V0A1" },
    em_event_speaker: { [SPEAKER_1]: "V0S1" },
    em_venue: { [VENUE_1]: "V0V1" },
    account: { [ACCOUNT_1]: "V001" },
  },
  { [SAMPLE_USER_ID]: 11 },
);
const usCountry = buildCountryContext();

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: HEADER_1,
    IsDeleted: false,
    Name: "EH-000123",
    Event_vod__c: EVENT_1,
    Payee_vod__c: "Attendee_vod",
    Incurred_Expense_Attendee_vod__c: ATTENDEE_1,
    Incurred_Expense_Speaker_vod__c: SPEAKER_1,
    Incurred_Expense_Venue_vod__c: VENUE_1,
    Payee_Account_vod__c: ACCOUNT_1,
    Payee_Venue_vod__c: VENUE_1,
    Status_vod__c: "Submitted_vod",
    Payment_Date_vod__c: "2025-03-14",
    Actual_vod__c: "1234.567",
    Committed_vod__c: 1500,
    CurrencyIsoCode: "usd",
    External_ID_vod__c: "EXP-001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-01T10:11:12.000Z",
    LastModifiedDate: "2025-03-15T03:04:05.000Z",
    SystemModstamp: "2025-03-15T03:04:05.000Z",
    ...extra,
  };
}

function mapping(cfg = config()) {
  return materialise(expense_header, resolveCountry(cfg, "US"), cfg, {
    now: NOW,
  });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: usCountry,
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: expense_header.custom,
    ...overrides,
  };
}

describe("expense_header module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(expense_header).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(expense_header.source).toBe("Expense_Header_vod__c");
    expect(expense_header.target).toBe("expense_header__v");
    expect(expense_header.targetEvidence).toBe("OBS");
    expect(expense_header.enabledByDefault).toBe(true);
    expect(expense_header.optionDefaults).toEqual({ optional: true });
    expect(expense_header.countryOf).toEqual([
      { kind: "parent", key: "em_event", field: "Event_vod__c" },
    ]);
    expect(expense_header.dependsOn).toEqual([
      "em_event",
      "em_attendee",
      "em_event_speaker",
      "em_venue",
      "account",
      "user",
    ]);
    expect(expense_header.selfRefs).toEqual([]);
    expect(expense_header.partitionBy).toBeUndefined();
    expect(expense_header.orderBy).toBeUndefined();
    expect(expense_header.deletePolicy).toBe("ignore");
    expect(expense_header.inactivate).toEqual([]);
    expect(expense_header.createPolicy).toBe("create");
    expect(expense_header.load.noTriggers).toBe(true);
    expect(expense_header.objectTypes).toEqual({});
    expect(expense_header.states).toEqual({});
    expect(expense_header.blobs).toBeUndefined();
    expect(expense_header.blockS).toMatchObject({
      name: "autoNumber",
      currency: true,
      objectType: false,
    });
    expect(expense_header.blockS.statusFromFlag).toBeUndefined();
    expect(expense_header.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "natural_key",
    ]);
    expect(expense_header.match[1].keys).toEqual([
      { target: "external_id__v", source: "External_ID_vod__c" },
    ]);
    expect(expense_header.match[2]).toMatchObject({
      sameCountry: true,
      keys: [
        { target: "event__v", source: "Event_vod__c" },
        { target: "payee__v", source: "Payee_vod__c" },
        { target: "payment_date__v", source: "Payment_Date_vod__c" },
      ],
    });
    expect(expense_header.notes).not.toContain("STUB");
  });

  it("carries every §6.3.25a row with evidence, required and unverified-source flags", () => {
    const byTarget = new Map(expense_header.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "event__v",
      "payee__v",
      "incurred_expense_attendee__v",
      "incurred_expense_speaker__v",
      "incurred_expense_venue__v",
      "payee_account__v",
      "payee_venue__v",
      "expense_header_status__v",
      "payment_date__v",
      "actual__v",
      "committed__v",
      "local_currency__sys",
      "ownerid__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "mobile_id__v",
      "external_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    // one row per target (Block S rows replaced, never duplicated)
    expect(new Set(expense_header.fields.map((f) => f.target)).size).toBe(
      expense_header.fields.length,
    );
    expect(byTarget.get("event__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "em_event" },
      required: "Y",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    });
    expect(byTarget.get("name__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
      required: "y?",
      evidence: "OBS",
      enabledBy: "preserveAutoNumberName",
    });
    expect(byTarget.get("payee__v")).toMatchObject({
      transform: { kind: "custom", fnName: "payeeAuto" },
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    });
    const refs: Record<string, string> = {
      incurred_expense_attendee__v: "em_attendee",
      incurred_expense_speaker__v: "em_event_speaker",
      incurred_expense_venue__v: "em_venue",
      payee_account__v: "account",
      payee_venue__v: "em_venue",
    };
    for (const [target, objectKey] of Object.entries(refs))
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "ref", objectKey },
        required: "n",
        evidence: "OBS",
        unverifiedSource: true,
      });
    expect(byTarget.get("expense_header_status__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: EXPENSE_HEADER_STATUS_MAP_KEY },
      required: "y?",
      evidence: "OBS",
      countryConfigurable: true,
      unverifiedSource: true,
    });
    // a guessed source never declares a type that could block the module
    // (SF_FIELD_TYPE_MISMATCH has no picklist→string auto-switch)
    expect(
      byTarget.get("expense_header_status__v")?.sourceType,
    ).toBeUndefined();
    expect(byTarget.get("payment_date__v")).toMatchObject({
      transform: { kind: "date" },
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    });
    for (const target of ["actual__v", "committed__v"])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "number" },
        required: "n",
        evidence: "UNV",
        unverifiedSource: true,
        sourceType: "currency",
      });
    expect(byTarget.get("local_currency__sys")).toMatchObject({
      transform: { kind: "currency" },
      evidence: "UNV",
      optionalSource: true,
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      source: "OwnerId",
      transform: { kind: "refUser" },
      required: "n",
      evidence: "UNV",
    });
    expect(Object.keys(expense_header.picklists).sort()).toEqual(
      [EXPENSE_HEADER_STATUS_MAP_KEY, EXPENSE_HEADER_PAYEE_MAP_KEY].sort(),
    );
    for (const f of expense_header.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("scopes on the parent event start time OR the payment date OR an open parent event, in the tov retention family", () => {
    expect(expense_header.scope).toEqual({
      kind: "dated",
      predicates: [
        { field: "Event_vod__r.Start_Time_vod__c", type: "datetime" },
        { field: "Payment_Date_vod__c", type: "date" },
      ],
      openPredicate: EXPENSE_HEADER_OPEN_PREDICATE,
      retentionFamily: "tov",
    });
    // §1.1 #4: the parent event's open-item term, mirrored through Event_vod__r.
    // — the same term the extractor appends for em_attendee/em_event_speaker
    expect(EXPENSE_HEADER_OPEN_PREDICATE).toBe(
      `(Event_vod__r.End_Time_vod__c >= {cutoffDateTime}) OR (Event_vod__r.Status_vod__c NOT IN (${EM_EVENT_CLOSED_STATUSES.map(
        (st) => `'${st}'`,
      ).join(", ")}))`,
    );
    expect(emEventOpenTerm("Event_vod__r")).toBe(EXPENSE_HEADER_OPEN_PREDICATE);
    // identical to em_event's own open term once the relationship prefix is stripped
    expect(EXPENSE_HEADER_OPEN_PREDICATE.replaceAll("Event_vod__r.", "")).toBe(
      EM_EVENT_OPEN_PREDICATE,
    );
    // default 24 months → 2024-09-07
    const m = mapping();
    expect(m.scope.retentionFamily).toBe("tov");
    expect(m.scope.historyMonths).toBe(24);
    expect(m.scope.cutoffDate).toBe("2024-09-07");
    const built = buildScopePredicate(m.scope);
    expect(built.kind).toBe("dated");
    expect(built.dateTerm).toBe(
      "Event_vod__r.Start_Time_vod__c >= 2024-09-07T00:00:00Z OR Payment_Date_vod__c >= 2024-09-07",
    );
    expect(built.openTerm).toBe(
      "(Event_vod__r.End_Time_vod__c >= 2024-09-07T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod'))",
    );
    expect(built.predicate).toBe(
      "(Event_vod__r.Start_Time_vod__c >= 2024-09-07T00:00:00Z OR Payment_Date_vod__c >= 2024-09-07) OR ((Event_vod__r.End_Time_vod__c >= 2024-09-07T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))",
    );
    expect(built.predicate).not.toContain("{cutoff");
    expect(m.options.optional).toBe(true);
    expect(m.options.deletePolicy).toBe("ignore");
  });

  it("is widened (never narrowed) by scope.tovRetentionMonths", () => {
    const widened = mapping(config({ scope: { tovRetentionMonths: 60 } }));
    expect(widened.scope.historyMonths).toBe(60);
    expect(widened.scope.cutoffDate).toBe("2021-09-07");
    expect(buildScopePredicate(widened.scope).predicate).toBe(
      "(Event_vod__r.Start_Time_vod__c >= 2021-09-07T00:00:00Z OR Payment_Date_vod__c >= 2021-09-07) OR ((Event_vod__r.End_Time_vod__c >= 2021-09-07T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))",
    );
    // a country override below the family retention is widened back
    const narrow = mapping(
      config({
        scope: { tovRetentionMonths: 60 },
        countries: {
          US: { scope: { objects: { expense_header: { historyMonths: 12 } } } },
        },
      }),
    );
    expect(narrow.scope.historyMonths).toBe(60);
    expect(narrow.findings).toContainEqual(
      expect.objectContaining({ code: "SCOPE_WIDENED" }),
    );
  });

  it("transforms a row: legacy id, resolved FKs, payee picklist, status crosswalk, date, amounts, currency, audit", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: HEADER_1,
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_1 } },
      payee__v: "attendee__v",
      incurred_expense_attendee__v: {
        $fk: { object: "em_attendee", sfdcId: ATTENDEE_1 },
      },
      incurred_expense_speaker__v: {
        $fk: { object: "em_event_speaker", sfdcId: SPEAKER_1 },
      },
      incurred_expense_venue__v: {
        $fk: { object: "em_venue", sfdcId: VENUE_1 },
      },
      payee_account__v: { $fk: { object: "account", sfdcId: ACCOUNT_1 } },
      payee_venue__v: { $fk: { object: "em_venue", sfdcId: VENUE_1 } },
      expense_header_status__v: "submitted__v",
      payment_date__v: "2025-03-14",
      actual__v: 1234.57,
      committed__v: 1500,
      local_currency__sys: "USD",
      external_id__v: "EXP-001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2025-03-01T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-03-15T03:04:05.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // autoNumber rule: Name skipped by default; no object type, no status derivation, no pass 2
    expect(r.payload.name__v).toBeUndefined();
    expect(r.payload["object_type__v.api_name__v"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.payload.state__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.blobs).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toEqual([]);
    // the payload never holds a Vault id
    expect(JSON.stringify(r.payload)).not.toContain("V0E1");
    expect(r.fkEdges).toContainEqual({
      field: "event__v",
      targetObjectKey: "em_event",
      targetSfdcId: EVENT_1,
    });
  });

  it("reports an unresolved required event as pending_fk and omits unresolved optional payee lookups", () => {
    const unknownAttendee = to18("a0A000000000099");
    const r = applyMapping(
      row({
        Event_vod__c: EVENT_UNKNOWN,
        Incurred_Expense_Attendee_vod__c: unknownAttendee,
      }),
      mapping(),
      applyCtx(),
    );
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      { field: "event__v", objectKey: "em_event", sfdcId: EVENT_UNKNOWN },
    ]);
    // deferred reference kept for the retry after closure (§3.5)
    expect(r.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_UNKNOWN },
    });
    expect(r.payload.incurred_expense_attendee__v).toBeUndefined();
    expect(r.unresolvedOptionalFks).toEqual([
      {
        field: "incurred_expense_attendee__v",
        objectKey: "em_attendee",
        sfdcId: unknownAttendee,
      },
    ]);
    // a missing required event fails the row outright
    const missing = applyMapping(
      row({ Event_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "event__v",
    });
  });

  it("carries the auto-number Name only with preserveAutoNumberName and honours country status crosswalks", () => {
    const cfg = config({
      objects: { expense_header: { preserveAutoNumberName: true } },
      countries: {
        US: {
          picklists: {
            [EXPENSE_HEADER_STATUS_MAP_KEY]: { Submitted_vod: "approved__v" },
          },
        },
      },
    });
    const m = mapping(cfg);
    expect(m.fields.some((f) => f.target === "name__v")).toBe(true);
    expect(m.picklists[EXPENSE_HEADER_STATUS_MAP_KEY]).toEqual({
      Submitted_vod: "approved__v",
    });
    const r = applyMapping(row(), m, applyCtx());
    expect(r.status).toBe("ok");
    expect(r.payload.name__v).toBe("EH-000123");
    expect(r.payload.expense_header_status__v).toBe("approved__v");
  });

  it("fails the row on an unmapped status under the error policy and skips erased rows", () => {
    const bad = applyMapping(
      row({ Status_vod__c: "Bogus_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("expense_header_status__v");
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [HEADER_1] }) }),
    );
    expect(erased.status).toBe("skipped");
    expect(erased.skipReason).toBe("erased");
  });

  it("hashes deterministically and includes the mapping hash", () => {
    const a = applyMapping(row(), mapping(), applyCtx());
    const b = applyMapping(row(), mapping(), applyCtx());
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(
      applyMapping(row({ Actual_vod__c: "99" }), mapping(), applyCtx())
        .sourceHash,
    ).not.toBe(a.sourceHash);
    const other = mapping(config({ scope: { tovRetentionMonths: 60 } }));
    expect(applyMapping(row(), other, applyCtx()).sourceHash).not.toBe(
      a.sourceHash,
    );
  });
});

describe("expense_header custom transforms", () => {
  const base = { Id: HEADER_1 };

  it("payeeAuto crosswalks picklist targets and cleans text otherwise", () => {
    const pickCtx = buildTransformContext({
      objectKey: "expense_header",
      field: { source: "Payee_vod__c", target: "payee__v" },
      targetField: {
        name: "payee__v",
        type: "picklist",
        picklistValues: ["attendee__v", "speaker__v"],
      },
    });
    expect(payeeAuto("Speaker_vod", base, pickCtx)).toMatchObject({
      value: "speaker__v",
    });
    const overridden = buildTransformContext({
      objectKey: "expense_header",
      field: { source: "Payee_vod__c", target: "payee__v" },
      targetField: {
        name: "payee__v",
        type: "picklist",
        picklistValues: ["attendee__v", "speaker__v"],
      },
      country: buildCountryContext({
        picklists: {
          [EXPENSE_HEADER_PAYEE_MAP_KEY]: { Guest_vod: "attendee__v" },
        },
      }),
    });
    expect(payeeAuto("Guest_vod", base, overridden)).toMatchObject({
      value: "attendee__v",
    });
    const textCtx = buildTransformContext({
      objectKey: "expense_header",
      field: { source: "Payee_vod__c", target: "payee__v" },
      targetField: { name: "payee__v", type: "string", maxLength: 255 },
    });
    expect(payeeAuto("  Dr. Jane Doe ", base, textCtx)).toEqual({
      value: "Dr. Jane Doe",
    });
    expect(payeeAuto("", base, textCtx)).toBeUndefined();
    expect(payeeAuto(null, base, pickCtx)).toBeUndefined();
  });

  it("payeeAuto never loads a raw SFDC id and drops contact ids with CONTACT_REF_DROPPED", () => {
    const textCtx = buildTransformContext({
      objectKey: "expense_header",
      field: { source: "Payee_vod__c", target: "payee__v" },
      targetField: { name: "payee__v", type: "string" },
    });
    expect(payeeAuto(CONTACT_1, base, textCtx)).toEqual({
      omit: true,
      diagnostic: {
        kind: "contact_ref_dropped",
        field: "payee__v",
        code: "CONTACT_REF_DROPPED",
        value: CONTACT_1,
      },
    });
    expect(payeeAuto(ACCOUNT_1, base, textCtx)).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        code: "PAYEE_ID_NOT_LOADABLE",
        value: ACCOUNT_1,
      },
    });
    // a non-fatal diagnostic: the row still loads with payee__v omitted
    const r = applyMapping(
      row({ Payee_vod__c: ACCOUNT_1 }),
      mapping(),
      applyCtx({ metadata: metadata({ payeeType: "String" }) }),
    );
    expect(r.status).toBe("ok");
    expect(r.payload.payee__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PAYEE_ID_NOT_LOADABLE" }),
    );
  });
});
