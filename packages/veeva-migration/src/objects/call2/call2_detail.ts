/**
 * `call2_detail` — `Call2_Detail_vod__c` → `call2_detail__v` (spec §6.3.31).
 *
 * TODO(family agent "call2"): replace this stub with the full module — field
 * mappings from §6.3.31, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const call2_detail = defineObject({
  key: "call2_detail",
  source: "Call2_Detail_vod__c",
  target: "call2_detail__v",
  targetEvidence: "DOC",
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product"],
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.31",
});
