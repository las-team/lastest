/**
 * `em_speaker` — `EM_Speaker_vod__c` → `em_speaker__v` `[OBS]` (spec §6.3.21,
 * §6.1 step 10, §6.2, §3.3, §3.5, §4.4).
 *
 * Events-management master data: full scope, attributed to the linked
 * account's country (`countryOf: account`), depends on `account` only, loaded
 * with `noTriggers = false` (§6.2). Upserted with `idParam = external_id__v`
 * in the wild `[OBS]`; the tool keeps the legacy-id field as idParam and
 * `external_id__v` as the first match key, then the `account__v` natural key
 * (§3.3, warning-level).
 *
 * `account__v` is the required parent (`ref(account)`, `Y`) and the source of
 * `em_event_speaker.account__v`; an unresolved account makes the row
 * `pending_fk` (§3.5).
 *
 * Name fields: `First_Name_vod__c`/`Last_Name_vod__c`/`Address_vod__c` are
 * `[UNVERIFIED-SOURCE]` (targets observed, sources inferred; sfdc-extract.md
 * §10 #3). When they are absent — dropped by preflight because the org lacks
 * the column, or simply empty on the row — `first_name__v`/`last_name__v`
 * fall back to the linked account's `FirstName`/`LastName`
 * (`custom(speakerNamesFromAccount)`). The fallback rows read
 * `Account_vod__r.FirstName` / `Account_vod__r.LastName` (selected through
 * the verified `Account_vod__c` relationship) and are declared under the
 * dotted targets `first_name__v.account` / `last_name__v.account` so that
 * (a) the target stays unique per row (`MAP_DUP_TARGET`), (b) preflight
 * validates them against the base field (`outputField` strips the suffix)
 * and (c) the transform emits into the real `first_name__v`/`last_name__v`
 * column via `targetField`. The primary row always wins when it has a value.
 *
 * `Next_Year_Status_vod__c` maps to `next_year_status__v`, which was observed
 * on `em_speaker_qualification__v`, not on the speaker — `[UNV]` on
 * `em_speaker__v`, so preflight drops it when absent. The roll-up
 * `Year_To_Date_Utilization_vod__c` is skipped (Vault recomputes).
 * Qualifications (`EM_Speaker_Qualification_vod__c` → `em_speaker_qualification__v`)
 * are out of v1 (§6.2.1) and carry no row.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only (no business flag);
 * `Status_vod__c` is the business status `em_speaker_status__v` (§6.0.2).
 */
import { applyTransform } from "../../transform/registry";
import type {
  CustomTransformFn,
  RowDiagnostic,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Diagnostic code counted when a speaker name came from the account. */
export const SPEAKER_NAME_FROM_ACCOUNT_CODE = "SPEAKER_NAME_FROM_ACCOUNT";

/** Primary (speaker-level) source per base name target. */
export const SPEAKER_NAME_SOURCES: Record<
  "first_name__v" | "last_name__v",
  { own: string; account: string }
> = {
  first_name__v: {
    own: "First_Name_vod__c",
    account: "Account_vod__r.FirstName",
  },
  last_name__v: { own: "Last_Name_vod__c", account: "Account_vod__r.LastName" },
};

/** Base target of a (possibly dotted) name-fallback row target. */
export function baseNameTarget(
  target: string,
): "first_name__v" | "last_name__v" | undefined {
  const base = target.split(".")[0];
  return base === "first_name__v" || base === "last_name__v" ? base : undefined;
}

/**
 * Pure reader: the account-derived value for `first_name__v`/`last_name__v`
 * when the speaker's own field is absent or empty; `undefined` otherwise.
 */
export function speakerNameFallback(
  row: SourceRow,
  base: "first_name__v" | "last_name__v",
): string | undefined {
  const src = SPEAKER_NAME_SOURCES[base];
  if (!isEmpty(row[src.own])) return undefined;
  const v = row[src.account];
  if (isEmpty(v)) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/**
 * `custom(speakerNamesFromAccount)`: on the fallback rows
 * (`Account_vod__r.FirstName → first_name__v.account`, …) emits the account's
 * name into the base target only when the speaker's own field is absent or
 * empty; the primary `text` row wins otherwise. Non-fatal `custom`
 * diagnostic `SPEAKER_NAME_FROM_ACCOUNT` for reporting counts.
 */
export const speakerNamesFromAccount: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  const base = baseNameTarget(ctx.field.target);
  if (!base) return undefined;
  const fallback = speakerNameFallback(row, base);
  if (fallback === undefined) return undefined;
  const raw = isEmpty(value) ? fallback : value;
  const r = applyTransform({ kind: "text" }, raw, row, {
    ...ctx,
    targetField: ctx.metadata.fields[base] ?? ctx.targetField,
  });
  if ("omit" in r) return r;
  const diagnostic: RowDiagnostic = {
    kind: "custom",
    field: base,
    code: SPEAKER_NAME_FROM_ACCOUNT_CODE,
    detail: `${base} derived from the linked account (${SPEAKER_NAME_SOURCES[base].account})`,
  };
  return { ...r, targetField: base, diagnostic: r.diagnostic ?? diagnostic };
};

export const em_speaker = defineObject({
  key: "em_speaker",
  source: "EM_Speaker_vod__c",
  target: "em_speaker__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account"],
  fields: [
    // --- §6.3.21 rows (same-target rows replace the Block S defaults)
    {
      source: "Account_vod__c",
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "OBS",
      sourceType: "reference",
      notes: "source of em_event_speaker.account__v",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      disabledBy: "preserveName",
      notes:
        'sent verbatim; one org used "Last, First" — a country overlay may switch to nameTemplate(speaker)',
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
      source: "First_Name_vod__c",
      target: "first_name__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE — target observed, source inferred]",
    },
    {
      source: "Last_Name_vod__c",
      target: "last_name__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE — target observed, source inferred]",
    },
    {
      source: "Address_vod__c",
      target: "address__v",
      transform: "text",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes: "[UNVERIFIED-SOURCE — target observed, source inferred]",
    },
    {
      source: SPEAKER_NAME_SOURCES.first_name__v.account,
      target: "first_name__v.account",
      transform: "custom(speakerNamesFromAccount)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "fallback when First_Name_vod__c is absent/empty: linked account's FirstName, emitted into first_name__v (dotted target = base field for preflight)",
    },
    {
      source: SPEAKER_NAME_SOURCES.last_name__v.account,
      target: "last_name__v.account",
      transform: "custom(speakerNamesFromAccount)",
      required: "n",
      evidence: "OBS",
      optionalSource: true,
      notes:
        "fallback when Last_Name_vod__c is absent/empty: linked account's LastName, emitted into last_name__v (dotted target = base field for preflight)",
    },
    {
      source: "Status_vod__c",
      target: "em_speaker_status__v",
      transform: "picklist(em_speaker.status)",
      required: "n",
      evidence: "OBS",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE]; business status per the §6.0.2 status-field rule",
    },
    {
      source: "Next_Year_Status_vod__c",
      target: "next_year_status__v",
      transform: "picklist(em_speaker.nextYearStatus)",
      required: "n",
      evidence: "UNV",
      unverifiedSource: true,
      notes:
        "[UNVERIFIED-SOURCE]; target observed on em_speaker_qualification__v, not the speaker — [UNV on em_speaker__v], dropped by preflight when absent",
    },
    {
      source: "Year_To_Date_Utilization_vod__c",
      target: "year_to_date_utilization__v",
      transform: "skip",
      required: "-",
      evidence: "DOC",
      unverifiedSource: true,
      notes: "roll-up [UNVERIFIED-SOURCE] — Vault recomputes; never loaded",
    },
  ],
  // No documented value lists: derivation rule by default (§6.0.2); overlays add entries.
  picklists: {
    "em_speaker.status": {},
    "em_speaker.nextYearStatus": {},
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
    {
      method: "natural_key",
      keys: [{ target: "account__v", source: "Account_vod__c" }],
      sameCountry: true,
      notes:
        "account__v pair (§3.3) — one speaker per account; reported as warning with counts",
    },
  ],
  custom: { speakerNamesFromAccount },
  notes:
    "EM master data (§6.3.21): country of the linked account, full scope, inactivate on delete (status__v only). Names fall back to the account's FirstName/LastName; qualifications out of v1 (§6.2.1).",
});
