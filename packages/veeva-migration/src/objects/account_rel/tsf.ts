/**
 * `tsf` — `TSF_vod__c` → `tsf__v` (spec §6.3.12).
 *
 * TODO(family agent "account_rel"): replace this stub with the full module — field
 * mappings from §6.3.12, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const tsf = defineObject({
  key: "tsf",
  source: "TSF_vod__c",
  target: "tsf__v",
  targetEvidence: "DOC",
  countryOf: "account",
  dependsOn: ["account", "territory", "address"],
  deletePolicy: "inactivate",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.12",
});
