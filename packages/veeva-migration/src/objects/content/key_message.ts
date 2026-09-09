/**
 * `key_message` — `Key_Message_vod__c` → `key_message__v` (spec §6.3.14).
 *
 * TODO(family agent "content"): replace this stub with the full module — field
 * mappings from §6.3.14, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const key_message = defineObject({
  key: "key_message",
  source: "Key_Message_vod__c",
  target: "key_message__v",
  targetEvidence: "DOC",
  countryOf: "global",
  dependsOn: ["product"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.14",
});
