/**
 * `sample_inventory_item` — `Sample_Inventory_Item_vod__c` → `sample_inventory_item__v` (spec §6.3.37).
 *
 * TODO(family agent "sample"): replace this stub with the full module — field
 * mappings from §6.3.37, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const sample_inventory_item = defineObject({
  key: "sample_inventory_item",
  source: "Sample_Inventory_Item_vod__c",
  target: "sample_inventory_item__v",
  targetEvidence: "UNV",
  countryOf: "parent:sample_inventory:Sample_Inventory_vod__c",
  dependsOn: ["sample_inventory", "sample_lot"],
  scope: {
    kind: "via-parent",
    parentKey: "sample_inventory",
    parentField: "Sample_Inventory_vod__r.Inventory_Date_Time_vod__c",
    type: "datetime",
    retentionFamily: "samples",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.37",
});
