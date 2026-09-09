/**
 * `sample_inventory` — `Sample_Inventory_vod__c` → `sample_inventory__v` (spec §6.3.36).
 *
 * TODO(family agent "sample"): replace this stub with the full module — field
 * mappings from §6.3.36, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const sample_inventory = defineObject({
  key: "sample_inventory",
  source: "Sample_Inventory_vod__c",
  target: "sample_inventory__v",
  targetEvidence: "DOC",
  countryOf: ["user:Inventory_For_vod__c", "user:OwnerId"],
  dependsOn: ["user"],
  scope: {
    kind: "dated",
    predicates: [{ field: "Inventory_Date_Time_vod__c", type: "datetime" }],
    retentionFamily: "samples",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.36",
});
