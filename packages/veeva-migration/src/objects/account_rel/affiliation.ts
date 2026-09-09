/**
 * `affiliation` — `Affiliation_vod__c` → `affiliation__v` (spec §6.3.10).
 *
 * TODO(family agent "account_rel"): replace this stub with the full module — field
 * mappings from §6.3.10, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const affiliation = defineObject({
  key: "affiliation",
  source: "Affiliation_vod__c",
  target: "affiliation__v",
  targetEvidence: "DOC",
  countryOf: "parent:account:From_Account_vod__c",
  dependsOn: ["account"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.10",
});
