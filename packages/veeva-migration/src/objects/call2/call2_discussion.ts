/**
 * `call2_discussion` — `Call2_Discussion_vod__c` → `call2_discussion__v` (spec §6.3.32).
 *
 * TODO(family agent "call2"): replace this stub with the full module — field
 * mappings from §6.3.32, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const call2_discussion = defineObject({
  key: "call2_discussion",
  source: "Call2_Discussion_vod__c",
  target: "call2_discussion__v",
  targetEvidence: "DOC",
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product", "account", "user", "medical_event"],
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.32",
});
