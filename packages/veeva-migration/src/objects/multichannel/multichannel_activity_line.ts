/**
 * `multichannel_activity_line` — `Multichannel_Activity_Line_vod__c` → `multichannel_activity_line__v` (spec §6.3.44).
 *
 * TODO(family agent "multichannel"): replace this stub with the full module — field
 * mappings from §6.3.44, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const multichannel_activity_line = defineObject({
  key: "multichannel_activity_line",
  source: "Multichannel_Activity_Line_vod__c",
  target: "multichannel_activity_line__v",
  targetEvidence: "UNV",
  countryOf: "parent:multichannel_activity:Multichannel_Activity_vod__c",
  dependsOn: ["multichannel_activity", "key_message", "clm_presentation"],
  scope: {
    kind: "via-parent",
    parentKey: "multichannel_activity",
    parentField: "Multichannel_Activity_vod__r.Start_DateTime_vod__c",
    type: "datetime",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.44",
});
