/**
 * `multichannel_consent` — `Multichannel_Consent_vod__c` → `multichannel_consent__v` (spec §6.3.42).
 *
 * TODO(family agent "multichannel"): replace this stub with the full module — field
 * mappings from §6.3.42, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const multichannel_consent = defineObject({
  key: "multichannel_consent",
  source: "Multichannel_Consent_vod__c",
  target: "multichannel_consent__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "product", "sent_email"],
  orderBy: ["Capture_Datetime_vod__c", "Id"],
  deletePolicy: "ignore",
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.42",
});
