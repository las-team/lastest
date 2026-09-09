/**
 * `child_account` — `Child_Account_vod__c` → `child_account__v` (spec §6.3.9).
 *
 * TODO(family agent "account_rel"): replace this stub with the full module — field
 * mappings from §6.3.9, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const child_account = defineObject({
  key: "child_account",
  source: "Child_Account_vod__c",
  target: "child_account__v",
  targetEvidence: "DOC",
  countryOf: "parent:account:Parent_Account_vod__c",
  dependsOn: ["account"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.9",
});
