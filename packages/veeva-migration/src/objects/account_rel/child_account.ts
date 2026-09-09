/**
 * `child_account` — `Child_Account_vod__c` → `child_account__v` (spec §6.3.9
 * `[DOC]`, all fields `[UNV]`; §6.1 step 6, §6.2, §3.3, §4.4).
 *
 * Hub child of `account` in both directions (`Parent_Account_vod__c`,
 * `Child_Account_vod__c`): full scope, country inherited from the **parent**
 * account (`parent:account:Parent_Account_vod__c`, §6.2), loaded after
 * `account` with triggers **on** (`noTriggers = false`, §2.5.4 master data) so
 * Vault's own hierarchy logic runs.
 *
 * `External_ID_vod__c` is Veeva's composite `{ParentId}__{ChildId}` (unique
 * 40). With `objects.child_account.rewriteCompositeExternalId = true`
 * (default, §3.2) it is re-issued as `{parentVaultId}__{childVaultId}` — a
 * `$composite` deferred value the loader renders from the id map — otherwise
 * copied verbatim (`custom(childAccountExternalId)`). The legacy-id field
 * still carries the row's own SFDC Id.
 *
 * `name__v` is probably system-managed on `child_account__v` (§6.3.9
 * "omit unless required") — the row is `y?`: sent when the target metadata
 * says `name__v` is required, otherwise the `preserveName` opt-out applies.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only (no business flag).
 */
import { applyTransform } from "../../transform/registry";
import { renameField } from "../../transform/rename";
import type {
  CustomTransformFn,
  FieldMapping,
  TransformSpec,
} from "../../types";
import { defineObject } from "../types";

/** Parent side of the hierarchy row (also the country-of lookup, §6.2). */
export const CHILD_ACCOUNT_PARENT_FIELD = "Parent_Account_vod__c";
/** Child side of the hierarchy row (same name as the object, as in Veeva CRM). */
export const CHILD_ACCOUNT_CHILD_FIELD = "Child_Account_vod__c";

/** Composite `external_id__v` template written when `rewriteCompositeExternalId` holds (§3.2). */
export const CHILD_ACCOUNT_EXTERNAL_ID_TEMPLATE = "{p}__{c}";

/**
 * Formula / roll-up / transient columns of `Child_Account_vod__c` that are
 * never selected nor loaded (§6.3.9 last row). Vault recomputes them.
 */
export const CHILD_ACCOUNT_SKIPPED_SOURCES = [
  "Child_Name_vod__c",
  "Child_Furigana_vod__c",
  "Child_Record_Type_vod__c",
  "Child_Identifier_vod__c",
  "Parent_Name_vod__c",
  "Parent_Furigana_vod__c",
  "Parent_Record_Type_vod__c",
  "Parent_Identifier_vod__c",
  "Parent_Child_Name_vod__c",
  "Parent_Child_Furigana_vod__c",
  "Child_Account_Search_LastFirst_vod__c",
  "Formatted_Name_Furigana_vod__c",
  "Primary_vod__c",
] as const;

type Row = Omit<FieldMapping, "transform"> & {
  transform: TransformSpec | string;
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** `skip` rows: never selected, never loaded; targets follow the rename rule so they stay unique. */
export function childAccountSkipRows(): Row[] {
  return CHILD_ACCOUNT_SKIPPED_SOURCES.map((source) => ({
    source,
    target: renameField(source) ?? `${source.toLowerCase()}__v`,
    transform: "skip",
    required: "-",
    notes: "formula / roll-up — Vault recomputes (§6.3.9)",
  }));
}

/**
 * `external_id__v`: `{parentVaultId}__{childVaultId}` (deferred `$composite`,
 * resolved by the loader) when `rewriteCompositeExternalId` is on, else the
 * source value verbatim. An empty source is omitted in both modes — there is
 * nothing to rewrite and an integration-owned value is never invented.
 */
export const childAccountExternalId: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  if (ctx.mapping.options.rewriteCompositeExternalId) {
    return applyTransform(
      {
        kind: "compositeExternalId",
        template: CHILD_ACCOUNT_EXTERNAL_ID_TEMPLATE,
        parts: {
          p: { ref: "account", source: CHILD_ACCOUNT_PARENT_FIELD },
          c: { ref: "account", source: CHILD_ACCOUNT_CHILD_FIELD },
        },
      },
      value,
      row,
      ctx,
    );
  }
  return applyTransform({ kind: "copy" }, value, row, ctx);
};

export const child_account = defineObject({
  key: "child_account",
  source: "Child_Account_vod__c",
  target: "child_account__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: `parent:account:${CHILD_ACCOUNT_PARENT_FIELD}`,
  dependsOn: ["account"],
  // lookups (not master-detail) → OwnerId exists; no currency fields
  blockS: { currency: false },
  fields: [
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "y?",
      evidence: "UNV",
      sourceType: "string",
      disabledBy: "preserveName",
      notes:
        "likely system-managed in Vault — sent only when the target says name__v is required (§6.3.9)",
    },
    {
      source: CHILD_ACCOUNT_PARENT_FIELD,
      target: "parent_account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "country-of lookup (§6.2)",
    },
    {
      source: CHILD_ACCOUNT_CHILD_FIELD,
      target: "child_account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "same name as the object (as in Veeva CRM)",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "custom(childAccountExternalId)",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "{ParentId}__{ChildId} (unique 40) → {parentVaultId}__{childVaultId} via $composite when objects.child_account.rewriteCompositeExternalId (default true), else copy; must stay unique",
    },
    {
      source: "External_Key_vod__c",
      target: "external_key__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "string",
      notes: "text 100",
    },
    {
      source: "Hierarchy_Type_vod__c",
      target: "hierarchy_type__v",
      transform: "picklist(child_account.hierarchyType)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
      notes:
        "plain-English values in CRM — derived names validated at preflight; crosswalk per country",
    },
    {
      source: "Network_Primary_vod__c",
      target: "network_primary__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Copy_Address_vod__c",
      target: "copy_address__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Customer_Master_Status_vod__c",
      target: "customer_master_status__v",
      transform: "picklist(child_account.customerMasterStatus)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "picklist",
      notes: "Network status values (Valid_vod, Under_Review_vod, …)",
    },
    {
      source: "Location_Identifier_vod__c",
      target: "location_identifier__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "string",
    },
    {
      source: "Alternate_Name_vod__c",
      target: "alternate_name__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "string",
    },
    {
      source: "Best_Times_vod__c",
      target: "best_times__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "string",
    },
    {
      source: "Child_Affiliation_Count_vod__c",
      target: "child_affiliation_count__v",
      transform: "number(0)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "double",
      notes: "trigger-maintained count — loaded verbatim, Vault may recompute",
    },
    {
      source: "Parent_Affiliation_Count_vod__c",
      target: "parent_affiliation_count__v",
      transform: "number(0)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "double",
      notes: "trigger-maintained count — loaded verbatim, Vault may recompute",
    },
    ...childAccountSkipRows(),
  ],
  picklists: {
    "child_account.hierarchyType": {},
    "child_account.customerMasterStatus": {},
  },
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "parent_account__v", source: CHILD_ACCOUNT_PARENT_FIELD },
        { target: "child_account__v", source: CHILD_ACCOUNT_CHILD_FIELD },
      ],
      evidence: "UNV",
      notes: "(parent_account__v, child_account__v) pair via VQL (§3.3)",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "UNV",
      notes:
        "compared against the verbatim SFDC composite; a rewritten value only matches rows this tool wrote",
    },
  ],
  custom: { childAccountExternalId },
  optionDefaults: { rewriteCompositeExternalId: true },
  notes:
    "Hierarchy rows between accounts; country from the parent account; inactivated (status__v only) on delete (§4.4); zvod_* columns are dropped by the rename rule.",
});
