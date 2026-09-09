/**
 * `product` — `Product_vod__c` → `product__v` (spec §6.3.5).
 *
 * TODO(family agent "product"): replace this stub with the full module — field
 * mappings from §6.3.5, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const product = defineObject({
  key: "product",
  source: "Product_vod__c",
  target: "product__v",
  targetEvidence: "OBS",
  countryOf: "global",
  dependsOn: [],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.5",
});
