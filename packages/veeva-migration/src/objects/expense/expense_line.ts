/**
 * `expense_line` — `Expense_Line_vod__c` → `expense_line__v` (spec §6.3.25b).
 *
 * TODO(family agent "expense"): replace this stub with the full module — field
 * mappings from §6.3.25b, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const expense_line = defineObject({
  key: "expense_line",
  source: "Expense_Line_vod__c",
  target: "expense_line__v",
  targetEvidence: "OBS",
  countryOf: "parent:expense_header:Expense_Header_vod__c",
  dependsOn: ["expense_header", "em_event"],
  scope: {
    kind: "via-parent",
    parentKey: "expense_header",
    parentField: "Expense_Header_vod__r.Event_vod__r.Start_Time_vod__c",
    type: "datetime",
    retentionFamily: "tov",
  },
  deletePolicy: "delete",
  optionDefaults: { optional: true },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.25b",
});
