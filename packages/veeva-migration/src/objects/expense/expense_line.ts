/**
 * `expense_line` — `Expense_Line_vod__c` `[UNVERIFIED-SOURCE object]` →
 * `expense_line__v` `[OBS]` (spec §6.3.25b, §6.1 step 12b, §6.2, §6.2.1,
 * §3.3, §4.4).
 *
 * Master-detail child of `expense_header` (transfer-of-value evidence,
 * `retentionFamily: "tov"`). Every `*_vod__c` source is the inverse rename of
 * the observed target and carries `unverifiedSource: true` (describe miss =
 * `info`, row dropped). Optional like its parent; loaded with
 * `noTriggers = true`; pure child rows are **deleted** with the parent
 * (`deletePolicy: "delete"`, §4.4).
 *
 * Scope (§6.2): via parent `Expense_Header_vod__r…`. The header is scoped on
 * two dates (`Event_vod__r.Start_Time_vod__c` ∨ `Payment_Date_vod__c`), and a
 * `via-parent` rule carries a single `parentField` — its second term could
 * only travel as a parent open predicate, which `extract/scope.ts` prefixes
 * with everything before the last dot of `parentField` (the *event*
 * relationship for a two-hop path), producing an invalid field. The line is
 * therefore `dated` with both header terms spelled through
 * `Expense_Header_vod__r.`: a line is in scope exactly when its header is,
 * with no dependence on how the engine passes parent open terms. Rendered:
 * `Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c >= {cutoff}T00:00:00Z OR Expense_Header_vod__r.Payment_Date_vod__c >= {cutoff}`.
 *
 * Block S opt-outs: `Name` follows the autoNumber rule; no `OwnerId`
 * (master-detail children have no owner column); `CurrencyIsoCode` is on.
 *
 * Custom transforms (pure, unit-tested in `expense_line.test.ts`):
 *  - `eventRef`         `Event_vod__c → event__v` (`ref(em_event)`), "derived
 *                       from the header when absent": falls back to the
 *                       header's `Expense_Header_vod__r.Event_vod__c` when the
 *                       row carries it (flattened or nested).
 *  - `budgetRefDropped` `Event_Budget_vod__c → event_budget__v`: EM budgets
 *                       are out of v1 (§6.2.1) — omitted and counted through
 *                       a non-fatal `EM_BUDGET_REF_DROPPED` diagnostic.
 *  - `expenseTypeAuto`  `Expense_Type_vod__c → expense_type__v`:
 *                       `ref(em_catalog)` when the target is an Object
 *                       reference to `em_catalog__v`, `picklist(expense_line.expenseType)`
 *                       when it is a Picklist, `text` otherwise.
 */
import { readSource } from "../../transform/apply";
import { isSfdcId, to18 } from "../../transform/ids";
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformSpec } from "../../types";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers (local copies — no coupling to other families)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Relationship column of the header's event, read by `eventRef` as the fallback. */
export const HEADER_EVENT_COLUMN = "Expense_Header_vod__r.Event_vod__c";
/** Picklist map key of the expense-type crosswalk (used when `expense_type__v` is a Picklist). */
export const EXPENSE_LINE_TYPE_MAP_KEY = "expense_line.expenseType";
/** Diagnostic code of the omit+count rule for `event_budget__v` (§6.2.1). */
export const EM_BUDGET_REF_DROPPED = "EM_BUDGET_REF_DROPPED";

/** `event__v`: own `Event_vod__c`, else the header's event (`HEADER_EVENT_COLUMN`), as `ref(em_event)`. */
export const eventRef: CustomTransformFn = (value, row, ctx) => {
  const own = isEmpty(value) ? undefined : value;
  const fromHeader = readSource(row, HEADER_EVENT_COLUMN);
  const effective = own ?? (isEmpty(fromHeader) ? undefined : fromHeader);
  if (effective === undefined) return undefined;
  const spec: TransformSpec = { kind: "ref", objectKey: "em_event" };
  return applyTransform(spec, effective, row, ctx);
};

/** `event_budget__v`: omit + count `EM_BUDGET_REF_DROPPED` (non-fatal); blanks are simply omitted. */
export const budgetRefDropped: CustomTransformFn = (value, _row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_scope_ref_dropped",
      field: ctx.field.target,
      code: EM_BUDGET_REF_DROPPED,
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail:
        "Event_Budget_vod__c references EM_Event_Budget_vod__c, out of v1 (§6.2.1)",
    },
  };
};

/** `expense_type__v`: `ref(em_catalog)` | `picklist(expense_line.expenseType)` | `text` by target type. */
export const expenseTypeAuto: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const type = ctx.targetField?.type;
  const referenceObject = ctx.targetField?.referenceObject;
  let spec: TransformSpec;
  if (
    type === "object" &&
    (referenceObject === undefined || referenceObject === "em_catalog__v")
  )
    spec = { kind: "ref", objectKey: "em_catalog" };
  else if (type === "object")
    return {
      omit: true,
      diagnostic: {
        kind: "unresolved_fk",
        field: ctx.field.target,
        code: "EXPENSE_TYPE_TARGET_UNSUPPORTED",
        value: String(value).trim(),
        detail: `expense_type__v references ${referenceObject}, not em_catalog__v`,
      },
    };
  else if (type === "picklist")
    spec = { kind: "picklist", mapKey: EXPENSE_LINE_TYPE_MAP_KEY };
  else spec = { kind: "text" };
  return applyTransform(spec, value, row, ctx);
};

export const expense_line = defineObject({
  key: "expense_line",
  source: "Expense_Line_vod__c",
  target: "expense_line__v",
  targetEvidence: "OBS",
  // §6.2: via parent `Expense_Header_vod__r…` — both header terms mirrored
  // through the relationship (see header comment for why not `via-parent`).
  scope: {
    kind: "dated",
    predicates: [
      {
        field: "Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c",
        type: "datetime",
      },
      { field: "Expense_Header_vod__r.Payment_Date_vod__c", type: "date" },
    ],
    retentionFamily: "tov",
  },
  countryOf: "parent:expense_header:Expense_Header_vod__c",
  // §6.2 lists expense_header, em_event; em_catalog is added because
  // `expense_type__v` may resolve as ref(em_catalog) (step 10, no cycle).
  dependsOn: ["expense_header", "em_event", "em_catalog"],
  // Master-detail child: auto-number Name, no OwnerId; amounts carry a currency.
  blockS: { name: "autoNumber", ownerId: false, currency: true },
  fields: [
    // --- §6.3.25b rows
    {
      source: "Expense_Header_vod__c",
      target: "expense_header__v",
      transform: "ref(expense_header)",
      required: "Y",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] master-detail parent; unresolved → pending_fk (§3.5)",
    },
    {
      source: "Event_vod__c",
      target: "event__v",
      transform: "custom(eventRef)",
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] ref(em_event); derived from the header (Expense_Header_vod__r.Event_vod__c) when absent",
    },
    {
      source: "Event_Budget_vod__c",
      target: "event_budget__v",
      transform: "custom(budgetRefDropped)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] ref→EM_Event_Budget_vod__c is out of v1: omitted and counted (EM_BUDGET_REF_DROPPED, §6.2.1)",
    },
    {
      source: "Expense_Type_vod__c",
      target: "expense_type__v",
      transform: "custom(expenseTypeAuto)",
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      countryConfigurable: true,
      notes:
        "[UNVERIFIED-SOURCE] ref(em_catalog) when the target references em_catalog__v, else picklist(expense_line.expenseType) / text; crosswalk per country",
    },
    {
      source: "Expense_Type_Name_vod__c",
      target: "expense_type_name__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "string",
      countryConfigurable: true,
      notes: "[UNVERIFIED-SOURCE] text snapshot of the expense type name",
    },
    {
      source: "Actual_vod__c",
      target: "actual__v",
      transform: "number",
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "currency",
      notes: "[UNVERIFIED-SOURCE] amount (y? actual)",
    },
    {
      source: "Committed_vod__c",
      target: "committed__v",
      transform: "number",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "currency",
      notes: "[UNVERIFIED-SOURCE] amount",
    },
    {
      source: "CurrencyIsoCode",
      target: "local_currency__sys",
      transform: "currency",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes: "multi-currency orgs only (Block S); value form probed (§5.3 #15)",
    },
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "longtext",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "textarea",
      notes: "[UNVERIFIED-SOURCE]",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "y?",
      evidence: "OBS",
      enabledBy: "preserveAutoNumberName",
      notes:
        "autoNumber rule (§6.0.4): skipped unless objects.expense_line.preserveAutoNumberName — Vault assigns its own sequence",
    },
  ],
  // No documented value list: derivation rule (strip `_vod`, lowercase, `__v`)
  // validated against the target; overlays add entries under this key.
  picklists: { [EXPENSE_LINE_TYPE_MAP_KEY]: {} },
  objectTypes: {},
  states: {},
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "UNV",
      notes:
        "external_id__v = External_ID_vod__c when the target has the field (§3.3 'if present')",
    },
  ],
  custom: { eventRef, budgetRefDropped, expenseTypeAuto },
  optionDefaults: { optional: true },
  notes:
    "Master-detail child of expense_header (§6.3.25b): optional, scoped through the header's event start time (+ the header's payment-date term via parentOpenPredicate), widened by scope.tovRetentionMonths; deleted with the parent (§4.4); event_budget__v omitted and counted (EM_BUDGET_REF_DROPPED); noTriggers = true.",
});
