/**
 * `em_venue` — `EM_Venue_vod__c` → `em_venue__v` `[OBS]` (spec §6.3.19, §6.1
 * step 10, §6.2, §3.3, §4.4).
 *
 * Events-management master data: full scope, `GLOBAL` country, no
 * dependencies, loaded with `noTriggers = false` (§6.2). In the wild the
 * object is upserted with `idParam = external_id__v` `[OBS]`; the tool still
 * uses the legacy-id field as idParam and `external_id__v` as the first match
 * key (§3.3). Because an integration owns `external_id__v` here, the module
 * defaults `externalIdOwnedBy = integration` so §3.2 step 4 can never promote
 * `external_id__v` to the legacy-id field (which would replace the
 * integration keys with `SF:{orgId15}:{id18}` values and defeat the match
 * key); `objects.em_venue.externalIdOwnedBy = migration` overrides it.
 *
 * Evidence: only `Name` (`[META-implied]`) and `External_ID_vod__c`
 * (`[OBS idParam]`) are verified sources — `EM_Venue_vod__c` appears in no
 * research file beyond its name — so **every other source is
 * `[UNVERIFIED-SOURCE]`** (`unverifiedSource: true`: a describe miss is an
 * `info SF_FIELD_MISSING` and the row is dropped) and every target other than
 * `name__v`/`external_id__v` is `[UNV]` (preflight `VT_FIELD_MISSING` →
 * dropped). Nothing is thrown in transforms for a missing name.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only (no business flag on
 * the target). No Block S `statusFromFlag` — the venue is not in the §6.0.4
 * default list; `Status_vod__c` maps to the business status
 * `em_venue_status__v` (§6.0.2 status-field rule).
 *
 * Custom transforms (pure, unit-tested in `em_venue.test.ts`):
 *  - `countryAuto`  the spec's `country(auto)`: `country(ref)` for Object
 *                   targets, `country(picklist)` for Picklist targets, ISO-2
 *                   text otherwise — the type of `em_venue__v.country__v` is
 *                   `[UNV]`, so the mode is picked from target metadata.
 *  - `stateAuto`    `State_Province_vod__c`: `picklist(em_venue.state)` when
 *                   the target is a Picklist, `text` otherwise (the spec row
 *                   says `text`/`picklist`; country-configurable).
 */
import { applyTransform } from "../../transform/registry";
import type {
  CountryMode,
  CustomTransformFn,
  TransformContext,
  TransformSpec,
} from "../../types";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers (local copies — no coupling to other families)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** `country(auto)` mode from the target field's metadata type (§6.0.3). */
export function countryModeFor(ctx: TransformContext): CountryMode {
  const type = ctx.targetField?.type;
  if (type === "picklist") return "picklist";
  if (type === "string" || type === "longtext") return "iso2";
  return "ref";
}

/** `country(auto)`: `ref` for Object targets, `picklist` for Picklist targets, ISO-2 text otherwise. */
export const countryAuto: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const spec: TransformSpec = { kind: "country", mode: countryModeFor(ctx) };
  return applyTransform(spec, value, row, ctx);
};

/** Picklist map key of the venue state crosswalk (country overlay `picklists.maps`). */
export const EM_VENUE_STATE_MAP_KEY = "em_venue.state";

/** `State_Province_vod__c`: picklist crosswalk when the target is a Picklist, text otherwise. */
export const stateAuto: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  const spec: TransformSpec =
    ctx.targetField?.type === "picklist"
      ? { kind: "picklist", mapKey: EM_VENUE_STATE_MAP_KEY }
      : { kind: "text" };
  return applyTransform(spec, value, row, ctx);
};

export const em_venue = defineObject({
  key: "em_venue",
  source: "EM_Venue_vod__c",
  target: "em_venue__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: [],
  fields: [
    // --- §6.3.19 rows (same-target rows replace the Block S defaults)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      disabledBy: "preserveName",
      notes: "[META-implied] venue name",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "[OBS idParam in the wild] — used as the first match key (§3.3); never overwrite an integration-owned value (§3.2 step 4)",
    },
    {
      source: "Address_Line_1_vod__c",
      target: "address_line_1__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]; target spelling [UNV]",
    },
    {
      source: "Address_Line_2_vod__c",
      target: "address_line_2__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]; target spelling [UNV]",
    },
    {
      source: "City_vod__c",
      target: "city__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]",
    },
    {
      source: "State_Province_vod__c",
      target: "state_province__v",
      transform: "custom(stateAuto)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      countryConfigurable: true,
      notes:
        "[UNVERIFIED-SOURCE]; picklist(em_venue.state) when the target is a Picklist, text otherwise — crosswalk per country",
    },
    {
      source: "Postal_Code_vod__c",
      target: "postal_code__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]",
    },
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "custom(countryAuto)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      countryConfigurable: true,
      notes:
        "[UNVERIFIED-SOURCE]; country(auto): ref | picklist | iso2 by target type, via the §3.4 country crosswalk",
    },
    {
      source: "Phone_vod__c",
      target: "phone__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]",
    },
    {
      source: "Venue_Type_vod__c",
      target: "venue_type__v",
      transform: "picklist(em_venue.venueType)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE]; target spelling [UNV]",
    },
    {
      source: "Status_vod__c",
      target: "em_venue_status__v",
      transform: "picklist(em_venue.status)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE]; business status per the §6.0.2 status-field rule (target [UNV])",
    },
  ],
  // No value lists are documented for the venue picklists: the default is the
  // §6.0.2 derivation rule (strip `_vod`, lowercase, `__v`), validated against
  // the target's active values; overlays add entries under these keys.
  picklists: {
    [EM_VENUE_STATE_MAP_KEY]: {},
    "em_venue.venueType": {},
    "em_venue.status": {},
  },
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
  custom: { countryAuto, stateAuto },
  // §3.2 step 4: external_id__v is integration-written [OBS idParam] — never a
  // legacy-id candidate, so it stays a usable match key. Config-overridable.
  optionDefaults: { externalIdOwnedBy: "integration" },
  notes:
    "EM master data (§6.3.19): GLOBAL, full scope, inactivate on delete (status__v only). Only Name/External_ID_vod__c are verified sources; the rest resolve at preflight (describe miss = info, row dropped). externalIdOwnedBy defaults to integration so external_id__v stays the match key and is never the legacy-id field (§3.2 step 4).",
});
