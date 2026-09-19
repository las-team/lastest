/**
 * `clm_presentation_slide` — `Clm_Presentation_Slide_vod__c` →
 * `clm_presentation_slide__v` (spec §6.3.16, §6.1 step 8, §6.2, §3.3, §4.4).
 *
 * Master-detail child of `Clm_Presentation_vod__c` (no `OwnerId`; deleted
 * with the parent, `deletePolicy: delete`). Creates follow the key-message
 * rule ("as key_message", §3.3): `match-only` while the vault's CLM
 * integration owns the content.
 *
 * **Slide identity.** `vault_external_id__v` is the identity CLM/gotoSlide
 * uses `[DOC]`. Its SFDC source `Vault_External_Id_vod__c` is
 * `[UNVERIFIED-SOURCE]`; when the column is blank (or absent from the org)
 * the value falls back to the referenced key message's
 * `Key_Message_vod__r.Vault_External_Id_vod__c` — `custom(slideVaultExternalId)`.
 *
 * The row is deliberately **anchored on the fallback path** (its `source`),
 * not on the unverified slide column: preflight drops a row whose
 * `unverifiedSource` column is absent from the describe, which would have
 * removed the fallback together with it in exactly the org shape the spec
 * anticipates. The key-message path is a real §6.3.14 field and always
 * resolvable; the slide's own column is read by the transform
 * (`readSource`) and travels with the extract because it is the first
 * §3.3 match-rule key (the column builder selects match-key sources that
 * the describe has and silently leaves out the ones it lacks). Preference
 * order is unchanged: own value first, then the key message's (counted as
 * `SLIDE_VAULT_EXTERNAL_ID_FROM_KEY_MESSAGE`). When neither source has a
 * value the row is created without the field and a non-fatal
 * `SLIDE_VAULT_EXTERNAL_ID_MISSING` diagnostic counts it (warning at run
 * level) — the `y?` requirement is deliberately not enforced here.
 *
 * `Sub_Presentation_vod__c` (ref → `Clm_Presentation_vod__c`) is held back
 * and patched in pass 2 (§6.1 step 8 `clm_presentation_slide.sub_presentation__v`).
 * The `selfRefs` entry is keyed to the module itself on purpose: naming
 * `clm_presentation` as its `objectKey` would remove the
 * `clm_presentation → clm_presentation_slide` DAG edge (`loadOrder`), and
 * the required `clm_presentation__v` needs presentations loaded first. The
 * deferred `$fk` value carries `object: clm_presentation`, which is what the
 * loader resolves in pass 2.
 */
import { readSource } from "../../transform/apply";
import type { CustomTransformFn } from "../../types";
import { defineObject } from "../types";

/** Direct source of the slide identity (`[UNVERIFIED-SOURCE]`, §6.3.16). */
export const SLIDE_VAULT_EXTERNAL_ID_SOURCE = "Vault_External_Id_vod__c";
/** Fallback: the referenced key message's Vault external id (§6.3.16, §3.3). */
export const SLIDE_VAULT_EXTERNAL_ID_FALLBACK =
  "Key_Message_vod__r.Vault_External_Id_vod__c";

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `vault_external_id__v`: the row's own `Vault_External_Id_vod__c` (read
 * from the row — the mapping row is anchored on the fallback path, see the
 * module comment), else the key message's `Vault_External_Id_vod__c`
 * (`value`, counted as `SLIDE_VAULT_EXTERNAL_ID_FROM_KEY_MESSAGE`), else
 * omitted with the non-fatal `SLIDE_VAULT_EXTERNAL_ID_MISSING` diagnostic.
 */
export const slideVaultExternalId: CustomTransformFn = (value, row, ctx) => {
  const ownRaw = readSource(row, SLIDE_VAULT_EXTERNAL_ID_SOURCE);
  const own = isEmpty(ownRaw) ? undefined : String(ownRaw).trim();
  if (own) return own;
  const fallback = isEmpty(value) ? undefined : String(value).trim();
  if (fallback) {
    return {
      value: fallback,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: "SLIDE_VAULT_EXTERNAL_ID_FROM_KEY_MESSAGE",
        detail: `${SLIDE_VAULT_EXTERNAL_ID_SOURCE} blank — value taken from ${SLIDE_VAULT_EXTERNAL_ID_FALLBACK}`,
      },
    };
  }
  return {
    omit: true,
    diagnostic: {
      kind: "custom",
      field: ctx.field.target,
      code: "SLIDE_VAULT_EXTERNAL_ID_MISSING",
      detail:
        "neither the slide nor its key message carries a Vault external id — row created without vault_external_id__v (§6.3.16)",
    },
  };
};

export const clm_presentation_slide = defineObject({
  key: "clm_presentation_slide",
  source: "Clm_Presentation_Slide_vod__c",
  target: "clm_presentation_slide__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["clm_presentation", "key_message"],
  selfRefs: [
    { target: "sub_presentation__v", source: "Sub_Presentation_vod__c" },
  ],
  // master-detail child: no OwnerId; Name is a real text field (§6.3.16)
  blockS: { ownerId: false },
  fields: [
    {
      source: "Clm_Presentation_vod__c",
      target: "clm_presentation__v",
      transform: "ref(clm_presentation)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
      notes: "master-detail parent",
    },
    {
      source: "Key_Message_vod__c",
      target: "key_message__v",
      transform: "ref(key_message)",
      required: "y?",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "Sub_Presentation_vod__c",
      target: "sub_presentation__v",
      transform: "ref(clm_presentation) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes: "patched in pass 2 (§6.1 step 8)",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "unique; match key (§3.3); integration-owned (§3.2 step 4) — never overwrite",
    },
    {
      source: "VExternal_Id_vod__c",
      target: "vexternal_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "match key (§3.3)",
    },
    {
      // anchored on the always-resolvable key-message path; the slide's own
      // [UNVERIFIED-SOURCE] column is read by the transform (see module comment)
      source: SLIDE_VAULT_EXTERNAL_ID_FALLBACK,
      target: "vault_external_id__v",
      transform: "custom(slideVaultExternalId)",
      required: "y?",
      evidence: "DOC",
      optionalSource: true,
      sourceType: "string",
      notes:
        "slide identity used by gotoSlide/CLM matching [DOC]; preferred source Vault_External_Id_vod__c [UNVERIFIED-SOURCE] (read from the row, selected as match key), fallback Key_Message_vod__r.Vault_External_Id_vod__c (row anchor); y? when PromoMats content exists — missing values are counted (SLIDE_VAULT_EXTERNAL_ID_MISSING), never fatal",
    },
    {
      source: "Display_Order_vod__c",
      target: "display_order__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "double",
    },
    {
      source: "Mandatory_Slides_vod__c",
      target: "mandatory_slides__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text",
      required: "Y",
      evidence: "UNV",
      sourceType: "string",
      disabledBy: "preserveName",
    },
  ],
  deletePolicy: "delete",
  createPolicy: "match-only",
  load: { noTriggers: false },
  match: [
    {
      method: "external_id",
      keys: [
        {
          target: "vault_external_id__v",
          source: SLIDE_VAULT_EXTERNAL_ID_SOURCE,
        },
      ],
      evidence: "DOC",
      notes:
        "slide identity used by gotoSlide [DOC]; source [UNVERIFIED-SOURCE]",
    },
    {
      method: "external_id",
      keys: [
        {
          target: "vault_external_id__v",
          source: SLIDE_VAULT_EXTERNAL_ID_FALLBACK,
        },
      ],
      evidence: "DOC",
      notes:
        "fallback: the matched key message's Vault_External_Id_vod__c (§3.3)",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "UNV",
    },
    {
      method: "external_id",
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
      evidence: "UNV",
    },
    {
      method: "natural_key",
      keys: [
        {
          target: "clm_presentation__v",
          source: "Clm_Presentation_vod__c",
          transform: { kind: "ref", objectKey: "clm_presentation" },
        },
        {
          target: "key_message__v",
          source: "Key_Message_vod__c",
          transform: { kind: "ref", objectKey: "key_message" },
        },
      ],
      evidence: "DOC",
      notes: "(clm_presentation__v, key_message__v) pair (§3.3)",
    },
  ],
  custom: { slideVaultExternalId },
  notes:
    "Master-detail child of clm_presentation; deleted with the parent (§4.4); creates as key_message (match-only while integration-owned); vault_external_id__v from Vault_External_Id_vod__c [UNVERIFIED-SOURCE] with key-message fallback; sub_presentation__v patched in pass 2. §3.3 lists no legacy-id step for slides — the legacy id remains the upsert idParam (§3.2).",
});
