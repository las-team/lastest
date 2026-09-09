/**
 * `call2_sample` — `Call2_Sample_vod__c` → `call2_sample__v` `[UNV object]`
 * (spec §6.3.34, §6.3.35, §6.1 step 17, §6.2, §3.3, §4.4).
 *
 * Master-detail child of `call2` in the **samples retention family**
 * (`scope.sampleRetentionMonths` widens the parent-date window; US), attributed
 * to the parent's country, deleted with the parent (`delete`, §4.4).
 *
 * In Veeva CRM a trigger created `Sample_Transaction_vod__c` from these rows
 * for `Product_Type ∈ {Sample, Alternative Sample, High Value Promotional}`;
 * Vault does the same on submit. Which side is loaded with triggers is decided
 * once per country by `objects.sample_transaction.load.sampleStrategy`
 * (§6.3.35) — never both (double inventory):
 *  - `noTriggersRecalc`, `noTriggersVerify`, `triggersOnTransactions` → this
 *    object is loaded with `noTriggers = true`;
 *  - `triggersOnCallSamples` → loaded **with** triggers so Vault regenerates
 *    disbursement transactions; `sample_transaction` disbursements are not
 *    loaded (other types still are).
 * `call2SampleNoTriggers(strategy)` is the pure rule the engine applies to
 * `mapping.load.noTriggers`; the module default is `true`.
 *
 * `Lot_vod__c` is the lot **name** (text 80), not the lot FK. `Amount_vod__c`
 * / `Product_Value_vod__c` are currency fields → `CurrencyIsoCode` feeds
 * `local_currency__sys` (Block S `currency`).
 */
import type { SampleStrategy } from "../../types";
import { defineObject } from "../types";
import {
  CALL2_ATTENDEE_TYPES,
  CALL2_CHILD_BLOCK_S,
  CALL2_MATCH_RULES,
  call2ChildCommonRows,
  unv,
} from "./call2";

/** `Delivery_Status_vod__c` → `delivery_status__v` (`[UNV]` values by the rename rule). */
export const CALL2_SAMPLE_DELIVERY_STATUS: Record<string, string> = {
  In_Progress_vod: "in_progress__v",
  Shipped_vod: "shipped__v",
  Delivered_vod: "delivered__v",
  Cancel_Request_vod: "cancel_request__v",
  Cancelled_vod: "cancelled__v",
};

/** `Cold_Chain_Status_vod__c` {In Range, Not In Range} → `cold_chain_status__v` (`[UNV]`). */
export const CALL2_SAMPLE_COLD_CHAIN_STATUS: Record<string, string> = {
  "In Range": "in_range__v",
  "Not In Range": "not_in_range__v",
};

/**
 * `X-VaultAPI-NoTriggers` for this object under a sample strategy (§6.3.34):
 * only `triggersOnCallSamples` loads call samples with triggers.
 */
export function call2SampleNoTriggers(
  strategy: SampleStrategy | undefined,
): boolean {
  return strategy !== "triggersOnCallSamples";
}

export const call2_sample = defineObject({
  key: "call2_sample",
  source: "Call2_Sample_vod__c",
  target: "call2_sample__v",
  targetEvidence: "UNV",
  scope: {
    kind: "via-parent",
    parentKey: "call2",
    parentField: "Call2_vod__r.Call_Date_vod__c",
    type: "date",
    retentionFamily: "samples",
  },
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product", "account"],
  // currency fields (Amount, Product_Value) → local_currency__sys
  blockS: { ...CALL2_CHILD_BLOCK_S, currency: true },
  fields: [
    // --- common to all call children (§6.3.31 preamble)
    ...call2ChildCommonRows("call2_sample"),
    // --- §6.3.34 rows
    unv("Product_vod__c", "product__v", "ref(product)", {
      required: "Y",
      sourceType: "reference",
    }),
    unv("Account_vod__c", "account__v", "ref(account)", {
      sourceType: "reference",
    }),
    unv("Call_Date_vod__c", "call_date__v", "date", {
      required: "Y",
      sourceType: "date",
    }),
    unv("Quantity_vod__c", "quantity__v", "number", {
      required: "Y",
      sourceType: "double",
    }),
    unv("Lot_vod__c", "lot__v", "text(80)", {
      sourceType: "string",
      notes: "lot name (text 80) — not the lot FK",
    }),
    unv("Amount_vod__c", "amount__v", "number", {
      sourceType: "currency",
      notes: "currency field — CurrencyIsoCode → local_currency__sys (Block S)",
    }),
    unv("Product_Value_vod__c", "product_value__v", "number", {
      sourceType: "currency",
      notes: "currency field — CurrencyIsoCode → local_currency__sys (Block S)",
    }),
    unv("Manufacturer_vod__c", "manufacturer__v", "text"),
    unv("Distributor_vod__c", "distributor__v", "text"),
    unv(
      "Delivery_Status_vod__c",
      "delivery_status__v",
      "picklist(call2_sample.deliveryStatus)",
      {
        sourceType: "picklist",
        notes:
          "{In_Progress_vod, Shipped_vod, Delivered_vod, Cancel_Request_vod, Cancelled_vod}",
      },
    ),
    unv(
      "Cold_Chain_Status_vod__c",
      "cold_chain_status__v",
      "picklist(call2_sample.coldChainStatus)",
      { sourceType: "picklist", notes: "{In Range, Not In Range}" },
    ),
    unv("Apply_Limit_vod__c", "apply_limit__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Limit_Applied_vod__c", "limit_applied__v", "bool", {
      sourceType: "boolean",
    }),
    unv("Custom_Text_vod__c", "custom_text__v", "text"),
    unv("Tag_Alert_Number_vod__c", "tag_alert_number__v", "text"),
  ],
  picklists: {
    "call2_sample.attendeeType": { ...CALL2_ATTENDEE_TYPES },
    "call2_sample.deliveryStatus": { ...CALL2_SAMPLE_DELIVERY_STATUS },
    "call2_sample.coldChainStatus": { ...CALL2_SAMPLE_COLD_CHAIN_STATUS },
  },
  deletePolicy: "delete",
  inactivate: [],
  createPolicy: "create",
  load: { noTriggers: true, sampleStrategy: "noTriggersRecalc" },
  match: CALL2_MATCH_RULES,
  notes:
    "Samples family child of call2 (§6.3.34): scoped through the parent's call date widened by sampleRetentionMonths; NoTriggers under every sample strategy except triggersOnCallSamples (call2SampleNoTriggers); deleted with the parent (§4.4).",
});
