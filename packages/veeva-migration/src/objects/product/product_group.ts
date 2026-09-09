/**
 * `product_group` — `Product_Group_vod__c` → `product_group__v` (spec §6.3.6).
 *
 * TODO(family agent "product"): replace this stub with the full module — field
 * mappings from §6.3.6, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const product_group = defineObject({
  key: "product_group",
  source: "Product_Group_vod__c",
  target: "product_group__v",
  targetEvidence: "UNV",
  countryOf: "global",
  dependsOn: ["product"],
  deletePolicy: "delete",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.6",
});
