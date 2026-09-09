/**
 * `affiliation` — `Affiliation_vod__c` → `affiliation__v` (spec §6.3.10
 * `[DOC]`, fields `[UNV]`; not Network-bridged in Vault CRM; §6.1 step 6,
 * §6.2, §3.3, §3.4, §4.4).
 *
 * Account ↔ account relationship rows. Full scope, country inherited from the
 * **from** account (`parent:account:From_Account_vod__c`, §6.2), loaded after
 * `account` with triggers on (master data, §2.5.4).
 *
 * Mirror rows: Veeva writes every affiliation twice (A→B and B→A) linked by
 * `Child_affiliation_vod__c`; that self-reference is a **pass-2 patch**
 * (`ref(affiliation) secondPass` + `selfRefs`, §6.1 step 6).
 *
 * Contacts (§3.4): `From_Contact_vod__c` / `To_Contact_vod__c` have no Vault
 * equivalent. A row whose account side is empty but whose contact side is
 * populated cannot be represented and is `skipped(CONTACT_REF_DROPPED)` —
 * counted, never failed (`custom(affiliationAccountRef)`). Mapping contacts to
 * person accounts (`objects.account.contactToPersonAccount`) is an
 * account-module concern and needs `Account.PersonContactId` resolution; it is
 * not attempted here.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only (no business flag).
 */
import { isContactId } from "../../transform/ids";
import { applyTransform } from "../../transform/registry";
import { renameField } from "../../transform/rename";
import type {
  CustomTransformFn,
  FieldMapping,
  TransformResult,
  TransformSpec,
} from "../../types";
import { defineObject } from "../types";

/** Country-of lookup (§6.2) and first half of the natural key. */
export const AFFILIATION_FROM_FIELD = "From_Account_vod__c";
export const AFFILIATION_TO_FIELD = "To_Account_vod__c";
/** Mirror-row self reference patched in pass 2 (§6.1). */
export const AFFILIATION_MIRROR_FIELD = "Child_affiliation_vod__c";

/** Formula columns of `Affiliation_vod__c` (§6.3.10 last row). */
export const AFFILIATION_SKIPPED_FORMULAS = [
  "To_Account_Name_vod__c",
  "To_Account_Identifier_vod__c",
  "To_Account_Record_Type_vod__c",
] as const;
/** Transient trigger flags (§6.3.10). */
export const AFFILIATION_SKIPPED_TRANSIENT = [
  "Disable_Trigger_vod__c",
  "destroy_vod__c",
] as const;

type Row = Omit<FieldMapping, "transform"> & {
  transform: TransformSpec | string;
};

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function skipRows(sources: readonly string[], notes: string): Row[] {
  return sources.map((source) => ({
    source,
    target: renameField(source) ?? `${source.toLowerCase()}__v`,
    transform: "skip",
    required: "-",
    notes,
  }));
}

/** `From_Account_vod__c` → `From_Contact_vod__c` (the contact twin of an account lookup). */
export function contactTwinOf(accountField: string): string {
  return accountField.replace("_Account_", "_Contact_");
}

/**
 * `from_account__v` / `to_account__v`: `ref(account)` when the account lookup
 * is set. When it is empty and the contact twin (`*_Contact_vod__c`) is
 * populated — or when the lookup itself carries a Contact id — the row is a
 * contact affiliation with no Vault representation →
 * `skipped(CONTACT_REF_DROPPED)` (fatal skip, counted per §3.4). Both empty →
 * omitted (the required-ness of the row then reports `REQUIRED_MISSING`).
 */
export const affiliationAccountRef: CustomTransformFn = (value, row, ctx) => {
  const contactField = contactTwinOf(ctx.field.source);
  const skip = (contact: unknown, source: string): TransformResult => ({
    omit: true,
    diagnostic: {
      kind: "skipped",
      field: ctx.field.target,
      code: "CONTACT_REF_DROPPED",
      value: String(contact),
      detail: `${source} references a Contact — no Vault CRM equivalent (§3.4)`,
      fatal: true,
    },
  });
  if (!isEmpty(value)) {
    if (isContactId(value)) return skip(value, ctx.field.source);
    return applyTransform(
      { kind: "ref", objectKey: "account" },
      value,
      row,
      ctx,
    );
  }
  const contact = row[contactField];
  if (isEmpty(contact)) return undefined;
  return skip(contact, contactField);
};

export const affiliation = defineObject({
  key: "affiliation",
  source: "Affiliation_vod__c",
  target: "affiliation__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: `parent:account:${AFFILIATION_FROM_FIELD}`,
  dependsOn: ["account"],
  selfRefs: [
    { target: "child_affiliation__v", source: AFFILIATION_MIRROR_FIELD },
  ],
  blockS: { currency: false },
  fields: [
    {
      source: AFFILIATION_FROM_FIELD,
      target: "from_account__v",
      transform: "custom(affiliationAccountRef)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "ref(account); From_Contact_vod__c-only rows are skipped(CONTACT_REF_DROPPED); country-of lookup (§6.2)",
    },
    {
      source: AFFILIATION_TO_FIELD,
      target: "to_account__v",
      transform: "custom(affiliationAccountRef)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "ref(account); To_Contact_vod__c-only rows are skipped(CONTACT_REF_DROPPED)",
    },
    {
      source: "From_Contact_vod__c",
      target: "from_contact__v",
      transform: "skip",
      required: "-",
      notes:
        "Contact lookup — CONTACT_REF_DROPPED (§3.4); read by custom(affiliationAccountRef) via the row",
    },
    {
      source: "To_Contact_vod__c",
      target: "to_contact__v",
      transform: "skip",
      required: "-",
      notes:
        "Contact lookup — CONTACT_REF_DROPPED (§3.4); read by custom(affiliationAccountRef) via the row",
    },
    {
      source: AFFILIATION_MIRROR_FIELD,
      target: "child_affiliation__v",
      transform: "ref(affiliation) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes: "mirror row — pass-2 patch (§6.1 step 6)",
    },
    {
      source: "External_Id_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "unique 255 (note the `_Id_` casing on this object)",
    },
    {
      source: "Role_vod__c",
      target: "role__v",
      transform: "picklist(affiliation.role)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
      notes: "third member of the natural key (§3.3)",
    },
    {
      source: "Influence_vod__c",
      target: "influence__v",
      transform: "picklist(affiliation.influence)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Relationship_Strength_vod__c",
      target: "relationship_strength__v",
      transform: "picklist(affiliation.relationshipStrength)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Therapeutic_Area_vod__c",
      target: "therapeutic_area__v",
      transform: "multipicklist(affiliation.therapeuticArea)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "multipicklist",
    },
    {
      source: "Parent_vod__c",
      target: "parent__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Comments_vod__c",
      target: "comments__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
    },
    ...skipRows(
      AFFILIATION_SKIPPED_TRANSIENT,
      "transient trigger flag (§6.3.10)",
    ),
    ...skipRows(AFFILIATION_SKIPPED_FORMULAS, "formula (§6.3.10)"),
  ],
  picklists: {
    "affiliation.role": {},
    "affiliation.influence": {},
    "affiliation.relationshipStrength": {},
    "affiliation.therapeuticArea": {},
  },
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_Id_vod__c" }],
      evidence: "UNV",
    },
    {
      method: "natural_key",
      keys: [
        { target: "from_account__v", source: AFFILIATION_FROM_FIELD },
        { target: "to_account__v", source: AFFILIATION_TO_FIELD },
        {
          target: "role__v",
          source: "Role_vod__c",
          transform: { kind: "picklist", mapKey: "affiliation.role" },
        },
      ],
      evidence: "UNV",
      notes: "(from_account__v, to_account__v, role__v) via VQL (§3.3)",
    },
  ],
  custom: { affiliationAccountRef },
  notes:
    "Account-to-account relationships incl. mirror rows (child_affiliation__v patched in pass 2); contact affiliations are skipped and counted (CONTACT_REF_DROPPED); inactivated (status__v only) on delete (§4.4).",
});
