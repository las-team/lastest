/**
 * `tsf` — `TSF_vod__c` → `tsf__v` (spec §6.3.12 `[DOC]`; §6.1 step 7, §6.2,
 * §3.3, §3.5, §4.4).
 *
 * Territory-specific account fields: one row per (account, territory).
 * Master-detail to `Account` (no `OwnerId`), full scope, country from the
 * account (`Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c`), loaded after
 * `account_territory` with triggers **on** — `YTD_Activity_vod__c` may be
 * trigger-maintained in Vault, so it is loaded verbatim under
 * `noTriggers = false` and Vault recomputes.
 *
 * `territory__v` is an **object reference** in Vault `[DOC]` while the source
 * `Territory_vod__c` is the territory *name* (text 80): `territoryRef`
 * resolves it through `ids.resolveTerritoryByName`; an unresolved name routes
 * the row to `pending_fk` (§6.3.12, `custom(tsfTerritory)`) so it is
 * re-evaluated after closure and reported as `failed(UNRESOLVED_FK)` with the
 * territory name when it never resolves. A String target takes the name as
 * text.
 *
 * Object types on `tsf__v` mirror the account object types `[DOC]`
 * (`custom(tsfObjectType)`): the account's `RecordType.DeveloperName` is read
 * through the relationship column and crosswalked with `tsf.objectType`
 * (defaults = the account crosswalk); only when the target `allow_types`.
 *
 * `External_Id_vod__c` is `{AccountId}__{TerritoryName}` (unique 255) →
 * `{accountVaultId}__{territoryName}` (`$composite`, §3.2) unless
 * `objects.tsf.rewriteCompositeExternalId = false` (`custom(tsfExternalId)`).
 *
 * Customer target-class / frequency `__c` columns are org-specific: enable
 * them per country through `objects.tsf.customFields` (§6.0.4).
 *
 * Inactivation (§4.4): `status__v = inactive__v` only.
 */
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformResult } from "../../types";
import { ACCOUNT_OBJECT_TYPES } from "../account/account";
import { defineObject } from "../types";

/** Master-detail parent (also the country-of lookup). */
export const TSF_ACCOUNT_FIELD = "Account_vod__c";
/** Territory name text (EXTID) resolved to `territory__v`. */
export const TSF_TERRITORY_FIELD = "Territory_vod__c";
/** Relationship column carrying the account's record type (selected from the mapping source). */
export const TSF_ACCOUNT_TYPE_COLUMN =
  "Account_vod__r.RecordType.DeveloperName";
/** Composite `external_id__v` template (§3.2). */
export const TSF_EXTERNAL_ID_TEMPLATE = "{a}__{t}";

/** `tsf.objectType` defaults — mirror of `account.objectType` (§6.3.12), all `[UNV]`. */
export const TSF_OBJECT_TYPES: Record<string, string> = {
  ...ACCOUNT_OBJECT_TYPES,
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `territory__v`: `territoryRef` by name; an unresolved name keeps the row
 * pending (`unresolved` marker with the name as the key, § 6.3.12) instead of
 * failing it outright.
 */
export const tsfTerritory: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const r = applyTransform({ kind: "territoryRef" }, value, row, ctx);
  if ("omit" in r && r.diagnostic?.code === "TERRITORY_UNRESOLVED") {
    const name = String(r.diagnostic.value ?? value).trim();
    return {
      ...r,
      unresolved: { objectKey: "territory", sfdcId: name },
    } satisfies TransformResult;
  }
  return r;
};

/**
 * `object_type__v.api_name__v` = the account's object type when `tsf__v`
 * allows types. Untyped target → omitted; typed target with an empty account
 * record type → fatal `TSF_ACCOUNT_TYPE_MISSING` (Vault would reject the
 * create).
 */
export const tsfObjectType: CustomTransformFn = (value, row, ctx) => {
  if (!ctx.metadata.allowTypes) return undefined;
  const devName = isEmpty(value) ? row[TSF_ACCOUNT_TYPE_COLUMN] : value;
  if (isEmpty(devName))
    return {
      omit: true,
      diagnostic: {
        kind: "required_missing",
        field: "object_type__v.api_name__v",
        code: "TSF_ACCOUNT_TYPE_MISSING",
        detail: `tsf__v allows types but ${TSF_ACCOUNT_TYPE_COLUMN} is empty`,
        fatal: true,
      },
    } satisfies TransformResult;
  return applyTransform(
    { kind: "objectType", mapKey: "tsf.objectType" },
    devName,
    row,
    ctx,
  );
};

/**
 * `external_id__v`: `{accountVaultId}__{territoryName}` (`$composite` with the
 * account deferred and the territory name literal) when
 * `rewriteCompositeExternalId`, else verbatim. Empty source → omitted.
 */
export const tsfExternalId: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  if (ctx.mapping.options.rewriteCompositeExternalId)
    return applyTransform(
      {
        kind: "compositeExternalId",
        template: TSF_EXTERNAL_ID_TEMPLATE,
        parts: {
          a: { ref: "account", source: TSF_ACCOUNT_FIELD },
          t: { field: TSF_TERRITORY_FIELD },
        },
      },
      value,
      row,
      ctx,
    );
  return applyTransform({ kind: "copy" }, value, row, ctx);
};

export const tsf = defineObject({
  key: "tsf",
  source: "TSF_vod__c",
  target: "tsf__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account", "territory", "address"],
  objectTypes: TSF_OBJECT_TYPES,
  // master-detail child of Account: no OwnerId; no currency fields
  blockS: { ownerId: false, currency: false },
  fields: [
    {
      source: TSF_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes: "master-detail; country-of lookup",
    },
    {
      source: TSF_TERRITORY_FIELD,
      target: "territory__v",
      transform: "custom(tsfTerritory)",
      required: "Y",
      evidence: "DOC",
      sourceType: "string",
      notes:
        "territoryRef by name (text 80, EXTID = territory name) → object reference [DOC]; unresolved → pending_fk",
    },
    {
      source: "External_Id_vod__c",
      target: "external_id__v",
      transform: "custom(tsfExternalId)",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "{AccountId}__{TerritoryName} (unique 255) → {accountVaultId}__{territoryName} via $composite when objects.tsf.rewriteCompositeExternalId (default true), else copy",
    },
    {
      source: "Address_vod__c",
      target: "address__v",
      transform: "ref(address)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
      notes: "preferred address",
    },
    {
      source: "Preferred_Account_vod__c",
      target: "preferred_account__v",
      transform: "ref(account)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "My_Target_vod__c",
      target: "my_target__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "boolean",
    },
    {
      source: "Last_Activity_Date_vod__c",
      target: "last_activity_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "date",
    },
    {
      source: "YTD_Activity_vod__c",
      target: "ytd_activity__v",
      transform: "number(0)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "double",
      notes:
        "may be trigger-maintained in Vault — loaded verbatim with noTriggers=false, Vault recomputes",
    },
    {
      source: "Route_vod__c",
      target: "route__v",
      transform: "picklist(tsf.route)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Allowed_Products_vod__c",
      target: "allowed_products__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "textarea",
    },
    {
      source: TSF_ACCOUNT_TYPE_COLUMN,
      target: "object_type__v.api_name__v",
      transform: "custom(tsfObjectType)",
      required: "y?",
      evidence: "DOC",
      countryConfigurable: true,
      notes:
        "account object type mirrored on tsf__v [DOC]; required only when the target allow_types (fatal TSF_ACCOUNT_TYPE_MISSING when empty then)",
    },
  ],
  picklists: { "tsf.route": {} },
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "account__v", source: TSF_ACCOUNT_FIELD },
        {
          target: "territory__v",
          source: TSF_TERRITORY_FIELD,
          transform: { kind: "territoryRef" },
        },
      ],
      evidence: "DOC",
      notes: "(account__v, territory__v) pair via VQL (§3.3)",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_Id_vod__c" }],
      evidence: "UNV",
      notes:
        "compared against the verbatim SFDC composite; a rewritten value only matches rows this tool wrote",
    },
  ],
  custom: { tsfTerritory, tsfObjectType, tsfExternalId },
  optionDefaults: { rewriteCompositeExternalId: true },
  notes:
    "Territory-specific account fields; object type mirrors the account; territory by name (pending_fk when unresolved); customer target-class/frequency __c columns via objects.tsf.customFields; inactivated (status__v only) on delete (§4.4).",
});
