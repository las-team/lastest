/**
 * `sample_inventory_item` — `Sample_Inventory_Item_vod__c` →
 * `sample_inventory_item__v` (spec §6.3.37, §6.1 step 18, §6.2, §3.3, §4.4).
 *
 * Pure child of `sample_inventory` (master-detail): scoped through the
 * parent's `Inventory_Date_Time_vod__c`, attributed to the parent's country,
 * deleted with the parent (`delete`), loaded with `noTriggers = true`.
 *
 * Source evidence is thin (sfdc-extract.md §10 #3): only the master-detail
 * `Sample_Inventory_vod__c` is `[META-implied]`; `Quantity_vod__c`,
 * `Product_vod__c` and `Name` are `[UNVERIFIED-SOURCE]` (`unverifiedSource`
 * → a describe miss is `info`, row dropped).
 *
 * The lot lookup is a plain `ref(sample_lot)` row so that FK id-set
 * collection (§2.2 step 4), closure and preflight's FK classification all
 * see a real reference. Its name is `[UNVERIFIED-SOURCE]` too (`Lot_vod__c`
 * **or** `Sample_Lot_vod__c`), but it is deliberately **not** tagged
 * `unverifiedSource`: the target is a required master-detail reference, and
 * an `info` + drop would load every item without its lot (or have Vault
 * reject it). A describe miss is therefore **blocking** `SF_FIELD_MISSING`
 * until preflight resolves the lookup per §6.3.37 — "*the* reference field
 * whose `referenceTo = Sample_Lot_vod__c` regardless of name" —
 * `resolveLotLookupField(describe.fields)` is the pure rule for that step
 * and rewrites the row's `source`. Meanwhile an org whose lookup is named
 * differently overrides the row explicitly:
 * `objects.sample_inventory_item.fields.override:
 *   [{ source: Sample_Lot_vod__c, target: lot__v, transform: ref(sample_lot) }]`.
 *
 * `product` is added to `dependsOn` (beyond the §6.2 pair
 * `sample_inventory, sample_lot`) because the table maps `product__v`.
 */
import type { SfdcFieldDescribe } from "../../types";
import { defineObject } from "../types";

/** SFDC object the lot lookup must reference (§6.3.37 resolution rule). */
export const SAMPLE_INVENTORY_ITEM_LOT_REFERENCE = "Sample_Lot_vod__c";

/** Candidate SFDC lookup names for the lot (§6.3.37), in preference order. */
export const SAMPLE_INVENTORY_ITEM_LOT_FIELDS: readonly string[] = [
  "Lot_vod__c",
  "Sample_Lot_vod__c",
];

/**
 * §6.3.37: the lot lookup of `Sample_Inventory_Item_vod__c` is *the*
 * reference field whose `referenceTo` contains `Sample_Lot_vod__c`,
 * regardless of its name. Returns that field's name, preferring the known
 * candidates (in order) when the org has several such lookups, and
 * `undefined` when none exists (preflight then blocks with
 * `SF_FIELD_MISSING`). Pure.
 */
export function resolveLotLookupField(
  fields: ReadonlyArray<
    Pick<SfdcFieldDescribe, "name" | "type" | "referenceTo">
  >,
): string | undefined {
  const lotRefs = fields.filter(
    (f) =>
      f.type === "reference" &&
      (f.referenceTo ?? []).includes(SAMPLE_INVENTORY_ITEM_LOT_REFERENCE),
  );
  if (lotRefs.length === 0) return undefined;
  for (const candidate of SAMPLE_INVENTORY_ITEM_LOT_FIELDS) {
    const hit = lotRefs.find(
      (f) => f.name.toLowerCase() === candidate.toLowerCase(),
    );
    if (hit) return hit.name;
  }
  return lotRefs.length === 1 ? lotRefs[0].name : undefined;
}

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
      source: SAMPLE_INVENTORY_ITEM_LOT_FIELDS[0],
      target: "lot__v",
      transform: "ref(sample_lot)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "lookup name [UNVERIFIED-SOURCE] (Lot_vod__c or Sample_Lot_vod__c) — required FK, so a describe miss is blocking, not an info drop; preflight resolves the field by referenceTo = Sample_Lot_vod__c (resolveLotLookupField) or the overlay overrides the row's source",
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
  notes:
    "Master-detail child of sample_inventory; deleted with the parent (§4.4). Sources other than the parent are [UNVERIFIED-SOURCE] (§6.3.37); the lot lookup is resolved by referenceTo at preflight.",
});
