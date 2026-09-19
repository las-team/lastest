/**
 * `call2_discussion` — `Call2_Discussion_vod__c` → `call2_discussion__v`
 * `[DOC]` (spec §6.3.32, §6.1 step 17, §6.2, §3.3, §3.4, §4.4).
 *
 * Master-detail child of `call2`: scoped and attributed through the parent,
 * deleted with it (`delete`, §4.4), `noTriggers = true`. Object types mirror
 * the call's (`CallReport_vod`, `Event_vod`, `MSLMeetingBrief_vod`,
 * `MeetingBrief_vod`) plus the documented `medical_discussion__v`
 * (`Medical_Discussion_vod` `[UNV DeveloperName]`).
 *
 * `Contact_vod__c` is dropped and counted (`CONTACT_REF_DROPPED`) unless the
 * id map carries a person account for the contact (`custom(contactRef)`,
 * shared with `call2`). `Product_Strategy_vod__c`, `Product_Tactic_vod__c`
 * and `Account_Tactic_vod__c` reference account-plan children that are out
 * of v1 (§6.2.1): omitted and counted (`OUT_OF_SCOPE_REF_DROPPED`).
 *
 * Customer discussion fields (`__c`) are discovered via describe and enabled
 * per country through `objects.call2_discussion.customFields` (§6.0.4) —
 * they are not rows of this module.
 */
import { defineObject } from "../types";
import {
  CALL2_ATTENDEE_TYPES,
  CALL2_CHILD_BLOCK_S,
  CALL2_MATCH_RULES,
  CALL2_OBJECT_TYPES,
  call2ChildCommonRows,
  contactRef,
  outOfScopeRef,
  unv,
} from "./call2";

/** RecordType DeveloperName → object type api name (`[UNV]`; `medical_discussion__v` `[DOC]`). */
export const CALL2_DISCUSSION_OBJECT_TYPES: Record<string, string> = {
  CallReport_vod: CALL2_OBJECT_TYPES.CallReport_vod,
  Event_vod: CALL2_OBJECT_TYPES.Event_vod,
  MSLMeetingBrief_vod: CALL2_OBJECT_TYPES.MSLMeetingBrief_vod,
  MeetingBrief_vod: CALL2_OBJECT_TYPES.MeetingBrief_vod,
  Medical_Discussion_vod: "medical_discussion__v",
};

export const call2_discussion = defineObject({
  key: "call2_discussion",
  source: "Call2_Discussion_vod__c",
  target: "call2_discussion__v",
  targetEvidence: "DOC",
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product", "account", "user", "medical_event"],
  blockS: { ...CALL2_CHILD_BLOCK_S },
  objectTypes: { ...CALL2_DISCUSSION_OBJECT_TYPES },
  fields: [
    // --- common to all call children (§6.3.31 preamble)
    ...call2ChildCommonRows("call2_discussion"),
    // --- §6.3.32 rows
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "Detail_Group_vod__c",
      target: "detail_group__v",
      transform: "ref(product)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
    },
    unv("Account_vod__c", "account__v", "ref(account)", {
      sourceType: "reference",
    }),
    unv("User_vod__c", "user__v", "refUser", {
      sourceType: "reference",
      notes:
        "business user lookup → objects.call2_discussion.unmappedUserPolicy (§3.5)",
    }),
    {
      source: "Contact_vod__c",
      target: "account__v.contact",
      transform: "custom(contactRef)",
      required: "-",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "dropped with CONTACT_REF_DROPPED unless the id map carries a person account for the contact (§3.4); emits into account__v",
    },
    unv("Call_Date_vod__c", "call_date__v", "date", { sourceType: "date" }),
    unv(
      "Product_Strategy_vod__c",
      "product_strategy__v",
      "custom(outOfScopeRef)",
      {
        required: "-",
        sourceType: "reference",
        notes:
          "omitted in v1 (account-plan child, §6.2.1): counted OUT_OF_SCOPE_REF_DROPPED",
      },
    ),
    unv("Product_Tactic_vod__c", "product_tactic__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      notes:
        "omitted in v1 (account-plan child, §6.2.1): counted OUT_OF_SCOPE_REF_DROPPED",
    }),
    unv("Account_Tactic_vod__c", "account_tactic__v", "custom(outOfScopeRef)", {
      required: "-",
      sourceType: "reference",
      notes:
        "omitted in v1 (account-plan child, §6.2.1): counted OUT_OF_SCOPE_REF_DROPPED",
    }),
    {
      source: "Medical_Event_vod__c",
      target: "medical_event__v",
      transform: "ref(medical_event)",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
    },
    unv("Discussion_vod__c", "discussion__v", "longtext", {
      sourceType: "textarea",
      countryConfigurable: true,
      notes:
        "customer discussion __c fields are discovered via describe (objects.call2_discussion.customFields)",
    }),
    {
      source: "zvod_Product_Map_vod__c",
      target: "zvod_product_map__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* layout marker — never loaded (§6.0.2)",
    },
  ],
  picklists: {
    "call2_discussion.attendeeType": { ...CALL2_ATTENDEE_TYPES },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: CALL2_MATCH_RULES,
  custom: { contactRef, outOfScopeRef },
  notes:
    "Master-detail child of call2 (§6.3.32): scoped and attributed through the parent; object types mirror the call plus medical_discussion__v; contacts dropped (§3.4); strategy/tactic refs out of v1; deleted with the parent (§4.4).",
});
