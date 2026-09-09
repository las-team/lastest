/**
 * `em_attendee` — `EM_Attendee_vod__c` → `em_attendee__v` (spec §6.3.23).
 *
 * TODO(family agent "em_event"): replace this stub with the full module — field
 * mappings from §6.3.23, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_attendee = defineObject({
  key: "em_attendee",
  source: "EM_Attendee_vod__c",
  target: "em_attendee__v",
  targetEvidence: "OBS",
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: ["em_event", "account", "user"],
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.23",
});
