/**
 * `em_catalog` — `EM_Catalog_vod__c` → `em_catalog__v` `[OBS]` (spec §6.3.20,
 * §6.1 step 10, §6.2, §3.3, §4.4).
 *
 * Events-management topic catalogue: full scope, `GLOBAL` country, no
 * dependencies, loaded with `noTriggers = false` (§6.2). Upserted with
 * `idParam = external_id__v` in the wild `[OBS]`; the tool keeps the legacy-id
 * field as idParam and `external_id__v` as the first match key (§3.3).
 *
 * Targets are all **OBS**: `name__v`, `em_catalog_name__v`, `external_id__v`,
 * `description__v`, `em_catalog_status__v`, `object_type__v.api_name__v`.
 * Sources `Description_vod__c` and `Status_vod__c` are `[UNVERIFIED-SOURCE]`
 * (sfdc-extract.md §10 #3 lists the EM_Catalog fields as unknown) — a
 * describe miss is `info`, the row is dropped.
 *
 * Object types (topic types, `RecordTypeId`): the spec names none, so the
 * module ships an **empty** crosswalk and relies on the §6.0.2 derivation
 * (`Foo_vod → foo__v`), validated against the target's object types at
 * transform time (`VT_OBJECT_TYPE_MISSING`) and overridable per country under
 * `objects.em_catalog.objectType`. The Block S object-type row is switched on
 * explicitly for that reason.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only (no business flag).
 */
import { defineObject } from "../types";

export const em_catalog = defineObject({
  key: "em_catalog",
  source: "EM_Catalog_vod__c",
  target: "em_catalog__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: [],
  // object types exist (topic types) even though no name is documented
  blockS: { objectType: true },
  fields: [
    // --- §6.3.20 rows (same-target rows replace the Block S defaults)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      disabledBy: "preserveName",
    },
    {
      source: "Name",
      target: "em_catalog_name__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      notes: "topic name mirrored on the observed business-name field",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "[OBS idParam in the wild] — first match key (§3.3); never overwrite an integration-owned value (§3.2 step 4)",
    },
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE — sfdc-extract.md §10 #3]",
    },
    {
      source: "Status_vod__c",
      target: "em_catalog_status__v",
      transform: "picklist(em_catalog.status)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE]; business status per the §6.0.2 status-field rule",
    },
  ],
  // Topic record types are undocumented: derivation rule by default (§6.0.2).
  objectTypes: {},
  // No documented value list: derivation rule by default; overlays add entries.
  picklists: { "em_catalog.status": {} },
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
      notes: "external_id__v = External_ID_vod__c [OBS upsert idParam]",
    },
    { method: "legacy_id" },
  ],
  notes:
    "EM master data (§6.3.20): GLOBAL, full scope, inactivate on delete (status__v only). Targets OBS; Description/Status sources unverified (describe miss = info, row dropped).",
});
