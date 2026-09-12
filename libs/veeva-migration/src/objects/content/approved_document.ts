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
 * materialised options (`mapping.options.configMaps.contentType`); the
 * spec location is `objects.multichannel_consent.configMaps.contentType`
 * and the engine/preflight must project it onto every module declaring
 * `configObjects` (the schema accepts `configMaps` on any object) — until
 * that projection exists, an `objects.approved_document.configMaps` overlay
 * reaches the transform directly.
 *
 * Automatic fallback (2) of §6.3.42 (`Content_Type_vod__r.External_ID_vod__c`
 * = `external_id__v`, the spec's `refLookup(content_type, external_id__v)`)
 * is an **explicit mapping row** (`custom(contentTypeExternalId)` →
 * `content_type__v.external_id__v`, `unverifiedSource` + `optionalSource`):
 * the column builder only selects columns named by a mapping row or a match
 * key, so a fallback read from inside `custom(contentType)` alone would
 * never see the relationship column. The explicit row yields when the
 * crosswalk has an entry for the row's `Content_Type_vod__c` (the entry may
 * pick the `name__v` / record-id form and two lookup forms must never be
 * sent for one reference). Fallback (3) (`Name` = `name__v` *within the same
 * country and object type*) is deliberately not implemented in the row
 * transform — it cannot enforce the scoping and ambiguity rules; use an
 * explicit `name:<v>` map entry. No hit → field omitted,
 * `VT_CONSENT_CONFIG_UNMATCHED` counted (blocking at preflight, non-fatal
 * here).
 *
 * `Survey_vod__c` references an object out of v1 (§6.2.1): omitted and
 * counted by `custom(outOfScopeRef)`.
 *
 * HTML bodies (`Email_HTML_1/2_vod__c` 131072, fragment HTML, template
 * fragment HTML/document id) are `custom(emailHtml) deferredBlob` rows loaded
 * in the blob pass (§8.6) under the `emailHtml` blob policy. LongText targets
 * hold ≤ 32 000 chars (`APPROVED_DOCUMENT_HTML_MAX`, or the target field's
 * `max_length`); a longer body follows `objects.approved_document.htmlOverflow`
 * (§7.2.1): `truncate` (default) cuts the value at the limit, `fail` fails the
 * row (`HTML_OVERFLOW_FAIL`), `attachment` passes the full body to the blob
 * pass, which routes oversized values to an attachment when
 * `objects.approved_document.blobs.emailHtml = attachment` — with any other
 * blob policy the loader would drop the value silently, so that combination
 * fails the row instead (`HTML_OVERFLOW_ATTACHMENT_UNCONFIGURED`). Values
 * within the limit are passed through verbatim (HTML is content, not text to
 * normalise).
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `approved_document_status__v = withdrawn__v` (or the business `status__v`
 * field, whichever preflight picked; value `[UNV]`).
 */
import { readSource } from "../../transform/apply";
import { isSfdcId, to15, to18 } from "../../transform/ids";
import type { CustomTransformFn, TransformContext } from "../../types";
import { defineObject } from "../types";
import {
  CONTENT_EXTERNAL_ID_FIELD,
  externalIdIfMigrationOwned,
  outOfScopeRef,
} from "./key_message";

/** Blob name of the HTML bodies (`objects.approved_document.blobs.emailHtml`, §8.6). */
export const APPROVED_DOCUMENT_HTML_BLOB = "emailHtml";

/** `Content_Type_vod__c` lookup column on the row (crosswalk key, §6.3.42). */
export const CONTENT_TYPE_SOURCE = "Content_Type_vod__c";
/** Relationship column of the §6.3.42 automatic fallback (2) — its own mapping row (`[UNVERIFIED-SOURCE]`). */
export const CONTENT_TYPE_EXTERNAL_ID_PATH =
  "Content_Type_vod__r.External_ID_vod__c";
/** LongText limit applied to the HTML bodies when the target field carries no `max_length` (§6.3.17). */
export const APPROVED_DOCUMENT_HTML_MAX = 32000;

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

/** Explicit `configMaps.contentType` entry for a `Content_Type_vod__c` id (18- or 15-char key). */
function contentTypeEntry(
  raw: unknown,
  ctx: TransformContext,
): { id: string; entry?: string } | undefined {
  if (isEmpty(raw)) return undefined;
  const text = String(raw).trim();
  if (!isSfdcId(text)) return undefined;
  const id = to18(text);
  const maps = ctx.mapping.options.configMaps as
    | { contentType?: Record<string, string> }
    | undefined;
  return {
    id,
    entry: maps?.contentType?.[id] ?? maps?.contentType?.[to15(id)],
  };
}

/**
 * `content_type__v` via the shared §6.3.42 crosswalk: (1) explicit
 * `configMaps.contentType[<sfdc id>]` entry — Vault id, `external_id:<v>`
 * (→ `content_type__v.external_id__v`) or `name:<v>` (→
 * `content_type__v.name__v`); (2) `Content_Type_vod__r.External_ID_vod__c`
 * when the row carries it (same output as the explicit
 * `custom(contentTypeExternalId)` row, which is what makes the extractor
 * select the column); else omitted with a non-fatal
 * `VT_CONSENT_CONFIG_UNMATCHED` diagnostic.
 */
export const contentType: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  const resolved = contentTypeEntry(raw, ctx);
  if (!resolved)
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: ctx.field.target,
        code: "INVALID_ID",
        value: raw,
      },
    };
  const { id, entry } = resolved;
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
  return {
    omit: true,
    diagnostic: {
      kind: "unresolved_fk",
      field: ctx.field.target,
      code: "VT_CONSENT_CONFIG_UNMATCHED",
      value: id,
      detail:
        "Content_Type_vod__c row has no entry in configMaps.contentType and no Content_Type_vod__r.External_ID_vod__c (§6.3.42)",
    },
  };
};

/**
 * §6.3.42 automatic fallback (2) as its own row:
 * `Content_Type_vod__r.External_ID_vod__c → content_type__v.external_id__v`.
 * Yields (omits) whenever the crosswalk has an explicit entry for the row's
 * `Content_Type_vod__c`, so a `name:`/record-id entry is never accompanied by
 * a second lookup form for the same reference.
 */
export const contentTypeExternalId: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const resolved = contentTypeEntry(readSource(row, CONTENT_TYPE_SOURCE), ctx);
  if (resolved?.entry) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
};

/**
 * HTML body → blob pass value under `objects.approved_document.htmlOverflow`
 * (§6.3.17, §7.2.1). Within the LongText limit the value is verbatim;
 * beyond it: `truncate` (default) cuts at the limit (`truncated`
 * diagnostic, `HTML_TRUNCATED`), `fail` fails the row (`HTML_OVERFLOW_FAIL`),
 * `attachment` passes the full body through for the blob pass to route to an
 * attachment — only valid with `blobs.emailHtml = attachment`, otherwise the
 * loader would drop it silently, so the row fails
 * (`HTML_OVERFLOW_ATTACHMENT_UNCONFIGURED`).
 */
export const emailHtml: CustomTransformFn = (value, _row, ctx) => {
  if (isEmpty(value)) return undefined;
  const text = String(value);
  const max = ctx.targetField?.maxLength ?? APPROVED_DOCUMENT_HTML_MAX;
  if (text.length <= max) return text;
  const policy = ctx.mapping.options.htmlOverflow ?? "truncate";
  const detail = `${text.length} > ${max} (objects.approved_document.htmlOverflow = ${String(policy)})`;
  if (policy === "attachment") {
    const blobPolicy = ctx.mapping.options.blobs?.[APPROVED_DOCUMENT_HTML_BLOB];
    if (blobPolicy === "attachment") return text;
    return {
      omit: true,
      diagnostic: {
        kind: "truncated",
        field: ctx.field.target,
        code: "HTML_OVERFLOW_ATTACHMENT_UNCONFIGURED",
        fatal: true,
        detail: `${detail} but objects.approved_document.blobs.${APPROVED_DOCUMENT_HTML_BLOB} = ${String(blobPolicy ?? "optional")} — the blob pass would drop the value`,
      },
    };
  }
  if (policy === "fail")
    return {
      omit: true,
      diagnostic: {
        kind: "truncated",
        field: ctx.field.target,
        code: "HTML_OVERFLOW_FAIL",
        fatal: true,
        detail,
      },
    };
  return {
    value: text.slice(0, max),
    diagnostic: {
      kind: "truncated",
      field: ctx.field.target,
      code: "HTML_TRUNCATED",
      detail,
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
      // §6.3.42 automatic fallback (2) — its own row so the extractor selects
      // the relationship column; yields to an explicit crosswalk entry
      source: CONTENT_TYPE_EXTERNAL_ID_PATH,
      target: "content_type__v.external_id__v",
      transform: "custom(contentTypeExternalId)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      optionalSource: true,
      sourceType: "string",
      notes:
        "refLookup(content_type, external_id__v): Content_Type_vod__c.External_ID_vod__c [UNVERIFIED-SOURCE] = content_type__v.external_id__v when no explicit configMaps.contentType entry exists (§6.3.42 fallback 2)",
    },
    {
      source: CONTENT_TYPE_SOURCE,
      target: "content_type__v",
      transform: "custom(contentType)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "explicit entry of the shared objects.multichannel_consent.configMaps.contentType crosswalk (Vault id | external_id:<v> | name:<v>), else the External_ID_vod__c relationship value, else omitted + VT_CONSENT_CONFIG_UNMATCHED (§6.3.42)",
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
      transform: "custom(emailHtml) deferredBlob",
      required: "n" as const,
      evidence: "UNV" as const,
      blobName: APPROVED_DOCUMENT_HTML_BLOB,
      notes:
        "LongText ≤ 32k: objects.approved_document.htmlOverflow = truncate (default) | fail | attachment applied by custom(emailHtml); loaded in the blob pass (§8.6) under blobs.emailHtml",
    })),
    CONTENT_EXTERNAL_ID_FIELD,
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
  custom: {
    publishMethod,
    contentType,
    contentTypeExternalId,
    emailHtml,
    outOfScopeRef,
    externalIdIfMigrationOwned,
  },
  optionDefaults: { htmlOverflow: "truncate" },
  notes:
    "Integration-owned (PromoMats) → createPolicy match-only by default; external_id__v written only with externalIdOwnedBy = migration; object types UNV; publish_method__v omitted unless objects.approved_document.publishMethod is set (create mode only); content_type__v via the shared configMaps.contentType crosswalk, else Content_Type_vod__r.External_ID_vod__c (§6.3.42); HTML bodies in the blob pass (htmlOverflow default truncate, applied by custom(emailHtml)); deletePolicy inactivate → status__v = inactive__v + approved_document_status__v = withdrawn__v (UNV value).",
});
