/**
 * `approved_document` — `Approved_Document_vod__c` → `approved_document__v` (spec §6.3.17).
 *
 * TODO(family agent "content"): replace this stub with the full module — field
 * mappings from §6.3.17, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const approved_document = defineObject({
  key: "approved_document",
  source: "Approved_Document_vod__c",
  target: "approved_document__v",
  targetEvidence: "DOC",
  countryOf: "global",
  dependsOn: ["product", "key_message"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.17",
});
