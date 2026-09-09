/**
 * `clm_presentation_slide` — `Clm_Presentation_Slide_vod__c` → `clm_presentation_slide__v` (spec §6.3.16).
 *
 * TODO(family agent "content"): replace this stub with the full module — field
 * mappings from §6.3.16, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const clm_presentation_slide = defineObject({
  key: "clm_presentation_slide",
  source: "Clm_Presentation_Slide_vod__c",
  target: "clm_presentation_slide__v",
  targetEvidence: "DOC",
  countryOf: "global",
  dependsOn: ["clm_presentation", "key_message"],
  deletePolicy: "delete",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.16",
});
