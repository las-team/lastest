/**
 * `email_activity` — `Email_Activity_vod__c` → `email_activity__v` (spec §6.3.41).
 *
 * TODO(family agent "order_email"): replace this stub with the full module — field
 * mappings from §6.3.41, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const email_activity = defineObject({
  key: "email_activity",
  source: "Email_Activity_vod__c",
  target: "email_activity__v",
  targetEvidence: "UNV",
  countryOf: "parent:sent_email:Sent_Email_vod__c",
  dependsOn: ["sent_email"],
  scope: {
    kind: "via-parent",
    parentKey: "sent_email",
    parentField: "Sent_Email_vod__r.Email_Sent_Date_vod__c",
    type: "datetime",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.41",
});
