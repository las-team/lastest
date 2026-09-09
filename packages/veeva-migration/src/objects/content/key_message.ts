/**
 * `key_message` — `Key_Message_vod__c` → `key_message__v` (spec §6.3.14,
 * §6.1 step 8, §6.2, §3.3, §4.4).
 *
 * CLM content is **integration-owned** whenever the vault runs the
 * PromoMats/MedComms CLM sync (Vault-to-Vault): the rows already exist in
 * Vault CRM and carry the Vault document identity. The module therefore
 * defaults to `createPolicy: match-only` — only non-Vault-managed content is
 * created, and only when the customer flips `objects.key_message.createPolicy`
 * to `create`. `external_id__v` is integration-owned (§3.2 step 4,
 * `externalIdOwnedBy: integration`, set by `config/resolve.ts`).
 *
 * Matching (§3.3): id map → `vexternal_id__v` / `vault_doc_id__v` /
 * `vault_external_id__v` (the key Vault CRM uses to match legacy call key
 * messages `[DOC]`) → `media_file_name__v` (unique) → legacy-id field.
 *
 * `Status_vod__c` targets the `{object}_status__v` pattern
 * (`key_message_status__v`) by default; preflight picks that field or the
 * business `status__v` (§6.3.14 "preflight picks") — the row is `[UNV]` and
 * degrades safely when neither exists.
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `active__v = false`; the Block S `status__v` row derives from
 * `Active_vod__c = false` (§6.0.4).
 *
 * `Shared_Resource_vod__c` is a self reference (key_message ↔ key_message,
 * §6.1 cycle summary) — held back and patched in pass 2 (`selfRefs`).
 *
 * `Product_Strategy_vod__c` references an object out of v1 (§6.2.1): the
 * value is dropped and counted (`OUT_OF_SCOPE_REF_DROPPED`) by
 * `custom(outOfScopeRef)`, which the other content modules reuse.
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type { CustomTransformFn } from "../../types";
import { defineObject } from "../types";

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Reference into an object that is out of v1 (§6.2.1 "omit+count"): the
 * field is left unset and every populated value is counted through a
 * non-fatal `out_of_scope_ref_dropped` diagnostic (`OUT_OF_SCOPE_REF_DROPPED`).
 * Blank values are simply omitted.
 */
export const outOfScopeRef: CustomTransformFn = (value, _row, ctx) => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_scope_ref_dropped",
      field: ctx.field.target,
      code: "OUT_OF_SCOPE_REF_DROPPED",
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail: `${ctx.field.source} references an object outside v1 (§6.2.1)`,
    },
  };
};

/** `Status_vod__c` → `key_message_status__v` defaults (§6.3.14). */
export const KEY_MESSAGE_STATUS_DEFAULTS: Record<string, string> = {
  Approved_vod: "approved__v",
  Staged_vod: "staged__v",
  Expired_vod: "expired__v",
};

/**
 * Vault-identity columns shared by `key_message` and `clm_presentation`
 * (§6.3.14 "match keys" row; §6.3.15 "as key_message").
 */
export const VAULT_IDENTITY_FIELDS = [
  {
    source: "VExternal_Id_vod__c",
    target: "vexternal_id__v",
    transform: "copy",
    required: "n",
    evidence: "UNV",
    sourceType: "string",
    notes: "EXTID unique; match key (§3.3)",
  },
  {
    source: "Vault_Doc_Id_vod__c",
    target: "vault_doc_id__v",
    transform: "copy",
    required: "n",
    evidence: "UNV",
    sourceType: "string",
    notes: "match key (§3.3)",
  },
  {
    source: "Vault_GUID_vod__c",
    target: "vault_guid__v",
    transform: "copy",
    required: "n",
    evidence: "UNV",
    sourceType: "string",
  },
  {
    source: "Vault_External_Id_vod__c",
    target: "vault_external_id__v",
    transform: "copy",
    required: "n",
    evidence: "UNV",
    sourceType: "string",
    notes:
      "OBS name on em_event; DOC match key — the key Vault CRM uses to match legacy call key messages (§3.3)",
  },
  {
    source: "Vault_DNS_vod__c",
    target: "vault_dns__v",
    transform: "copy",
    required: "n",
    evidence: "UNV",
    sourceType: "string",
  },
  {
    source: "Vault_Last_Modified_Date_Time_vod__c",
    target: "vault_last_modified_date_time__v",
    transform: "datetime",
    required: "n",
    evidence: "UNV",
    sourceType: "datetime",
  },
] as const;

export const key_message = defineObject({
  key: "key_message",
  source: "Key_Message_vod__c",
  target: "key_message__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["product"],
  selfRefs: [
    { target: "shared_resource__v", source: "Shared_Resource_vod__c" },
  ],
  blockS: {
    statusFromFlag: {
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    },
  },
  fields: [
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "UNV",
      sourceType: "string",
      disabledBy: "preserveName",
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "y?",
      evidence: "DOC",
      sourceType: "reference",
      notes: "one product per key message [DOC]",
    },
    {
      source: "Detail_Group_vod__c",
      target: "detail_group__v",
      transform: "ref(product)",
      required: "y?",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "Product_Strategy_vod__c",
      target: "product_strategy__v",
      transform: "custom(outOfScopeRef)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "ref → Product_Strategy_vod__c is out of v1: omitted and counted (OUT_OF_SCOPE_REF_DROPPED, §6.2.1)",
    },
    {
      source: "Shared_Resource_vod__c",
      target: "shared_resource__v",
      transform: "ref(key_message) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes: "self reference — patched in pass 2 (§6.1 step 8)",
    },
    {
      source: "Media_File_Name_vod__c",
      target: "media_file_name__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "EXTID unique 255; match key (§3.3)",
    },
    ...VAULT_IDENTITY_FIELDS,
    {
      source: "CLM_ID_vod__c",
      target: "clm_id__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Slide_Version_vod__c",
      target: "slide_version__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Category_vod__c",
      target: "category__v",
      transform: "picklist(key_message.category)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Language_vod__c",
      target: "language__v",
      transform: "picklist(key_message.language)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "Segment_vod__c",
      target: "segment__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Vehicle_vod__c",
      target: "vehicle__v",
      transform: "picklist(key_message.vehicle)",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Custom_Reaction_vod__c",
      target: "custom_reaction__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Display_Order_vod__c",
      target: "display_order__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Media_File_CRC_vod__c",
      target: "media_file_crc__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Media_File_Size_vod__c",
      target: "media_file_size__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "CDN_Path_vod__c",
      target: "cdn_path__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "iOS_Viewer_vod__c",
      target: "ios_viewer__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Status_vod__c",
      target: "key_message_status__v",
      transform: "picklist(key_message.status)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{object}_status__v pattern; preflight picks key_message_status__v or the business status__v (§6.3.14)",
    },
    {
      source: "Active_vod__c",
      target: "active__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      notes:
        "business flag written in addition to status__v (§4.4 / §6.0.4); also the source of the Block S status__v derivation",
    },
    {
      source: "Is_Shared_Resource_vod__c",
      target: "is_shared_resource__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Disable_Actions_vod__c",
      target: "disable_actions__v",
      transform: "multipicklist(key_message.disableActions)",
      required: "n",
      evidence: "UNV",
      sourceType: "multipicklist",
    },
  ],
  picklists: {
    "key_message.status": { ...KEY_MESSAGE_STATUS_DEFAULTS },
    "key_message.category": {},
    "key_message.language": {},
    "key_message.vehicle": {},
    "key_message.disableActions": {},
  },
  deletePolicy: "inactivate",
  inactivate: [{ field: "active__v", value: false }],
  createPolicy: "match-only",
  load: { noTriggers: false },
  match: [
    {
      method: "external_id",
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
      evidence: "UNV",
      notes: "PromoMats/MedComms-synced content (§3.3)",
    },
    {
      method: "external_id",
      keys: [{ target: "vault_doc_id__v", source: "Vault_Doc_Id_vod__c" }],
      evidence: "UNV",
    },
    {
      method: "external_id",
      keys: [
        { target: "vault_external_id__v", source: "Vault_External_Id_vod__c" },
      ],
      evidence: "DOC",
      notes:
        "the key Vault CRM uses to match legacy call key messages (vault-crm-model.md §4.13)",
    },
    {
      method: "external_id",
      keys: [
        { target: "media_file_name__v", source: "Media_File_Name_vod__c" },
      ],
      evidence: "UNV",
      notes: "unique media file name",
    },
    {
      method: "legacy_id",
      evidence: "UNV",
      notes: "last resort — the upsert idParam (§3.2)",
    },
  ],
  custom: { outOfScopeRef },
  notes:
    "Integration-owned when PromoMats/MedComms syncs CLM content → createPolicy match-only by default (objects.key_message.createPolicy = create for non-Vault-managed content); shared_resource__v patched in pass 2; deletePolicy inactivate → status__v = inactive__v + active__v = false; key_message_status__v / status__v picked at preflight.",
});
