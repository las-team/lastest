/**
 * `order_line` — `Order_Line_vod__c` → `order_line__v` (spec §6.3.39).
 *
 * TODO(family agent "order_email"): replace this stub with the full module — field
 * mappings from §6.3.39, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const order_line = defineObject({
  key: "order_line",
  source: "Order_Line_vod__c",
  target: "order_line__v",
  targetEvidence: "DOC",
  countryOf: "parent:order:Order_vod__c",
  dependsOn: ["order", "product"],
  scope: {
    kind: "via-parent",
    parentKey: "order",
    parentField: "Order_vod__r.Order_Date_vod__c",
    type: "date",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.39",
});
