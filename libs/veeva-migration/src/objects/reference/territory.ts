/**
 * `territory` — `Territory2` → `territory__v` (spec §6.3.3, §3.3, §4.4, §6.1).
 *
 * `createPolicy` defaults to `match-only` (Align usually owns territories);
 * unmatched rows are created only with `objects.territory.createPolicy =
 * 'create'`. The hierarchy is loaded roots-first (depth order by
 * `ParentTerritory2Id`) with `parent_territory__v` patched in pass 2.
 *
 * Only the **active** territory model is loaded (§6.3.3
 * `Territory2Model.State = 'Active'`, `TERRITORY_ACTIVE_MODEL_PREDICATE`):
 * territory names/DeveloperNames repeat across Planning/Archived models, so a
 * row of another model would collide with the active one on the
 * `name__v`/`external_id__v` match keys. The filter is applied client-side by
 * `territoryStatus` (`skipped(TERRITORY_MODEL_INACTIVE)`, switch off with
 * `objects.territory.activeModelOnly = false` — then §6.0.4 applies and the
 * row is loaded with `status__v = inactive__v`); the extractor may add the
 * predicate to the SOQL as well (`ScopeSpec` has no static predicate hook for
 * `full` scopes yet). `Territory2ModelId` / `Territory2TypeId` are skipped.
 *
 * Country (§6.3.3 "Country" row): `territory__v.country__v` is `[UNV]` and
 * "required when selecting territories" `[DOC]`. The rule is
 * `objects.territory.countryOf` (spec key; `countryRule` is an accepted
 * alias because the generic §6.0.5 `countryOf` override grammar rejects
 * `fromUsers`/`prefixMap` — `config/resolve.ts` must route the territory
 * value here instead of parsing it as a unit-scoping rule), one of
 * `field:<Territory2 custom field>`, `prefixMap` (`objects.territory
 * .countryPrefixMap: { 'DE-': DE, 'US_': US }` matched against
 * `DeveloperName` then `Name`, longest prefix first), `fromUsers` (default —
 * majority country of the territory's active users, pre-computed into
 * `TERRITORY_USERS_COUNTRY_COLUMN` by `enrichTerritoryRows`; ties →
 * `TERRITORY_COUNTRY_AMBIGUOUS`) or `const:<ISO>`. Unresolved →
 * `TERRITORY_COUNTRY_UNRESOLVED`: the row is still loaded when the target
 * field is optional; when it is required the row **fails** with that code
 * (countries are never created, so a `pending_fk` hold could never resolve
 * and would only surface later as a misleading `UNRESOLVED_FK`).
 *
 * `external_id__v = DeveloperName` is written only when
 * `objects.territory.externalIdOwnedBy = 'migration'` (`territoryExternalId`);
 * by default Align owns the field (§3.2 step 4, §6.0.4 "never overwrite an
 * integration-owned value"). The `external_id` match rule still works — the
 * matcher falls back to the source column for the key value.
 *
 * The unit itself is `GLOBAL` (§6.2).
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
  SourceRow,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";
import { readFlag } from "./user";

/** SOQL filter restricting the extract to the active territory model (§6.3.3). */
export const TERRITORY_ACTIVE_MODEL_PREDICATE =
  "Territory2Model.State = 'Active'";

/** Skip code of rows belonging to a non-active `Territory2Model` (`activeModelOnly`, default true). */
export const TERRITORY_MODEL_INACTIVE = "TERRITORY_MODEL_INACTIVE";

/**
 * Synthetic row column carrying the ISO-2 countries of the territory's active
 * users (`fromUsers` rule): a single code, a `;`-separated list (one entry per
 * user, so the majority can be computed) or an array. Filled by
 * `enrichTerritoryRows` from `UserTerritory2Association WHERE IsActive = true`
 * joined to the user map; absent → `TERRITORY_COUNTRY_UNRESOLVED`.
 */
export const TERRITORY_USERS_COUNTRY_COLUMN = "Users_Country__computed";

export type TerritoryCountryRule =
  | { kind: "field"; field: string }
  | { kind: "prefixMap" }
  | { kind: "fromUsers" }
  | { kind: "const"; iso2: string };

/** Parse `objects.territory.countryOf` / `countryRule` (default `fromUsers`). Returns undefined for anything else. */
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
 * The configured territory country rule text: the spec key
 * `objects.territory.countryOf` when it reached the options, else the
 * `countryRule` alias (module default `fromUsers`).
 */
export function territoryCountryRuleText(
  options: Record<string, unknown>,
): unknown {
  return options.countryRule ?? options.countryOf;
}

/**
 * Source columns the configured rule reads beyond the mapping rows — the
 * custom field of a `field:<f>` rule (`prefixMap` reads `DeveloperName`/`Name`
 * which are mapping sources already; `fromUsers` reads the synthetic column
 * produced by `enrichTerritoryRows`). Pass to `buildColumnList(..., { extra })`
 * / `objects.territory.extraColumns`.
 */
export function territoryExtraColumns(
  options: Record<string, unknown>,
): string[] {
  const rule = parseTerritoryCountryRule(territoryCountryRuleText(options));
  return rule?.kind === "field" ? [rule.field] : [];
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

/** One `UserTerritory2Association` / `UserTerritory` row as the enrichment needs it. */
export interface TerritoryUserAssociation {
  /** `Territory2Id` (or legacy `TerritoryId`). */
  TerritoryId: string;
  UserId: string;
  /** `IsActive`; absent counts as active. */
  IsActive?: unknown;
}

/**
 * Fill `TERRITORY_USERS_COUNTRY_COLUMN` on every territory row from the
 * active user–territory associations and the users' countries (ISO-2 by
 * 18-char user id, as the wave-0 user extract resolved them). Pure: returns
 * new row objects, one code per active user so `majorityCountry` can vote;
 * territories without an active user of known country get an empty column
 * (→ `TERRITORY_COUNTRY_UNRESOLVED`). Rows that already carry the column are
 * left untouched (idempotent re-runs).
 */
export function enrichTerritoryRows<R extends SourceRow>(
  rows: readonly R[],
  associations: readonly TerritoryUserAssociation[],
  countryByUserSfdcId: ReadonlyMap<string, string> | Record<string, string>,
): R[] {
  const lookup = (id: string): string | undefined =>
    countryByUserSfdcId instanceof Map
      ? (countryByUserSfdcId as ReadonlyMap<string, string>).get(id)
      : (countryByUserSfdcId as Record<string, string>)[id];
  const byTerritory = new Map<string, string[]>();
  for (const a of associations) {
    if (!isSfdcId(a.TerritoryId) || !isSfdcId(a.UserId)) continue;
    if (readFlag(a.IsActive) === false) continue;
    const iso2 = lookup(to18(a.UserId)) ?? lookup(a.UserId);
    if (!iso2) continue;
    const key = to18(a.TerritoryId);
    const list = byTerritory.get(key) ?? [];
    list.push(iso2.trim().toUpperCase());
    byTerritory.set(key, list);
  }
  return rows.map((row) => {
    if (row[TERRITORY_USERS_COUNTRY_COLUMN] !== undefined) return row;
    const codes = isSfdcId(row.Id) ? byTerritory.get(to18(row.Id)) : undefined;
    return { ...row, [TERRITORY_USERS_COUNTRY_COLUMN]: codes ?? [] };
  });
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

/** Mirrors `applyMapping`'s rule: config override → row `K`/`Y` → target metadata (a `-` row is never required). */
function targetRequired(ctx: TransformContext): boolean {
  const override = ctx.mapping.required[ctx.field.target];
  if (override !== undefined) return override;
  if (ctx.field.required === "K" || ctx.field.required === "Y") return true;
  if (ctx.field.required === "-") return false;
  return ctx.field.required !== "n" && ctx.targetField?.required === true;
}

/**
 * `country__v` per `objects.territory.countryOf` (see file header). Emits
 * the crosswalk Vault id (`country(ref)` semantics) or a deferred
 * `{ $fk: country }`.
 */
export const territoryCountry: CustomTransformFn = (_value, row, ctx) => {
  const options = ctx.mapping.options;
  const ruleText = territoryCountryRuleText(options);
  const rule = parseTerritoryCountryRule(ruleText);
  const unresolved = (
    code: "TERRITORY_COUNTRY_UNRESOLVED" | "TERRITORY_COUNTRY_AMBIGUOUS",
    detail: string,
    value?: string,
  ): TransformResult => {
    // §6.0.4/§6.3.3: optional target → row loaded without the field, warning-level
    // diagnostic; required target → the row fails now with the real code
    // (countries are never created, so no FK round could ever resolve it)
    const required = targetRequired(ctx);
    const diagnostic: RowDiagnostic = {
      kind: required ? "required_missing" : "country_unresolved",
      field: ctx.field.target,
      code,
      detail,
      value,
      fatal: required || undefined,
    };
    return { omit: true, diagnostic };
  };
  if (!rule)
    return unresolved(
      "TERRITORY_COUNTRY_UNRESOLVED",
      `invalid objects.territory.countryOf "${String(ruleText)}"`,
    );

  let entry: CountryCrosswalkEntry | undefined;
  let probe: string | undefined;
  switch (rule.kind) {
    case "field": {
      const v = row[rule.field];
      if (v === undefined)
        return unresolved(
          "TERRITORY_COUNTRY_UNRESOLVED",
          `field ${rule.field} is not on the row (declare it in objects.territory.extraColumns / territoryExtraColumns)`,
        );
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
      const raw = row[TERRITORY_USERS_COUNTRY_COLUMN];
      if (raw === undefined)
        return unresolved(
          "TERRITORY_COUNTRY_UNRESOLVED",
          `${TERRITORY_USERS_COUNTRY_COLUMN} is not on the row (enrichTerritoryRows was not applied before the transform)`,
        );
      const vote = majorityCountry(usersCountries(raw));
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
 * `Territory2Model.State` → active-model filter + `status__v`:
 *  - non-active model and `activeModelOnly` (default true): the row is
 *    `skipped(TERRITORY_MODEL_INACTIVE)` — only the active model is loaded
 *    (§6.3.3) and its names must not be matched against the active one;
 *  - non-active model and `activeModelOnly = false`: `status__v = inactive__v`
 *    (§6.0.4 territory row) unless `statusFromFlag = false`;
 *  - active model or column absent: omitted (Vault defaults `active__v`).
 * The `statusFromFlag` switch is honoured inside the transform (not as a row
 * `disabledBy`) so that turning the status derivation off never removes the
 * model filter.
 */
export const territoryStatus: CustomTransformFn = (_value, row, ctx) => {
  const state = row["Territory2Model.State"];
  if (isEmpty(state)) return undefined;
  if (String(state).trim() === "Active") return undefined;
  const options = ctx.mapping.options;
  if (options.activeModelOnly !== false)
    return {
      omit: true,
      diagnostic: {
        kind: "skipped",
        field: ctx.field.target,
        code: TERRITORY_MODEL_INACTIVE,
        value: String(state).trim().slice(0, 32),
        detail: `Territory2Model.State = ${String(state).trim()} — only the active model is loaded (objects.territory.activeModelOnly)`,
        fatal: true,
      },
    } satisfies TransformResult;
  if (options.statusFromFlag === false) return undefined;
  return "inactive__v";
};

/**
 * `DeveloperName` (legacy: `Name`) → `external_id__v` only when the migration
 * owns the field (`objects.territory.externalIdOwnedBy = 'migration'`);
 * omitted under the default `integration` (Align) so a matched update never
 * overwrites Align's key (§3.2 step 4, §6.0.4). The `external_id` match rule
 * reads the source column, so matching is unaffected.
 */
export const territoryExternalId: CustomTransformFn = (value, _row, ctx) => {
  if (ctx.mapping.options.externalIdOwnedBy === "integration") return undefined;
  if (isEmpty(value)) return undefined;
  return String(value);
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
  custom: { territoryCountry, territoryStatus, territoryExternalId },
  optionDefaults: {
    countryRule: "fromUsers",
    countryPrefixMap: {},
    activeModelOnly: true,
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
    "[DOC] 'Country is required when selecting territories'. objects.territory.countryOf (alias countryRule): field:<f> | prefixMap (countryPrefixMap vs DeveloperName then Name) | fromUsers (default; majority of active users via enrichTerritoryRows, ties → TERRITORY_COUNTRY_AMBIGUOUS) | const:<ISO>; unresolved → TERRITORY_COUNTRY_UNRESOLVED (row loaded when the field is optional, failed with that code when required)",
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
      optionalSource: true,
      notes:
        "non-active model → skipped(TERRITORY_MODEL_INACTIVE) (activeModelOnly, default) or inactive__v (§6.0.4, activeModelOnly = false; statusFromFlag honoured in the transform); only the active model is loaded",
    },
    {
      source: "DeveloperName",
      target: "external_id__v",
      transform: "custom(territoryExternalId)",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "written only with externalIdOwnedBy = migration; Align owns external_id__v by default (externalIdOwnedBy = integration) and is never overwritten (§3.2 step 4)",
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
      notes: `not loaded; only the active model is loaded (${TERRITORY_ACTIVE_MODEL_PREDICATE})`,
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
    "createPolicy match-only (Align owns territories); country via objects.territory.countryOf (field | prefixMap | fromUsers | const); depth-ordered client-side by ParentTerritory2Id; deletePolicy inactivate (status__v only). Only the active model is loaded (TERRITORY_ACTIVE_MODEL_PREDICATE; other models skipped(TERRITORY_MODEL_INACTIVE)). external_id__v written only when externalIdOwnedBy = migration. Legacy Territory orgs use territoryLegacy.",
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
      transform: "custom(territoryExternalId)",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "DeveloperName absent on legacy Territory — Name instead; written only with externalIdOwnedBy = migration",
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
