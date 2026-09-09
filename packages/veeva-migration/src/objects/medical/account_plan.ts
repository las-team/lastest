/**
 * `account_plan` — `Account_Plan_vod__c` → `account_plan__v` (spec §6.3.28).
 *
 * TODO(family agent "medical"): replace this stub with the full module — field
 * mappings from §6.3.28, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const account_plan = defineObject({
  key: "account_plan",
  source: "Account_Plan_vod__c",
  target: "account_plan__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "user"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.28",
});
