/**
 * `account_territory` — `ObjectTerritory2Association` (Account rows) →
 * `account_territory__v` (spec §6.3.11 `[DOC]`; §6.1 step 7, §6.2, §3.3,
 * §4.4, §2.1.6).
 *
 * **Optional, disabled by default** (`enabledByDefault = false`): Align /
 * territory rules own account–territory alignment in Vault CRM, and creating
 * an `account_territory__v` auto-creates the matching `tsf__v` `[DOC]`. Enable
 * with `objects.account_territory.enabled = true` when the target has no Align
 * feed.
 *
 * Source quirks the extractor must honour:
 *  - the association object is polymorphic — only rows with
 *    `SobjectType = 'Account'` belong here (`ACCOUNT_TERRITORY_SOURCE_FILTER`);
 *  - the `Object` relationship cannot be traversed in SOQL, so the country
 *    rule `account:ObjectId` has no path form and must use the id-set form
 *    (`ObjectId IN (in-scope account ids)`, §6.0.5);
 *  - it is expected to be **non-replicateable** (§2.1.6): no `getDeleted`,
 *    deletes come from `IsDeleted` rows and the key-set reconciliation.
 *
 * `name__v` is synthesised (`custom(accountTerritoryName)`) from
 * `nameTemplates.accountTerritory` (default `{territory}:{account}` —
 * `Territory2.Name` and the account's 18-char SFDC id) because the source has
 * no Name column; the target name is `[UNV]` and likely system-managed, so an
 * incomplete input omits the field rather than failing the row.
 *
 * Legacy Territory Management orgs (`describeGlobal` lacks `Territory2`) keep
 * assignments in `AccountShare WHERE RowCause = 'Territory'` `[DOC]` (§6.3.3
 * legacy row); that variant needs the territory-group crosswalk and is not
 * part of this module — preflight reports the object as unavailable there.
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type {
  CustomTransformFn,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";

/** SOQL filter selecting the account rows of the polymorphic association. */
export const ACCOUNT_TERRITORY_SOURCE_FILTER = "SobjectType = 'Account'";
/** Account lookup of the association (polymorphic `ObjectId`). */
export const ACCOUNT_TERRITORY_ACCOUNT_FIELD = "ObjectId";
/** Territory lookup of the association. */
export const ACCOUNT_TERRITORY_TERRITORY_FIELD = "Territory2Id";
/** Relationship column the name template reads (select via `ColumnOptions.extra`). */
export const ACCOUNT_TERRITORY_EXTRA_COLUMNS = ["Territory2.Name"] as const;
/** Default `nameTemplates.accountTerritory` (§7.3). */
export const ACCOUNT_TERRITORY_NAME_TEMPLATE = "{territory}:{account}";

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

/** Render the name template for one association row. */
export function renderAccountTerritoryName(
  template: string,
  row: SourceRow,
  accountColumn: string = ACCOUNT_TERRITORY_ACCOUNT_FIELD,
): { name: string; territory: string; account: string } {
  const territory = firstText(row, ["Territory2.Name", "territory"]);
  const rawAccount = row[accountColumn];
  const account = isSfdcId(rawAccount)
    ? to18(rawAccount)
    : isEmpty(rawAccount)
      ? ""
      : String(rawAccount).trim();
  const name = template
    .replace(/\{territory\}/g, territory)
    .replace(/\{account\}/g, account)
    .trim();
  return { name, territory, account };
}

/**
 * `name__v` = `nameTemplates.accountTerritory` rendered with `{territory}` =
 * `Territory2.Name` and `{account}` = the account's 18-char id. Incomplete
 * inputs omit the field with a non-fatal `ACCOUNT_TERRITORY_NAME_INCOMPLETE`
 * diagnostic (Vault assigns its system-managed name or rejects the row).
 */
export const accountTerritoryName: CustomTransformFn = (_value, row, ctx) => {
  const template =
    ctx.country.nameTemplates.accountTerritory ??
    ACCOUNT_TERRITORY_NAME_TEMPLATE;
  const accountColumn = ctx.field.source || ACCOUNT_TERRITORY_ACCOUNT_FIELD;
  const { name, territory, account } = renderAccountTerritoryName(
    template,
    row,
    accountColumn,
  );
  if (!territory || !account || !name)
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: "ACCOUNT_TERRITORY_NAME_INCOMPLETE",
        detail: !territory
          ? "Territory2.Name missing"
          : `${accountColumn} missing`,
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

export const account_territory = defineObject({
  key: "account_territory",
  source: "ObjectTerritory2Association",
  target: "account_territory__v",
  targetEvidence: "DOC",
  enabledByDefault: false,
  scope: { kind: "full" },
  countryOf: `account:${ACCOUNT_TERRITORY_ACCOUNT_FIELD}`,
  dependsOn: ["account", "territory"],
  // association object: no Name, no OwnerId, no Veeva stamps, no external id
  blockS: {
    name: "none",
    ownerId: false,
    currency: false,
    mobileId: false,
    lastDevice: false,
    mobileDatetimes: false,
    locks: false,
    unlock: false,
    externalId: false,
  },
  fields: [
    {
      source: ACCOUNT_TERRITORY_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes: "polymorphic ObjectId — Account rows only (SobjectType filter)",
    },
    {
      source: ACCOUNT_TERRITORY_TERRITORY_FIELD,
      target: "territory__v",
      transform: "ref(territory)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "AssociationCause",
      target: "associationcause__v",
      transform: "skip",
      required: "-",
      notes: "Territory2 assignment cause — not loaded (§6.3.11)",
    },
    {
      source: ACCOUNT_TERRITORY_ACCOUNT_FIELD,
      target: "name__v",
      transform: "custom(accountTerritoryName)",
      required: "y?",
      evidence: "UNV",
      notes:
        "{territory}:{account} via nameTemplates.accountTerritory; reads Territory2.Name (ACCOUNT_TERRITORY_EXTRA_COLUMNS); omitted when incomplete",
    },
  ],
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "account__v", source: ACCOUNT_TERRITORY_ACCOUNT_FIELD },
        { target: "territory__v", source: ACCOUNT_TERRITORY_TERRITORY_FIELD },
      ],
      evidence: "DOC",
      notes: "(account__v, territory__v) pair via VQL",
    },
  ],
  custom: { accountTerritoryName },
  optionDefaults: { enabled: false, optional: true },
  notes:
    "Optional (default disabled — Align owns alignment; creating one auto-creates tsf__v). Extract with SobjectType = 'Account'; country via the id-set form of account:ObjectId (Object is not traversable); likely non-replicateable → key-set reconciliation for deletes (§2.1.6, §4.4).",
});
