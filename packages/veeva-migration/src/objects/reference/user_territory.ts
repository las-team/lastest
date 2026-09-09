/**
 * `user_territory` — `UserTerritory2Association` → `user_territory__v`
 * (spec §6.3.4 `[OBS]`, §3.3, §4.4).
 *
 * Pure association rows: created when unmatched, `deletePolicy = delete`
 * (§4.4). `UserTerritory2Association` may be non-replicateable in some orgs —
 * `getDeleted` is then unavailable and deletes come from the key-set
 * reconciliation instead (§4.4 source 2 / §2.1.6).
 *
 * `name__v` is synthesised as `{username}:{territory name}`
 * (`nameTemplates.userTerritory`, §7.3) from the relationship columns in
 * `USER_TERRITORY_EXTRA_COLUMNS`; `external_id__v` is the composite
 * `{userVaultId}__{territoryVaultId}` resolved by the loader.
 *
 * Legacy Territory Management orgs use `user_territoryLegacy`
 * (`UserTerritory`: `UserId`, `TerritoryId`, `IsActive`).
 */
import type {
  CustomTransformFn,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";
import { readFlag } from "./user";

/** Relationship columns the name template reads (select them with `ColumnOptions.extra`). */
export const USER_TERRITORY_EXTRA_COLUMNS = [
  "User.Username",
  "Territory2.Name",
] as const;
export const USER_TERRITORY_LEGACY_EXTRA_COLUMNS = [
  "User.Username",
  "Territory.Name",
] as const;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function firstText(row: SourceRow, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (!isEmpty(v)) return String(v).normalize("NFC").trim();
  }
  return "";
}

/** Render `nameTemplates.userTerritory` (`{username}:{territory}`) for one association row. */
export function renderUserTerritoryName(
  template: string,
  row: SourceRow,
): { name: string; username: string; territory: string } {
  const username = firstText(row, ["User.Username", "username", "Username"]);
  const territory = firstText(row, [
    "Territory2.Name",
    "Territory.Name",
    "territory",
  ]);
  const name = template
    .replace(/\{username\}/g, username)
    .replace(/\{territory\}/g, territory)
    .trim();
  return { name, username, territory };
}

/**
 * `name__v` = `{username}:{territory name}`. Incomplete inputs (a relationship
 * column not selected or empty) omit the field with a non-fatal
 * `USER_TERRITORY_NAME_INCOMPLETE` diagnostic — Vault either assigns its
 * system-managed name or rejects the row with a clear error.
 */
export const userTerritoryName: CustomTransformFn = (_value, row, ctx) => {
  const template =
    ctx.country.nameTemplates.userTerritory ?? "{username}:{territory}";
  const { name, username, territory } = renderUserTerritoryName(template, row);
  if (!username || !territory || !name)
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: "USER_TERRITORY_NAME_INCOMPLETE",
        detail: !username ? "User.Username missing" : "Territory name missing",
      },
    } satisfies TransformResult;
  const max = ctx.targetField?.maxLength ?? 128;
  if (name.length <= max) return name;
  return {
    value: name.slice(0, max),
    diagnostic: {
      kind: "truncated",
      field: ctx.field.target,
      detail: `${name.length} > ${max}`,
    },
  } satisfies TransformResult;
};

/** `IsActive = false` → `status__v = inactive__v`; otherwise omitted (Vault defaults `active__v`). */
export const userTerritoryStatus: CustomTransformFn = (value) => {
  const flag = readFlag(value);
  if (flag === undefined) return undefined;
  return flag ? undefined : "inactive__v";
};

const shared = {
  key: "user_territory",
  target: "user_territory__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["user", "territory"],
  // association object: no Name column, no OwnerId, no Veeva stamps; external_id__v is the composite below
  blockS: {
    name: "none",
    ownerId: false,
    mobileId: false,
    lastDevice: false,
    mobileDatetimes: false,
    locks: false,
    unlock: false,
    externalId: false,
  },
  picklists: { "user_territory.role": {} },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  custom: { userTerritoryName, userTerritoryStatus },
} satisfies Partial<ObjectModuleInput>;

function rows(opts: { territoryIdColumn: string }) {
  return [
    {
      source: "UserId",
      target: "user__v",
      transform: "refUser",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: opts.territoryIdColumn,
      target: "territory__v",
      transform: "ref(territory)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "User.Username",
      target: "name__v",
      transform: "custom(userTerritoryName)",
      required: "Y",
      evidence: "OBS",
      notes:
        "{username}:{territory name} via nameTemplates.userTerritory; reads User.Username and the territory Name relationship column (USER_TERRITORY_EXTRA_COLUMNS)",
    },
    {
      source: "Id",
      target: "external_id__v",
      transform: `compositeExternalId('{u}__{t}', u=user:UserId, t=ref:territory:${opts.territoryIdColumn})`,
      required: "n",
      evidence: "OBS",
      notes:
        "{userVaultId}__{territoryVaultId} — resolved by the loader from the id map (§3.2 rewriteCompositeExternalId)",
    },
    {
      source: "RoleInTerritory2",
      target: "role__v",
      transform: "picklist(user_territory.role)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "picklist",
      notes: "dropped by preflight when the target field is absent",
    },
    {
      source: "IsActive",
      target: "status__v",
      transform: "custom(userTerritoryStatus)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "boolean",
      disabledBy: "statusFromFlag",
      notes:
        "inactive__v when IsActive = false (§6.0.4 user_territory row); dropped when absent",
    },
  ] as const;
}

export const user_territory = defineObject({
  ...shared,
  source: "UserTerritory2Association",
  fields: [...rows({ territoryIdColumn: "Territory2Id" })],
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "user__v", source: "UserId" },
        { target: "territory__v", source: "Territory2Id" },
      ],
      evidence: "OBS",
      notes: "(user__v, territory__v) pair via VQL",
    },
  ],
  notes:
    "Association rows: deletePolicy delete; UserTerritory2Association may be non-replicateable → key-set reconciliation instead of getDeleted (§4.4). Legacy orgs use user_territoryLegacy.",
});

/** Legacy Territory Management variant (`UserTerritory`), selected by preflight when `Territory2` is absent. */
export const user_territoryLegacy = defineObject({
  ...shared,
  source: "UserTerritory",
  fields: rows({ territoryIdColumn: "TerritoryId" }).filter(
    (r) => r.source !== "RoleInTerritory2",
  ),
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "user__v", source: "UserId" },
        { target: "territory__v", source: "TerritoryId" },
      ],
      evidence: "OBS",
    },
  ],
  notes:
    "Legacy UserTerritory variant of user_territory (UserId → user__v, TerritoryId → territory__v, IsActive → status__v).",
});
