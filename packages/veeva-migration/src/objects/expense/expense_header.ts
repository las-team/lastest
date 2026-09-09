/**
 * `expense_header` — `Expense_Header_vod__c` → `expense_header__v` (spec §6.3.25a).
 *
 * TODO(family agent "expense"): replace this stub with the full module — field
 * mappings from §6.3.25a, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const expense_header = defineObject({
  key: "expense_header",
  source: "Expense_Header_vod__c",
  target: "expense_header__v",
  targetEvidence: "OBS",
  countryOf: "parent:em_event:Event_vod__c",
  dependsOn: [
    "em_event",
    "em_attendee",
    "em_event_speaker",
    "em_venue",
    "account",
    "user",
  ],
  scope: {
    kind: "via-parent",
    parentKey: "em_event",
    parentField: "Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  deletePolicy: "ignore",
  optionDefaults: { optional: true },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.25a",
});
