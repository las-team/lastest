/**
 * `call2` — `Call2_vod__c` → `call2__v` (spec §6.3.30).
 *
 * TODO(family agent "call2"): replace this stub with the full module — field
 * mappings from §6.3.30, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const call2 = defineObject({
  key: "call2",
  source: "Call2_vod__c",
  target: "call2__v",
  targetEvidence: "DOC",
  countryOf: ["account", "user:User_vod__c", "user:OwnerId"],
  dependsOn: [
    "account",
    "user",
    "address",
    "child_account",
    "product",
    "em_event",
    "medical_event",
    "medical_inquiry",
    "account_plan",
    "territory",
  ],
  scope: {
    kind: "dated",
    predicates: [{ field: "Call_Date_vod__c", type: "date" }],
    openPredicate: "Status_vod__c = 'Planned_vod'",
  },
  partitionBy: { field: "Parent_Call_vod__c", order: ["null", "notNull"] },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.30",
});
