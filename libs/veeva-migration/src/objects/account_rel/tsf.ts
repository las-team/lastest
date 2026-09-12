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
 * resolves it through `ids.resolveTerritoryByName` — the `name__v → id`
 * snapshot of `territory__v` the run loads once per vault, after the
 * `territory` unit (§6.1 step 1) has matched/created every territory. A name
 * missing from that snapshot can therefore never resolve later in the run,
 * and the pending-FK queue (§8.4) only knows deferred `$fk` ids, not names:
 * `custom(tsfTerritory)` fails the row immediately as `failed(UNRESOLVED_FK)`
 * with the territory name in the report (retried by `retry-failed` once the
 * territory exists). This is the §6.3.12 "unresolved → pending_fk" outcome
 * without the intermediate queue round. A String target takes the name as
 * text.
 *
 * Object types on `tsf__v` mirror the account object types `[DOC]`
 * (`custom(tsfObjectType)`): the account's `RecordType.DeveloperName` is read
 * through the relationship column and crosswalked with `tsf.objectType`
 * (defaults = the account crosswalk, `TSF_OBJECT_TYPES`) and, when that has
 * no entry, with the layered `picklists.maps["account.objectType"]` of the
 * country; only when the target `allow_types`. A country that remaps an
 * account record type under `objects.account.objectType` must overlay the
 * same entry under `objects.tsf.objectType` — that per-object override is
 * not visible from another object's transform context.
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
import type {
  CustomTransformFn,
  TransformContext,
  TransformResult,
} from "../../types";
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
 * `territory__v`: `territoryRef` by name. An unresolved name is fatal —
 * `failed(UNRESOLVED_FK)` with the name as the reported value — because the
 * territory snapshot is complete by the time `tsf` transforms (§6.1 step 1
 * precedes step 7) and the pending queue cannot park a name-keyed
 * reference (every `sfdcId` it stores is an 18-char id, CONTRACTS.md).
 */
export const tsfTerritory: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const r = applyTransform({ kind: "territoryRef" }, value, row, ctx);
  if ("omit" in r && r.diagnostic?.code === "TERRITORY_UNRESOLVED") {
    const name = String(r.diagnostic.value ?? value).trim();
    return {
      omit: true,
      diagnostic: {
        kind: "unresolved_fk",
        field: ctx.field.target,
        code: "UNRESOLVED_FK",
        objectKey: "territory",
        value: name,
        detail: `territory "${name}" has no territory__v with that name__v (TERRITORY_UNRESOLVED) — territories are matched in step 1, so the row cannot resolve later in this run`,
        fatal: true,
      },
    } satisfies TransformResult;
  }
  return r;
};

/** Layered account object-type crosswalk key consulted when `tsf.objectType` has no entry. */
export const TSF_ACCOUNT_OBJECT_TYPE_MAP_KEY = "account.objectType";

/**
 * `object_type__v.api_name__v` = the account's object type when `tsf__v`
 * allows types. Untyped target → omitted; typed target with an empty account
 * record type → fatal `TSF_ACCOUNT_TYPE_MISSING` (Vault would reject the
 * create).
 *
 * Crosswalk order: `tsf.objectType` (module defaults = the account crosswalk,
 * plus `objects.tsf.objectType`) → the country's layered
 * `picklists.maps["tsf.objectType"]` → `picklists.maps["account.objectType"]`
 * → the §6.0.2 derivation. The account-map hop keeps a country that
 * crosswalks account types through `picklists.maps` in step with
 * `account__v` without a duplicated `tsf` map (a `null` there skips the row
 * here too, `OBJECT_TYPE_SKIPPED`).
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
  const name = String(devName).trim();
  let objectTypeCtx: TransformContext = ctx;
  if (
    ctx.mapping.objectTypes[name] === undefined &&
    ctx.country.picklist("tsf.objectType", name) === undefined
  ) {
    const fromAccount = ctx.country.picklist(
      TSF_ACCOUNT_OBJECT_TYPE_MAP_KEY,
      name,
    );
    if (fromAccount === null)
      return {
        omit: true,
        diagnostic: {
          kind: "skipped",
          field: "object_type__v.api_name__v",
          code: "OBJECT_TYPE_SKIPPED",
          value: name,
          fatal: true,
        },
      } satisfies TransformResult;
    if (fromAccount !== undefined)
      objectTypeCtx = {
        ...ctx,
        mapping: {
          ...ctx.mapping,
          objectTypes: { ...ctx.mapping.objectTypes, [name]: fromAccount },
        },
      };
  }
  return applyTransform(
    { kind: "objectType", mapKey: "tsf.objectType" },
    name,
    row,
    objectTypeCtx,
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
  // `account_territory` precedes `tsf` (§6.1 step 7): creating an
  // `account_territory__v` auto-creates the matching `tsf__v` [DOC], so the tsf
  // unit must match those rows before it creates its own. `loadOrder` drops
  // the dependency when the (default-disabled) object is not enabled.
  dependsOn: ["account", "territory", "address", "account_territory"],
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
        "territoryRef by name (text 80, EXTID = territory name) → object reference [DOC]; unresolved name → failed(UNRESOLVED_FK) with the name (territories are complete after step 1; the pending queue is id-keyed)",
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
        { target: "territory__v", source: TSF_TERRITORY_FIELD },
      ],
      evidence: "DOC",
      notes:
        "(account__v, territory__v) pair via VQL (§3.3); the matcher compares the payload values — the resolved account id and the territory id custom(tsfTerritory) already put in territory__v — so no key transform is needed",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_Id_vod__c" }],
      evidence: "UNV",
      notes:
        "compared against the value the tool writes: with rewriteCompositeExternalId (default) that is the {accountVaultId}__{territoryName} composite rendered from the id map, so this key only finds rows written with the same convention (a previous run of this tool); set rewriteCompositeExternalId = false to match a load keyed by the verbatim SFDC composite",
    },
  ],
  custom: { tsfTerritory, tsfObjectType, tsfExternalId },
  optionDefaults: { rewriteCompositeExternalId: true },
  notes:
    "Territory-specific account fields; object type mirrors the account (overlay objects.tsf.objectType alongside objects.account.objectType); territory by name (failed(UNRESOLVED_FK) when unresolved — territories are complete after step 1); loaded after account_territory (auto-created tsf__v rows are matched, not duplicated); customer target-class/frequency __c columns via objects.tsf.customFields; inactivated (status__v only) on delete (§4.4).",
});
