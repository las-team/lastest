/**
 * `account` — `Account` → `account__v` (spec §6.3.7).
 *
 * TODO(family agent "account"): replace this stub with the full module — field
 * mappings from §6.3.7, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const account = defineObject({
  key: "account",
  source: "Account",
  target: "account__v",
  targetEvidence: "OBS",
  countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
  dependsOn: ["country", "user"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.7",
});
