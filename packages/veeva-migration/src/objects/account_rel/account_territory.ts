/**
 * `account_territory` — `ObjectTerritory2Association` → `account_territory__v` (spec §6.3.11).
 *
 * TODO(family agent "account_rel"): replace this stub with the full module — field
 * mappings from §6.3.11, Block S opt-outs, objectTypes/states/picklists
 * defaults, match rules (§3.3), inactivate set (§4.4), custom functions.
 */
import { defineObject } from "../types";

export const account_territory = defineObject({
  key: "account_territory",
  source: "ObjectTerritory2Association",
  target: "account_territory__v",
  targetEvidence: "DOC",
  enabledByDefault: false,
  countryOf: "account",
  dependsOn: ["account", "territory"],
  deletePolicy: "delete",
  load: { noTriggers: false },
  notes: "STUB — see docs/MIGRATION_SPEC.md §6.3.11",
});
