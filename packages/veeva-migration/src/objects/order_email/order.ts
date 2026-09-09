/**
 * `order` — `Order_vod__c` → `order__v` (spec §6.3.38).
 *
 * TODO(family agent "order_email"): replace this stub with the full module — field
 * mappings from §6.3.38, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const order = defineObject({
  key: "order",
  source: "Order_vod__c",
  target: "order__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "call2", "address", "user"],
  scope: {
    kind: "dated",
    predicates: [{ field: "Order_Date_vod__c", type: "date" }],
    openPredicate: "Status_vod__c NOT IN ('Submitted_vod', 'Voided_vod')",
  },
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.38",
});
