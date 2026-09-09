/**
 * `territory` — `Territory2` → `territory__v` (spec §6.3.3, §3.3, §4.4, §6.1).
 *
 * `createPolicy` defaults to `match-only` (Align usually owns territories);
 * unmatched rows are created only with `objects.territory.createPolicy =
 * 'create'`. The hierarchy is loaded roots-first (depth order by
 * `ParentTerritory2Id`) with `parent_territory__v` patched in pass 2.
 *
 * Only the **active** territory model is extracted
 * (`TERRITORY_ACTIVE_MODEL_PREDICATE`); `Territory2ModelId` / `Territory2TypeId`
 * are skipped.
 *
 * Country (§6.3.3 "Country" row): `territory__v.country__v` is `[UNV]` and
 * "required when selecting territories" `[DOC]`. The rule lives in
 * `objects.territory.countryRule`, one of `field:<Territory2 custom field>`,
 * `prefixMap` (`objects.territory.countryPrefixMap: { 'DE-': DE, 'US_': US }`
 * matched against `DeveloperName` then `Name`, longest prefix first),
 * `fromUsers` (default — majority country of the territory's active users,
 * pre-computed by the extractor into `TERRITORY_USERS_COUNTRY_COLUMN`; ties →
 * `TERRITORY_COUNTRY_AMBIGUOUS`) or `const:<ISO>`. Unresolved →
 * `TERRITORY_COUNTRY_UNRESOLVED`; the row is still loaded when the target
 * field is not required, else it is held as `pending_fk`.
 *
 * NOTE: the spec names this knob `objects.territory.countryOf`, but that key
 * is reserved for the closed §6.0.5 grammar (`parseCountryOf` rejects
 * `fromUsers` / `prefixMap` with `MAP_COUNTRY_RULE_INVALID`), so the module
 * reads `countryRule` instead. The unit itself is `GLOBAL` (§6.2).
 *
 * Legacy Territory Management orgs (`describeGlobal` lacks `Territory2`):
 * preflight selects `territoryLegacy` (`info SF_TERRITORY2` absent) — same
 * key and targets, `Territory` source, `ParentTerritoryId`, and
 * `external_id__v = Name` (no `DeveloperName` on legacy territories); no
 * `Territory2Model` filter applies.
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type {
  CountryCrosswalkEntry,
  CustomTransformFn,
  RowDiagnostic,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

/** SOQL filter restricting the extract to the active territory model (§6.3.3). */
export const TERRITORY_ACTIVE_MODEL_PREDICATE =
  "Territory2Model.State = 'Active'";

/**
 * Synthetic row column carrying the ISO-2 countries of the territory's active
 * users (`fromUsers` rule): a single code, a `;`-separated list (one entry per
 * user, so the majority can be computed) or an array. Filled by the extractor
 * from `UserTerritory2Association WHERE IsActive = true` joined to the user
 * map; absent → `TERRITORY_COUNTRY_UNRESOLVED`.
 */
export const TERRITORY_USERS_COUNTRY_COLUMN = "Users_Country__computed";

export type TerritoryCountryRule =
  | { kind: "field"; field: string }
  | { kind: "prefixMap" }
  | { kind: "fromUsers" }
  | { kind: "const"; iso2: string };

/** Parse `objects.territory.countryRule` (default `fromUsers`). Returns undefined for anything else. */
export function parseTerritoryCountryRule(
  raw: unknown,
): TerritoryCountryRule | undefined {
  if (raw === undefined || raw === null || raw === "")
    return { kind: "fromUsers" };
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (text === "fromUsers") return { kind: "fromUsers" };
  if (text === "prefixMap") return { kind: "prefixMap" };
  if (text.startsWith("field:") && text.length > 6)
    return { kind: "field", field: text.slice(6) };
  if (/^const:[A-Z]{2}$/.test(text))
    return { kind: "const", iso2: text.slice(6) };
  return undefined;
}

/**
 * Majority vote over ISO-2 codes (case-insensitive, blanks ignored).
 * `ambiguous` is true when the top count is shared.
 */
export function majorityCountry(codes: readonly string[]): {
  iso2?: string;
  ambiguous: boolean;
} {
  const counts = new Map<string, number>();
  for (const c of codes) {
    const k = c.trim().toUpperCase();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (!counts.size) return { ambiguous: false };
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const ambiguous = sorted.length > 1 && sorted[0][1] === sorted[1][1];
  return { iso2: ambiguous ? undefined : sorted[0][0], ambiguous };
}

/** `DeveloperName` then `Name` against the prefix map, longest prefix first. */
export function countryFromPrefixMap(
  prefixMap: Record<string, string>,
  developerName: unknown,
  name: unknown,
): string | undefined {
  const entries = Object.entries(prefixMap).sort(
    (a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]),
  );
  for (const candidate of [developerName, name]) {
    if (typeof candidate !== "string" || !candidate) continue;
    for (const [prefix, iso2] of entries)
      if (prefix && candidate.startsWith(prefix)) return iso2.toUpperCase();
  }
  return undefined;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function usersCountries(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (isEmpty(raw)) return [];
  return String(raw).split(/[;,]/);
}

function lookupEntry(
  ctx: TransformContext,
  value: unknown,
): CountryCrosswalkEntry | undefined {
  if (isEmpty(value)) return undefined;
  const text = String(value).trim();
  if (isSfdcId(value)) return ctx.country.countries.bySfdcId(to18(text));
  return ctx.country.countries.byIso2(text.toUpperCase());
}

/**
 * `country__v` per `objects.territory.countryRule` (see file header). Emits
 * the crosswalk Vault id (`country(ref)` semantics) or a deferred
 * `{ $fk: country }`.
 */
export const territoryCountry: CustomTransformFn = (_value, row, ctx) => {
  const options = ctx.mapping.options;
  const rule = parseTerritoryCountryRule(options.countryRule);
  const unresolved = (
    code: "TERRITORY_COUNTRY_UNRESOLVED" | "TERRITORY_COUNTRY_AMBIGUOUS",
    detail: string,
    value?: string,
  ): TransformResult => {
    const diagnostic: RowDiagnostic = {
      kind: "country_unresolved",
      field: ctx.field.target,
      code,
      detail,
      value,
    };
    const required =
      ctx.mapping.required[ctx.field.target] ??
      ctx.targetField?.required ??
      false;
    // required target → pending_fk-style hold (§6.3.3); optional → row loaded without the field
    return required
      ? {
          omit: true,
          diagnostic,
          unresolved: { objectKey: "country", sfdcId: "" },
        }
      : { omit: true, diagnostic };
  };
  if (!rule)
    return unresolved(
      "TERRITORY_COUNTRY_UNRESOLVED",
      `invalid objects.territory.countryRule "${String(options.countryRule)}"`,
    );

  let entry: CountryCrosswalkEntry | undefined;
  let probe: string | undefined;
  switch (rule.kind) {
    case "field": {
      const v = row[rule.field];
      probe = isEmpty(v) ? undefined : String(v).trim();
      entry = lookupEntry(ctx, v);
      break;
    }
    case "prefixMap": {
      const map = (options.countryPrefixMap ?? {}) as Record<string, string>;
      probe = countryFromPrefixMap(map, row.DeveloperName, row.Name);
      entry = probe ? ctx.country.countries.byIso2(probe) : undefined;
      break;
    }
    case "fromUsers": {
      const vote = majorityCountry(
        usersCountries(row[TERRITORY_USERS_COUNTRY_COLUMN]),
      );
      if (vote.ambiguous)
        return unresolved(
          "TERRITORY_COUNTRY_AMBIGUOUS",
          "active users split evenly between countries",
        );
      probe = vote.iso2;
      entry = probe ? ctx.country.countries.byIso2(probe) : undefined;
      break;
    }
    case "const":
      probe = rule.iso2;
      entry = ctx.country.countries.byIso2(rule.iso2);
      break;
  }
  if (!entry)
    return unresolved(
      "TERRITORY_COUNTRY_UNRESOLVED",
      `rule ${rule.kind} yielded no country`,
      probe && isSfdcId(probe) ? to18(probe) : probe,
    );
  if (entry.vaultId) return entry.vaultId;
  if (entry.sfdcId) return { $fk: { object: "country", sfdcId: entry.sfdcId } };
  return unresolved(
    "TERRITORY_COUNTRY_UNRESOLVED",
    `country ${entry.iso2} has no Vault id in the crosswalk`,
    entry.iso2,
  );
};

/**
 * `status__v = inactive__v` when the row belongs to a non-active
 * `Territory2Model` (§6.0.4 territory row). Omitted when the column is absent
 * (only the active model is extracted, so this is a safety net).
 */
export const territoryStatus: CustomTransformFn = (_value, row) => {
  const state = row["Territory2Model.State"];
  if (isEmpty(state)) return undefined;
  return String(state).trim() === "Active" ? undefined : "inactive__v";
};

const shared = {
  key: "territory",
  target: "territory__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: [],
  blockS: {
    ownerId: false,
    mobileId: false,
    lastDevice: false,
    mobileDatetimes: false,
    locks: false,
    unlock: false,
    externalId: false,
  },
  picklists: {},
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "match-only",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "DeveloperName" }],
      evidence: "UNV",
      notes:
        "territory__v.external_id__v = Territory2.DeveloperName [UNVERIFIED field]",
    },
    {
      method: "natural_key",
      keys: [{ target: "name__v", source: "Name" }],
      evidence: "OBS",
      notes: "territory__v.name__v = Territory2.Name (unique in practice)",
    },
  ],
  custom: { territoryCountry, territoryStatus },
  optionDefaults: {
    countryRule: "fromUsers",
    countryPrefixMap: {},
  },
} satisfies Partial<ObjectModuleInput>;

const countryRow = {
  source: "",
  target: "country__v",
  transform: "custom(territoryCountry)",
  required: "y?",
  evidence: "UNV",
  countryConfigurable: true,
  notes:
    "[DOC] 'Country is required when selecting territories'. objects.territory.countryRule: field:<f> | prefixMap (countryPrefixMap vs DeveloperName then Name) | fromUsers (default; majority of active users, ties → TERRITORY_COUNTRY_AMBIGUOUS) | const:<ISO>; unresolved → TERRITORY_COUNTRY_UNRESOLVED (row loaded when the field is optional, else held pending_fk)",
} as const;

export const territory = defineObject({
  ...shared,
  source: "Territory2",
  selfRefs: [{ target: "parent_territory__v", source: "ParentTerritory2Id" }],
  depthOrderBy: "ParentTerritory2Id",
  fields: [
    {
      source: "Territory2Model.State",
      target: "status__v",
      transform: "custom(territoryStatus)",
      required: "n",
      evidence: "OBS",
      disabledBy: "statusFromFlag",
      optionalSource: true,
      notes:
        "inactive__v when Territory2Model.State != 'Active' (§6.0.4); only the active model is extracted",
    },
    {
      source: "DeveloperName",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "Align owns external_id__v by default (externalIdOwnedBy = integration)",
    },
    {
      source: "ParentTerritory2Id",
      target: "parent_territory__v",
      transform: "ref(territory) secondPass",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes: "roots first (depth order), patched in pass 2",
    },
    {
      source: "Description",
      target: "description__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
    },
    {
      source: "Territory2ModelId",
      target: "territory2modelid__v",
      transform: "skip",
      required: "-",
      sourceType: "reference",
      notes: `not loaded; extract filtered to ${TERRITORY_ACTIVE_MODEL_PREDICATE}`,
    },
    {
      source: "Territory2TypeId",
      target: "territory2typeid__v",
      transform: "skip",
      required: "-",
      sourceType: "reference",
      notes: "not loaded",
    },
    countryRow,
  ],
  notes:
    "createPolicy match-only (Align owns territories); country via objects.territory.countryRule (field | prefixMap | fromUsers | const); depth-ordered client-side by ParentTerritory2Id; deletePolicy inactivate (status__v only). Extract only the active model (TERRITORY_ACTIVE_MODEL_PREDICATE). Legacy Territory orgs use territoryLegacy.",
});

/** Legacy Territory Management variant (`Territory`), selected by preflight when `Territory2` is absent. */
export const territoryLegacy = defineObject({
  ...shared,
  source: "Territory",
  targetEvidence: "OBS",
  selfRefs: [{ target: "parent_territory__v", source: "ParentTerritoryId" }],
  depthOrderBy: "ParentTerritoryId",
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "Name" }],
      evidence: "UNV",
      notes: "legacy territories have no DeveloperName — external_id__v = Name",
    },
    {
      method: "natural_key",
      keys: [{ target: "name__v", source: "Name" }],
      evidence: "OBS",
    },
  ],
  fields: [
    {
      source: "Name",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "DeveloperName absent on legacy Territory — Name instead",
    },
    {
      source: "ParentTerritoryId",
      target: "parent_territory__v",
      transform: "ref(territory) secondPass",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes: "roots first, patched in pass 2",
    },
    {
      source: "Description",
      target: "description__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
    },
    countryRow,
  ],
  notes:
    "Legacy Territory Management variant of territory (info SF_TERRITORY2 absent at preflight); no Territory2Model filter; account assignments come from AccountShare WHERE RowCause = 'Territory' (account_territory, optional).",
});
