/**
 * `expense_header` — `Expense_Header_vod__c` `[UNVERIFIED-SOURCE object]` →
 * `expense_header__v` `[OBS full field list]` (spec §6.3.25a, §6.1 step 12b,
 * §6.2, §3.3, §3.5, §4.4).
 *
 * Transfer-of-value evidence (Sunshine Act / EFPIA): the object family that
 * `scope.tovRetentionMonths` widens (`retentionFamily: "tov"`). The source
 * object and every `*_vod__c` field name are the **inverse rename** of the
 * observed target (`expense_header__v.payee__v` ← `Payee_vod__c`), so all of
 * them carry `unverifiedSource: true` — preflight confirms them through
 * `describeGlobal`/`describe`; a describe miss is `info` and the row is
 * dropped, never a thrown error. The module is optional by default
 * (`objects.expense_header.optional = true`): an org without EM expenses
 * auto-disables it with `warning SF_OBJECT_MISSING`.
 *
 * Scope (§6.2): "via parent `Event_vod__r.Start_Time_vod__c` ∨
 * `Payment_Date_vod__c`". A `via-parent` rule carries a single `parentField`
 * and cannot add an own secondary date, so the header is `dated` with two
 * predicates — the parent's start time through the relationship path and
 * the secondary date (`payment_date__v`, "secondary scope date") — plus the
 * parent event's open-item term as `openPredicate` (§1.1 #4: an EM event
 * with an end time in the future or a status ∉ closed/cancelled is always in
 * scope, and so is its ToV evidence; the extractor gives `em_attendee` /
 * `em_event_speaker` the same term automatically through `via-parent`, here
 * it is spelled through `Event_vod__r.` by hand — `EXPENSE_HEADER_OPEN_PREDICATE`).
 * Rendered SOQL (`extract/scope.ts`):
 * `(Event_vod__r.Start_Time_vod__c >= {cutoff}T00:00:00Z OR Payment_Date_vod__c >= {cutoff}) OR ((Event_vod__r.End_Time_vod__c >= {cutoff}T00:00:00Z) OR (Event_vod__r.Status_vod__c NOT IN (…closed…)))`.
 * `expense_line` mirrors every term through `Expense_Header_vod__r.` so a
 * line is in scope exactly when its header is.
 *
 * Load: `noTriggers = true` — Vault EM expense triggers roll amounts into
 * `em_event__v.actual_cost__v`, which `em_event` loads verbatim. Deletes are
 * `ignore` (regulated transactional rows, §4.4) so `inactivate` is empty.
 *
 * Match (§3.3): id map → legacy id → `external_id__v` (if present) → header
 * natural key `(event__v, payee, payment_date__v)` (warning-level review).
 *
 * Custom transforms (pure, unit-tested in `expense_header.test.ts`):
 *  - `payeeAuto`  `Payee_vod__c → payee__v`: the target is "text/picklist of
 *                 payee kind `[UNV type]`" — `picklist(expense_header.payee)`
 *                 when the target is a Picklist, `text` otherwise. Contact ids
 *                 are dropped and counted (`CONTACT_REF_DROPPED`); any other
 *                 raw SFDC id is refused (a polymorphic lookup is carried by
 *                 the five typed `incurred_expense_*`/`payee_*` references).
 */
import { isContactId, isSfdcId, to18 } from "../../transform/ids";
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformSpec } from "../../types";
import { EM_EVENT_CLOSED_STATUSES } from "../em_event/em_event";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers (local copies — no coupling to other families)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Picklist map key of the payee-kind crosswalk (country overlay `picklists.maps`). */
export const EXPENSE_HEADER_PAYEE_MAP_KEY = "expense_header.payee";
/** Picklist map key of the business status crosswalk (§6.0.2 status-field rule). */
export const EXPENSE_HEADER_STATUS_MAP_KEY = "expense_header.status";

/**
 * The EM event open-item term (§1.1 #4, same shape as
 * `em_event.EM_EVENT_OPEN_PREDICATE`: end time not before the cutoff ∨ status
 * ∉ `EM_EVENT_CLOSED_STATUSES`) seen through a relationship `prefix`
 * (`Event_vod__r.` from a header, `Expense_Header_vod__r.Event_vod__r.` from a
 * line). The prefix is written into the field paths directly: the
 * `{cutoffDateTime}` token must reach `renderOpenPredicate` untouched, which
 * `prefixPredicateFields` over the unrendered text would not guarantee.
 */
export function emEventOpenTerm(prefix: string): string {
  const p = prefix.endsWith(".") ? prefix : `${prefix}.`;
  const closed = EM_EVENT_CLOSED_STATUSES.map((s) => `'${s}'`).join(", ");
  return `(${p}End_Time_vod__c >= {cutoffDateTime}) OR (${p}Status_vod__c NOT IN (${closed}))`;
}

/** Open-item term of the header's parent event through `Event_vod__r.` (§1.1 #4, §6.2). */
export const EXPENSE_HEADER_OPEN_PREDICATE = emEventOpenTerm("Event_vod__r.");

/**
 * `payee__v` `[UNV type]`: picklist crosswalk when the target is a Picklist,
 * cleaned text otherwise. Raw SFDC ids never land in a text/picklist field.
 */
export const payeeAuto: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  if (isSfdcId(raw)) {
    if (isContactId(raw))
      return {
        omit: true,
        diagnostic: {
          kind: "contact_ref_dropped",
          field: ctx.field.target,
          code: "CONTACT_REF_DROPPED",
          value: to18(raw),
        },
      };
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: ctx.field.target,
        code: "PAYEE_ID_NOT_LOADABLE",
        value: to18(raw),
        detail:
          "Payee_vod__c holds an SFDC id; the typed payee references carry the lookup",
      },
    };
  }
  const spec: TransformSpec =
    ctx.targetField?.type === "picklist"
      ? { kind: "picklist", mapKey: EXPENSE_HEADER_PAYEE_MAP_KEY }
      : { kind: "text" };
  return applyTransform(spec, raw, row, ctx);
};

export const expense_header = defineObject({
  key: "expense_header",
  source: "Expense_Header_vod__c",
  target: "expense_header__v",
  targetEvidence: "OBS",
  // §6.2: via parent Event_vod__r.Start_Time_vod__c ∨ Payment_Date_vod__c,
  // ∨ the parent event's open-item term (§1.1 #4) — see header comment.
  scope: {
    kind: "dated",
    predicates: [
      { field: "Event_vod__r.Start_Time_vod__c", type: "datetime" },
      { field: "Payment_Date_vod__c", type: "date" },
    ],
    openPredicate: EXPENSE_HEADER_OPEN_PREDICATE,
    retentionFamily: "tov",
  },
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: [
    "em_event",
    "em_attendee",
    "em_event_speaker",
    "em_venue",
    "account",
    "user",
  ],
  // Name follows the autoNumber rule (§6.0.4); currency fields exist on the header.
  blockS: { name: "autoNumber", currency: true },
  fields: [
    // --- §6.3.25a rows (same-target rows replace the Block S defaults)
    {
      source: "Event_vod__c",
      target: "event__v",
      transform: "ref(em_event)",
      required: "Y",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] ref→EM_Event_vod__c; unresolved → pending_fk (§3.5)",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "y?",
      evidence: "OBS",
      enabledBy: "preserveAutoNumberName",
      notes:
        "autoNumber rule (§6.0.4): skipped unless objects.expense_header.preserveAutoNumberName — Vault assigns its own sequence",
    },
    {
      source: "Payee_vod__c",
      target: "payee__v",
      transform: "custom(payeeAuto)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE]; target name [OBS], type [UNV]: picklist(expense_header.payee) when Picklist, text otherwise",
    },
    {
      source: "Incurred_Expense_Attendee_vod__c",
      target: "incurred_expense_attendee__v",
      transform: "ref(em_attendee)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] payee lookup (attendee) — observed target field set",
    },
    {
      source: "Incurred_Expense_Speaker_vod__c",
      target: "incurred_expense_speaker__v",
      transform: "ref(em_event_speaker)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] payee lookup (event speaker) — observed target field set",
    },
    {
      source: "Incurred_Expense_Venue_vod__c",
      target: "incurred_expense_venue__v",
      transform: "ref(em_venue)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] payee lookup (venue) — observed target field set",
    },
    {
      source: "Payee_Account_vod__c",
      target: "payee_account__v",
      transform: "ref(account)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] payee lookup (account) — observed target field set",
    },
    {
      source: "Payee_Venue_vod__c",
      target: "payee_venue__v",
      transform: "ref(em_venue)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "[UNVERIFIED-SOURCE] payee lookup (venue paid) — observed target field set",
    },
    {
      source: "Status_vod__c",
      target: "expense_header_status__v",
      transform: `picklist(${EXPENSE_HEADER_STATUS_MAP_KEY})`,
      required: "y?",
      evidence: "OBS",
      unverifiedSource: true,
      // No `sourceType`: the name is guessed (§9.3 item 32b), and a declared
      // `picklist` on a String-typed field would raise a blocking
      // SF_FIELD_TYPE_MISMATCH (no auto-switch) instead of degrading — the
      // picklist transform reads a string source just as well.
      countryConfigurable: true,
      notes:
        "[UNVERIFIED-SOURCE]; business status per the §6.0.2 status-field rule ({object}_status__v [OBS]); crosswalk per country; source type undeclared until preflight confirms the field",
    },
    {
      source: "Payment_Date_vod__c",
      target: "payment_date__v",
      transform: "date",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "date",
      notes: "[UNVERIFIED-SOURCE]; secondary scope date (§6.2)",
    },
    {
      source: "Actual_vod__c",
      target: "actual__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      sourceType: "currency",
      notes:
        "[UNVERIFIED-SOURCE] amount; target [UNV] on the header (OBS only on expense_line) — preflight drops it when absent",
    },
    {
      source: "Committed_vod__c",
      target: "committed__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      sourceType: "currency",
      notes:
        "[UNVERIFIED-SOURCE] amount; target [UNV] on the header (OBS only on expense_line) — preflight drops it when absent",
    },
    {
      source: "CurrencyIsoCode",
      target: "local_currency__sys",
      transform: "currency",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes:
        "multi-currency orgs only (Block S); value form probed (§5.3 #15); target [UNV] on the header",
    },
    // `OwnerId → ownerid__v` (if present, refUser, n, UNV) is the Block S default row —
    // preflight drops it when the target object has no ownerid__v (§6.0.4).
  ],
  // No documented value lists: the §6.0.2 derivation rule applies (strip `_vod`,
  // lowercase, `__v`), validated against the target's active values; country
  // overlays add entries under these keys (`expense_header.status` is CC = Y).
  picklists: {
    [EXPENSE_HEADER_STATUS_MAP_KEY]: {},
    [EXPENSE_HEADER_PAYEE_MAP_KEY]: {},
  },
  objectTypes: {},
  states: {},
  deletePolicy: "ignore",
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
    {
      method: "natural_key",
      keys: [
        { target: "event__v", source: "Event_vod__c" },
        { target: "payee__v", source: "Payee_vod__c" },
        { target: "payment_date__v", source: "Payment_Date_vod__c" },
      ],
      sameCountry: true,
      evidence: "UNV",
      notes:
        "header natural key (event__v, payee, payment_date__v) — reported as warning findings for review before init (§3.3)",
    },
  ],
  custom: { payeeAuto },
  optionDefaults: { optional: true },
  notes:
    "Transfer-of-value evidence (§6.3.25a): optional module (auto-disabled with SF_OBJECT_MISSING when the org has no EM expenses); scoped on the parent event start time OR payment date OR the parent event still open (§1.1 #4), widened by scope.tovRetentionMonths; noTriggers = true so Vault does not re-roll em_event__v.actual_cost__v; deletes ignored (§4.4).",
});
