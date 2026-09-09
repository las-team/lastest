/**
 * `sample_inventory_item` — `Sample_Inventory_Item_vod__c` →
 * `sample_inventory_item__v` (spec §6.3.37, §6.1 step 18, §6.2, §3.3, §4.4).
 *
 * Pure child of `sample_inventory` (master-detail): scoped through the
 * parent's `Inventory_Date_Time_vod__c`, attributed to the parent's country,
 * deleted with the parent (`delete`), loaded with `noTriggers = true`.
 *
 * Source evidence is thin (sfdc-extract.md §10 #3): only the master-detail
 * `Sample_Inventory_vod__c` is `[META-implied]`; the lot lookup name
 * (`Lot_vod__c` **or** `Sample_Lot_vod__c`), `Quantity_vod__c`,
 * `Product_vod__c` and `Name` are `[UNVERIFIED-SOURCE]` (`unverifiedSource`
 * → a describe miss is `info`). Preflight resolves the lot lookup as *the*
 * reference field whose `referenceTo = Sample_Lot_vod__c` regardless of its
 * name and rewrites the row's source; `custom(lotRef)` additionally reads
 * the configured `objects.sample_inventory_item.lotLookupField` and both
 * candidate columns from the row, then behaves exactly like
 * `ref(sample_lot)`.
 *
 * `product` is added to `dependsOn` (beyond the §6.2 pair
 * `sample_inventory, sample_lot`) because the table maps `product__v`.
 */
import { applyTransform } from "../../transform/registry";
import type {
  CustomTransformFn,
  SourceRow,
  TransformResult,
} from "../../types";
import { defineObject } from "../types";

/** Candidate SFDC lookup names for the lot (§6.3.37), in preference order. */
export const SAMPLE_INVENTORY_ITEM_LOT_FIELDS: readonly string[] = [
  "Lot_vod__c",
  "Sample_Lot_vod__c",
];

/**
 * The lot id of a row: the configured lookup field first, then the known
 * candidate names. Returns `undefined` when none carries a value. Pure.
 */
export function readLotId(row: SourceRow, lotLookupField?: unknown): unknown {
  const candidates = [
    ...(typeof lotLookupField === "string" && lotLookupField !== ""
      ? [lotLookupField]
      : []),
    ...SAMPLE_INVENTORY_ITEM_LOT_FIELDS,
  ];
  for (const c of candidates) {
    const v = row[c];
    if (v !== null && v !== undefined && v !== "") return v;
  }
  return undefined;
}

/** `custom(lotRef)`: `ref(sample_lot)` over whichever lot lookup the org has. */
export const lotRef: CustomTransformFn = (value, row, ctx): TransformResult => {
  const empty = value === null || value === undefined || value === "";
  const id = empty ? readLotId(row, ctx.mapping.options.lotLookupField) : value;
  if (id === undefined) return { omit: true };
  return applyTransform({ kind: "ref", objectKey: "sample_lot" }, id, row, ctx);
};

export const sample_inventory_item = defineObject({
  key: "sample_inventory_item",
  source: "Sample_Inventory_Item_vod__c",
  target: "sample_inventory_item__v",
  targetEvidence: "UNV",
  scope: {
    kind: "via-parent",
    parentKey: "sample_inventory",
    parentField: "Sample_Inventory_vod__r.Inventory_Date_Time_vod__c",
    type: "datetime",
    retentionFamily: "samples",
  },
  countryOf: "parent:sample_inventory:Sample_Inventory_vod__c",
  dependsOn: ["sample_inventory", "sample_lot", "product"],
  // master-detail child: no OwnerId on the source
  blockS: { ownerId: false },
  fields: [
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      disabledBy: "preserveName",
    },
    {
      source: "Sample_Inventory_vod__c",
      target: "sample_inventory__v",
      transform: "ref(sample_inventory)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "master-detail parent [META-implied]",
    },
    {
      source: "Lot_vod__c",
      target: "lot__v",
      transform: "custom(lotRef)",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "ref(sample_lot); lookup name Lot_vod__c or Sample_Lot_vod__c — preflight resolves by referenceTo = Sample_Lot_vod__c regardless of name",
    },
    {
      source: "Quantity_vod__c",
      target: "quantity__v",
      transform: "number",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
    },
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "Y",
      evidence: "UNV",
      unverifiedSource: true,
      sourceType: "reference",
    },
  ],
  deletePolicy: "delete",
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
    },
  ],
  custom: { lotRef },
  optionDefaults: { lotLookupField: "Lot_vod__c" },
  notes:
    "Master-detail child of sample_inventory; deleted with the parent (§4.4). Sources other than the parent are [UNVERIFIED-SOURCE] (§6.3.37).",
});
