/**
 * `em_speaker` — `EM_Speaker_vod__c` → `em_speaker__v` (spec §6.3.21).
 *
 * TODO(family agent "em_master"): replace this stub with the full module — field
 * mappings from §6.3.21, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const em_speaker = defineObject({
  key: "em_speaker",
  source: "EM_Speaker_vod__c",
  target: "em_speaker__v",
  targetEvidence: "OBS",
  countryOf: "account",
  dependsOn: ["account"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.21",
});
