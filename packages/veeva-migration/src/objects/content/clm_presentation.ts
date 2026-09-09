/**
 * `clm_presentation` — `Clm_Presentation_vod__c` → `clm_presentation__v`
 * (spec §6.3.15, §6.1 step 8, §6.2, §3.3, §4.4).
 *
 * Same integration caveat as `key_message` (§6.3.14): PromoMats/MedComms
 * CLM sync owns presentations → `createPolicy: match-only` by default,
 * `external_id__v` integration-owned (§3.2 step 4).
 *
 * Matching (§3.3): id map → `vexternal_id__v` / `vault_doc_id__v` /
 * `presentation_id__v` → legacy-id field.
 *
 * `Status_vod__c` targets `clm_presentation_status__v` (pattern) — preflight
 * picks that field or the business `status__v` (§6.3.15).
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `active__v = false` (source `Active_vod__c`, §6.0.4). `Active_vod__c` is
 * not listed in the §6.3.15 table, so its row is `optionalSource` +
 * `unverifiedSource` (a describe miss is `info` and the row is dropped).
 *
 * `Survey_vod__c` references an object out of v1 (§6.2.1): omitted and
 * counted by `custom(outOfScopeRef)`. `Original_Record_ID_vod__c`,
 * `ParentId_vod__c`, `Copied_From_vod__c` are copied verbatim — the ids
 * inside remain legacy SFDC ids (§6.3.15).
 */
import { defineObject } from "../types";
import {
  KEY_MESSAGE_STATUS_DEFAULTS,
  VAULT_IDENTITY_FIELDS,
  outOfScopeRef,
} from "./key_message";

/** Boolean `Clm_Presentation_vod__c` flags mapped 1:1 to `<name>__v` (§6.3.15). */
export const CLM_PRESENTATION_BOOLEAN_FIELDS = [
  "Approved_vod__c",
  "Hidden_vod__c",
  "Training_vod__c",
  "Default_Presentation_vod__c",
  "Enable_Survey_Overlay_vod__c",
] as const;

/** Legacy-id columns copied verbatim (`ids inside remain legacy ids`, §6.3.15). */
export const CLM_PRESENTATION_COPY_FIELDS = [
  "Original_Record_ID_vod__c",
  "ParentId_vod__c",
  "Copied_From_vod__c",
] as const;

/** `Foo_Bar_vod__c` → `foo_bar__v` (§6.0.2 field rule). */
export function renameContentField(source: string): string {
  return `${source.replace(/__c$/i, "").replace(/_vod$/i, "").toLowerCase()}__v`;
}

export const clm_presentation = defineObject({
  key: "clm_presentation",
  source: "Clm_Presentation_vod__c",
  target: "clm_presentation__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["product"],
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
      transform: "text",
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
    },
    {
      source: "Presentation_Id_vod__c",
      target: "presentation_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "EXTID unique; match key (§3.3)",
    },
    ...VAULT_IDENTITY_FIELDS,
    {
      source: "Directory_vod__c",
      target: "directory__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
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
      source: "Version_vod__c",
      target: "version__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Type_vod__c",
      target: "type__v",
      transform: "picklist(clm_presentation.type)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{HQ, Custom}",
    },
    {
      source: "Control_Visibility_vod__c",
      target: "control_visibility__v",
      transform: "picklist(clm_presentation.controlVisibility)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Product_vod, Detail_Group_vod}",
    },
    {
      source: "Event_Content_vod__c",
      target: "event_content__v",
      transform: "picklist(clm_presentation.eventContent)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes: "{Events_Only_vod, Events_CLM_vod}",
    },
    {
      source: "Status_vod__c",
      target: "clm_presentation_status__v",
      transform: "picklist(clm_presentation.status)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{object}_status__v pattern; preflight picks clm_presentation_status__v or the business status__v (§6.3.15)",
    },
    {
      source: "Start_Date_vod__c",
      target: "start_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      sourceType: "date",
    },
    {
      source: "End_Date_vod__c",
      target: "end_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      sourceType: "date",
    },
    ...CLM_PRESENTATION_BOOLEAN_FIELDS.map((source) => ({
      source,
      target: renameContentField(source),
      transform: "bool",
      required: "n" as const,
      evidence: "UNV" as const,
      sourceType: "boolean" as const,
    })),
    {
      source: "Keywords_vod__c",
      target: "keywords__v",
      transform: "longtext",
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
    ...CLM_PRESENTATION_COPY_FIELDS.map((source) => ({
      source,
      target: renameContentField(source),
      transform: "copy",
      required: "n" as const,
      evidence: "UNV" as const,
      notes: "ids inside remain legacy ids (§6.3.15)",
    })),
    {
      source: "Copy_Date_vod__c",
      target: "copy_date__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      notes:
        "§6.3.15 lists copy; datetime normalises the SFDC literal to Vault's UTC form (same value, valid format)",
    },
    {
      source: "Active_vod__c",
      target: "active__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      optionalSource: true,
      unverifiedSource: true,
      notes:
        "§4.4 inactivation flag (status__v = inactive__v + active__v = false); not in the §6.3.15 table — describe miss is info",
    },
  ],
  picklists: {
    "clm_presentation.type": { HQ_vod: "hq__v", Custom_vod: "custom__v" },
    "clm_presentation.controlVisibility": {
      Product_vod: "product__v",
      Detail_Group_vod: "detail_group__v",
    },
    "clm_presentation.eventContent": {
      Events_Only_vod: "events_only__v",
      Events_CLM_vod: "events_clm__v",
    },
    "clm_presentation.status": { ...KEY_MESSAGE_STATUS_DEFAULTS },
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
        { target: "presentation_id__v", source: "Presentation_Id_vod__c" },
      ],
      evidence: "UNV",
      notes: "unique presentation id",
    },
    {
      method: "legacy_id",
      evidence: "UNV",
      notes: "last resort — the upsert idParam (§3.2)",
    },
  ],
  custom: { outOfScopeRef },
  notes:
    "As key_message: integration-owned → createPolicy match-only by default; deletePolicy inactivate → status__v = inactive__v + active__v = false; clm_presentation_status__v / status__v picked at preflight; survey__v out of v1 (counted).",
});
