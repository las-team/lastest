/**
 * `clm_presentation` — `Clm_Presentation_vod__c` → `clm_presentation__v` (spec §6.3.15).
 *
 * TODO(family agent "content"): replace this stub with the full module — field
 * mappings from §6.3.15, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const clm_presentation = defineObject({
  key: "clm_presentation",
  source: "Clm_Presentation_vod__c",
  target: "clm_presentation__v",
  targetEvidence: "DOC",
  countryOf: "global",
  dependsOn: ["product"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.15",
});
