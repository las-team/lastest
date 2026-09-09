/**
 * `sample_lot` — `Sample_Lot_vod__c` → `sample_lot__v` (spec §6.3.18).
 *
 * TODO(family agent "sample"): replace this stub with the full module — field
 * mappings from §6.3.18, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const sample_lot = defineObject({
  key: "sample_lot",
  source: "Sample_Lot_vod__c",
  target: "sample_lot__v",
  targetEvidence: "DOC",
  countryOf: "user:OwnerId",
  dependsOn: ["product", "user"],
  deletePolicy: "inactivate",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.18",
});
