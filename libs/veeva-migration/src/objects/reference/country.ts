/**
 * `country` — `Country_vod__c` → `country__v` (spec §6.3.1, §3.3, §3.4).
 *
 * Match-only crosswalk builder: the module is never loaded. Its purpose is to
 * pair every SFDC `Country_vod__c` row with the pre-existing `country__v` row
 * (assumption A2) so that every `country(...)` transform and every
 * `countryOf` predicate can translate between SFDC ids, ISO-2 codes and Vault
 * ids. A source country without a target match is a blocking
 * `COUNTRY_UNMATCHED` finding — countries are **never** created.
 *
 * The target key field holding the ISO alpha-2 code is `[UNVERIFIED]`:
 * preflight tries `COUNTRY_KEY_FIELD_CANDIDATES` in order, otherwise scans
 * `country__v` for a unique 2-character `String` field; `objects.country
 * .targetKeyField` overrides the choice (`info COUNTRY_KEY_FIELD_SELECTED`).
 */
import { defineObject } from "../types";

/**
 * Candidate `country__v` fields for the ISO alpha-2 key, in preflight order
 * (§6.3.1). Only `external_id__v` is observed on `country__v`; the others are
 * mechanical renames.
 */
export const COUNTRY_KEY_FIELD_CANDIDATES = [
  "alpha_2_code__v",
  "country_code__v",
  "abbreviation__v",
  "external_id__v",
] as const;

/** Source columns the crosswalk needs (§6.3.1 table). */
export const COUNTRY_SOURCE_COLUMNS = [
  "Id",
  "Name",
  "Alpha_2_Code_vod__c",
  "Country_Code_vod__c",
] as const;

export const country = defineObject({
  key: "country",
  source: "Country_vod__c",
  target: "country__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: [],
  // Match-only crosswalk: no audit/owner/mobile/lock rows are ever written.
  blockS: {
    name: "none",
    ownerId: false,
    audit: false,
    mobileId: false,
    lastDevice: false,
    mobileDatetimes: false,
    locks: false,
    unlock: false,
    externalId: false,
  },
  fields: [
    {
      source: "Id",
      target: "legacy_crm_id__v",
      transform: "legacyId",
      required: "K",
      evidence: "UNV",
      notes:
        "crosswalk key only — country rows are never written; Account.Country_vod__c, EM_Event_vod__c.Country_vod__c and possibly User.Country_vod__c point here",
    },
    {
      source: "Alpha_2_Code_vod__c",
      target: "alpha_2_code__v",
      transform: "copy",
      required: "-",
      evidence: "UNV",
      sourceType: "string",
      notes:
        "match key (ISO alpha-2). Target key field resolved at preflight from COUNTRY_KEY_FIELD_CANDIDATES (alpha_2_code__v [UNV, mechanical rename], country_code__v, abbreviation__v, external_id__v [OBS]) or a unique 2-char String scan; objects.country.targetKeyField overrides (info COUNTRY_KEY_FIELD_SELECTED)",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "-",
      evidence: "OBS",
      sourceType: "string",
      notes:
        "fallback match key, case-insensitive (country__vr.name__v observed)",
    },
    {
      source: "Country_Code_vod__c",
      target: "country_code__v",
      transform: "skip",
      required: "-",
      evidence: "UNV",
      sourceType: "string",
      notes: "informational only (extracted for the report, never matched on)",
    },
  ],
  deletePolicy: "ignore",
  createPolicy: "match-only",
  load: { noTriggers: true },
  match: [
    {
      method: "external_id",
      keys: [{ target: "alpha_2_code__v", source: "Alpha_2_Code_vod__c" }],
      evidence: "UNV",
      notes:
        "ISO alpha-2 against the preflight-selected key field (target name in keys[0] is the first candidate; preflight substitutes the resolved field)",
    },
    {
      method: "natural_key",
      keys: [{ target: "name__v", source: "Name", caseInsensitive: true }],
      evidence: "OBS",
      notes: "case-insensitive name fallback",
    },
  ],
  notes:
    "Match-only crosswalk (§6.3.1): country__v rows must pre-exist (A2); unmatched source countries are blocking COUNTRY_UNMATCHED (§3.3). Never created, never updated, never deleted.",
});
