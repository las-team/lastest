import { describe, expect, it } from "vitest";
import {
  EM_BUDGET_REF_DROPPED,
  EXPENSE_LINE_OPEN_PREDICATE,
  EXPENSE_LINE_TYPE_MAP_KEY,
  HEADER_EVENT_COLUMN,
  LINE_EVENT_PREFIX,
  budgetRefDropped,
  expense_line,
} from "./expense_line";
import {
  EXPENSE_HEADER_OPEN_PREDICATE,
  expense_header,
} from "./expense_header";
import { EM_EVENT_CLOSED_STATUSES } from "../em_event/em_event";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildColumnList, mappingFkColumns } from "../../extract/columns";
import { buildScopePredicate } from "../../extract/scope";
import { referenceColumns } from "../../run/context";
import { refTarget } from "../../transform/spec";
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
      source: HEADER_EVENT_COLUMN,
      transform: { kind: "ref", objectKey: "em_event" },
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    });
    expect(byTarget.get("event_budget__v")).toMatchObject({
      transform: { kind: "custom", fnName: "budgetRefDropped" },
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    });
    expect(byTarget.get("expense_type__v")).toMatchObject({
      source: "Expense_Type_vod__c",
      transform: { kind: "ref", objectKey: "em_catalog" },
      required: "y?",
      evidence: "OBS",
      countryConfigurable: true,
      unverifiedSource: true,
      sourceType: "reference",
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

  it("is scoped via the header: every header term (dates + event open-item term) mirrored through Expense_Header_vod__r", () => {
    expect(expense_line.scope).toEqual({
      kind: "dated",
      predicates: [
        {
          field: "Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c",
          type: "datetime",
        },
        { field: "Expense_Header_vod__r.Payment_Date_vod__c", type: "date" },
      ],
      openPredicate: EXPENSE_LINE_OPEN_PREDICATE,
      retentionFamily: "tov",
    });
    expect(LINE_EVENT_PREFIX).toBe("Expense_Header_vod__r.Event_vod__r.");
    // §1.1 #4 open term of the header's event, one hop further than the header's
    expect(EXPENSE_LINE_OPEN_PREDICATE).toBe(
      `(Expense_Header_vod__r.Event_vod__r.End_Time_vod__c >= {cutoffDateTime}) OR (Expense_Header_vod__r.Event_vod__r.Status_vod__c NOT IN (${EM_EVENT_CLOSED_STATUSES.map(
        (st) => `'${st}'`,
      ).join(", ")}))`,
    );
    expect(EXPENSE_LINE_OPEN_PREDICATE).toBe(
      EXPENSE_HEADER_OPEN_PREDICATE.replaceAll(
        "Event_vod__r.",
        "Expense_Header_vod__r.Event_vod__r.",
      ),
    );
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
    const built = buildScopePredicate(m.scope);
    expect(built.kind).toBe("dated");
    expect(built.openTerm).toBe(
      "(Expense_Header_vod__r.Event_vod__r.End_Time_vod__c >= 2024-09-07T00:00:00Z) OR (Expense_Header_vod__r.Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod'))",
    );
    expect(built.predicate).toBe(
      "(Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c >= 2024-09-07T00:00:00Z OR Expense_Header_vod__r.Payment_Date_vod__c >= 2024-09-07) OR ((Expense_Header_vod__r.Event_vod__r.End_Time_vod__c >= 2024-09-07T00:00:00Z) OR (Expense_Header_vod__r.Event_vod__r.Status_vod__c NOT IN ('Closed_vod', 'Canceled_vod', 'Cancelled_vod')))",
    );
    // the token is rendered, never mangled by a prefix pass
    expect(built.predicate).not.toContain("{cutoff");
    expect(built.predicate).not.toContain("Expense_Header_vod__r.cutoff");
    // widened by the tov family, exactly like the header
    const wide = mapping(config({ scope: { tovRetentionMonths: 60 } }));
    expect(wide.scope.cutoffDate).toBe("2021-09-07");
    expect(buildScopePredicate(wide.scope).predicate).toContain(
      "Expense_Header_vod__r.Event_vod__r.End_Time_vod__c >= 2021-09-07T00:00:00Z",
    );
    expect(wide.options.deletePolicy).toBe("delete");
    expect(wide.options.optional).toBe(true);
  });

  it("exposes every FK as a plain ref the engine can see: id-map snapshot, closure columns, SELECT list, lint", () => {
    const m = mapping();
    // transform-time id resolver snapshot (run/context.ts buildUnitResolver)
    const refs = referenceColumns(m);
    expect(refs).toContainEqual({
      key: "expense_header",
      source: "Expense_Header_vod__c",
    });
    expect(refs).toContainEqual({
      key: "em_event",
      source: HEADER_EVENT_COLUMN,
    });
    expect(refs).toContainEqual({
      key: "em_catalog",
      source: "Expense_Type_vod__c",
    });
    // §2.2 step 5 closure id-sets (plain columns only; the header's event is
    // pulled by the header unit's own Event_vod__c)
    expect(mappingFkColumns(m)).toEqual(
      expect.arrayContaining([
        { column: "Expense_Header_vod__c", targetObjectKey: "expense_header" },
        { column: "Expense_Type_vod__c", targetObjectKey: "em_catalog" },
      ]),
    );
    // the SELECT list carries the header's event relationship column
    const cols = buildColumnList(m, undefined).columns;
    expect(cols).toContain(HEADER_EVENT_COLUMN);
    expect(cols).toContain("Expense_Type_vod__c");
    expect(cols).toContain("Expense_Header_vod__c");
    expect(cols).not.toContain("Event_vod__c");
    // MAP_FK_PARENT_NOT_IN_PLAN / preflight FK checks read refTarget()
    const byTarget = new Map(m.fields.map((f) => [f.target, f]));
    expect(refTarget(byTarget.get("event__v")!.transform)).toBe("em_event");
    expect(refTarget(byTarget.get("expense_type__v")!.transform)).toBe(
      "em_catalog",
    );
    expect(refTarget(byTarget.get("expense_header__v")!.transform)).toBe(
      "expense_header",
    );
    // no custom row hides a reference
    for (const f of m.fields)
      if (f.transform.kind === "custom")
        expect(f.target, `${f.target} is not a reference`).toBe(
          "event_budget__v",
        );
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

  it("reads event__v from the header's event (flattened bulk column or nested REST shape), ignoring a line-level Event_vod__c", () => {
    const flat = applyMapping(
      row({ [HEADER_EVENT_COLUMN]: EVENT_2, Event_vod__c: EVENT_1 }),
      mapping(),
      applyCtx(),
    );
    expect(flat.status).toBe("ok");
    expect(flat.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_2 },
    });
    const base = row();
    delete base[HEADER_EVENT_COLUMN];
    const nested = applyMapping(
      { ...base, Expense_Header_vod__r: { Event_vod__c: EVENT_2 } },
      mapping(),
      applyCtx(),
    );
    expect(nested.status).toBe("ok");
    expect(nested.payload.event__v).toEqual({
      $fk: { object: "em_event", sfdcId: EVENT_2 },
    });
    // header event unmapped: optional lookup → omitted + reported, row still loads
    const unknown = to18("a0E000000000077");
    const unresolved = applyMapping(
      row({ [HEADER_EVENT_COLUMN]: unknown }),
      mapping(),
      applyCtx(),
    );
    expect(unresolved.status).toBe("ok");
    expect(unresolved.unresolvedOptionalFks).toEqual([
      { field: "event__v", objectKey: "em_event", sfdcId: unknown },
    ]);
    // absent: optional lookup (target not required) → omitted, row still loads
    const none = applyMapping(
      row({ [HEADER_EVENT_COLUMN]: "" }),
      mapping(),
      applyCtx(),
    );
    expect(none.status).toBe("ok");
    expect(none.payload.event__v).toBeUndefined();
    // an org whose lines carry an authoritative own event overrides the source
    const own = mapping(
      config({
        objects: {
          expense_line: {
            fields: {
              override: [
                {
                  source: "Event_vod__c",
                  target: "event__v",
                  transform: "ref(em_event)",
                },
              ],
            },
          },
        },
      }),
    );
    expect(referenceColumns(own)).toContainEqual({
      key: "em_event",
      source: "Event_vod__c",
    });
    expect(
      applyMapping(row({ Event_vod__c: EVENT_1 }), own, applyCtx()).payload
        .event__v,
    ).toEqual({ $fk: { object: "em_event", sfdcId: EVENT_1 } });
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

  it("resolves expense_type__v through the documented override when the target is a picklist or text", () => {
    const withTransform = (transform: string) =>
      mapping(
        config({
          objects: {
            expense_line: {
              fields: {
                override: [
                  {
                    source: "Expense_Type_vod__c",
                    target: "expense_type__v",
                    transform,
                  },
                ],
              },
            },
          },
        }),
      );
    const picklist = withTransform(`picklist(${EXPENSE_LINE_TYPE_MAP_KEY})`);
    expect(picklist.findings.map((f) => f.code)).not.toContain(
      "MAP_OVERRIDE_TARGET_UNKNOWN",
    );
    // the crosswalk key is registered on the module for exactly this override
    expect(picklist.picklists[EXPENSE_LINE_TYPE_MAP_KEY]).toEqual({});
    const pick = applyMapping(
      row({ Expense_Type_vod__c: "Catering_vod" }),
      picklist,
      applyCtx({ metadata: metadata({ expenseType: "Picklist" }) }),
    );
    expect(pick.status).toBe("ok");
    expect(pick.payload.expense_type__v).toBe("catering__v");
    // the catalog reference is gone from the resolver's column set
    expect(referenceColumns(picklist).map((c) => c.key)).not.toContain(
      "em_catalog",
    );
    const text = applyMapping(
      row({ Expense_Type_vod__c: " Catering " }),
      withTransform("text"),
      applyCtx({ metadata: metadata({ expenseType: "String" }) }),
    );
    expect(text.status).toBe("ok");
    expect(text.payload.expense_type__v).toBe("Catering");
    // unmapped picklist value under the error policy fails the row
    const bad = applyMapping(
      row({ Expense_Type_vod__c: "Bogus_vod" }),
      picklist,
      applyCtx({ metadata: metadata({ expenseType: "Picklist" }) }),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("expense_type__v");
    // default mapping, catalog id unmapped: optional lookup → omitted + reported
    const unknown = to18("a0T000000000077");
    const unresolved = applyMapping(
      row({ Expense_Type_vod__c: unknown }),
      mapping(),
      applyCtx(),
    );
    expect(unresolved.status).toBe("ok");
    expect(unresolved.unresolvedOptionalFks).toEqual([
      { field: "expense_type__v", objectKey: "em_catalog", sfdcId: unknown },
    ]);
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
});
