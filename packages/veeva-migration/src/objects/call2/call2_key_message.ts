/**
 * `call2_key_message` — `Call2_Key_Message_vod__c` → `call2_key_message__v`
 * `[DOC]` (spec §6.3.33, §6.1 step 17, §6.2, §3.3, §4.4).
 *
 * Master-detail child of `call2`: scoped and attributed through the parent,
 * deleted with it (`delete`, §4.4), `noTriggers = true`. Customer `__c`
 * fields are unsupported on this object `[DOC]` (`customFields` stays
 * `none`).
 *
 * `Clm_Presentation_vod__c` → `clm_presentation__v` **only when the target
 * field is an object reference** (`custom(clmPresentationRef)`): document-
 * model vaults expose a document reference instead, in which case the value
 * is omitted and counted (`CALL2_KM_CLM_PRESENTATION_NOT_OBJECT`) while the
 * text snapshots `clm_presentation_name__v` / `presentation_id__v` carry the
 * identity.
 */
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject } from "../types";
import {
  CALL2_ATTENDEE_TYPES,
  CALL2_CHILD_BLOCK_S,
  CALL2_MATCH_RULES,
  call2ChildCommonRows,
  unv,
} from "./call2";

/** `Reaction_vod__c` → `reaction__v` `[DOC]`. */
export const CALL2_KEY_MESSAGE_REACTIONS: Record<string, string> = {
  Positive: "positive__v",
  Neutral: "neutral__v",
  Negative: "negative__v",
};

/** `Category_vod__c` → `category__v` (`[UNV]`; further values by the rename rule). */
export const CALL2_KEY_MESSAGE_CATEGORIES: Record<string, string> = {
  Efficacy: "efficacy__v",
  Safety: "safety__v",
};

export const CALL2_KM_CLM_PRESENTATION_NOT_OBJECT_CODE =
  "CALL2_KM_CLM_PRESENTATION_NOT_OBJECT";

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(clmPresentationRef)`: `ref(clm_presentation)` when the target is an
 * object reference (or its type is unknown before preflight); omitted and
 * counted (non-fatal) when the vault models it as a document reference.
 */
export const clmPresentationRef: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const type = ctx.targetField?.type;
  if (type !== undefined && type !== "object")
    return {
      omit: true,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: CALL2_KM_CLM_PRESENTATION_NOT_OBJECT_CODE,
        detail: `${ctx.field.target} is not an object reference on the target (document model); text snapshots kept`,
      },
    };
  return applyTransform(
    { kind: "ref", objectKey: "clm_presentation" },
    value,
    row,
    ctx,
  );
};

export const call2_key_message = defineObject({
  key: "call2_key_message",
  source: "Call2_Key_Message_vod__c",
  target: "call2_key_message__v",
  targetEvidence: "DOC",
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: [
    "call2",
    "key_message",
    "clm_presentation",
    "product",
    "account",
    "user",
  ],
  blockS: { ...CALL2_CHILD_BLOCK_S },
  fields: [
    // --- common to all call children (§6.3.31 preamble)
    ...call2ChildCommonRows("call2_key_message"),
    // --- §6.3.33 rows
    {
      source: "Key_Message_vod__c",
      target: "key_message__v",
      transform: "ref(key_message)",
      required: "y?",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "Clm_Presentation_vod__c",
      target: "clm_presentation__v",
      transform: "custom(clmPresentationRef)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
      notes:
        "ref(clm_presentation) only if the target is an object reference; document-model vaults → omitted, clm_presentation_name__v / presentation_id__v kept",
    },
    unv("Product_vod__c", "product__v", "ref(product)", {
      sourceType: "reference",
    }),
    unv("Detail_Group_vod__c", "detail_group__v", "ref(product)", {
      sourceType: "reference",
    }),
    unv("Account_vod__c", "account__v", "ref(account)", {
      sourceType: "reference",
    }),
    unv("User_vod__c", "user__v", "refUser", {
      sourceType: "reference",
      notes:
        "business user lookup → objects.call2_key_message.unmappedUserPolicy (§3.5)",
    }),
    unv("Call_Date_vod__c", "call_date__v", "date", { sourceType: "date" }),
    unv("Start_Time_vod__c", "start_time__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Duration_vod__c", "duration__v", "number", { sourceType: "double" }),
    unv("Display_Order_vod__c", "display_order__v", "number", {
      sourceType: "double",
    }),
    {
      source: "Reaction_vod__c",
      target: "reaction__v",
      transform: "picklist(call2_key_message.reaction)",
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      notes: "{Positive, Neutral, Negative}",
    },
    {
      source: "Vehicle_vod__c",
      target: "vehicle__v",
      transform: "picklist(call2_key_message.vehicle)",
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      notes: "values by the rename rule",
    },
    unv(
      "Category_vod__c",
      "category__v",
      "picklist(call2_key_message.category)",
      {
        sourceType: "picklist",
        notes: "{Efficacy, Safety, …}",
      },
    ),
    // --- text snapshots (verbatim)
    {
      source: "Key_Message_Name_vod__c",
      target: "key_message_name__v",
      transform: "text",
      required: "n",
      evidence: "DOC",
      notes: "text snapshot — verbatim",
    },
    {
      source: "Clm_Presentation_Name_vod__c",
      target: "clm_presentation_name__v",
      transform: "text",
      required: "n",
      evidence: "DOC",
      notes: "text snapshot — verbatim",
    },
    unv(
      "Clm_Presentation_Version_vod__c",
      "clm_presentation_version__v",
      "text",
      {
        notes: "text snapshot — verbatim",
      },
    ),
    unv("Slide_Version_vod__c", "slide_version__v", "text", {
      notes: "text snapshot — verbatim",
    }),
    unv("Presentation_ID_vod__c", "presentation_id__v", "text", {
      notes: "text snapshot — verbatim",
    }),
    {
      source: "CLM_ID_vod__c",
      target: "clm_id__v",
      transform: "text",
      required: "n",
      evidence: "DOC",
      notes: "text snapshot — verbatim",
    },
    unv("Segment_vod__c", "segment__v", "text", {
      notes: "text snapshot — verbatim",
    }),
    unv("Entity_Reference_KM_Id_vod__c", "entity_reference_km_id__v", "text", {
      notes: "text snapshot — verbatim",
    }),
  ],
  picklists: {
    "call2_key_message.attendeeType": { ...CALL2_ATTENDEE_TYPES },
    "call2_key_message.reaction": { ...CALL2_KEY_MESSAGE_REACTIONS },
    "call2_key_message.vehicle": {},
    "call2_key_message.category": { ...CALL2_KEY_MESSAGE_CATEGORIES },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: CALL2_MATCH_RULES,
  custom: { clmPresentationRef },
  notes:
    "Master-detail child of call2 (§6.3.33): scoped and attributed through the parent; clm_presentation__v only when the target is an object reference; custom __c fields unsupported on this object; deleted with the parent (§4.4).",
});
