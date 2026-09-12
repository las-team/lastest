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
 * two dates (`Event_vod__r.Start_Time_vod__c` ∨ `Payment_Date_vod__c`) plus
 * the event's open-item term (§1.1 #4), and a `via-parent` rule carries a
 * single `parentField` — so the line is `dated` with all three header terms
 * spelled through `Expense_Header_vod__r.`: a line is in scope exactly when
 * its header is. Rendered:
 * `(Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c >= {cutoff}T00:00:00Z OR Expense_Header_vod__r.Payment_Date_vod__c >= {cutoff}) OR ((Expense_Header_vod__r.Event_vod__r.End_Time_vod__c >= {cutoff}T00:00:00Z) OR (Expense_Header_vod__r.Event_vod__r.Status_vod__c NOT IN (…closed…)))`.
 *
 * FK rows are **plain `ref(...)`** so the engine sees them: the transform-time
 * id-map snapshot (`referenceColumns`), the §2.2 step 5 closure
 * (`mappingFkColumns`), the preflight FK checks and the
 * `MAP_FK_PARENT_NOT_IN_PLAN` lint all read `refTarget()`, which a
 * `custom(...)` transform would hide (see `product.parent_product__v`).
 *  - `event__v` is read from the **header's** event
 *    (`Expense_Header_vod__r.Event_vod__c`, `HEADER_EVENT_COLUMN`): a line
 *    cannot belong to another event than its master-detail header, the
 *    header's `Event_vod__c` is required there, and the line's own
 *    `Event_vod__c` is `[UNVERIFIED-SOURCE]`. This is the spec's "derived from
 *    the header when absent" made unconditional; an org whose lines carry an
 *    authoritative own event overrides the source through
 *    `objects.expense_line.fields.override`.
 *  - `expense_type__v` defaults to `ref(em_catalog)` (the spec default "when
 *    the target is an object reference to `em_catalog__v`"). A vault whose
 *    `expense_type__v` is a Picklist/String fails preflight's VT type check
 *    (`VT_TYPE_INCOMPATIBLE`) for this row; the fix is the documented override
 *    to `picklist(expense_line.expenseType)` / `text` — the
 *    `expense_line.expenseType` crosswalk key is registered for that purpose.
 *
 * Block S opt-outs: `Name` follows the autoNumber rule; no `OwnerId`
 * (master-detail children have no owner column); `CurrencyIsoCode` is on.
 *
 * Custom transform (pure, unit-tested in `expense_line.test.ts`):
 *  - `budgetRefDropped` `Event_Budget_vod__c → event_budget__v`: EM budgets
 *                       are out of v1 (§6.2.1) — omitted and counted through
 *                       a non-fatal `EM_BUDGET_REF_DROPPED` diagnostic.
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type { CustomTransformFn } from "../../types";
import { defineObject } from "../types";
import { emEventOpenTerm } from "./expense_header";

// ---------------------------------------------------------------------------
// helpers (local copies — no coupling to other families)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Source of `event__v`: the header's event through the master-detail relationship. */
export const HEADER_EVENT_COLUMN = "Expense_Header_vod__r.Event_vod__c";
/** Picklist map key of the expense-type crosswalk (override `expense_type__v` to `picklist(expense_line.expenseType)` when the target is a Picklist). */
export const EXPENSE_LINE_TYPE_MAP_KEY = "expense_line.expenseType";
/** Diagnostic code of the omit+count rule for `event_budget__v` (§6.2.1). */
export const EM_BUDGET_REF_DROPPED = "EM_BUDGET_REF_DROPPED";
/** Relationship prefix of the header's event as seen from a line. */
export const LINE_EVENT_PREFIX = "Expense_Header_vod__r.Event_vod__r.";
/**
 * §1.1 #4 open-item term of the header's event, mirrored through
 * `Expense_Header_vod__r.Event_vod__r.` (same shape as the header's, one hop
 * further; the prefixes are written literally so the `{cutoffDateTime}` token
 * survives untouched).
 */
export const EXPENSE_LINE_OPEN_PREDICATE = emEventOpenTerm(LINE_EVENT_PREFIX);

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

export const expense_line = defineObject({
  key: "expense_line",
  source: "Expense_Line_vod__c",
  target: "expense_line__v",
  targetEvidence: "OBS",
  // §6.2: via parent `Expense_Header_vod__r…` — every header term mirrored
  // through the relationship (see header comment for why not `via-parent`).
  scope: {
    kind: "dated",
    predicates: [
      {
        field: `${LINE_EVENT_PREFIX}Start_Time_vod__c`,
        type: "datetime",
      },
      { field: "Expense_Header_vod__r.Payment_Date_vod__c", type: "date" },
    ],
    openPredicate: EXPENSE_LINE_OPEN_PREDICATE,
    retentionFamily: "tov",
  },
  countryOf: "parent:expense_header:Expense_Header_vod__c",
  // §6.2 lists expense_header, em_event; em_catalog is added because
  // `expense_type__v` defaults to ref(em_catalog) (step 10, no cycle).
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
      source: HEADER_EVENT_COLUMN,
      target: "event__v",
      transform: "ref(em_event)",
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] ref(em_event) read from the header's event (Expense_Header_vod__r.Event_vod__c — the spec's 'derived from the header' made unconditional, keeps the FK visible to the engine); override the source to Event_vod__c when the line's own lookup is authoritative",
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
      transform: "ref(em_catalog)",
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      countryConfigurable: true,
      notes:
        "[UNVERIFIED-SOURCE] ref(em_catalog) — the spec default for an em_catalog__v reference target; when preflight reports VT_TYPE_INCOMPATIBLE (Picklist/String target) override to picklist(expense_line.expenseType) / text; crosswalk per country",
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
  // validated against the target; overlays add entries under this key. Used
  // only once `expense_type__v` is overridden to `picklist(expense_line.expenseType)`.
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
  custom: { budgetRefDropped },
  optionDefaults: { optional: true },
  notes:
    "Master-detail child of expense_header (§6.3.25b): optional; scoped `dated` with the header's terms mirrored through Expense_Header_vod__r (event start time ∨ payment date ∨ the event open-item term), widened by scope.tovRetentionMonths; event__v read from the header's event; deleted with the parent (§4.4); event_budget__v omitted and counted (EM_BUDGET_REF_DROPPED); noTriggers = true.",
});
