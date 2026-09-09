/**
 * `approved_document` — `Approved_Document_vod__c` → `approved_document__v`
 * (spec §6.3.17, §6.1 step 8, §6.2, §3.3, §4.4, §6.3.42).
 *
 * Approved Email templates/fragments, Engage, Events Management and Medical
 * Inquiry templates. Integration-owned (PromoMats sync) → `createPolicy:
 * match-only` by default; `external_id__v` integration-owned (§3.2 step 4).
 *
 * Object types (§6.3.17, all `[UNV]`): `Email_Template_vod → email_template__v`
 * … `Case_Template_vod → case_template__v`.
 *
 * Matching (§3.3): id map → `vault_document_id__v` / `document_id__v` →
 * legacy-id field.
 *
 * `publish_method__v` (`[INFER]`, "Vault Auto Published" for PromoMats-synced
 * fragments) has no SFDC source: `custom(publishMethod)` sends
 * `objects.approved_document.publishMethod` — **omitted by default** so the
 * PromoMats integration can claim the row later; the row is gated by the
 * flag (`enabledBy: publishMethod`) and only relevant when `createPolicy =
 * create` (migrated, non-Vault-managed content is expected to carry the
 * *manual* value). Value names are `[UNV]` (`vault_auto_published__v` /
 * `manual__v`), resolved by label at preflight.
 *
 * `content_type__v` goes through the **shared** config-object crosswalk of
 * §6.3.42 (`configMaps.contentType`, keyed by the SFDC 18-char id of the
 * `Content_Type_vod__c` row; value = Vault record id | `external_id:<v>` |
 * `name:<v>`), `custom(contentType)`. The map is read from this object's
 * materialised options (`mapping.options.configMaps.contentType`) — the
 * engine/preflight is expected to project `objects.multichannel_consent.configMaps`
 * onto it (the schema accepts `configMaps` on any object). Automatic
 * fallbacks (2)/(3) of §6.3.42 use the relationship columns when the extract
 * carries them. No hit → field omitted, `VT_CONSENT_CONFIG_UNMATCHED`
 * counted (blocking at preflight, non-fatal here).
 *
 * `Survey_vod__c` references an object out of v1 (§6.2.1): omitted and
 * counted by `custom(outOfScopeRef)`.
 *
 * HTML bodies (`Email_HTML_1/2_vod__c` 131072, fragment HTML, template
 * fragment HTML/document id) are `deferredBlob` rows loaded in the blob pass
 * (§8.6) under the `emailHtml` policy; LongText targets hold ≤ 32 000 chars,
 * the split/truncate policy is `objects.approved_document.htmlOverflow`
 * (default `truncate`, §7.2.1).
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `approved_document_status__v = withdrawn__v` (or the business `status__v`
 * field, whichever preflight picked; value `[UNV]`).
 */
import { readSource } from "../../transform/apply";
import { isSfdcId, to15, to18 } from "../../transform/ids";
import type { CustomTransformFn } from "../../types";
import { defineObject } from "../types";
import { outOfScopeRef } from "./key_message";

/** Blob name of the HTML bodies (`objects.approved_document.blobs.emailHtml`, §8.6). */
export const APPROVED_DOCUMENT_HTML_BLOB = "emailHtml";

/** `Content_Type_vod__c` relationship columns used by the §6.3.42 automatic fallbacks (2)/(3). */
export const CONTENT_TYPE_EXTERNAL_ID_PATH =
  "Content_Type_vod__r.External_ID_vod__c";
export const CONTENT_TYPE_NAME_PATH = "Content_Type_vod__r.Name";

/** RecordType DeveloperName → object type api name (§6.3.17, all `[UNV]`). */
export const APPROVED_DOCUMENT_OBJECT_TYPES: Record<string, string> = {
  Email_Template_vod: "email_template__v",
  Email_Fragment_vod: "email_fragment__v",
  Email_Receipt_vod: "email_receipt__v",
  Engage_vod: "engage__v",
  Events_Management_vod: "events_management__v",
  Medical_Inquiry_Template_vod: "medical_inquiry_template__v",
  Remote_Meeting_vod: "remote_meeting__v",
  CoBrowse_Invite_Template_vod: "cobrowse_invite_template__v",
  Case_Template_vod: "case_template__v",
};

/** `Status_vod__c` → `approved_document_status__v` defaults (§6.3.17). */
export const APPROVED_DOCUMENT_STATUS_DEFAULTS: Record<string, string> = {
  Staged_vod: "staged__v",
  Expired_vod: "expired__v",
  Withdrawn_vod: "withdrawn__v",
  Approved_vod: "approved__v",
};

/** Expected `publish_method__v` value names (`[UNV]`, resolved by label at preflight). */
export const PUBLISH_METHOD_VALUES = {
  vaultAutoPublished: "vault_auto_published__v",
  manual: "manual__v",
} as const;

/** Plain text columns mapped 1:1 to `<name>__v` (`as types`, §6.3.17). */
export const APPROVED_DOCUMENT_TEXT_FIELDS = [
  "Email_Subject_vod__c",
  "Email_From_Address_vod__c",
  "Email_From_Name_vod__c",
  "Email_ReplyTo_Address_vod__c",
  "Email_ReplyTo_Name_vod__c",
  "Email_Domain_vod__c",
  "Bcc_vod__c",
  "Engage_Document_Id_vod__c",
  "Document_Host_URL_vod__c",
] as const;

/** Boolean columns mapped 1:1 (§6.3.17). */
export const APPROVED_DOCUMENT_BOOLEAN_FIELDS = [
  "Email_Allows_Documents_vod__c",
  "Allow_Any_Product_Fragment_vod__c",
] as const;

/**
 * `PI/ISI/Piece/Other_Document_ID*_vod__c` (§6.3.17 glob) — the exact
 * spellings are org-dependent, so every row is `unverifiedSource` (describe
 * miss = info, row dropped).
 */
export const APPROVED_DOCUMENT_ID_FIELDS = [
  "PI_Document_ID_vod__c",
  "ISI_Document_ID_vod__c",
  "Piece_Document_ID_vod__c",
  "Other_Document_ID_vod__c",
] as const;

/** HTML body columns loaded in the blob pass (§6.3.17 last row, §8.6). */
export const APPROVED_DOCUMENT_HTML_FIELDS = [
  "Email_HTML_1_vod__c",
  "Email_HTML_2_vod__c",
  "Email_Fragment_HTML_vod__c",
  "Email_Template_Fragment_HTML_vod__c",
  "Email_Template_Fragment_Document_ID_vod__c",
] as const;

/** `Foo_Bar_vod__c` → `foo_bar__v` (§6.0.2 field rule). */
export function renameApprovedDocumentField(source: string): string {
  return `${source.replace(/__c$/i, "").replace(/_vod$/i, "").toLowerCase()}__v`;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `publish_method__v`: `objects.approved_document.publishMethod` when set
 * and the unit creates rows; omitted otherwise (integration claims the row
 * later). A configured name outside the target picklist is reported
 * (`VT_PICKLIST_VALUE_MISSING`) and omitted — preflight resolves labels.
 */
export const publishMethod: CustomTransformFn = (_value, _row, ctx) => {
  const configured = ctx.mapping.options.publishMethod;
  if (typeof configured !== "string" || configured.trim() === "")
    return undefined;
  if (ctx.mapping.options.createPolicy !== "create") return undefined;
  const name = configured.trim();
  const known = ctx.targetField?.picklistValues;
  if (known && known.length && !known.includes(name))
    return {
      omit: true,
      diagnostic: {
        kind: "unmapped_picklist",
        field: ctx.field.target,
        code: "VT_PICKLIST_VALUE_MISSING",
        value: name,
      },
    };
  return name;
};

/**
 * `content_type__v` via the shared §6.3.42 crosswalk: (1) explicit
 * `configMaps.contentType[<sfdc id>]` entry — Vault id, `external_id:<v>`
 * (→ `content_type__v.external_id__v`) or `name:<v>` (→
 * `content_type__v.name__v`); (2) `Content_Type_vod__r.External_ID_vod__c`
 * when extracted; (3) `Content_Type_vod__r.Name`; else omitted with a
 * non-fatal `VT_CONSENT_CONFIG_UNMATCHED` diagnostic.
 */
export const contentType: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  if (!isSfdcId(raw))
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: ctx.field.target,
        code: "INVALID_ID",
        value: raw,
      },
    };
  const id = to18(raw);
  const maps = ctx.mapping.options.configMaps as
    | { contentType?: Record<string, string> }
    | undefined;
  const entry = maps?.contentType?.[id] ?? maps?.contentType?.[to15(id)];
  if (entry) {
    if (entry.startsWith("external_id:"))
      return {
        value: entry.slice("external_id:".length),
        targetField: `${ctx.field.target}.external_id__v`,
      };
    if (entry.startsWith("name:"))
      return {
        value: entry.slice("name:".length),
        targetField: `${ctx.field.target}.name__v`,
      };
    // Vault record id resolved at preflight — config crosswalk exception (§6.3.42), as country(ref)
    return { value: entry };
  }
  const ext = readSource(row, CONTENT_TYPE_EXTERNAL_ID_PATH);
  if (!isEmpty(ext))
    return {
      value: String(ext).trim(),
      targetField: `${ctx.field.target}.external_id__v`,
    };
  const name = readSource(row, CONTENT_TYPE_NAME_PATH);
  if (!isEmpty(name))
    return {
      value: String(name).trim(),
      targetField: `${ctx.field.target}.name__v`,
    };
  return {
    omit: true,
    diagnostic: {
      kind: "unresolved_fk",
      field: ctx.field.target,
      code: "VT_CONSENT_CONFIG_UNMATCHED",
      value: id,
      detail:
        "Content_Type_vod__c row has no entry in configMaps.contentType (§6.3.42)",
    },
  };
};

export const approved_document = defineObject({
  key: "approved_document",
  source: "Approved_Document_vod__c",
  target: "approved_document__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["product", "key_message"],
  fields: [
    {
      source: "Name",
      target: "name__v",
      transform: "text",
      required: "Y",
      evidence: "UNV",
      sourceType: "string",
      disabledBy: "preserveName",
    },
    {
      source: "Document_ID_vod__c",
      target: "document_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "EXTID unique 100; match key (§3.3)",
    },
    {
      source: "Vault_Document_ID_vod__c",
      target: "vault_document_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "100; match key (§3.3)",
    },
    {
      source: "Vault_Instance_ID_vod__c",
      target: "vault_instance_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
    },
    {
      source: "Document_Last_Mod_DateTime_vod__c",
      target: "document_last_mod_datetime__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      sourceType: "datetime",
    },
    {
      source: "Status_vod__c",
      target: "approved_document_status__v",
      transform: "picklist(approved_document.status)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{Staged_vod, Expired_vod, Withdrawn_vod, Approved_vod}; {object}_status__v pattern — preflight picks approved_document_status__v or the business status__v",
    },
    {
      source: "",
      target: "publish_method__v",
      transform: "custom(publishMethod)",
      required: "n",
      evidence: "UNV",
      enabledBy: "publishMethod",
      notes:
        "[INFER vault-crm-model.md §4.15] const(objects.approved_document.publishMethod) — omitted by default so the PromoMats integration can claim the row; only when createPolicy = create; value names UNV (vault_auto_published__v / manual__v) resolved by label at preflight",
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Detail_Group_vod__c",
      target: "detail_group__v",
      transform: "ref(product)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Key_Message_vod__c",
      target: "key_message__v",
      transform: "ref(key_message)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Content_Type_vod__c",
      target: "content_type__v",
      transform: "custom(contentType)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "refLookup(content_type, external_id__v) via the shared objects.multichannel_consent.configMaps.contentType crosswalk (§6.3.42)",
    },
    {
      source: "Survey_vod__c",
      target: "survey__v",
      transform: "custom(outOfScopeRef)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "ref → Survey_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    },
    {
      source: "Language_vod__c",
      target: "language__v",
      transform: "picklist(approved_document.language)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Territory_vod__c",
      target: "territory__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "string",
      notes: "text, not a territory reference",
    },
    ...APPROVED_DOCUMENT_TEXT_FIELDS.map((source) => ({
      source,
      target: renameApprovedDocumentField(source),
      transform: "text",
      required: "n" as const,
      evidence: "UNV" as const,
    })),
    ...APPROVED_DOCUMENT_BOOLEAN_FIELDS.map((source) => ({
      source,
      target: renameApprovedDocumentField(source),
      transform: "bool",
      required: "n" as const,
      evidence: "UNV" as const,
      sourceType: "boolean" as const,
    })),
    {
      source: "Allowed_Document_IDs_vod__c",
      target: "allowed_document_ids__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    ...APPROVED_DOCUMENT_ID_FIELDS.map((source) => ({
      source,
      target: renameApprovedDocumentField(source),
      transform: "text",
      required: "n" as const,
      evidence: "UNV" as const,
      unverifiedSource: true,
      notes: "PI/ISI/Piece/Other_Document_ID*_vod__c glob (§6.3.17)",
    })),
    {
      source: "Events_Management_Subtype_vod__c",
      target: "events_management_subtype__v",
      transform: "picklist(approved_document.eventsManagementSubtype)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Save_The_Date_vod, Reminder_vod, Invitation_vod, Follow_Up_vod}",
    },
    {
      source: "Document_Description_vod__c",
      target: "document_description__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    ...APPROVED_DOCUMENT_HTML_FIELDS.map((source) => ({
      source,
      target: renameApprovedDocumentField(source),
      transform: `deferredBlob(${APPROVED_DOCUMENT_HTML_BLOB})`,
      required: "n" as const,
      evidence: "UNV" as const,
      blobName: APPROVED_DOCUMENT_HTML_BLOB,
      notes:
        "LongText ≤ 32k: split/truncate per objects.approved_document.htmlOverflow; loaded in the blob pass (§8.6)",
    })),
  ],
  objectTypes: { ...APPROVED_DOCUMENT_OBJECT_TYPES },
  picklists: {
    "approved_document.status": { ...APPROVED_DOCUMENT_STATUS_DEFAULTS },
    "approved_document.language": {},
    "approved_document.eventsManagementSubtype": {
      Save_The_Date_vod: "save_the_date__v",
      Reminder_vod: "reminder__v",
      Invitation_vod: "invitation__v",
      Follow_Up_vod: "follow_up__v",
    },
  },
  deletePolicy: "inactivate",
  inactivate: [{ field: "approved_document_status__v", value: "withdrawn__v" }],
  createPolicy: "match-only",
  load: { noTriggers: false },
  match: [
    {
      method: "external_id",
      keys: [
        { target: "vault_document_id__v", source: "Vault_Document_ID_vod__c" },
      ],
      evidence: "UNV",
      notes: "PromoMats document id (§3.3)",
    },
    {
      method: "external_id",
      keys: [{ target: "document_id__v", source: "Document_ID_vod__c" }],
      evidence: "UNV",
      notes: "EXTID unique",
    },
    {
      method: "legacy_id",
      evidence: "UNV",
      notes: "last resort — the upsert idParam (§3.2)",
    },
  ],
  blobs: { [APPROVED_DOCUMENT_HTML_BLOB]: "optional" },
  configObjects: ["contentType"],
  custom: { publishMethod, contentType, outOfScopeRef },
  optionDefaults: { htmlOverflow: "truncate" },
  notes:
    "Integration-owned (PromoMats) → createPolicy match-only by default; object types UNV; publish_method__v omitted unless objects.approved_document.publishMethod is set (create mode only); content_type__v via the shared configMaps.contentType crosswalk (§6.3.42); HTML bodies in the blob pass (htmlOverflow default truncate); deletePolicy inactivate → status__v = inactive__v + approved_document_status__v = withdrawn__v (UNV value).",
});
