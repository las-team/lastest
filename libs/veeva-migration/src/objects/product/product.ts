/**
 * `product` — `Product_vod__c` → `product__v` (spec §6.3.5, §6.1 step 3,
 * §6.2, §3.3, §3.4, §4.4).
 *
 * The product hierarchy is loaded **by depth** of `Parent_Product_vod__c`
 * (Detail Group ← Detail ← Sample/Order/BRC/Kit Item; `depthOrderBy`, BFS by
 * the extractor) so a child is matched/created only after its parent (§3.4).
 * `parent_product__v` is `ref(product) secondPass` — the same shape as
 * `territory.parent_territory__v`: the value is held back from the pass-1
 * payload and patched by Vault id in pass 2 (`selfRefs`, §6.1 step 3), and a
 * parent still missing then is queued as `pending_fk` (§3.5). A plain
 * `ref(product)` must stay visible to FK discovery: the §2.2 step 5 closure
 * (`mappingFkColumns`), the preflight FK checks (`classifyRow`,
 * `VT_FK_TARGET_MISMATCH`) and the `MAP_SELFREF_NOT_REF` lint all read
 * `refTarget()`, which a `custom(...)` transform would hide — that is why the
 * parent is not a custom function even though depth ordering would let most
 * rows resolve in pass 1.
 *
 * `product_type__v` value names are `[UNV]`: Veeva CRM stores plain English
 * (`Detail`, `Sample`, `Detail Group`, …); the module defaults derive the
 * expected `detail__v`, `sample__v`, `detail_group__v`, … and preflight
 * resolves the real names from the target picklist by label match. Every
 * default is overridable through `picklists.maps["product.productType"]`.
 *
 * `require_discussion__v` is a picklist (`no__v` / `yes__v`) or a boolean
 * depending on the target metadata — `custom(requireDiscussion)` decides per
 * `targetField.type`.
 *
 * Country/market scoping: `Product_vod__c` carries a country/market field in
 * some orgs only (`Country_vod__c`, `Market_vod__c`, customer field). The row
 * defaults to `Country_vod__c` (`optionalSource` + `unverifiedSource`: a
 * describe miss is `info` and the row is dropped); orgs that use another
 * column override the source through the `objects.product.fields` overlay.
 * When present it drives the `(name, type, country)` natural key.
 *
 * Inactivation (§4.4): `status__v = inactive__v` (implied) **and**
 * `active__v = false`; the Block S `status__v` row derives from
 * `Active_vod__c = false` (§6.0.4).
 */
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn } from "../../types";
import { defineObject } from "../types";

/** Blob name of the thumbnail (`objects.product.blobs.thumbnail`, §8.6). */
export const PRODUCT_THUMBNAIL_BLOB = "thumbnail";

/** Self-parent column used for depth ordering (BFS) and the pass-2 fallback. */
export const PRODUCT_PARENT_FIELD = "Parent_Product_vod__c";

/**
 * Plain-English `Product_Type_vod__c` values known in Veeva CRM (§6.3.5) →
 * expected `product_type__v` names `[UNV]` (mechanical rule of §6.0.2:
 * lowercase, `[^a-z0-9]+` → `_`, `+ __v`). Preflight validates each against
 * the target picklist by label and reports `VT_PICKLIST_VALUE_MISSING`.
 */
export const PRODUCT_TYPE_DEFAULTS: Record<string, string> = {
  Detail: "detail__v",
  Sample: "sample__v",
  "Detail Group": "detail_group__v",
  "Detail Topic": "detail_topic__v",
  "Alternative Sample": "alternative_sample__v",
  "High Value Promotional": "high_value_promotional__v",
  "Promotional & Educational Item": "promotional_educational_item__v",
  Order: "order__v",
  BRC: "brc__v",
  "Kit Item": "kit_item__v",
  Market: "market__v",
  Submarket: "submarket__v",
  "Product Group": "product_group__v",
  "Sample Product Group": "sample_product_group__v",
  "Inventory Monitoring": "inventory_monitoring__v",
  Vouchers: "vouchers__v",
  "Medical Letters": "medical_letters__v",
  Literature: "literature__v",
  Reprint: "reprint__v",
  Brand: "brand__v",
  "Therapeutic Area": "therapeutic_area__v",
};

/** Boolean `Product_vod__c` flags mapped 1:1 to `<name>__v` (§6.3.5 boolean row). */
export const PRODUCT_BOOLEAN_FIELDS = [
  "Company_Product_vod__c",
  "Controlled_Substance_vod__c",
  "Cold_Chain_vod__c",
  "Restricted_vod__c",
  "Bundle_Pack_vod__c",
  "Inventory_Monitoring_vod__c",
  "No_Details_vod__c",
  "No_Metrics_vod__c",
  "No_Cycle_Plans_vod__c",
  "Require_Key_Message_vod__c",
  "User_Aligned_vod__c",
  "Sample_Quantity_Bound_vod__c",
  "Pricing_Bound_vod__c",
  "Pricing_Rule_Quantity_Bound_vod__c",
  "Create_Lot_Catalog_vod__c",
] as const;

/** `Company_Product_vod__c` → `company_product__v` (§6.0.2 field rule). */
export function renameProductFlag(source: string): string {
  return `${source.replace(/__c$/i, "").replace(/_vod$/i, "").toLowerCase()}__v`;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `require_discussion__v`: `{No_vod, Yes_vod}` → boolean when the target is a
 * Boolean field, else the `product.requireDiscussion` picklist crosswalk
 * (`no__v` / `yes__v`). Unknown target metadata → picklist.
 */
export const requireDiscussion: CustomTransformFn = (value, row, ctx) => {
  if (isEmpty(value)) return undefined;
  if (ctx.targetField?.type === "boolean") {
    const s = String(value).trim().toLowerCase();
    if (s === "yes_vod" || s === "yes" || s === "true" || s === "1")
      return true;
    if (s === "no_vod" || s === "no" || s === "false" || s === "0")
      return false;
    return {
      omit: true,
      diagnostic: {
        kind: "invalid_value",
        field: ctx.field.target,
        value: String(value),
        code: "INVALID_BOOLEAN",
      },
    };
  }
  return applyTransform(
    { kind: "picklist", mapKey: "product.requireDiscussion" },
    value,
    row,
    ctx,
  );
};

export const product = defineObject({
  key: "product",
  source: "Product_vod__c",
  target: "product__v",
  targetEvidence: "OBS",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: [],
  selfRefs: [{ target: "parent_product__v", source: PRODUCT_PARENT_FIELD }],
  depthOrderBy: PRODUCT_PARENT_FIELD,
  blockS: {
    currency: true,
    statusFromFlag: {
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    },
  },
  fields: [
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "OBS",
      sourceType: "string",
      disabledBy: "preserveName",
      notes: "natural key with type (§3.4)",
    },
    {
      source: "Product_Type_vod__c",
      target: "product_type__v",
      transform: "picklist(product.productType)",
      required: "y?",
      evidence: "DOC",
      sourceType: "picklist",
      notes:
        "field DOC / value names UNV (plain English in CRM; resolved by label at preflight)",
    },
    {
      source: PRODUCT_PARENT_FIELD,
      target: "parent_product__v",
      transform: "ref(product) secondPass",
      required: "n",
      evidence: "DOC",
      sourceType: "reference",
      notes:
        "depth-ordered (parent matched first, §3.4); patched by id in pass 2 (§6.1 step 3) — a visible ref so closure/preflight see the self-FK",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "OBS",
      sourceType: "string",
      notes:
        "EXTID, not unique in META; match key when populated; not the idParam unless unique in target; integration-owned (§3.2 step 4)",
    },
    {
      source: "VExternal_Id_vod__c",
      target: "vexternal_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "EXTID unique; PromoMats-synced products already exist — match",
    },
    {
      source: "Master_Align_Id_vod__c",
      target: "master_align_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
    },
    {
      source: "Product_Identifier_vod__c",
      target: "product_identifier__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
    },
    {
      source: "Manufacturer_vod__c",
      target: "manufacturer__v",
      transform: "picklist(product.manufacturer)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Therapeutic_Area_vod__c",
      target: "therapeutic_area__v",
      transform: "picklist(product.therapeuticArea)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
      notes: "controlling field of the dependent pair",
    },
    {
      source: "Therapeutic_Class_vod__c",
      target: "therapeutic_class__v",
      transform: "picklist(product.therapeuticClass)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
      notes:
        "dependent on Therapeutic_Area_vod__c — pair validated at preflight or loaded in migration mode",
    },
    ...PRODUCT_BOOLEAN_FIELDS.map((source) => ({
      source,
      target: renameProductFlag(source),
      transform: "bool",
      required: "n" as const,
      evidence: "UNV" as const,
      sourceType: "boolean" as const,
    })),
    {
      source: "Active_vod__c",
      target: "active__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      notes:
        "business flag written in addition to status__v (§4.4 / §6.0.4); also the source of the Block S status__v derivation",
    },
    {
      source: "Require_Discussion_vod__c",
      target: "require_discussion__v",
      transform: "custom(requireDiscussion)",
      required: "n",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{No_vod, Yes_vod} → picklist (no__v/yes__v) or bool per target type",
    },
    {
      source: "Schedule_vod__c",
      target: "schedule__v",
      transform: "text(10)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "string",
      notes: "US controlled-substance schedule",
    },
    {
      source: "Restricted_States_vod__c",
      target: "restricted_states__v",
      transform: "text(100)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "string",
      notes: "US controlled-substance schedule",
    },
    {
      source: "Sample_U_M_vod__c",
      target: "sample_u_m__v",
      transform: "picklist(product.sampleUM)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Sample_Quantity_Picklist_vod__c",
      target: "sample_quantity_picklist__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "textarea",
    },
    {
      source: "Quantity_Per_Case_vod__c",
      target: "quantity_per_case__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "double",
    },
    {
      source: "Inventory_Quantity_Per_Case_vod__c",
      target: "inventory_quantity_per_case__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "double",
    },
    {
      source: "Inventory_Order_UOM_vod__c",
      target: "inventory_order_uom__v",
      transform: "picklist(product.inventoryOrderUom)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      sourceType: "picklist",
    },
    {
      source: "Product_Value_vod__c",
      target: "product_value__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "currency",
      notes:
        "currency amount; local_currency__sys from CurrencyIsoCode (Block S)",
    },
    {
      source: "Cost_vod__c",
      target: "cost__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "currency",
      notes:
        "currency amount; local_currency__sys from CurrencyIsoCode (Block S)",
    },
    {
      source: "Display_Order_vod__c",
      target: "display_order__v",
      transform: "number",
      required: "n",
      evidence: "UNV",
      sourceType: "double",
    },
    {
      source: "Sort_Code_vod__c",
      target: "sort_code__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
    },
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
    },
    {
      source: "Distributor_vod__c",
      target: "distributor__v",
      transform: "text",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
    },
    {
      source: "Product_Thumbnail_vod__c",
      target: "product_thumbnail__v",
      transform: `deferredBlob(${PRODUCT_THUMBNAIL_BLOB})`,
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
      blobName: PRODUCT_THUMBNAIL_BLOB,
      notes: "longtext 32000; loaded in the blob pass (§8.6)",
    },
    {
      source: "No_Promo_Items_vod__c",
      target: "no_promo_items__v",
      transform: "skip",
      required: "-",
      notes: "formula — Vault recomputes",
    },
    {
      source: "zvod_Custom_Text_vod__c",
      target: "zvod_custom_text__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* layout marker — never loaded",
    },
    {
      source: "Country_vod__c",
      target: "country__v",
      transform: "country(ref)",
      required: "n",
      evidence: "UNV",
      countryConfigurable: true,
      optionalSource: true,
      unverifiedSource: true,
      sourceType: "reference",
      notes:
        "country/market scoping — customer field (Country_vod__c / Market_vod__c) when present; override the source via objects.product.fields; drives the (name, type, country) natural key",
    },
  ],
  picklists: {
    "product.productType": { ...PRODUCT_TYPE_DEFAULTS },
    "product.requireDiscussion": { No_vod: "no__v", Yes_vod: "yes__v" },
    "product.manufacturer": {},
    "product.therapeuticArea": {},
    "product.therapeuticClass": {},
    "product.sampleUM": {},
    "product.inventoryOrderUom": {},
  },
  deletePolicy: "inactivate",
  inactivate: [{ field: "active__v", value: false }],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    {
      method: "legacy_id",
      evidence: "UNV",
      notes: "implicit — the upsert idParam (§3.2)",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "OBS",
      notes: "when populated; External_ID_vod__c is not unique in META",
    },
    {
      method: "external_id",
      keys: [{ target: "vexternal_id__v", source: "VExternal_Id_vod__c" }],
      evidence: "UNV",
      notes:
        "PromoMats-synced products (product__v.vexternal_id__v [UNVERIFIED])",
    },
    {
      method: "name_type",
      keys: [
        { target: "name__v", source: "Name" },
        {
          target: "product_type__v",
          source: "Product_Type_vod__c",
          transform: { kind: "picklist", mapKey: "product.productType" },
        },
      ],
      sameCountry: true,
      evidence: "OBS",
      notes:
        "(name__v, product_type__v) + same country/market; parent matched first (depth order)",
    },
  ],
  blobs: { [PRODUCT_THUMBNAIL_BLOB]: "optional" },
  custom: { requireDiscussion },
  notes:
    "Depth-ordered by Parent_Product_vod__c (BFS; parent_product__v patched in pass 2); (name, type[, country]) natural key; deletePolicy inactivate → status__v = inactive__v + active__v = false; product_type__v value names UNV (resolved by label at preflight).",
});
