/**
 * `product_group` — `Product_Group_vod__c` → `product_group__v` (spec §6.3.6,
 * §6.1 step 3, §6.2, §3.3, §4.4).
 *
 * The target object name is `[UNV]` (mechanical rename); preflight confirms
 * it. Pure association row between a product and its detail group
 * (`product__v`, `detail_group__v`, both required references to `product__v`)
 * — loaded after `product`, deleted with `deletePolicy = delete` (§4.4 "pure
 * child rows"). An unresolved required parent holds the row as `pending_fk`
 * (§3.5).
 *
 * Matching (§3.3): id map → legacy-id field → `(product__v, detail_group__v)`
 * pair.
 */
import { defineObject } from "../types";

export const product_group = defineObject({
  key: "product_group",
  source: "Product_Group_vod__c",
  target: "product_group__v",
  targetEvidence: "UNV",
  scope: { kind: "full" },
  countryOf: "global",
  dependsOn: ["product"],
  fields: [
    {
      source: "Product_vod__c",
      target: "product__v",
      transform: "ref(product)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Detail_Group_vod__c",
      target: "detail_group__v",
      transform: "ref(product)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text",
      required: "Y",
      evidence: "UNV",
      sourceType: "string",
      disabledBy: "preserveName",
    },
    {
      source: "External_ID_vod__c",
      target: "external_id__v",
      transform: "copy",
      required: "n",
      evidence: "UNV",
      sourceType: "string",
      optionalSource: true,
      notes: "never overwrite an integration-owned value (§3.2 step 4)",
    },
  ],
  picklists: {},
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id", evidence: "UNV" },
    {
      method: "natural_key",
      keys: [
        {
          target: "product__v",
          source: "Product_vod__c",
          transform: { kind: "ref", objectKey: "product" },
        },
        {
          target: "detail_group__v",
          source: "Detail_Group_vod__c",
          transform: { kind: "ref", objectKey: "product" },
        },
      ],
      evidence: "UNV",
      notes: "(product__v, detail_group__v) pair via VQL",
    },
  ],
  notes:
    "Association of a product with its detail group; loaded after product (§6.1 step 3); deletePolicy delete (§4.4 pure child rows); status__v = inactive__v only when inactivated by override.",
});
