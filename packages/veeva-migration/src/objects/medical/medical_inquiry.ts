/**
 * `medical_inquiry` — `Medical_Inquiry_vod__c` → `medical_inquiry__v` (spec §6.3.29).
 *
 * TODO(family agent "medical"): replace this stub with the full module — field
 * mappings from §6.3.29, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const medical_inquiry = defineObject({
  key: "medical_inquiry",
  source: "Medical_Inquiry_vod__c",
  target: "medical_inquiry__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "user", "product", "call2"],
  scope: {
    kind: "dated",
    predicates: [{ field: "CreatedDate", type: "datetime" }],
    openPredicate:
      "(Status_vod__c != 'Closed' AND Fulfillment_Status_vod__c != 'Completed_vod')",
  },
  selfRefs: [
    { target: "call2__v", source: "Call2_vod__c", objectKey: "call2" },
  ],
  fields: [
    {
      source: "Call2_vod__c",
      target: "call2__v",
      transform: "ref(call2) secondPass",
      required: "n",
      evidence: "UNV",
    },
  ],
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.29",
});
