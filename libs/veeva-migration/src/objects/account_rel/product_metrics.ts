/**
 * `product_metrics` — `Product_Metrics_vod__c` → `product_metrics__v` (spec
 * §6.3.13 `[DOC]`; §6.1 step 7, §6.2, §3.3, §4.4, §6.0.4).
 *
 * One row per (account, product) carrying the customer's metric columns
 * (`Segment__c`, `Potential__c`, … — org-specific, often dependent picklists).
 * Master-detail to `Account` (no `OwnerId`); `Name` is an auto-number in most
 * orgs (§6.0.4 → carried only with `preserveAutoNumberName`). Full scope,
 * country from the account, loaded after `tsf` with triggers on.
 *
 * The product reference is `Products_vod__c` (plural, §6.0.2 exception) →
 * `products__v` `[UNV]` with `product__v` as the §6.3.13 fallback spelling.
 * Both spellings are carried as separate `ref(product)` rows with the same
 * source (the `account` module's "whichever exists" pattern): each is `y?`
 * with `[UNV]` evidence, so preflight drops the spelling the vault does not
 * have as a `VT_FIELD_MISSING` **warning** (a `Y` row would block the object
 * instead, §5.2) and the remaining row is required exactly when the vault
 * marks the field required (which a master-detail-like product reference
 * is). The natural key (§3.3) is declared once per spelling; the matcher
 * skips the rule whose key field the target lacks. Without preflight (unit
 * contexts) both rows transform — the pruned mapping is what the run loads.
 *
 * Customer metric columns are the point of the object, so the module defaults
 * `customFields.mode = allMatching` (every source `__c` whose lower-cased name
 * exists on the target, §6.0.4); each picklist column is crosswalked through
 * `picklists.maps["product_metrics.<field>"]` per country. Override per
 * country with `objects.product_metrics.customFields`.
 *
 * Inactivation (§4.4): `status__v = inactive__v` only.
 */
import { defineObject } from "../types";

/** Master-detail parent (country-of lookup). */
export const PRODUCT_METRICS_ACCOUNT_FIELD = "Account_vod__c";
/** Plural product lookup (§6.0.2 known exception → `products__v`). */
export const PRODUCT_METRICS_PRODUCT_FIELD = "Products_vod__c";
/** Primary target of the product reference (`[UNV]`, §6.3.13). */
export const PRODUCT_METRICS_PRODUCT_TARGET = "products__v";
/** Target name when the vault carries the singular field instead (fallback row, §6.3.13). */
export const PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET = "product__v";

export const product_metrics = defineObject({
  key: "product_metrics",
  source: "Product_Metrics_vod__c",
  target: "product_metrics__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account", "product", "child_account"],
  // master-detail child of Account: auto-number Name, no OwnerId, no currency
  blockS: { name: "autoNumber", ownerId: false, currency: false },
  fields: [
    {
      source: PRODUCT_METRICS_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "master-detail; country-of lookup",
    },
    {
      source: PRODUCT_METRICS_PRODUCT_FIELD,
      target: PRODUCT_METRICS_PRODUCT_TARGET,
      transform: "ref(product)",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "plural in both systems (§6.0.2 exception); y? so a vault carrying only product__v degrades to a VT_FIELD_MISSING warning (the fallback row then carries the reference) — required whenever the target says so",
    },
    {
      source: PRODUCT_METRICS_PRODUCT_FIELD,
      target: PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET,
      transform: "ref(product)",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "§6.3.13 fallback spelling of products__v — same source; preflight drops whichever spelling the vault lacks",
    },
    {
      source: "Detail_Group_vod__c",
      target: "detail_group__v",
      transform: "ref(product)",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Location_vod__c",
      target: "location__v",
      transform: "ref(child_account)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "reference",
      notes: "child-account location of the metric",
    },
    {
      source: "Location_Parent_vod__c",
      target: "location_parent__v",
      transform: "ref(account)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "reference",
    },
    {
      source: "Location_Child_vod__c",
      target: "location_child__v",
      transform: "ref(account)",
      required: "n",
      evidence: "UNV",
      optionalSource: true,
      sourceType: "reference",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      notes: "unique 255; secondary match key",
    },
  ],
  picklists: {},
  deletePolicy: "inactivate",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        { target: "account__v", source: PRODUCT_METRICS_ACCOUNT_FIELD },
        {
          target: PRODUCT_METRICS_PRODUCT_TARGET,
          source: PRODUCT_METRICS_PRODUCT_FIELD,
        },
      ],
      evidence: "UNV",
      notes:
        "(account__v, products__v) pair via VQL (§3.3); skipped by the matcher on a vault without products__v",
    },
    {
      method: "natural_key",
      keys: [
        { target: "account__v", source: PRODUCT_METRICS_ACCOUNT_FIELD },
        {
          target: PRODUCT_METRICS_PRODUCT_FALLBACK_TARGET,
          source: PRODUCT_METRICS_PRODUCT_FIELD,
        },
      ],
      evidence: "UNV",
      notes:
        "(account__v, product__v) pair — the fallback spelling of the same key; skipped on a vault without product__v",
    },
    {
      method: "external_id",
      keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  optionDefaults: {
    customFields: { mode: "allMatching", include: [], exclude: [] },
  },
  notes:
    "Account × product metric rows; product reference carried as products__v with a product__v fallback row (preflight keeps whichever the vault has); customer metric __c columns mapped per country through customFields (default allMatching) with picklist(product_metrics.<field>) crosswalks; inactivated (status__v only) on delete (§4.4).",
});
