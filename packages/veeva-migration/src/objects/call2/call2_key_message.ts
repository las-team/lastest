/**
 * `call2_key_message` — `Call2_Key_Message_vod__c` → `call2_key_message__v` (spec §6.3.33).
 *
 * TODO(family agent "call2"): replace this stub with the full module — field
 * mappings from §6.3.33, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const call2_key_message = defineObject({
  key: "call2_key_message",
  source: "Call2_Key_Message_vod__c",
  target: "call2_key_message__v",
  targetEvidence: "DOC",
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: [
    "call2",
    "key_message",
    "clm_presentation",
    "product",
    "account",
    "user",
  ],
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
  },
  deletePolicy: "delete",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.33",
});
