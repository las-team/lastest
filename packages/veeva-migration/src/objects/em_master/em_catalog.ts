/**
 * `em_catalog` — `EM_Catalog_vod__c` → `em_catalog__v` (spec §6.3.20).
 *
 * TODO(family agent "em_master"): replace this stub with the full module — field
 * mappings from §6.3.20, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_catalog = defineObject({
  key: "em_catalog",
  source: "EM_Catalog_vod__c",
  target: "em_catalog__v",
  targetEvidence: "OBS",
  countryOf: "global",
  dependsOn: [],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.20",
});
