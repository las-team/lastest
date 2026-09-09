/**
 * `em_event` — `EM_Event_vod__c` → `em_event__v` `[OBS full field list]`
 * (spec §6.3.22, §6.1 step 11, §6.2, §3.3, §3.5, §4.4).
 *
 * Transfer-of-value family (`tov`, widened by `scope.tovRetentionMonths`):
 * dated on `Start_Time_vod__c` plus the open-item term (event still running
 * or not closed/cancelled). Country from the event's own country lookup
 * (`field:Country_vod__r.Alpha_2_Code_vod__c`). Parents are loaded before
 * children (`partitionBy Parent_Event_vod__c`) and `parent_event__v` is a
 * pass-2 self reference. Lifecycled on the target (`state__v`, `stage__v`):
 * `Status_vod__c` feeds both the business status `em_event_status__v` and
 * the lifecycle state (`em_event.state`, migration mode). `noTriggers = true`
 * (EM automated e-mails). Deleted events are ignored on the target (§4.4).
 *
 * Custom transforms (pure, unit-tested here):
 *  - `emEventLocalTimes` — `start/end_time_local__v`, `start/end_date__v`
 *    and `time_zone__v` derived from the UTC times plus the chosen timezone:
 *    `Event_Time_Zone*` (`[UNVERIFIED-SOURCE]`, any row key with that prefix)
 *    → owner `TimeZoneSidKey` (opt-in column, see below) → country
 *    `defaultTimezone`. Fallback use is counted through non-fatal `custom`
 *    diagnostics so the report can document the timezone choice per run.
 *  - `eventConfiguration` — `event_configuration__v` via
 *    `objects.em_event.configurationMap` (SFDC id → Vault id or
 *    `external_id:<value>`), else automatic match by the configuration's
 *    `External_ID_vod__c` (`external_id__v` lookup) then `Name`
 *    (`name__v` lookup); unmatched → `VT_EM_CONFIG_UNMATCHED`.
 *  - `vendorRefDropped` — `vendor__v` omitted and counted
 *    (`EM_VENDOR_REF_DROPPED`, `EM_Vendor_vod__c` is out of v1, §6.2.1).
 *  - `eventCountryFallback` — `Event_Country_vod__c` feeds `country__v`
 *    only when `Country_vod__c` is empty.
 *  - `eventStage` — `stage__v` from `objects.em_event.stageMap` only (the
 *    stage is otherwise set by Vault from `state__v`).
 *
 * Dotted "selector" targets (`time_zone__v.event`, `time_zone__v.owner`,
 * `event_configuration__v.external_id`, `event_configuration__v.name`,
 * `country__v.event_country`) exist so that the extra source columns are
 * selected by the extractor and validated by preflight against their base
 * field (`outputField` strips the suffix); the transform emits into the base
 * field (or nothing) via `targetField`.
 */
import { applyTransform, normaliseDatetime } from "../../transform/registry";
import { isSfdcId, to15, to18 } from "../../transform/ids";
import { renameTimezone } from "../../transform/rename";
import type {
  CustomTransformFn,
  RowDiagnostic,
  SourceRow,
  TransformContext,
  TransformResult,
} from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** RecordType DeveloperName → object type (`[UNV]` names, §6.3.22). */
export const EM_EVENT_OBJECT_TYPES: Record<string, string> = {
  Speaker_Program_vod: "speaker_program__v",
  Congress_vod: "congress__v",
  Investigator_Meeting_vod: "investigator_meeting__v",
  Round_Table_vod: "round_table__v",
};

/** `Status_vod__c` → `em_event_status__v` (`[UNV]` values; customer plain-English values → `__c` via overlays). */
export const EM_EVENT_STATUS: Record<string, string> = {
  Requested_vod: "requested__v",
  Pending_Approval_vod: "pending_approval__v",
  Approved_vod: "approved__v",
  Rejected_vod: "rejected__v",
  Closed_vod: "closed__v",
  Canceled_vod: "canceled__v",
  Cancelled_vod: "canceled__v",
};

/**
 * `Status_vod__c` → lifecycle state (`[UNV]`; `<status>_state__v` pattern).
 * Preflight validates every entry against the lifecycle and lists the stage
 * of each mapped state (`info EM_STATE_STAGE_TABLE`) for reviewer sign-off.
 */
export const EM_EVENT_STATES: Record<string, string> = {
  Requested_vod: "requested_state__v",
  Pending_Approval_vod: "pending_approval_state__v",
  Approved_vod: "approved_state__v",
  Rejected_vod: "rejected_state__v",
  Closed_vod: "closed_state__v",
  Canceled_vod: "canceled_state__v",
  Cancelled_vod: "canceled_state__v",
};

/** Statuses that make an event "closed" for the open-item scope term (§6.2). */
export const EM_EVENT_CLOSED_STATUSES: readonly string[] = [
  "Closed_vod",
  "Canceled_vod",
  "Cancelled_vod",
];

/**
 * Open-item term (§6.2: `End_Time_vod__c >= today` ∨ status ∉ closed/cancelled).
 * "today" is rendered as the run's cutoff literal (`{cutoffDateTime}`) —
 * the scope builder offers no "today" token and §1.1 #2 forbids relative
 * SOQL literals; the resulting set is a superset of the spec's (events that
 * started before the cutoff and end after it), never narrower.
 */
export const EM_EVENT_OPEN_PREDICATE = `(End_Time_vod__c >= {cutoffDateTime}) OR (Status_vod__c NOT IN (${EM_EVENT_CLOSED_STATUSES.map(
  (s) => `'${s}'`,
).join(", ")}))`;

/** `[UNVERIFIED-SOURCE]` default name; any row key starting with `EVENT_TIME_ZONE_PREFIX` is honoured. */
export const EVENT_TIME_ZONE_SOURCE = "Event_Time_Zone_vod__c";
export const EVENT_TIME_ZONE_PREFIX = "Event_Time_Zone";
/** Owner timezone column (opt-in: `objects.em_event.ownerTimezoneLookup`). */
export const OWNER_TIME_ZONE_SOURCE = "Owner.TimeZoneSidKey";

export const EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE =
  "Event_Configuration_vod__r.External_ID_vod__c";
export const EM_EVENT_CONFIG_NAME_SOURCE = "Event_Configuration_vod__r.Name";

/** Diagnostic codes (counted in the run report). */
export const EM_VENDOR_REF_DROPPED_CODE = "EM_VENDOR_REF_DROPPED";
export const VT_EM_CONFIG_UNMATCHED_CODE = "VT_EM_CONFIG_UNMATCHED";
export const EM_EVENT_TIMEZONE_FROM_OWNER_CODE = "EM_EVENT_TIMEZONE_FROM_OWNER";
export const EM_EVENT_TIMEZONE_DEFAULTED_CODE = "EM_EVENT_TIMEZONE_DEFAULTED";
export const EM_EVENT_TIMEZONE_INVALID_CODE = "EM_EVENT_TIMEZONE_INVALID";
export const VT_TIMEZONE_VALUE_MISSING_CODE = "VT_TIMEZONE_VALUE_MISSING";

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

const tzCache = new Map<string, boolean>();

/** True when `tz` is an IANA zone the runtime knows. */
export function isValidTimezone(tz: string): boolean {
  const cached = tzCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  tzCache.set(tz, ok);
  return ok;
}

/**
 * Wall-clock components of a UTC instant in `tz`: `date` (`YYYY-MM-DD`) and
 * `datetime` (`YYYY-MM-DDTHH:MM:SS`, no zone). `undefined` when either the
 * instant or the zone is invalid.
 */
export function localWallClock(
  isoUtc: string,
  tz: string,
): { date: string; datetime: string } | undefined {
  const t = Date.parse(isoUtc);
  if (Number.isNaN(t) || !isValidTimezone(tz)) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date,
    datetime: `${date}T${hour}:${get("minute")}:${get("second")}`,
  };
}

/** The event's own timezone column value (`Event_Time_Zone*`, first non-empty). */
export function eventTimezoneSource(row: SourceRow): string | undefined {
  const direct = row[EVENT_TIME_ZONE_SOURCE];
  if (!isEmpty(direct)) return String(direct).trim();
  for (const [k, v] of Object.entries(row))
    if (k.startsWith(EVENT_TIME_ZONE_PREFIX) && !isEmpty(v))
      return String(v).trim();
  return undefined;
}

export type TimezoneOrigin = "event" | "owner" | "country";

/**
 * §6.3.22 timezone choice: event column → owner `TimeZoneSidKey` → country
 * `defaultTimezone` (→ `UTC`). Invalid zones fall through; `invalid` lists
 * the rejected candidates.
 */
export function chooseEventTimezone(
  row: SourceRow,
  ctx: Pick<TransformContext, "country">,
): { tz: string; origin: TimezoneOrigin; invalid: string[] } {
  const invalid: string[] = [];
  const own = eventTimezoneSource(row);
  if (own) {
    if (isValidTimezone(own)) return { tz: own, origin: "event", invalid };
    invalid.push(own);
  }
  const owner = row[OWNER_TIME_ZONE_SOURCE];
  if (!isEmpty(owner)) {
    const o = String(owner).trim();
    if (isValidTimezone(o)) return { tz: o, origin: "owner", invalid };
    invalid.push(o);
  }
  const country = ctx.country.defaultTimezone || "UTC";
  if (isValidTimezone(country))
    return { tz: country, origin: "country", invalid };
  invalid.push(country);
  return { tz: "UTC", origin: "country", invalid };
}

const LOCAL_TIME_TARGETS: Record<
  string,
  { source: string; part: "datetime" | "date" }
> = {
  start_time_local__v: { source: "Start_Time_vod__c", part: "datetime" },
  end_time_local__v: { source: "End_Time_vod__c", part: "datetime" },
  start_date__v: { source: "Start_Time_vod__c", part: "date" },
  end_date__v: { source: "End_Time_vod__c", part: "date" },
};

/**
 * `custom(emEventLocalTimes)`: dispatches on the row target —
 * `time_zone__v` (zone name → `america_new_york__sys` form, country
 * crosswalk `em_event.timeZone` first, validated against the target
 * picklist), `start/end_time_local__v` (wall clock; `…T..:..:..` text when
 * the target is a String, else `.000Z`-suffixed datetime form) and
 * `start/end_date__v` (local calendar date). Selector rows return nothing.
 */
export const emEventLocalTimes: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  const target = ctx.field.target;
  if (target === "time_zone__v") {
    const choice = chooseEventTimezone(row, ctx);
    const mapKey = "em_event.timeZone";
    const explicit =
      ctx.country.picklist(mapKey, choice.tz) ??
      ctx.mapping.picklists[mapKey]?.[choice.tz];
    if (explicit === null) return { omit: true };
    const name = explicit ?? renameTimezone(choice.tz);
    const diagnostic = timezoneDiagnostic(choice);
    const known = ctx.targetField?.picklistValues;
    if (known && known.length && !known.includes(name))
      return {
        omit: true,
        diagnostic: {
          kind: "unmapped_picklist",
          field: target,
          code: VT_TIMEZONE_VALUE_MISSING_CODE,
          value: choice.tz,
        },
      };
    return { value: name, diagnostic };
  }
  const spec = LOCAL_TIME_TARGETS[target];
  if (!spec) return undefined;
  const raw = isEmpty(value) ? row[spec.source] : value;
  if (isEmpty(raw)) return undefined;
  const iso = normaliseDatetime(String(raw));
  if (!iso)
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: target,
        code: "INVALID_DATETIME",
        value: String(raw),
      },
    };
  const { tz } = chooseEventTimezone(row, ctx);
  const local = localWallClock(iso, tz);
  if (!local) return undefined;
  if (spec.part === "date") return { value: local.date };
  return {
    value:
      ctx.targetField?.type === "string"
        ? local.datetime
        : `${local.datetime}.000Z`,
  };
};

function timezoneDiagnostic(
  choice: ReturnType<typeof chooseEventTimezone>,
): RowDiagnostic | undefined {
  if (choice.invalid.length)
    return {
      kind: "custom",
      field: "time_zone__v",
      code: EM_EVENT_TIMEZONE_INVALID_CODE,
      value: choice.invalid.join(","),
      detail: `unknown timezone(s) ignored; used ${choice.tz} (${choice.origin})`,
    };
  if (choice.origin === "owner")
    return {
      kind: "custom",
      field: "time_zone__v",
      code: EM_EVENT_TIMEZONE_FROM_OWNER_CODE,
      value: choice.tz,
    };
  if (choice.origin === "country")
    return {
      kind: "custom",
      field: "time_zone__v",
      code: EM_EVENT_TIMEZONE_DEFAULTED_CODE,
      value: choice.tz,
    };
  return undefined;
}

/** `objects.em_event.configurationMap` as a lookup (keys normalised to 18 chars). */
export function configurationMapOf(
  options: Record<string, unknown>,
): Record<string, string> | undefined {
  const raw = options.configurationMap;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) continue;
    out[isSfdcId(k) ? to18(k) : k] = v;
  }
  return out;
}

/**
 * `custom(eventConfiguration)`: `event_configuration__v` per §6.3.22 —
 * configured map (Vault id or `external_id:<value>` → `external_id__v`
 * lookup), else `External_ID_vod__c` of the configuration, else its `Name`
 * (`name__v` lookup, matched per country by the loader). Unmatched →
 * `VT_EM_CONFIG_UNMATCHED` (fatal when the field is required).
 */
export const eventConfiguration: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  const target = ctx.field.target;
  if (target !== "event_configuration__v") return undefined;
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  const id = isSfdcId(raw) ? to18(raw) : raw;
  const map = configurationMapOf(ctx.mapping.options);
  const hit = map?.[id] ?? (isSfdcId(raw) ? map?.[to15(raw)] : undefined);
  if (hit) {
    if (hit.startsWith("external_id:"))
      return {
        value: hit.slice("external_id:".length),
        targetField: `${target}.external_id__v`,
      };
    return { value: hit };
  }
  const ext = row[EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE];
  if (!isEmpty(ext))
    return {
      value: String(ext).trim(),
      targetField: `${target}.external_id__v`,
    };
  const name = row[EM_EVENT_CONFIG_NAME_SOURCE];
  if (!isEmpty(name))
    return { value: String(name).trim(), targetField: `${target}.name__v` };
  const required =
    ctx.mapping.required[target] ?? ctx.targetField?.required ?? false;
  return {
    omit: true,
    diagnostic: {
      kind: "unresolved_fk",
      field: target,
      code: VT_EM_CONFIG_UNMATCHED_CODE,
      value: id,
      fatal: required,
      detail:
        "EM_Event_Configuration_vod__c row has no Vault match (configurationMap / External_ID_vod__c / Name)",
    },
  };
};

/** `custom(vendorRefDropped)`: `vendor__v` omitted and counted (`EM_Vendor_vod__c` out of v1, §6.2.1). */
export const vendorRefDropped: CustomTransformFn = (
  value,
  _row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_scope_ref_dropped",
      field: ctx.field.target,
      code: EM_VENDOR_REF_DROPPED_CODE,
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail:
        "EM_Vendor_vod__c is out of v1 (becomes ref(em_vendor) when that module is enabled)",
    },
  };
};

/** `custom(eventCountryFallback)`: `Event_Country_vod__c` → `country__v` only when `Country_vod__c` is empty. */
export const eventCountryFallback: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  if (!isEmpty(row.Country_vod__c)) return undefined;
  const r = applyTransform({ kind: "country", mode: "ref" }, value, row, {
    ...ctx,
    targetField: ctx.metadata.fields.country__v ?? ctx.targetField,
  });
  if ("omit" in r) return r;
  return { ...r, targetField: "country__v" };
};

/** `custom(eventStage)`: `stage__v` from `objects.em_event.stageMap[status]`; nothing without a map entry. */
export const eventStage: CustomTransformFn = (
  value,
  _row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const map = ctx.mapping.options.stageMap;
  if (!map || typeof map !== "object") return undefined;
  const hit = (map as Record<string, unknown>)[String(value).trim()];
  return typeof hit === "string" && hit ? { value: hit } : undefined;
};

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

const text = (
  source: string,
  target: string,
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform: "text",
  required: "n",
  evidence: "OBS",
  ...extra,
});

export const em_event = defineObject({
  key: "em_event",
  source: "EM_Event_vod__c",
  target: "em_event__v",
  targetEvidence: "OBS",
  scope: {
    kind: "dated",
    predicates: [{ field: "Start_Time_vod__c", type: "datetime" }],
    openPredicate: EM_EVENT_OPEN_PREDICATE,
    retentionFamily: "tov",
  },
  countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
  dependsOn: [
    "country",
    "user",
    "em_venue",
    "em_catalog",
    "product",
    "account",
  ],
  selfRefs: [{ target: "parent_event__v", source: "Parent_Event_vod__c" }],
  partitionBy: { field: "Parent_Event_vod__c", order: ["null", "notNull"] },
  blockS: { currency: true },
  objectTypes: { ...EM_EVENT_OBJECT_TYPES },
  states: { ...EM_EVENT_STATES },
  fields: [
    // --- identity / names
    {
      source: "Id",
      target: "legacy_crm_id__v",
      transform: "legacyId",
      required: "K",
      evidence: "OBS",
      notes: "idParam of the upsert; observed on em_event__v (§3.3)",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      disabledBy: "preserveName",
    },
    text("Event_Display_Name_vod__c", "event_display_name__v", {
      transform: "text(80)",
    }),
    // --- status: business picklist + lifecycle state (+ optional stage)
    {
      source: "Status_vod__c",
      target: "em_event_status__v",
      transform: "picklist(em_event.status)",
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "values approved__v/rejected__v/pending_approval__v/closed__v/canceled__v/requested__v [UNV]; customer plain-English values → in_draft__c… via overlays",
    },
    {
      source: "Status_vod__c",
      target: "state__v",
      transform: "state(em_event.state)",
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "migration mode; every status must map to a state whose stage matches the business status (preflight info EM_STATE_STAGE_TABLE)",
    },
    {
      source: "Status_vod__c",
      target: "stage__v",
      transform: "custom(eventStage)",
      required: "n",
      evidence: "OBS",
      enabledBy: "stageMap",
      notes:
        "not loaded by default (Vault sets the stage from state__v); objects.em_event.stageMap sets it explicitly when the probe shows stage__v writable in migration mode",
    },
    // --- times (UTC) + local values + timezone
    {
      source: "Start_Time_vod__c",
      target: "start_time__v",
      transform: "datetime",
      required: "Y",
      evidence: "OBS",
      sourceType: "datetime",
    },
    {
      source: "End_Time_vod__c",
      target: "end_time__v",
      transform: "datetime",
      required: "n",
      evidence: "OBS",
      sourceType: "datetime",
    },
    {
      source: "Start_Time_vod__c",
      target: "start_date__v",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "local calendar date of the start (UTC + chosen timezone)",
    },
    {
      source: "End_Time_vod__c",
      target: "end_date__v",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "local calendar date of the end",
    },
    {
      source: "Start_Time_vod__c",
      target: "start_time_local__v",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "wall-clock start in the chosen timezone",
    },
    {
      source: "End_Time_vod__c",
      target: "end_time_local__v",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes: "wall-clock end in the chosen timezone",
    },
    {
      source: "Start_Time_vod__c",
      target: "time_zone__v",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      countryConfigurable: true,
      notes:
        "timezone choice: Event_Time_Zone* → Owner.TimeZoneSidKey (opt-in) → countries.<ISO>.defaultTimezone; value form america_new_york__sys-style [OBS array]; crosswalk em_event.timeZone",
    },
    {
      source: EVENT_TIME_ZONE_SOURCE,
      target: "time_zone__v.event",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE — exact API name resolved by describe prefix match Event_Time_Zone*]; selector row: column read by the time_zone__v row",
    },
    {
      source: OWNER_TIME_ZONE_SOURCE,
      target: "time_zone__v.owner",
      transform: "custom(emEventLocalTimes)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      enabledBy: "ownerTimezoneLookup",
      notes:
        "selector row (opt-in objects.em_event.ownerTimezoneLookup): Owner is polymorphic on queue-enabled objects, where this path is not selectable",
    },
    // --- country (+ fallback source)
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "country(ref)",
      required: "y?",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Event_Country_vod__c",
      target: "country__v.event_country",
      transform: "custom(eventCountryFallback)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      countryConfigurable: true,
      notes:
        "[DOC sfdc-extract.md §7.16 — confirm in describe] ref→Country_vod__c or ISO text; feeds country__v only when Country_vod__c is null",
    },
    // --- location
    text("Location_vod__c", "location__v", {
      transform: "text(255)",
      countryConfigurable: true,
    }),
    text("Location_Address_vod__c", "location_address__v", {
      countryConfigurable: true,
    }),
    text("Location_Address_Line_2_vod__c", "location_address_line_2__v", {
      countryConfigurable: true,
    }),
    text("City_vod__c", "city__v", { countryConfigurable: true }),
    text("State_Province_vod__c", "state_province__v", {
      countryConfigurable: true,
    }),
    text("Postal_Code_vod__c", "postal_code__v", {
      countryConfigurable: true,
      notes:
        "§6.0.2 also lists Zip_vod__c → postal_code__v for em_event; an overlay may switch the source when the org uses Zip_vod__c",
    }),
    text("Address_vod__c", "address__v", { countryConfigurable: true }),
    // --- references
    {
      source: "Venue_vod__c",
      target: "venue__v",
      transform: "ref(em_venue)",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Vendor_vod__c",
      target: "vendor__v",
      transform: "custom(vendorRefDropped)",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes:
        "omit+count EM_VENDOR_REF_DROPPED (EM_Vendor_vod__c out of v1, §6.2.1) — becomes ref(em_vendor) when that module is enabled",
    },
    {
      source: "Topic_vod__c",
      target: "topic__v",
      transform: "ref(em_catalog)",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
    },
    {
      source: "Event_Configuration_vod__c",
      target: "event_configuration__v",
      transform: "custom(eventConfiguration)",
      required: "y?",
      evidence: "OBS",
      sourceType: "reference",
      countryConfigurable: true,
      notes:
        "em_event_configuration__v must pre-exist (§6.1); objects.em_event.configurationMap (SFDC Id → Vault id | external_id:<value>), else External_ID_vod__c = external_id__v, then Name = name__v per country; unmatched → blocking VT_EM_CONFIG_UNMATCHED",
    },
    {
      source: EM_EVENT_CONFIG_EXTERNAL_ID_SOURCE,
      target: "event_configuration__v.external_id",
      transform: "custom(eventConfiguration)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      optionalSource: true,
      notes:
        "selector row: configuration External_ID_vod__c [UNVERIFIED-SOURCE field] for the automatic match",
    },
    {
      source: EM_EVENT_CONFIG_NAME_SOURCE,
      target: "event_configuration__v.name",
      transform: "custom(eventConfiguration)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes: "selector row: configuration Name for the automatic match",
    },
    {
      source: "Parent_Event_vod__c",
      target: "parent_event__v",
      transform: "ref(em_event) secondPass",
      required: "n",
      evidence: "OBS",
      sourceType: "reference",
      notes: "pass-2 self reference (§6.1 step 11); parents loaded first",
    },
    {
      source: "Parent_Event_vod__c",
      target: "parent_event_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes: "SFDC id of the parent as text",
    },
    // --- external ids
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes:
        "match key (§3.3); never overwrite an integration-owned value (§3.2 step 4)",
    },
    {
      source: "KOL_External_Id_vod__c",
      target: "kol_external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Stub_Mobile_Id_vod__c",
      target: "stub_mobile_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Stub_SFDC_Id_vod__c",
      target: "stub_sfdc_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      notes: "4th match key (§3.3)",
    },
    // --- descriptions
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "longtext",
      required: "n",
      evidence: "OBS",
    },
    text("Sponsor_vod__c", "sponsor__v"),
    text("Web_Source_vod__c", "web_source__v"),
    {
      source: "Disclaimer_vod__c",
      target: "disclaimer__v",
      transform: "longtext",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Cancellation_Reason_vod__c",
      target: "cancellation_reason__v",
      transform: "picklist(em_event.cancellationReason)",
      required: "n",
      evidence: "OBS",
    },
    {
      source: "Last_Comment_vod__c",
      target: "last_comment__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
    },
    // --- counters (verbatim, NoTriggers)
    ...[
      "Estimated_Attendance_vod__c",
      "Actual_Attendance_vod__c",
      "Invited_Attendees_vod__c",
      "Walk_In_Count_vod__c",
      "Online_Registrant_Count_vod__c",
      "Attendees_Requesting_Meals_vod__c",
      "Attendees_With_Meals_vod__c",
      "HCPs_With_Meals_vod__c",
    ].map((source) => ({
      source,
      target: `${source.replace(/_vod__c$/, "").toLowerCase()}__v`,
      transform: "number",
      required: "n" as const,
      evidence: "OBS" as const,
      notes: "roll-up-like counter — verbatim (NoTriggers)",
    })),
    // --- costs (currency; local_currency__sys from Block S currency row)
    ...[
      "Estimated_Cost_vod__c",
      "Committed_Cost_vod__c",
      "Actual_Cost_vod__c",
      "Actual_Meal_Cost_Per_Person_vod__c",
      "Flat_Fee_Expense_vod__c",
      "Failed_Expense_vod__c",
    ].map((source) => ({
      source,
      target: `${source.replace(/_vod__c$/, "").toLowerCase()}__v`,
      transform: "number",
      required: "n" as const,
      evidence: "OBS" as const,
      sourceType: "currency" as const,
      notes:
        "*_corpv__sys computed post-load (postLoad.updateCorporateCurrency)",
    })),
    // --- booleans
    ...[
      "Attendee_Reconciliation_Complete_vod__c",
      "Publish_Event_vod__c",
      "QR_Sign_In_Enabled_vod__c",
      "Meal_Optin_For_QR_Signin_vod__c",
    ].map((source) => ({
      source,
      target: `${source.replace(/_vod__c$/, "").toLowerCase()}__v`,
      transform: "bool",
      required: "n" as const,
      evidence: "OBS" as const,
      sourceType: "boolean" as const,
    })),
    // --- attendee-field configuration blobs
    ...[
      "Account_Attendee_Fields_vod__c",
      "Contact_Attendee_Fields_vod__c",
      "User_Attendee_Fields_vod__c",
      "Walk_In_Fields_vod__c",
      "Prescriber_Walk_In_Fields_vod__c",
      "Non_Prescriber_Walk_In_Fields_vod__c",
      "Other_Walk_In_Fields_vod__c",
      "Online_Registration_Fields_vod__c",
    ].map((source) => ({
      source,
      target: `${source.replace(/_vod__c$/, "").toLowerCase()}__v`,
      transform: "longtext",
      required: "n" as const,
      evidence: "OBS" as const,
      notes: "config blob, verbatim",
    })),
    // --- newer fields (targets OBS; source names confirmed via describe)
    {
      source: "Event_Format_vod__c",
      target: "event_format__v",
      transform: "picklist(em_event.eventFormat)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      countryConfigurable: true,
    },
    {
      source: "Meal_Type_vod__c",
      target: "meal_type__v",
      transform: "picklist(em_event.mealType)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      countryConfigurable: true,
    },
    text("Event_Identifier_vod__c", "event_identifier__v", {
      unverifiedSource: true,
    }),
    {
      source: "Program_Type_vod__c",
      target: "program_type__v",
      transform: "picklist(em_event.programType)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      countryConfigurable: true,
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    {
      source: "Account_vod__c",
      target: "account__v",
      transform: "ref(account)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    text("Registration_URL_vod__c", "registration_url__v", {
      unverifiedSource: true,
    }),
    text("Sign_In_URL_vod__c", "sign_in_url__v", { unverifiedSource: true }),
    {
      source: "Key_Contact_vod__c",
      target: "key_contact__v",
      transform: "refUser",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    text("Key_Contact_Name_vod__c", "key_contact_name__v", {
      unverifiedSource: true,
    }),
    text("Key_Contact_Email_vod__c", "key_contact_email__v", {
      unverifiedSource: true,
    }),
    text("Key_Contact_Phone_vod__c", "key_contact_phone__v", {
      unverifiedSource: true,
    }),
    {
      source: "Location_Type_vod__c",
      target: "location_type__v",
      transform: "picklist(em_event.locationType)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      countryConfigurable: true,
    },
    {
      source: "Country_User_vod__c",
      target: "country_user__v",
      transform: "refUser",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    {
      source: "Assigned_Host_vod__c",
      target: "assigned_host__v",
      transform: "refUser",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      sourceType: "reference",
    },
    text("AV_Equipment_vod__c", "av_equipment__v", { unverifiedSource: true }),
    text("Content_Length_vod__c", "content_length__v", {
      unverifiedSource: true,
    }),
    {
      source: "Vault_External_Id_vod__c",
      target: "vault_external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    },
    text("Vault_Binder_Path_vod__c", "vault_binder_path__v", {
      unverifiedSource: true,
    }),
    {
      source: "Engage_Webinar_vod__c",
      target: "engage_webinar__v",
      transform: "bool",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
    },
    {
      source: "Cvent_Event_Id_vod__c",
      target: "cvent_event_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "Cvent_* family — further columns via objects.em_event.fields.add",
    },
    {
      source: "External_Id_ON24_vod__c",
      target: "external_id_on24__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes:
        "*_ON24_* family — further columns via objects.em_event.fields.add",
    },
    // --- newer (2): business classification picklists (targets [UNV])
    {
      source: "Event_Type_vod__c",
      target: "event_type__v",
      transform: "picklist(em_event.eventType)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      countryConfigurable: true,
      notes:
        "business classification, distinct from object_type__v — never used for the object-type crosswalk; loaded only when the target field exists",
    },
    {
      source: "Virtual_Event_Type_vod__c",
      target: "virtual_event_type__v",
      transform: "picklist(em_event.virtualEventType)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      countryConfigurable: true,
    },
    // --- owner (observed on em_event__v)
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "OBS",
      notes: "queue owners → §3.4",
    },
  ],
  picklists: {
    "em_event.status": { ...EM_EVENT_STATUS },
    "em_event.cancellationReason": {},
    "em_event.eventFormat": {},
    "em_event.mealType": {},
    "em_event.programType": {},
    "em_event.locationType": {},
    "em_event.eventType": {},
    "em_event.virtualEventType": {},
    "em_event.timeZone": {},
  },
  deletePolicy: "ignore",
  // §4.4: when deletePolicy is overridden to `inactivate`, status__v = inactive__v only
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id", evidence: "OBS" },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
    },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "OBS",
    },
    {
      method: "natural_key",
      keys: [{ target: "stub_sfdc_id__v", source: "Stub_SFDC_Id_vod__c" }],
      evidence: "OBS",
      notes: "stub events created from the mobile app (§3.3)",
    },
  ],
  configObjects: ["em_event_configuration"],
  custom: {
    emEventLocalTimes,
    eventConfiguration,
    vendorRefDropped,
    eventCountryFallback,
    eventStage,
  },
  optionDefaults: {
    configurationMap: false,
    stageMap: false,
    ownerTimezoneLookup: false,
  },
  notes:
    "ToV family (§6.3.22): dated on Start_Time_vod__c ∨ open (End_Time ≥ cutoff / status ∉ closed,cancelled), widened by scope.tovRetentionMonths. Parents before children (partitionBy Parent_Event_vod__c), parent_event__v patched in pass 2. Lifecycled: em_event_status__v + state__v from Status_vod__c; stage__v only via objects.em_event.stageMap. vendor__v omitted (EM_VENDOR_REF_DROPPED); event_configuration__v via objects.em_event.configurationMap / External_ID / Name. Deleted rows ignored on the target (§4.4).",
});
