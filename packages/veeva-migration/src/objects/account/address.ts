/**
 * `address` — `Address_vod__c` → `address__v` (spec §6.3.8).
 *
 * TODO(family agent "account"): replace this stub with the full module — field
 * mappings from §6.3.8, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const address = defineObject({
  key: "address",
  source: "Address_vod__c",
  target: "address__v",
  targetEvidence: "OBS",
  countryOf: "account",
  dependsOn: ["account"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.8",
});
