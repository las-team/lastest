/**
 * `em_event_speaker` — `EM_Event_Speaker_vod__c` → `em_event_speaker__v` (spec §6.3.24).
 *
 * TODO(family agent "em_event"): replace this stub with the full module — field
 * mappings from §6.3.24, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_event_speaker = defineObject({
  key: "em_event_speaker",
  source: "EM_Event_Speaker_vod__c",
  target: "em_event_speaker__v",
  targetEvidence: "OBS",
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: ["em_event", "em_speaker", "account"],
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.24",
});
