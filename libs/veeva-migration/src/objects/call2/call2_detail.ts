/**
 * `call2_detail` — `Call2_Detail_vod__c` → `call2_detail__v` `[DOC]`
 * (spec §6.3.31, §6.1 step 17, §6.2, §3.3, §4.4).
 *
 * Master-detail child of `call2`: scoped through the parent's
 * `Call2_vod__r.Call_Date_vod__c` (the parent's planned-call open term is
 * re-prefixed by the extractor), attributed to the parent's country
 * (`parent:call2:Call2_vod__c`), deleted with the parent (`delete`, §4.4),
 * loaded with `noTriggers = true`.
 *
 * Block S: the SFDC `Name` is an auto-number (carried only with
 * `objects.call2_detail.preserveAutoNumberName`, §6.0.4 — the spec row
 * "`Name` → `name__v` text, likely system-managed, y?" is that gated row),
 * no `OwnerId` (master-detail), no currency. The common child rows
 * (`call2__v`, `attendee_type__v`, `entity_reference_id__v`,
 * `call2_mobile_id__v`, skipped `Is_Parent_Call_vod__c`) come from
 * `call2ChildCommonRows`.
 */
import { defineObject } from "../types";
import {
  CALL2_ATTENDEE_TYPES,
  CALL2_CHILD_BLOCK_S,
  CALL2_MATCH_RULES,
  call2ChildCommonRows,
} from "./call2";

/** `Type_vod__c` → `type__v` (`edetail__v` `[DOC]`, `paper_detail__v`). */
export const CALL2_DETAIL_TYPES: Record<string, string> = {
  EDetail_vod: "edetail__v",
  Paper_Detail_vod: "paper_detail__v",
};

export const call2_detail = defineObject({
  key: "call2_detail",
  source: "Call2_Detail_vod__c",
  target: "call2_detail__v",
  targetEvidence: "DOC",
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product"],
  blockS: { ...CALL2_CHILD_BLOCK_S },
  fields: [
    // --- common to all call children (§6.3.31 preamble)
    ...call2ChildCommonRows("call2_detail"),
    // --- §6.3.31 rows
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "Y",
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
    {
      source: "Type_vod__c",
      target: "type__v",
      transform: "picklist(call2_detail.type)",
      required: "n",
      evidence: "DOC",
      sourceType: "picklist",
      notes: "{EDetail_vod, Paper_Detail_vod}",
    },
    {
      source: "Detail_Priority_vod__c",
      target: "detail_priority__v",
      transform: "number",
      required: "n",
      evidence: "DOC",
      sourceType: "double",
    },
    {
      source: "Detail_Priority_Text_vod__c",
      target: "detail_priority_text__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
    },
  ],
  picklists: {
    "call2_detail.type": { ...CALL2_DETAIL_TYPES },
    "call2_detail.attendeeType": { ...CALL2_ATTENDEE_TYPES },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: CALL2_MATCH_RULES,
  notes:
    "Master-detail child of call2 (§6.3.31): scoped and attributed through the parent; deleted with the parent (§4.4); auto-number Name carried only with preserveAutoNumberName.",
});
