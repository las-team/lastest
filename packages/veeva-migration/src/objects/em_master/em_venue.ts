/**
 * `em_venue` — `EM_Venue_vod__c` → `em_venue__v` (spec §6.3.19).
 *
 * TODO(family agent "em_master"): replace this stub with the full module — field
 * mappings from §6.3.19, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_venue = defineObject({
  key: "em_venue",
  source: "EM_Venue_vod__c",
  target: "em_venue__v",
  targetEvidence: "OBS",
  countryOf: "global",
  dependsOn: [],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.19",
});
