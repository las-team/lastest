/**
 * `order` — `Order_vod__c` → `order__v` `[DOC]` (spec §6.3.38, §6.1 step 19,
 * §6.2, §3.3, §3.5, §4.4).
 *
 * Dated on `Order_Date_vod__c` (2y) **or open** (status not submitted /
 * voided); country of the account; `noTriggers = true`; deleted orders are
 * ignored on the target and listed for review (§4.4). Lifecycled: the
 * business status goes to `order_status__v` and the lifecycle state to
 * `state__v` (migration mode); `allowTypeChange` defaults to `false` (§2.5.6).
 *
 * **Self-reference** `Parent_Order_vod__c → parent_order__v` is patched in
 * pass 2 (`secondPass` + `selfRefs`, §6.1 step 19).
 *
 * Object types `Direct_vod → direct__v`, `Transfer_vod → transfer__v` (`[UNV]`).
 *
 * References into objects outside v1 (`Wholesaler_Account_Partner_vod__c`,
 * `Payer_vod__c`, `Price_Book_vod__c`, `Delivery_Location_vod__c`,
 * `Contract_vod__c`, `Assortment_vod__c`, `Order_Campaign_vod__c`) are kept
 * as rows so nothing is silently dropped: `custom(outOfScopeRef)` omits the
 * field and counts it (`OUT_OF_SCOPE_REF_DROPPED`, `CONTRACT_REF_DROPPED` for
 * the contract, §6.2.1). Their §6.3.38 target is `—`: the `target` on the
 * row is a placeholder name and `required = '-'` marks the row as
 * target-less (same convention as `sent_email`/`call2`), so preflight must
 * not drop it when the placeholder is absent from Vault metadata.
 *
 * Amount fields are currency fields → Block S `CurrencyIsoCode →
 * local_currency__sys` is enabled; the signature image goes through the blob
 * pass (`objects.order.blobs.signature`, §8.6).
 */
import { isSfdcId, to18 } from "../../transform/ids";
import type { CustomTransformFn, TransformResult } from "../../types";
import { defineObject, type ObjectModuleInput } from "../types";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const ORDER_ACCOUNT_FIELD = "Account_vod__c";
export const ORDER_PARENT_FIELD = "Parent_Order_vod__c";
export const ORDER_DATE_FIELD = "Order_Date_vod__c";

/** Open-item term (§6.2): orders not yet submitted / voided stay in scope. */
export const ORDER_OPEN_PREDICATE =
  "Status_vod__c NOT IN ('Submitted_vod', 'Voided_vod')";

/** `RecordType.DeveloperName` → object type (`[UNV]`). */
export const ORDER_OBJECT_TYPES: Record<string, string> = {
  Direct_vod: "direct__v",
  Transfer_vod: "transfer__v",
};

/** `Status_vod__c` → `order_status__v` (`[UNV]` values by the rename rule). */
export const ORDER_STATUS: Record<string, string> = {
  Saved_vod: "saved__v",
  Submitted_vod: "submitted__v",
  Voided_vod: "voided__v",
};

/** `Status_vod__c` → lifecycle state (`[UNV]` `<status>_state__v` pattern, validated by preflight). */
export const ORDER_STATES: Record<string, string> = {
  Saved_vod: "saved_state__v",
  Submitted_vod: "submitted_state__v",
  Voided_vod: "voided_state__v",
};

/** Blob name of the signature image (`objects.order.blobs.signature`). */
export const ORDER_SIGNATURE_BLOB = "signature";

export const OUT_OF_SCOPE_REF_DROPPED_CODE = "OUT_OF_SCOPE_REF_DROPPED";
export const CONTRACT_REF_DROPPED_CODE = "CONTRACT_REF_DROPPED";

/** Source lookups whose drop is counted under `CONTRACT_REF_DROPPED` (§6.2.1). */
export const CONTRACT_REF_SOURCES: ReadonlySet<string> = new Set([
  "Contract_vod__c",
]);

// ---------------------------------------------------------------------------
// custom transforms (pure)
// ---------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * `custom(outOfScopeRef)`: reference into an object outside v1 (§6.2.1
 * "omit+count"): the field is left unset and every populated value is counted
 * through a non-fatal `out_of_scope_ref_dropped` diagnostic
 * (`CONTRACT_REF_DROPPED` for `Contract_vod__c`, else `OUT_OF_SCOPE_REF_DROPPED`).
 */
export const outOfScopeRef: CustomTransformFn = (
  value,
  _row,
  ctx,
): TransformResult | undefined => {
  if (isEmpty(value)) return undefined;
  const raw = String(value).trim();
  const code = CONTRACT_REF_SOURCES.has(ctx.field.source)
    ? CONTRACT_REF_DROPPED_CODE
    : OUT_OF_SCOPE_REF_DROPPED_CODE;
  return {
    omit: true,
    diagnostic: {
      kind: "out_of_scope_ref_dropped",
      field: ctx.field.target,
      code,
      value: isSfdcId(raw) ? to18(raw) : raw,
      detail: `${ctx.field.source} references an object outside v1 (§6.2.1)`,
    },
  };
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

/** Ship-to / bill-to address snapshot columns (verbatim text; org-specific names → describe miss is `info`). */
export const ORDER_ADDRESS_SNAPSHOT_FIELDS: ReadonlyArray<{
  source: string;
  target: string;
}> = [
  {
    source: "Ship_To_Address_Line_1_vod__c",
    target: "ship_to_address_line_1__v",
  },
  {
    source: "Ship_To_Address_Line_2_vod__c",
    target: "ship_to_address_line_2__v",
  },
  { source: "Ship_To_City_vod__c", target: "ship_to_city__v" },
  { source: "Ship_To_State_vod__c", target: "ship_to_state__v" },
  { source: "Ship_To_Zip_vod__c", target: "ship_to_zip__v" },
  { source: "Ship_To_Country_vod__c", target: "ship_to_country__v" },
  {
    source: "Billing_Address_Line_1_vod__c",
    target: "billing_address_line_1__v",
  },
  {
    source: "Billing_Address_Line_2_vod__c",
    target: "billing_address_line_2__v",
  },
  { source: "Billing_City_vod__c", target: "billing_city__v" },
  { source: "Billing_State_vod__c", target: "billing_state__v" },
  { source: "Billing_Zip_vod__c", target: "billing_zip__v" },
  { source: "Billing_Country_vod__c", target: "billing_country__v" },
];

/** Lookups into objects outside v1 (§6.3.38 row 2, §6.2.1): omitted and counted. `target` is a placeholder (§6.3.38 lists `—`); the rows carry `required: '-'`. */
export const ORDER_OUT_OF_SCOPE_REFS: ReadonlyArray<{
  source: string;
  target: string;
  notes: string;
}> = [
  {
    source: "Wholesaler_Account_Partner_vod__c",
    target: "wholesaler_account_partner__v",
    notes: "ref → Account_Partner_vod__c (out of v1)",
  },
  {
    source: "Payer_vod__c",
    target: "payer__v",
    notes: "ref → Account_Partner_vod__c (out of v1)",
  },
  {
    source: "Price_Book_vod__c",
    target: "price_book__v",
    notes: "ref → Price_Book (out of v1)",
  },
  {
    source: "Delivery_Location_vod__c",
    target: "delivery_location__v",
    notes: "ref → Account_Partner_vod__c (out of v1)",
  },
  {
    source: "Contract_vod__c",
    target: "contract__v",
    notes: "ref → Contract_vod__c (out of v1): counted CONTRACT_REF_DROPPED",
  },
  {
    source: "Assortment_vod__c",
    target: "assortment__v",
    notes: "ref → Assortment (out of v1)",
  },
  {
    source: "Order_Campaign_vod__c",
    target: "order_campaign__v",
    notes: "ref → Order_Campaign (out of v1)",
  },
];

export const order = defineObject({
  key: "order",
  source: "Order_vod__c",
  target: "order__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: ORDER_DATE_FIELD, type: "date" }],
    openPredicate: ORDER_OPEN_PREDICATE,
  },
  countryOf: "account",
  dependsOn: ["account", "call2", "address", "user"],
  selfRefs: [{ target: "parent_order__v", source: ORDER_PARENT_FIELD }],
  // amounts are currency fields → CurrencyIsoCode → local_currency__sys
  blockS: { currency: true },
  objectTypes: { ...ORDER_OBJECT_TYPES },
  states: { ...ORDER_STATES },
  fields: [
    // --- references (§6.3.38 row 1)
    {
      source: ORDER_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "country-of lookup",
    },
    unv("Call2_vod__c", "call2__v", "ref(call2)", { sourceType: "reference" }),
    {
      source: ORDER_PARENT_FIELD,
      target: "parent_order__v",
      transform: "ref(order) secondPass",
      required: "n",
      evidence: "UNV",
      sourceType: "reference",
      notes:
        "self-reference — omitted in pass 1, patched in pass 2 (§6.1 step 19)",
    },
    unv("Wholesaler_vod__c", "wholesaler__v", "ref(account)", {
      sourceType: "reference",
      notes: "ref → Account (wholesaler account)",
    }),
    unv("Ship_To_Address_vod__c", "ship_to_address__v", "ref(address)", {
      sourceType: "reference",
    }),
    unv("Billing_Address_vod__c", "billing_address__v", "ref(address)", {
      sourceType: "reference",
    }),
    // --- lookups into objects outside v1 (row 2): omitted + counted; no Vault
    // target (§6.3.38 `—`) → required '-' so the placeholder name never gates the count
    ...ORDER_OUT_OF_SCOPE_REFS.map((r) =>
      unv(r.source, r.target, "custom(outOfScopeRef)", {
        required: "-",
        sourceType: "reference",
        optionalSource: true,
        notes: `${r.notes} — omitted in v1, counted (§6.2.1); target is a placeholder, the row is target-less`,
      }),
    ),
    // --- dates (row 3)
    {
      source: ORDER_DATE_FIELD,
      target: "order_date__v",
      transform: "date",
      required: "Y",
      evidence: "DOC",
      sourceType: "date",
      notes: "scope date (§6.2)",
    },
    unv("Delivery_Date_vod__c", "delivery_date__v", "date", {
      sourceType: "date",
    }),
    unv("DateTime_vod__c", "datetime__v", "datetime", {
      sourceType: "datetime",
    }),
    unv("Signature_Date_vod__c", "signature_date__v", "datetime", {
      sourceType: "datetime",
    }),
    // --- status (row 4): business picklist + lifecycle state (migration mode)
    {
      source: "Status_vod__c",
      target: "order_status__v",
      transform: "picklist(order.status)",
      required: "Y",
      evidence: "UNV",
      sourceType: "picklist",
      notes:
        "{Saved_vod, Submitted_vod, Voided_vod} → saved__v/submitted__v/voided__v [UNV]; preflight may pick status__v when the object has no order_status__v",
    },
    {
      source: "Status_vod__c",
      target: "state__v",
      transform: "state(order.state)",
      required: "Y",
      evidence: "UNV",
      notes:
        "lifecycled (§6.2); migration mode; state names [UNV], validated against the lifecycle",
    },
    unv("Master_Order_vod__c", "master_order__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Delivery_Order_vod__c", "delivery_order__v", "bool", {
      sourceType: "boolean",
    }),
    // --- amounts (row 5): number + Block S currency
    unv("Order_List_Amount_vod__c", "order_list_amount__v", "number"),
    unv("Order_Net_Amount_vod__c", "order_net_amount__v", "number"),
    unv("Order_Discount_vod__c", "order_discount__v", "number"),
    unv("Order_Free_Goods_vod__c", "order_free_goods__v", "number"),
    unv("Order_Total_Quantity_vod__c", "order_total_quantity__v", "number"),
    // --- address snapshots, notes, signature (row 6)
    ...ORDER_ADDRESS_SNAPSHOT_FIELDS.map((f) =>
      unv(f.source, f.target, "text", {
        unverifiedSource: true,
        optionalSource: true,
        notes: "ship/bill address snapshot, verbatim (org-specific column set)",
      }),
    ),
    unv("Notes_vod__c", "notes__v", "longtext", { sourceType: "textarea" }),
    {
      source: "Signature_vod__c",
      target: "signature__v",
      transform: `deferredBlob(${ORDER_SIGNATURE_BLOB})`,
      required: "n",
      evidence: "UNV",
      blobName: ORDER_SIGNATURE_BLOB,
      optionalSource: true,
      notes: "blob pass (§8.6); policy objects.order.blobs.signature",
    },
    // --- owner (row 7): y? per §6.3.38 (Block S default is n)
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      notes:
        "queue owners → §3.4; dropped by preflight when the target has no ownerid__v",
    },
    // --- skipped roll-ups / formulas / layout fields (row 8)
    {
      source: "List_Amount_vod__c",
      target: "list_amount__v",
      transform: "skip",
      required: "-",
      notes: "roll-up — Vault recomputes (§2.5.6)",
    },
    {
      source: "Net_Amount_vod__c",
      target: "net_amount__v",
      transform: "skip",
      required: "-",
      notes: "roll-up — Vault recomputes (§2.5.6)",
    },
    {
      source: "Ship_To_Address_Text_vod__c",
      target: "ship_to_address_text__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "Total_Discount_vod__c",
      target: "total_discount__v",
      transform: "skip",
      required: "-",
      notes: "formula",
    },
    {
      source: "zvod_Order_Lines_vod__c",
      target: "zvod_order_lines__v",
      transform: "skip",
      required: "-",
      notes: "zvod_* layout marker — never loaded (§6.0.2)",
    },
  ],
  picklists: {
    "order.status": { ...ORDER_STATUS },
  },
  deletePolicy: "ignore",
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
  blobs: { [ORDER_SIGNATURE_BLOB]: "optional" },
  custom: { outOfScopeRef },
  notes:
    "Orders (§6.3.38): 2y on Order_Date_vod__c or open (not submitted/voided); country of the account; lifecycled (order_status__v + state__v); parent_order__v patched in pass 2; out-of-v1 lookups omitted and counted; signature blob; deletes ignored (§4.4).",
});
