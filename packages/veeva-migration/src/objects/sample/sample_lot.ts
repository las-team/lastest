/**
 * `sample_lot` — `Sample_Lot_vod__c` → `sample_lot__v` (spec §6.3.18, §6.1
 * step 9, §6.2, §3.3, §4.4, §6.3.35).
 *
 * Master data of the samples family: full scope, attributed to the owning
 * rep's country (`user:OwnerId`), loaded with `noTriggers = true` (§6.2) so
 * the Vault CRM lot triggers do not touch inventory while history is loaded.
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `active__v = false`; the Block S `status__v` row derives from
 * `Active_vod__c = false` (§6.0.4, disable with
 * `objects.sample_lot.statusFromFlag = false`).
 *
 * `Calculated_Quantity_vod__c` is a roll-up that Vault recomputes
 * (`calculated_quantity__v`), so nothing is loaded — but the source value is
 * **extracted anyway** as the expected roll-up for the post-load verification
 * of §6.3.35 (`noTriggersVerify`). A `skip` row would not select the column
 * (the extractor ignores `skip` sources), so the row is `custom(expectedRollup)`:
 * it never emits a payload value and instead records a non-fatal `custom`
 * diagnostic (`SAMPLE_LOT_EXPECTED_ROLLUP`) carrying the number, which the
 * reconciler reads into `reconciliation.extra`. `readExpectedRollup(row)` is
 * the pure reader for callers that hold the source row.
 *
 * `lot_catalog__v` (a new Vault object) is not loaded in v1 (open question
 * §9) — it has no SFDC source and therefore no mapping row.
 */
import type {
  CustomTransformFn,
  RowDiagnostic,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";

/** Source of the expected roll-up (§6.3.18 / §6.3.35 verification). */
export const SAMPLE_LOT_ROLLUP_SOURCE = "Calculated_Quantity_vod__c";
/** Diagnostic code that carries the expected roll-up of a lot row. */
export const SAMPLE_LOT_EXPECTED_ROLLUP_CODE = "SAMPLE_LOT_EXPECTED_ROLLUP";

/** `U_M_vod__c` default crosswalk (plain-English values → derived names, all `[UNV]`). */
export const SAMPLE_LOT_UM_DEFAULTS: Record<string, string> = {
  Cases: "cases__v",
  Box: "box__v",
  Unit: "unit__v",
  Wallet: "wallet__v",
  Blister: "blister__v",
  Syringe: "syringe__v",
};

/**
 * Parse the SFDC roll-up value of a lot row (`Calculated_Quantity_vod__c`).
 * Returns `undefined` when absent or not numeric. Pure.
 */
export function readExpectedRollup(row: SourceRow): number | undefined {
  const raw = row[SAMPLE_LOT_ROLLUP_SOURCE];
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `custom(expectedRollup)`: never loads a value; records the expected roll-up
 * as a non-fatal diagnostic so the column is extracted and the number reaches
 * reconciliation (§6.3.18 "extracted anyway", §6.3.35 `noTriggersVerify`).
 */
export const expectedRollup: CustomTransformFn = (
  _value,
  row,
  ctx,
): TransformResult => {
  const n = readExpectedRollup(row);
  if (n === undefined) return { omit: true };
  const diagnostic: RowDiagnostic = {
    kind: "custom",
    field: ctx.field.target,
    code: SAMPLE_LOT_EXPECTED_ROLLUP_CODE,
    value: String(n),
    detail: "expected calculated_quantity__v roll-up (not loaded)",
  };
  return { omit: true, diagnostic };
};

export const sample_lot = defineObject({
  key: "sample_lot",
  source: "Sample_Lot_vod__c",
  target: "sample_lot__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "user:OwnerId",
  dependsOn: ["product", "user"],
  blockS: {
    // §6.0.4: master-data objects with `Active_vod__c` derive the platform status
    statusFromFlag: {
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    },
  },
  fields: [
    // --- §6.3.18 rows (same-target rows replace Block S defaults)
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "DOC",
      disabledBy: "preserveName",
      notes: "lot number",
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "Y",
      evidence: "DOC",
      sourceType: "reference",
    },
    {
      source: "Sample_vod__c",
      target: "sample__v",
      transform: "text(100)",
      required: "Y",
      evidence: "DOC",
      notes: "product name; Vault stamps from product — loaded verbatim",
    },
    {
      source: "Sample_Lot_Id_vod__c",
      target: "sample_lot_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      notes: "EXTID unique 200; match key (§3.3)",
    },
    {
      source: "Expiration_Date_vod__c",
      target: "expiration_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      sourceType: "date",
    },
    {
      source: "Active_vod__c",
      target: "active__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      notes: "inactivate-delete target (§4.4)",
    },
    {
      source: "Suppress_Lot_vod__c",
      target: "suppress_lot__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Allocated_Quantity_vod__c",
      target: "allocated_quantity__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
    },
    {
      source: "U_M_vod__c",
      target: "u_m__v",
      transform: "picklist(sample_lot.um)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      notes: "{Cases, Box, Unit, Wallet, Blister, Syringe}",
    },
    {
      source: "Batch_Lot_Id_vod__c",
      target: "batch_lot_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      notes: "newer field — confirmed via describe",
    },
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      notes: "rep; queue owners → §3.4",
    },
    {
      source: SAMPLE_LOT_ROLLUP_SOURCE,
      target: "calculated_quantity__v",
      transform: "custom(expectedRollup)",
      required: "-",
      evidence: "DOC",
      notes:
        "roll-up — Vault computes calculated_quantity__v; never loaded, extracted as the expected roll-up for §6.3.35 verification (reconciliation.extra)",
    },
  ],
  picklists: {
    "sample_lot.um": { ...SAMPLE_LOT_UM_DEFAULTS },
  },
  deletePolicy: "inactivate",
  inactivate: [{ field: "active__v", value: false }],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    {
      method: "external_id",
      keys: [{ target: "sample_lot_id__v", source: "Sample_Lot_Id_vod__c" }],
      evidence: "UNV",
      notes: "sample_lot_id__v = Sample_Lot_Id_vod__c (unique)",
    },
    { method: "legacy_id" },
    {
      method: "natural_key",
      keys: [
        { target: "name__v", source: "Name" },
        { target: "product__v", source: "Product_vod__c" },
        { target: "ownerid__v", source: "OwnerId" },
      ],
      sameCountry: true,
      notes:
        "(name__v, product__v, ownerid__v) — reported as warning with counts",
    },
  ],
  custom: { expectedRollup },
  notes:
    "Samples master data (§6.3.18). Load flags follow objects.sample_transaction.load.sampleStrategy jointly with the family (§6.3.35). lot_catalog__v not loaded in v1 (§9).",
});
