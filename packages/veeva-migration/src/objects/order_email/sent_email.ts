/**
 * `sent_email` — `Sent_Email_vod__c` → `sent_email__v` (spec §6.3.40).
 *
 * TODO(family agent "order_email"): replace this stub with the full module — field
 * mappings from §6.3.40, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const sent_email = defineObject({
  key: "sent_email",
  source: "Sent_Email_vod__c",
  target: "sent_email__v",
  targetEvidence: "DOC",
  countryOf: ["account", "user:User_vod__c", "user:OwnerId"],
  dependsOn: [
    "account",
    "user",
    "approved_document",
    "call2",
    "product",
    "key_message",
    "em_event",
    "em_attendee",
    "em_event_speaker",
    "em_event_team_member",
    "event_attendee",
    "medical_event",
    "medical_inquiry",
  ],
  scope: {
    kind: "dated",
    predicates: [{ field: "Email_Sent_Date_vod__c", type: "datetime" }],
    openPredicate:
      "Status_vod__c IN ('Scheduled_vod', 'Saved_vod', 'Pending_vod')",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.40",
});
