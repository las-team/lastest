/**
 * `em_event` — `EM_Event_vod__c` → `em_event__v` (spec §6.3.22).
 *
 * TODO(family agent "em_event"): replace this stub with the full module — field
 * mappings from §6.3.22, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_event = defineObject({
  key: "em_event",
  source: "EM_Event_vod__c",
  target: "em_event__v",
  targetEvidence: "OBS",
  countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
  dependsOn: [
    "country",
    "user",
    "em_venue",
    "em_catalog",
    "product",
    "account",
  ],
  scope: {
    kind: "dated",
    predicates: [{ field: "Start_Time_vod__c", type: "datetime" }],
    retentionFamily: "tov",
  },
  partitionBy: { field: "Parent_Event_vod__c", order: ["null", "notNull"] },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.22",
});
