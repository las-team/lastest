/**
 * `medical_event` — `Medical_Event_vod__c` → `medical_event__v` (spec §6.3.26).
 *
 * TODO(family agent "medical"): replace this stub with the full module — field
 * mappings from §6.3.26, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const medical_event = defineObject({
  key: "medical_event",
  source: "Medical_Event_vod__c",
  target: "medical_event__v",
  targetEvidence: "DOC",
  countryOf: ["account", "user:OwnerId"],
  dependsOn: ["account", "address", "em_event"],
  scope: {
    kind: "dated",
    predicates: [{ field: "Start_Date_vod__c", type: "date" }],
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.26",
});
