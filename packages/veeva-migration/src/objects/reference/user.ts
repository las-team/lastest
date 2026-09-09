/**
 * `user` — `User` → `user__sys` (spec §6.3.2, §3.3, §3.4, §3.5, §4.4).
 *
 * Users are matched by default (`objects.user.mode = 'match'`): the user map is
 * built first (wave 0, `GLOBAL`) and is required by every other object. Every
 * SFDC user, active or not, is extracted (historical references). Users are
 * never auto-created from data; `mode: 'create'` switches on the Users API
 * path (`buildUsersApiRow`) which needs `objects.user.securityPolicyId`
 * (`VT_USER_SECURITY_POLICY_MISSING` otherwise). Users cannot be deleted —
 * `deletePolicy = inactivate` writes `status__v = inactive__v` +
 * `isactive__v = false`.
 *
 * Custom transforms (pure, unit-tested in `user.test.ts`):
 *  - `userStatus`         IsActive → `status__v` (`active__v` / `inactive__v`)
 *  - `userCountry`        Country_vod__c (picklist **or** lookup) / Country →
 *                         ISO-2 text or `country__v` reference, chosen by the
 *                         target field type (`country__v`, `country_code__v`,
 *                         `vcountry__v` — "write all three that exist")
 *  - `usernameCreateOnly` Username → `username__sys` only in create mode,
 *                         re-domained through `objects.user.usernameTemplate`
 *  - `securityProfile` / `applicationProfile` / `layoutProfile`
 *                         Profile.Name → explicit crosswalk only
 *                         (`objects.user.securityProfile` map, then the
 *                         `user.<kind>Profile` picklist maps); never derived,
 *                         because profiles are Vault-admin owned
 */
import { isSfdcId, to18 } from "../../transform/ids";
import { renameTimezone } from "../../transform/rename";
import type {
  CustomTransformFn,
  PayloadValue,
  SourceRow,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : String(v);
}

/** SFDC booleans arrive as `true`/`"true"`/`"1"` (REST vs CSV). */
export function readFlag(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (isEmpty(v)) return undefined;
  const s = asString(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

function isCreateMode(ctx: TransformContext): boolean {
  return ctx.mapping.options.mode === "create";
}

/**
 * Render `objects.user.usernameTemplate` (default `{Username}`). Tokens are
 * any row column (`{Username}`, `{Alias}`, `{Email}`, `{FederationIdentifier}`)
 * plus `{localPart}` / `{domain}` derived from `Username`.
 */
export function renderUsername(template: string, row: SourceRow): string {
  const username = isEmpty(row.Username) ? "" : asString(row.Username).trim();
  const at = username.indexOf("@");
  const derived: Record<string, string> = {
    localPart: at >= 0 ? username.slice(0, at) : username,
    domain: at >= 0 ? username.slice(at + 1) : "",
  };
  return template
    .replace(/\{([A-Za-z0-9_]+)\}/g, (_m, token: string) => {
      if (token in derived) return derived[token];
      const v = row[token];
      return isEmpty(v) ? "" : asString(v).trim();
    })
    .trim();
}

// ---------------------------------------------------------------------------
// custom transforms
// ---------------------------------------------------------------------------

/** `IsActive` → `status__v`: `inactive__v` when false, `active__v` when true, omitted when unknown. */
export const userStatus: CustomTransformFn = (value) => {
  const flag = readFlag(value);
  if (flag === undefined) return undefined;
  return flag ? "active__v" : "inactive__v";
};

/**
 * `Country_vod__c` (picklist holding ISO-2 **or** lookup holding a
 * `Country_vod__c` id — type resolved at preflight) with `Country` as
 * fallback. Emits the ISO-2 text for String targets and the `country__v`
 * reference (Vault id from the crosswalk, else a deferred `$fk`) for Object
 * targets or `vcountry__v`.
 */
export const userCountry: CustomTransformFn = (value, row, ctx) => {
  const raw = isEmpty(value) ? row.Country : value;
  if (isEmpty(raw)) return undefined;
  const text = asString(raw).trim();
  const entry = isSfdcId(raw)
    ? ctx.country.countries.bySfdcId(to18(text))
    : text.length === 2
      ? ctx.country.countries.byIso2(text.toUpperCase())
      : undefined;
  if (!entry)
    return {
      omit: true,
      diagnostic: {
        kind: "country_unresolved",
        field: ctx.field.target,
        code: "USER_COUNTRY_UNRESOLVED",
        value: isSfdcId(raw) ? to18(text) : text.slice(0, 64),
      },
    } satisfies TransformResult;
  const asReference =
    ctx.targetField?.type === "object" ||
    (ctx.targetField === undefined && ctx.field.target === "vcountry__v");
  if (!asReference) return entry.iso2;
  if (entry.vaultId) return entry.vaultId;
  if (entry.sfdcId) return { $fk: { object: "country", sfdcId: entry.sfdcId } };
  return {
    omit: true,
    diagnostic: {
      kind: "unresolved_fk",
      field: ctx.field.target,
      code: "VT_COUNTRY_UNMATCHED",
      value: entry.iso2,
      objectKey: "country",
    },
  } satisfies TransformResult;
};

/** `Username` → `username__sys` (create mode only; must be domain-unique). */
export const usernameCreateOnly: CustomTransformFn = (value, row, ctx) => {
  if (!isCreateMode(ctx)) return undefined;
  const template = asString(
    ctx.mapping.options.usernameTemplate ?? "{Username}",
  );
  const username = isEmpty(value) ? row.Username : value;
  // An empty source must not render the template's literal characters
  // (`{localPart}@{domain}` → `@`): username__sys is required on create.
  const rendered = isEmpty(username)
    ? ""
    : renderUsername(template, { ...row, Username: username });
  if (!rendered)
    return {
      omit: true,
      diagnostic: {
        kind: "required_missing",
        field: ctx.field.target,
        code: "REQUIRED_MISSING",
        fatal: true,
      },
    } satisfies TransformResult;
  return rendered;
};

/**
 * Explicit-only profile crosswalk: `objects.user.<configKey>` map → layered
 * `user.<mapKey>` picklist maps → module defaults. Unmapped names are omitted
 * (non-fatal) in match mode; fatal in create mode when `requiredOnCreate`.
 */
function profileCrosswalk(
  mapKey: string,
  opts: { configKey?: string; requiredOnCreate: boolean },
): CustomTransformFn {
  return (value, _row, ctx) => {
    if (isEmpty(value)) return undefined;
    const name = asString(value).trim();
    if (!name) return undefined;
    const fromConfig = opts.configKey
      ? (
          ctx.mapping.options[opts.configKey] as
            | Record<string, string>
            | undefined
        )?.[name]
      : undefined;
    let target: string | null | undefined = fromConfig;
    if (target === undefined) target = ctx.country.picklist(mapKey, name);
    if (target === undefined) target = ctx.mapping.picklists[mapKey]?.[name];
    if (target === null) return undefined;
    if (target !== undefined && target !== "") return target;
    const fatal = opts.requiredOnCreate && isCreateMode(ctx);
    return {
      omit: true,
      diagnostic: {
        kind: "unmapped_picklist",
        field: ctx.field.target,
        code: "USER_PROFILE_UNMAPPED",
        value: name,
        fatal,
      },
    } satisfies TransformResult;
  };
}

export const securityProfile = profileCrosswalk("user.securityProfile", {
  configKey: "securityProfile",
  requiredOnCreate: true,
});
export const applicationProfile = profileCrosswalk("user.applicationProfile", {
  requiredOnCreate: false,
});
export const layoutProfile = profileCrosswalk("user.layoutProfile", {
  requiredOnCreate: false,
});

// ---------------------------------------------------------------------------
// Users API (create mode only, §6.3.2 / §2.5.4)
// ---------------------------------------------------------------------------

/** `user__sys` fields required on create (`[DOC-MIRROR]`). */
export const USER_SYS_CREATE_REQUIRED = [
  "email__sys",
  "first_name__sys",
  "last_name__sys",
  "username__sys",
  "language__sys",
  "locale__sys",
  "timezone__sys",
  "security_profile__sys",
] as const;

/** CRM licence flags on `user__sys` — Vault-admin owned, reported only (never mapped). */
export const USER_LICENSE_FIELDS = [
  "license_vaultcrmcore__sys",
  "license_vaultcrmengage__sys",
] as const;

export interface UsersApiOptions {
  /** `target.vaultId` (from auth) — first segment of `vault_membership`. */
  vaultId: string | number;
  /** `objects.user.securityPolicyId` (required; `VT_USER_SECURITY_POLICY_MISSING`). */
  securityPolicyId: string | number;
  /** Resolved security profile api name (profile crosswalk). */
  securityProfile: string;
  /** `objects.user.licenseType` (default `full__v`). */
  licenseType?: string;
  /** `objects.user.usernameTemplate` (default `{Username}`). */
  usernameTemplate?: string;
}

/**
 * The Users API body for one SFDC user (`POST /objects/users`, upsert on
 * `user_name__v`). `vault_membership` follows the observed
 * `{vault_id}:{active__v}:{security_profile}:{license_type}` form `[SRC]`;
 * when the bulk endpoint rejects it the loader falls back to
 * `PUT /objects/users/{id}/vault_membership/{vaultId}` (probe at first create).
 * Every `user__sys`-side Veeva field is written afterwards by the regular
 * mapping (`PUT /vobjects/user__sys` by id).
 */
export function buildUsersApiRow(
  row: SourceRow,
  opts: UsersApiOptions,
): Record<string, PayloadValue> {
  const licenseType = opts.licenseType ?? "full__v";
  const active = readFlag(row.IsActive) ?? true;
  const out: Record<string, PayloadValue> = {
    user_name__v: renderUsername(opts.usernameTemplate ?? "{Username}", row),
    user_first_name__v: isEmpty(row.FirstName)
      ? null
      : asString(row.FirstName).trim(),
    user_last_name__v: isEmpty(row.LastName)
      ? null
      : asString(row.LastName).trim(),
    user_email__v: isEmpty(row.Email) ? null : asString(row.Email).trim(),
    user_timezone__v: isEmpty(row.TimeZoneSidKey)
      ? null
      : renameTimezone(asString(row.TimeZoneSidKey).trim()),
    user_locale__v: isEmpty(row.LocaleSidKey)
      ? null
      : asString(row.LocaleSidKey).trim(),
    user_language__v: isEmpty(row.LanguageLocaleKey)
      ? null
      : asString(row.LanguageLocaleKey).trim(),
    security_profile__v: opts.securityProfile,
    security_policy_id__v: opts.securityPolicyId,
    license_type__v: licenseType,
    send_welcome_email__v: false,
    active__v: active,
    domain_active__v: active,
    vault_membership: `${opts.vaultId}:${active}:${opts.securityProfile}:${licenseType}`,
  };
  if (!isEmpty(row.FederationIdentifier))
    out.federated_id__v = asString(row.FederationIdentifier).trim();
  if (!isEmpty(row.CompanyName))
    out.company__v = asString(row.CompanyName).trim();
  return out;
}

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

export const user = defineObject({
  key: "user",
  source: "User",
  target: "user__sys",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  // `User.Country_vod__c` may be a picklist (ISO-2) or a lookup — the SOQL path is resolved at preflight (§6.0.5)
  countryOf: "field:Country_vod__c",
  dependsOn: ["country"],
  selfRefs: [{ target: "manager__sys", source: "ManagerId" }],
  // User has no Name (compound formula), OwnerId or Veeva lock/mobile stamps; External_ID_vod__c maps to user_identifier__v below
  blockS: {
    name: "none",
    ownerId: false,
    lastDevice: false,
    mobileDatetimes: false,
    locks: false,
    unlock: false,
    externalId: false,
  },
  fields: [
    {
      source: "Id",
      target: "legacy_crm_id__v",
      transform: "legacyId",
      required: "K",
      evidence: "OBS",
      sourceType: "id",
      notes:
        "match key, not an idParam — users are updated by id when at all (§3.2); user_id18__c-style customer fields seen in the wild",
    },
    {
      source: "Username",
      target: "salesforce_username__sys",
      transform: "copy",
      required: "Y",
      evidence: "OBS",
      sourceType: "string",
      notes: "match key (§3.3)",
    },
    {
      source: "Username",
      target: "username__sys",
      transform: "custom(usernameCreateOnly)",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
      notes:
        "create mode only (Y on create); must be domain-unique; re-domained per objects.user.usernameTemplate",
    },
    {
      source: "FederationIdentifier",
      target: "federated_id__sys",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
      notes: "SSO; match key",
    },
    {
      source: "Email",
      target: "email__sys",
      transform: "text",
      required: "Y",
      evidence: "OBS",
      sourceType: "email",
      notes: "fallback match key (unique hits only)",
    },
    {
      source: "FirstName",
      target: "first_name__sys",
      transform: "text",
      required: "Y",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "LastName",
      target: "last_name__sys",
      transform: "text",
      required: "Y",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "Alias",
      target: "alias__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "Title",
      target: "title__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "CompanyName",
      target: "company__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "Department",
      target: "department__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "Division",
      target: "division__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "EmployeeNumber",
      target: "employee_number__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "IsActive",
      target: "status__v",
      transform: "custom(userStatus)",
      required: "Y",
      evidence: "OBS",
      sourceType: "boolean",
      disabledBy: "statusFromFlag",
      notes:
        "active__v / inactive__v; inactive creates need migration mode (§6.0.4 user row: IsActive)",
    },
    {
      source: "IsActive",
      target: "isactive__v",
      transform: "bool",
      required: "Y",
      evidence: "OBS",
      sourceType: "boolean",
    },
    {
      source: "Profile.Name",
      target: "security_profile__sys",
      transform: "custom(securityProfile)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "Y on create. Explicit crosswalk SFDC profile name → Vault security profile api name: objects.user.securityProfile map, then picklist map user.securityProfile; never derived (per-country profiles common)",
    },
    {
      source: "Profile.Name",
      target: "profile_name__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      notes: "SFDC profile name verbatim (informational)",
    },
    {
      source: "Profile.Name",
      target: "application_profile__v",
      transform: "custom(applicationProfile)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "explicit crosswalk via picklist map user.applicationProfile",
    },
    {
      source: "Profile.Name",
      target: "layout_profile__sys",
      transform: "custom(layoutProfile)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "explicit crosswalk via picklist map user.layoutProfile",
    },
    {
      source: "UserRoleId",
      target: "userroleid__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes: "semantics unverified — raw SFDC role id carried as text",
    },
    {
      source: "ManagerId",
      target: "manager__sys",
      transform: "refUser secondPass",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes: "pass 2 (self-reference)",
    },
    {
      source: "LanguageLocaleKey",
      target: "language__sys",
      transform: "localeLookup(language)",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
      notes:
        "Y on create; language__sys.name__v lookup through locales.language (en_US → English)",
    },
    {
      source: "LanguageLocaleKey",
      target: "language_code__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
    },
    {
      source: "LocaleSidKey",
      target: "locale__sys",
      transform: "localeLookup(locale)",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
      notes:
        "Y on create; locale__sys.name__v lookup through locales.locale (en_US → United States)",
    },
    {
      source: "LocaleSidKey",
      target: "locale_code__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
    },
    {
      source: "TimeZoneSidKey",
      target: "timezone__sys",
      transform: "userTimezone",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
      notes:
        "Y on create; America/New_York → america_new_york__sys; preflight validates against the picklist",
    },
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "custom(userCountry)",
      required: "y?",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "ISO-2 text (or reference when the target is an Object — type UNV, layouts differ per customer); Vault CRM requires country__v on users for record detail pages [DOC]; falls back to User.Country",
    },
    {
      source: "Country_vod__c",
      target: "country_code__v",
      transform: "custom(userCountry)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes: "ISO-2 text; written when the field exists",
    },
    {
      source: "Country_vod__c",
      target: "vcountry__v",
      transform: "custom(userCountry)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "reference → country__v (crosswalk Vault id); written when the field exists",
    },
    {
      source: "Street",
      target: "street__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "textarea",
    },
    {
      source: "City",
      target: "city__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "string",
    },
    {
      source: "State",
      target: "state__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "string",
      notes: "state__v on user__sys (vs state_province__v on address/em_event)",
    },
    {
      source: "PostalCode",
      target: "postalcode__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      sourceType: "string",
    },
    {
      source: "Phone",
      target: "office_phone__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "phone",
    },
    {
      source: "MobilePhone",
      target: "mobile_phone__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "phone",
    },
    {
      source: "Fax",
      target: "fax__sys",
      transform: "text",
      required: "n",
      evidence: "OBS",
      sourceType: "phone",
    },
    {
      source: "UserType",
      target: "user_type__v",
      transform: "picklist(user.userType)",
      required: "n",
      evidence: "OBS",
      sourceType: "picklist",
      notes: "semantics unverified",
    },
    {
      source: "DelegatedApproverId",
      target: "delegatedapproverid__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "CommunityNickname",
      target: "communitynickname__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
    },
    {
      source: "SmallPhotoUrl",
      target: "smallphotourl__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "url",
    },
    {
      source: "External_ID_vod__c",
      target: "user_identifier__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      sourceType: "string",
    },
    {
      source: "Master_Align_Id_vod__c",
      target: "master_align_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      sourceType: "string",
    },
    // Veeva user flags — org-specific, confirmed via describe (update-only fields in create mode)
    ...(
      [
        ["Approved_Email_Admin_vod__c", "approved_email_admin__v", "bool"],
        ["MCCP_Admin_vod__c", "mccp_admin__v", "bool"],
        ["Network_Admin_vod__c", "network_admin__v", "bool"],
        ["Consent_Admin_vod__c", "consent_admin__v", "bool"],
        ["Content_Admin_vod__c", "content_admin__v", "bool"],
        ["Analytics_Admin_vod__c", "analytics_admin__v", "bool"],
        ["Engage_Group_vod__c", "engage_group__v", "text"],
        ["Primary_Territory_vod__c", "primary_territory__v", "text"],
        ["Share_Team_vod__c", "share_team__v", "text"],
        ["Product_Expertise_vod__c", "product_expertise__v", "text"],
        [
          "Inventory_Order_Allocation_Group_vod__c",
          "inventory_order_allocation_group__v",
          "text",
        ],
        [
          "Network_Additional_Countries_vod__c",
          "network_additional_countries__v",
          "text",
        ],
      ] as const
    ).map(([source, target, transform]) => ({
      source,
      target,
      transform,
      required: "n" as const,
      evidence: "OBS" as const,
      optionalSource: true,
      notes: "Veeva user flag (org-specific); update-only field in create mode",
    })),
    {
      source: "Territory_vod__c",
      target: "territory__v",
      transform: "skip",
      required: "-",
      optionalSource: true,
      notes:
        "territory membership is loaded through the user_territory object (UserTerritory2Association)",
    },
    {
      source: "LastLoginDate",
      target: "last_login_date__v",
      transform: "skip",
      required: "-",
      notes: "never loaded",
    },
    {
      source: "EmailEncodingKey",
      target: "email_encoding_key__v",
      transform: "skip",
      required: "-",
      notes: "never loaded",
    },
    {
      source: "PhotoUrl",
      target: "photo_url__v",
      transform: "skip",
      required: "-",
      notes: "never loaded (device sync stamps are skipped likewise)",
    },
  ],
  picklists: {
    "user.securityProfile": {},
    "user.applicationProfile": {},
    "user.layoutProfile": {},
    "user.userType": {},
  },
  deletePolicy: "inactivate",
  inactivate: [{ field: "isactive__v", value: false }],
  createPolicy: "match-only",
  load: { noTriggers: true },
  match: [
    {
      method: "legacy_id",
      evidence: "OBS",
      notes: "user__sys.legacy_crm_id__v = {id18}",
    },
    {
      method: "username",
      keys: [{ target: "salesforce_username__sys", source: "Username" }],
      evidence: "OBS",
    },
    {
      method: "username",
      keys: [{ target: "username__sys", source: "Username" }],
      evidence: "OBS",
    },
    {
      method: "federated_id",
      keys: [{ target: "federated_id__sys", source: "FederationIdentifier" }],
      evidence: "OBS",
    },
    {
      method: "email",
      keys: [{ target: "email__sys", source: "Email" }],
      requireUnique: true,
      evidence: "OBS",
      notes:
        "only when exactly one active hit; else warning UNMAPPED_USER_AMBIGUOUS",
    },
  ],
  custom: {
    userStatus,
    userCountry,
    usernameCreateOnly,
    securityProfile,
    applicationProfile,
    layoutProfile,
  },
  optionDefaults: {
    mode: "match",
    usernameTemplate: "{Username}",
    licenseType: "full__v",
    securityProfile: {},
    unmappedUserPolicy: "omit",
  },
  notes:
    "Match by default (objects.user.mode); create mode uses the Users API (buildUsersApiRow) and needs securityPolicyId + vault_membership. Users cannot be deleted: deletePolicy=inactivate (status__v = inactive__v, isactive__v = false). CRM licence flags (USER_LICENSE_FIELDS) are Vault-admin owned and reported only.",
});
