/**
 * `order_line` — `Order_Line_vod__c` → `order_line__v` `[DOC]` (spec §6.3.39,
 * §6.1 step 19, §6.2, §3.3, §4.4).
 *
 * Master-detail child of `order`: scoped through the parent's
 * `Order_vod__r.Order_Date_vod__c` (2y, plus the parent's open-item term),
 * country of the parent order, `noTriggers = true`, deleted with the parent
 * (`deletePolicy = delete`, §4.4). `Name` is an auto-number (§6.0.4) —
 * carried only with `objects.order_line.preserveAutoNumberName`.
 *
 * `Product_Group_vod__c` is a lookup to **Product** (the detail-group product
 * row), so the default transform is `ref(product)`. When the target field
 * `product_group__v` references `product_group__v` instead, the transform
 * switches to `ref(product_group)` (resolved through the
 * `(product__v, detail_group__v)` pair by the product_group module's match
 * rule) — `custom(productGroupRef)` reads the resolved target metadata and
 * reports the switch as an `info`-level `FK_TARGET_SWITCHED` diagnostic.
 *
 * Amount fields are currency fields → Block S `CurrencyIsoCode →
 * local_currency__sys` is enabled.
 */
import { applyTransform } from "../../transform/registry";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const ORDER_LINE_ORDER_FIELD = "Order_vod__c";
export const ORDER_LINE_PRODUCT_FIELD = "Product_vod__c";
export const ORDER_LINE_PRODUCT_GROUP_FIELD = "Product_Group_vod__c";
export const ORDER_LINE_PRODUCT_GROUP_TARGET = "product_group__v";

export const FK_TARGET_SWITCHED_CODE = "FK_TARGET_SWITCHED";

/** `U_M_vod__c` → `u_m__v` (`[UNV]`, country-configurable). */
export const ORDER_LINE_UM: Record<string, string> = {
  Cases: "cases__v",
  Boxes: "boxes__v",
  Units: "units__v",
};

// ---------------------------------------------------------------------------
// custom transforms (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(productGroupRef)`: `ref(product)` by default (§6.3.39 — the
 * detail-group *product* row); `ref(product_group)` when the resolved target
 * field references `product_group__v` (`info FK_TARGET_SWITCHED`).
 */
export const productGroupRef: CustomTransformFn = (
  value,
  row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const referenced = ctx.targetField?.referenceObject;
  if (referenced === "product_group__v") {
    const r = applyTransform(
      { kind: "ref", objectKey: "product_group" },
      value,
      row,
      ctx,
    );
    if (r.diagnostic) return r;
    return {
      ...r,
      diagnostic: {
        kind: "custom",
        field: ctx.field.target,
        code: FK_TARGET_SWITCHED_CODE,
        detail: `${ctx.field.target} references product_group__v — resolved as ref(product_group) instead of ref(product)`,
      },
    };
  }
  return applyTransform({ kind: "ref", objectKey: "product" }, value, row, ctx);
};

// ---------------------------------------------------------------------------
// module
// ---------------------------------------------------------------------------

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

const unv = (
  source: string,
  target: string,
  transform: string,
  extra: Partial<RowInput> = {},
): RowInput => ({
  source,
  target,
  transform,
  required: "n",
  evidence: "UNV",
  ...extra,
});

/** Wildcard groups of §6.3.39 (`List_Price_*`, `Net_Price_*`, `*_Discount_vod__c`, `Payment_*`) expanded to the usual column names; org-specific → describe miss is `info`. */
export const ORDER_LINE_WILDCARD_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
  transform: "number" | "text";
}> = [
  {
    source: "List_Price_Rule_vod__c",
    target: "list_price_rule__v",
    transform: "text",
  },
  {
    source: "Net_Price_Rule_vod__c",
    target: "net_price_rule__v",
    transform: "text",
  },
  { source: "Discount_vod__c", target: "discount__v", transform: "number" },
  {
    source: "Discount_Amount_vod__c",
    target: "discount_amount__v",
    transform: "number",
  },
  {
    source: "Free_Goods_Discount_vod__c",
    target: "free_goods_discount__v",
    transform: "number",
  },
  {
    source: "Payment_Terms_vod__c",
    target: "payment_terms__v",
    transform: "text",
  },
  {
    source: "Payment_Amount_vod__c",
    target: "payment_amount__v",
    transform: "number",
  },
];

export const order_line = defineObject({
  key: "order_line",
  source: "Order_Line_vod__c",
  target: "order_line__v",
  targetEvidence: "DOC",
  scope: {
    kind: "via-parent",
    parentKey: "order",
    parentField: "Order_vod__r.Order_Date_vod__c",
    type: "date",
  },
  countryOf: `parent:order:${ORDER_LINE_ORDER_FIELD}`,
  // §6.2 lists order, product; product_group is added for the `ref(product_group)`
  // switch of custom(productGroupRef) (step 3 precedes step 19, no cycle).
  dependsOn: ["order", "product", "product_group"],
  // master-detail child: auto-number Name, no OwnerId; amounts are currency fields
  blockS: { name: "autoNumber", ownerId: false, currency: true },
  fields: [
    // --- references (§6.3.39 row 1)
    {
      source: ORDER_LINE_ORDER_FIELD,
      target: "order__v",
      transform: "ref(order)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "master-detail → Order_vod__c",
    },
    {
      source: ORDER_LINE_PRODUCT_FIELD,
      target: "product__v",
      transform: "ref(product)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
    },
    {
      source: ORDER_LINE_PRODUCT_GROUP_FIELD,
      target: ORDER_LINE_PRODUCT_GROUP_TARGET,
      transform: "custom(productGroupRef)",
      required: "y?",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "ref → Product (detail-group product row) → product__v [INFER]; switches to ref(product_group) when the target references product_group__v (info FK_TARGET_SWITCHED); Y in §6.3.39 for the row group, optional in practice",
    },
    // --- quantities / prices / amounts (row 2)
    unv("Quantity_vod__c", "quantity__v", "number"),
    unv("Free_Goods_vod__c", "free_goods__v", "number"),
    unv("List_Price_vod__c", "list_price__v", "number"),
    unv("Net_Price_vod__c", "net_price__v", "number"),
    unv("Net_Amount_vod__c", "net_amount__v", "number"),
    unv("List_Amount_vod__c", "list_amount__v", "number"),
    ...ORDER_LINE_WILDCARD_FIELDS.map((f) =>
      unv(f.source, f.target, f.transform, {
        unverifiedSource: true,
        optionalSource: true,
        notes:
          "§6.3.39 wildcard group — org-specific column, confirm via describe",
      }),
    ),
    unv("U_M_vod__c", "u_m__v", "picklist(order_line.um)", {
      countryConfigurable: true,
      sourceType: "picklist",
      notes: "{Cases, Boxes, Units}",
    }),
    unv("Product_Identifier_vod__c", "product_identifier__v", "text"),
    // --- skipped (row 3)
    {
      source: "Delivery_Quantity_vod__c",
      target: "delivery_quantity__v",
      transform: "skip",
      required: "-",
      notes: "formula — Vault recomputes",
    },
  ],
  picklists: {
    "order_line.um": { ...ORDER_LINE_UM },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  custom: { productGroupRef },
  notes:
    "Order lines (§6.3.39): master-detail child of order, scoped and attributed through the parent; product_group__v = ref(product) with an automatic switch to ref(product_group); deleted with the parent (§4.4).",
});
