/**
 * `call2_sample` — `Call2_Sample_vod__c` → `call2_sample__v` (spec §6.3.34).
 *
 * TODO(family agent "call2"): replace this stub with the full module — field
 * mappings from §6.3.34, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const call2_sample = defineObject({
  key: "call2_sample",
  source: "Call2_Sample_vod__c",
  target: "call2_sample__v",
  targetEvidence: "UNV",
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product", "account"],
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
    retentionFamily: "samples",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.34",
});
