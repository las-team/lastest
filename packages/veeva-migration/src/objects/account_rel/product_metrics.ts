/**
 * `product_metrics` — `Product_Metrics_vod__c` → `product_metrics__v` (spec §6.3.13).
 *
 * TODO(family agent "account_rel"): replace this stub with the full module — field
 * mappings from §6.3.13, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const product_metrics = defineObject({
  key: "product_metrics",
  source: "Product_Metrics_vod__c",
  target: "product_metrics__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "product", "child_account"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.13",
});
