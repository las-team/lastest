/**
 * `sample_transaction` — `Sample_Transaction_vod__c` → `sample_transaction__v` (spec §6.3.35).
 *
 * TODO(family agent "sample"): replace this stub with the full module — field
 * mappings from §6.3.35, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const sample_transaction = defineObject({
  key: "sample_transaction",
  source: "Sample_Transaction_vod__c",
  target: "sample_transaction__v",
  targetEvidence: "DOC",
  countryOf: ["user:OwnerId", "account"],
  dependsOn: ["sample_lot", "account", "user", "call2"],
  scope: {
    kind: "dated",
    predicates: [
      { field: "Call_Date_vod__c", type: "date" },
      { field: "Transferred_Date_vod__c", type: "date" },
      { field: "Adjusted_Date_vod__c", type: "date" },
      { field: "Submitted_Date_vod__c", type: "date" },
      { field: "CreatedDate", type: "datetime" },
    ],
    retentionFamily: "samples",
  },
  deletePolicy: "ignore",
  load: { noTriggers: true, sampleStrategy: "noTriggersRecalc" },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.35",
});
