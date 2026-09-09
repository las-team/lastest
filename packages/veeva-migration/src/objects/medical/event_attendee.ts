/**
 * `event_attendee` — `Event_Attendee_vod__c` → `event_attendee__v` (spec §6.3.27).
 *
 * TODO(family agent "medical"): replace this stub with the full module — field
 * mappings from §6.3.27, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const event_attendee = defineObject({
  key: "event_attendee",
  source: "Event_Attendee_vod__c",
  target: "event_attendee__v",
  targetEvidence: "OBS",
  countryOf: "parent:medical_event:Medical_Event_vod__c",
  dependsOn: [
    "medical_event",
    "account",
    "user",
    "em_attendee",
    "em_event_speaker",
  ],
  scope: {
    kind: "via-parent",
    parentKey: "medical_event",
    parentField: "Medical_Event_vod__r.Start_Date_vod__c",
    type: "date",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.27",
});
