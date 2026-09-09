/**
 * `multichannel_activity` — `Multichannel_Activity_vod__c` → `multichannel_activity__v` (spec §6.3.43).
 *
 * TODO(family agent "multichannel"): replace this stub with the full module — field
 * mappings from §6.3.43, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const multichannel_activity = defineObject({
  key: "multichannel_activity",
  source: "Multichannel_Activity_vod__c",
  target: "multichannel_activity__v",
  targetEvidence: "UNV",
  countryOf: ["account", "user:Organizer_vod__c", "user:OwnerId"],
  dependsOn: [
    "account",
    "call2",
    "sent_email",
    "product",
    "medical_event",
    "event_attendee",
    "user",
  ],
  scope: {
    kind: "dated",
    predicates: [{ field: "Start_DateTime_vod__c", type: "datetime" }],
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.43",
});
