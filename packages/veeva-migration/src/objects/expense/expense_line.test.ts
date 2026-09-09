import { describe, expect, it } from "vitest";
import {
  EM_BUDGET_REF_DROPPED,
  EXPENSE_LINE_TYPE_MAP_KEY,
  HEADER_EVENT_COLUMN,
  budgetRefDropped,
  eventRef,
  expenseTypeAuto,
  expense_line,
} from "./expense_line";
import { expense_header } from "./expense_header";
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
type LineField = Parameters<typeof buildVaultMetadata>[1][number];

const NOW = new Date("2026-09-07T00:00:00Z");
const LINE_1 = to18("a0L000000000001");
const HEADER_1 = to18("a0H000000000001");
const HEADER_UNKNOWN = to18("a0H000000000099");
const EVENT_1 = to18("a0E000000000001");
const EVENT_2 = to18("a0E000000000002");
const BUDGET_1 = to18("a0B000000000001");
const CATALOG_1 = to18("a0T000000000001");

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

/** Target metadata; the `expense_type__v` shape is [UNV] so tests vary it. */
function metadata(
  opts: { expenseType?: "Object" | "Picklist" | "String" } = {},
) {
  const expenseType: LineField =
    opts.expenseType === "Picklist"
      ? {
          name: "expense_type__v",
          type: "Picklist",
          picklist: "expense_type__v",
        }
      : opts.expenseType === "String"
        ? { name: "expense_type__v", type: "String", max_length: 100 }
        : {
            name: "expense_type__v",
            type: "Object",
            object: { name: "em_catalog__v" },
            relationship_type: "reference",
          };
  return resolveMetadata(
    buildVaultMetadata("expense_line__v", [
      {
        name: "expense_header__v",
        type: "Object",
        object: { name: "expense_header__v" },
        relationship_type: "parent",
        required: true,
      },
      {
        name: "event__v",
        type: "Object",
        object: { name: "em_event__v" },
        relationship_type: "reference",
      },
      {
        name: "event_budget__v",
        type: "Object",
        object: { name: "em_event_budget__v" },
        relationship_type: "reference",
      },
      expenseType,
      { name: "expense_type_name__v", type: "String", max_length: 100 },
      { name: "actual__v", type: "Number", scale: 2, required: true },
      { name: "committed__v", type: "Number", scale: 2 },
      { name: "local_currency__sys", type: "Picklist" },
      { name: "description__v", type: "LongText", max_length: 32000 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "external_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        expense_type__v: ["catering__v", "travel__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    expense_header: { [HEADER_1]: "V0H1" },
    em_event: { [EVENT_1]: "V0E1", [EVENT_2]: "V0E2" },
    em_catalog: { [CATALOG_1]: "V0T1" },
  },
  { [SAMPLE_USER_ID]: 11 },
);
const usCountry = buildCountryContext();

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: LINE_1,
    IsDeleted: false,
    Name: "EL-000456",
    Expense_Header_vod__c: HEADER_1,
    [HEADER_EVENT_COLUMN]: EVENT_1,
    Event_vod__c: EVENT_1,
    Event_Budget_vod__c: BUDGET_1,
    Expense_Type_vod__c: CATALOG_1,
    Expense_Type_Name_vod__c: "Catering",
    Actual_vod__c: "250.125",
    Committed_vod__c: "300",
    CurrencyIsoCode: "EUR",
    Description_vod__c: "Dinner for 12 attendees\r\nincl. VAT",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2025-03-01T10:11:12.000Z",
    LastModifiedDate: "2025-03-15T03:04:05.000Z",
    SystemModstamp: "2025-03-15T03:04:05.000Z",
    ...extra,
  };
}

function mapping(cfg = config()) {
  return materialise(expense_line, resolveCountry(cfg, "US"), cfg, {
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
    custom: expense_line.custom,
    ...overrides,
  };
}

describe("expense_line module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(expense_line).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(expense_line.source).toBe("Expense_Line_vod__c");
    expect(expense_line.target).toBe("expense_line__v");
    expect(expense_line.targetEvidence).toBe("OBS");
    expect(expense_line.optionDefaults).toEqual({ optional: true });
    expect(expense_line.countryOf).toEqual([
      { kind: "parent", key: "expense_header", field: "Expense_Header_vod__c" },
    ]);
    expect(expense_line.dependsOn).toEqual([
      "expense_header",
      "em_event",
      "em_catalog",
    ]);
    expect(expense_line.selfRefs).toEqual([]);
    expect(expense_line.deletePolicy).toBe("delete");
    expect(expense_line.inactivate).toEqual([]);
    expect(expense_line.createPolicy).toBe("create");
    expect(expense_line.load.noTriggers).toBe(true);
    expect(expense_line.objectTypes).toEqual({});
    expect(expense_line.states).toEqual({});
    expect(expense_line.blockS).toMatchObject({
      name: "autoNumber",
      ownerId: false,
      currency: true,
      objectType: false,
    });
    expect(expense_line.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
    ]);
    expect(expense_line.notes).not.toContain("STUB");
  });

  it("carries every §6.3.25b row with evidence, required and unverified-source flags", () => {
    const byTarget = new Map(expense_line.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "expense_header__v",
      "event__v",
      "event_budget__v",
      "expense_type__v",
      "expense_type_name__v",
      "actual__v",
      "committed__v",
      "local_currency__sys",
      "description__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "mobile_id__v",
      "external_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    // master-detail child: no OwnerId row at all
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(new Set(expense_line.fields.map((f) => f.target)).size).toBe(
      expense_line.fields.length,
    );
    expect(byTarget.get("expense_header__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "expense_header" },
      required: "Y",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    });
    expect(byTarget.get("event__v")).toMatchObject({
      source: "Event_vod__c",
      transform: { kind: "custom", fnName: "eventRef" },
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
    });
    expect(byTarget.get("event_budget__v")).toMatchObject({
      transform: { kind: "custom", fnName: "budgetRefDropped" },
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    });
    expect(byTarget.get("expense_type__v")).toMatchObject({
      transform: { kind: "custom", fnName: "expenseTypeAuto" },
      required: "y?",
      evidence: "OBS",
      countryConfigurable: true,
      unverifiedSource: true,
    });
    expect(byTarget.get("expense_type_name__v")).toMatchObject({
      transform: { kind: "text" },
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
    });
    expect(byTarget.get("actual__v")).toMatchObject({
      transform: { kind: "number" },
      required: "y?",
      evidence: "OBS",
      sourceType: "currency",
    });
    expect(byTarget.get("committed__v")).toMatchObject({
      transform: { kind: "number" },
      required: "n",
      evidence: "OBS",
    });
    expect(byTarget.get("local_currency__sys")).toMatchObject({
      transform: { kind: "currency" },
      evidence: "OBS",
      optionalSource: true,
    });
    expect(byTarget.get("description__v")).toMatchObject({
      transform: { kind: "longtext" },
      required: "n",
      evidence: "OBS",
    });
    expect(byTarget.get("name__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
      required: "y?",
      evidence: "OBS",
      enabledBy: "preserveAutoNumberName",
    });
    expect(Object.keys(expense_line.picklists)).toEqual([
      EXPENSE_LINE_TYPE_MAP_KEY,
    ]);
    for (const f of expense_line.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is scoped via the header: both header date terms mirrored through Expense_Header_vod__r", () => {
    expect(expense_line.scope).toEqual({
      kind: "dated",
      predicates: [
        {
          field: "Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c",
          type: "datetime",
        },
        { field: "Expense_Header_vod__r.Payment_Date_vod__c", type: "date" },
      ],
      retentionFamily: "tov",
    });
    // a line is in scope exactly when its header is: same predicates, prefixed
    expect(expense_header.scope.kind).toBe("dated");
    if (
      expense_header.scope.kind === "dated" &&
      expense_line.scope.kind === "dated"
    )
      expect(expense_line.scope.predicates).toEqual(
        expense_header.scope.predicates.map((p) => ({
          ...p,
          field: `Expense_Header_vod__r.${p.field}`,
        })),
      );
    const m = mapping();
    expect(m.scope.retentionFamily).toBe("tov");
    expect(m.scope.cutoffDate).toBe("2024-09-07");
    expect(buildScopePredicate(m.scope).predicate).toBe(
      "Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c >= 2024-09-07T00:00:00Z OR Expense_Header_vod__r.Payment_Date_vod__c >= 2024-09-07",
    );
    // widened by the tov family, exactly like the header
    const wide = mapping(config({ scope: { tovRetentionMonths: 60 } }));
    expect(wide.scope.cutoffDate).toBe("2021-09-07");
    expect(wide.options.deletePolicy).toBe("delete");
    expect(wide.options.optional).toBe(true);
  });

  it("transforms a row: header + event FKs, budget dropped and counted, catalog ref, amounts, currency, longtext", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: LINE_1,
      expense_header__v: {
        $fk: { object: "expense_header", sfdcId: HEADER_1 },
      },
      event__v: { $fk: { object: "em_event", sfdcId: EVENT_1 } },
      expense_type__v: { $fk: { object: "em_catalog", sfdcId: CATALOG_1 } },
      expense_type_name__v: "Catering",
      actual__v: 250.13,
      committed__v: 300,
      local_currency__sys: "EUR",
      description__v: "Dinner for 12 attendees\nincl. VAT",
      created_date__v: "2025-03-01T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-03-15T03:04:05.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.event_budget__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "out_of_scope_ref_dropped",
        field: "event_budget__v",
        code: EM_BUDGET_REF_DROPPED,
        value: BUDGET_1,
      }),
    );
    expect(r.payload.name__v).toBeUndefined();
    expect(r.payload.ownerid__v).toBeUndefined();
    expect(r.payload["object_type__v.api_name__v"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toEqual([]);
    expect(JSON.stringify(r.payload)).not.toContain("V0H1");
    expect(r.fkEdges).toEqual(
      expect.arrayContaining([
        {
          field: "expense_header__v",
          targetObjectKey: "expense_header",
          targetSfdcId: HEADER_1,
        },
        {
          field: "event__v",
          targetObjectKey: "em_event",
          targetSfdcId: EVENT_1,
        },
        {
          field: "expense_type__v",
          targetObjectKey: "em_catalog",
          targetSfdcId: CATALOG_1,
        },
      ]),
    );
  });

  it("derives event__v from the header when the line's own Event_vod__c is absent", () => {
    const derived = applyMapping(
      row({ Event_vod__c: "", [HEADER_EVENT_COLUMN]: EVENT_2 }),
      mapping(),
      applyCtx(),
    );
    expect(derived.status).toBe("ok");
    expect(derived.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_2 },
    });
    // own value wins over the header's
    const own = applyMapping(
      row({ Event_vod__c: EVENT_1, [HEADER_EVENT_COLUMN]: EVENT_2 }),
      mapping(),
      applyCtx(),
    );
    expect(own.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_1 },
    });
    // neither present: optional lookup (target not required) → omitted, row still loads
    const none = applyMapping(
      row({ Event_vod__c: "", [HEADER_EVENT_COLUMN]: "" }),
      mapping(),
      applyCtx(),
    );
    expect(none.status).toBe("ok");
    expect(none.payload.event__v).toBeUndefined();
  });

  it("reports an unresolved required header as pending_fk and fails on a missing header", () => {
    const r = applyMapping(
      row({ Expense_Header_vod__c: HEADER_UNKNOWN }),
      mapping(),
      applyCtx(),
    );
    expect(r.status).toBe("pending_fk");
    expect(r.unresolvedRequiredFks).toEqual([
      {
        field: "expense_header__v",
        objectKey: "expense_header",
        sfdcId: HEADER_UNKNOWN,
      },
    ]);
    expect(r.payload.expense_header__v).toEqual({
      $fk: { object: "expense_header", sfdcId: HEADER_UNKNOWN },
    });
    const missing = applyMapping(
      row({ Expense_Header_vod__c: null }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "expense_header__v",
    });
  });

  it("resolves expense_type__v as a picklist or text when the target is not an em_catalog reference", () => {
    const pick = applyMapping(
      row({ Expense_Type_vod__c: "Catering_vod" }),
      mapping(),
      applyCtx({ metadata: metadata({ expenseType: "Picklist" }) }),
    );
    expect(pick.status).toBe("ok");
    expect(pick.payload.expense_type__v).toBe("catering__v");
    const text = applyMapping(
      row({ Expense_Type_vod__c: " Catering " }),
      mapping(),
      applyCtx({ metadata: metadata({ expenseType: "String" }) }),
    );
    expect(text.status).toBe("ok");
    expect(text.payload.expense_type__v).toBe("Catering");
    // unmapped picklist value under the error policy fails the row
    const bad = applyMapping(
      row({ Expense_Type_vod__c: "Bogus_vod" }),
      mapping(),
      applyCtx({ metadata: metadata({ expenseType: "Picklist" }) }),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("expense_type__v");
  });

  it("fails on a missing required amount, carries the Name only with preserveAutoNumberName, hashes deterministically", () => {
    // actual__v is y? and required in the target metadata → REQUIRED_MISSING
    const missing = applyMapping(
      row({ Actual_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "actual__v",
    });
    const withName = mapping(
      config({ objects: { expense_line: { preserveAutoNumberName: true } } }),
    );
    expect(applyMapping(row(), withName, applyCtx()).payload.name__v).toBe(
      "EL-000456",
    );
    const a = applyMapping(row(), mapping(), applyCtx());
    const b = applyMapping(row(), mapping(), applyCtx());
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(applyMapping(row(), withName, applyCtx()).sourceHash).not.toBe(
      a.sourceHash,
    );
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [LINE_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});

describe("expense_line custom transforms", () => {
  const base = { Id: LINE_1 };

  it("eventRef prefers the own event, falls back to the header's (flattened or nested), and reports unresolved", () => {
    const ctx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Event_vod__c", target: "event__v" },
      targetField: { name: "event__v", type: "object" },
      ids,
    });
    expect(
      eventRef(EVENT_1, { ...base, [HEADER_EVENT_COLUMN]: EVENT_2 }, ctx),
    ).toEqual({ value: { $fk: { object: "em_event", sfdcId: EVENT_1 } } });
    expect(
      eventRef("", { ...base, [HEADER_EVENT_COLUMN]: EVENT_2 }, ctx),
    ).toEqual({ value: { $fk: { object: "em_event", sfdcId: EVENT_2 } } });
    expect(
      eventRef(
        undefined,
        { ...base, Expense_Header_vod__r: { Event_vod__c: EVENT_2 } },
        ctx,
      ),
    ).toEqual({ value: { $fk: { object: "em_event", sfdcId: EVENT_2 } } });
    expect(eventRef(null, base, ctx)).toBeUndefined();
    const unknown = to18("a0E000000000077");
    expect(eventRef(unknown, base, ctx)).toMatchObject({
      value: { $fk: { object: "em_event", sfdcId: unknown } },
      unresolved: { objectKey: "em_event", sfdcId: unknown },
    });
  });

  it("budgetRefDropped omits with a non-fatal EM_BUDGET_REF_DROPPED diagnostic and ignores blanks", () => {
    const ctx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Event_Budget_vod__c", target: "event_budget__v" },
    });
    const r = budgetRefDropped(to18("a0B000000000001"), base, ctx);
    expect(r).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "out_of_scope_ref_dropped",
        field: "event_budget__v",
        code: EM_BUDGET_REF_DROPPED,
        value: BUDGET_1,
      },
    });
    expect(
      (r as { diagnostic?: { fatal?: boolean } }).diagnostic?.fatal,
    ).toBeUndefined();
    expect(budgetRefDropped("", base, ctx)).toBeUndefined();
    expect(budgetRefDropped(undefined, base, ctx)).toBeUndefined();
  });

  it("expenseTypeAuto picks ref / picklist / text by target type and refuses a foreign object reference", () => {
    const refCtx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Expense_Type_vod__c", target: "expense_type__v" },
      targetField: {
        name: "expense_type__v",
        type: "object",
        referenceObject: "em_catalog__v",
      },
      ids,
    });
    expect(expenseTypeAuto(CATALOG_1, base, refCtx)).toEqual({
      value: { $fk: { object: "em_catalog", sfdcId: CATALOG_1 } },
    });
    const pickCtx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Expense_Type_vod__c", target: "expense_type__v" },
      targetField: {
        name: "expense_type__v",
        type: "picklist",
        picklistValues: ["travel__v"],
      },
    });
    expect(expenseTypeAuto("Travel_vod", base, pickCtx)).toMatchObject({
      value: "travel__v",
    });
    const textCtx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Expense_Type_vod__c", target: "expense_type__v" },
      targetField: { name: "expense_type__v", type: "string", maxLength: 100 },
    });
    expect(expenseTypeAuto(" Travel ", base, textCtx)).toEqual({
      value: "Travel",
    });
    const foreignCtx = buildTransformContext({
      objectKey: "expense_line",
      field: { source: "Expense_Type_vod__c", target: "expense_type__v" },
      targetField: {
        name: "expense_type__v",
        type: "object",
        referenceObject: "expense_type__v",
      },
    });
    expect(expenseTypeAuto(CATALOG_1, base, foreignCtx)).toMatchObject({
      omit: true,
      diagnostic: { code: "EXPENSE_TYPE_TARGET_UNSUPPORTED" },
    });
    expect(expenseTypeAuto("", base, refCtx)).toBeUndefined();
  });
});
