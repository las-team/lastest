/**
 * `sample_inventory` — `Sample_Inventory_vod__c` → `sample_inventory__v`
 * (spec §6.3.36, §6.1 step 18, §6.2, §3.3, §4.4).
 *
 * Regulated inventory headers of the samples family: dated scope on
 * `Inventory_Date_Time_vod__c` (datetime) widened by
 * `scope.sampleRetentionMonths`, attributed to the country of the user the
 * inventory is for with the owner as fallback
 * (`['user:Inventory_For_vod__c', 'user:OwnerId']`), loaded with
 * `noTriggers = true`, never deleted on the target (`ignore`).
 *
 * `Name` is an SFDC auto-number (§6.0.4 lists `Sample_Inventory_vod__c`
 * explicitly), so `name__v` is carried only with
 * `objects.sample_inventory.preserveAutoNumberName = true`; the table's
 * `Name → name__v (Y)` row is therefore governed by the Block S autoNumber
 * rule, which §6.0.4 says wins.
 *
 * `Status_vod__c` feeds both the business status
 * (`sample_inventory_status__v`, rename pattern of §6.0.2 — preflight picks
 * `status__v` when the object has no `{object}_status__v`) and the lifecycle
 * `state__v` (migration mode). `Inventory_Type_vod__c` holds customer values
 * (`[DOC field]`), so its crosswalk is empty by default and country-specific.
 *
 * `Unlock_vod__c` is `[OBS on sample_inventory__v]` and stays gated by
 * `objects.sample_inventory.loadUnlockFlag` (Block S, §6.0.4).
 */
import { defineObject } from "../types";

/** `Status_vod__c` → lifecycle state (`[UNV]`, pattern `Submitted_vod → submitted_state__v`). */
export const SAMPLE_INVENTORY_STATES: Record<string, string> = {
  Saved_vod: "saved_state__v",
  Submitted_vod: "submitted_state__v",
  In_Progress_vod: "in_progress_state__v",
};

export const sample_inventory = defineObject({
  key: "sample_inventory",
  source: "Sample_Inventory_vod__c",
  target: "sample_inventory__v",
  targetEvidence: "DOC",
  scope: {
    kind: "dated",
    predicates: [{ field: "Inventory_Date_Time_vod__c", type: "datetime" }],
    retentionFamily: "samples",
  },
  countryOf: ["user:Inventory_For_vod__c", "user:OwnerId"],
  dependsOn: ["user"],
  // Name is autoNumber (§6.0.4) — carried only with preserveAutoNumberName
  blockS: { name: "autoNumber" },
  states: { ...SAMPLE_INVENTORY_STATES },
  fields: [
    {
      source: "Inventory_For_vod__c",
      target: "inventory_for__v",
      transform: "refUser",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "user the inventory is for; first countryOf rule",
    },
    {
      source: "Inventory_Date_Time_vod__c",
      target: "inventory_date_time__v",
      transform: "datetime",
      required: "Y",
      evidence: "UNV",
      sourceType: "datetime",
      notes: "scope field",
    },
    {
      source: "Inventory_From_Date_vod__c",
      target: "inventory_from_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      sourceType: "date",
    },
    {
      source: "Previous_Inventory_Date_Time_vod__c",
      target: "previous_inventory_date_time__v",
      transform: "datetime",
      required: "n",
      evidence: "UNV",
      sourceType: "datetime",
    },
    {
      source: "Submitted_Date_vod__c",
      target: "submitted_date__v",
      transform: "date",
      required: "n",
      evidence: "UNV",
      sourceType: "date",
    },
    {
      source: "Status_vod__c",
      target: "sample_inventory_status__v",
      transform: "picklist(sample_inventory.status)",
      required: "Y",
      evidence: "UNV",
      notes:
        "{Saved_vod, Submitted_vod, In_Progress_vod}; preflight may pick status__v when the object has no {object}_status__v",
    },
    {
      source: "Status_vod__c",
      target: "state__v",
      transform: "state(sample_inventory.state)",
      required: "Y",
      evidence: "UNV",
      notes:
        "migration mode; state names [UNV], validated against the lifecycle",
    },
    {
      source: "Inventory_Type_vod__c",
      target: "inventory_type__v",
      transform: "picklist(sample_inventory.inventoryType)",
      required: "n",
      evidence: "DOC",
      countryConfigurable: true,
      notes: "customer values — crosswalk per country",
    },
    {
      source: "Submitted_vod__c",
      target: "submitted__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "Audit_vod__c",
      target: "audit__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "No_Sample_Lots_vod__c",
      target: "no_sample_lots__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
    },
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "Y",
      evidence: "UNV",
      notes: "queue owners → §3.4; second countryOf rule",
    },
  ],
  picklists: {
    "sample_inventory.status": {
      Saved_vod: "saved__v",
      Submitted_vod: "submitted__v",
      In_Progress_vod: "in_progress__v",
    },
    "sample_inventory.inventoryType": {},
  },
  deletePolicy: "ignore",
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
    "Regulated inventory headers (§6.3.36). Load flags follow objects.sample_transaction.load.sampleStrategy jointly with the samples family (§6.3.35); roll-ups recalculated/verified post-load. Deleted rows are ignored on the target and listed for review (§4.4).",
});
