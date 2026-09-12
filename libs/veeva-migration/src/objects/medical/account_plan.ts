/**
 * `account_plan` — `Account_Plan_vod__c` → `account_plan__v` `[DOC]`
 * (spec §6.3.28, §6.1 step 14, §6.2, §3.3, §3.5, §4.4).
 *
 * Small master-data object: full scope, country of the planned account
 * (`countryOf: account`), depends on `account` and `user` (owner), loaded
 * with `noTriggers = false`. Object type `Account_Plan_vod → account_plan__v`
 * (`[UNV]`).
 *
 * Block S: `status__v = inactive__v` is derived from `Active_vod__c = false`
 * (§6.0.4 / §4.4 "Active_vod__c" family) next to the business flag
 * `active__v`; on delete the row is **inactivated** with the same set
 * (`status__v = inactive__v` implied + `active__v = false`, §4.4).
 *
 * Roll-ups (`Total_Plan_Tactics_vod__c`, `Completed_Plan_Tactics_vod__c`,
 * `Percent_Complete_vod__c`, `Plan_Tactic_Progress_vod__c`) are skipped —
 * Vault recomputes them (`postLoad.recalculateRollups`, §2.5.6). The
 * children (`Account_Tactic_vod__c`, `Plan_Tactic_vod__c`,
 * `Call_Objective_vod__c` → `account_tactic__v`, `plan_tactic__v`,
 * `call_objective__v` `[DOC]`) are out of v1 (§6.2.1) and carry no rows.
 */
import { defineObject, type ObjectModuleInput } from "../types";

/** RecordType DeveloperName → object type api name (`[UNV]`, §6.3.28). */
export const ACCOUNT_PLAN_OBJECT_TYPES: Record<string, string> = {
  Account_Plan_vod: "account_plan__v",
};

/** Required parent (also the country-of lookup). */
export const ACCOUNT_PLAN_ACCOUNT_FIELD = "Account_vod__c";

/** Roll-up columns never loaded (§6.3.28). */
export const ACCOUNT_PLAN_ROLLUPS: ReadonlyArray<[string, string]> = [
  ["Total_Plan_Tactics_vod__c", "total_plan_tactics__v"],
  ["Completed_Plan_Tactics_vod__c", "completed_plan_tactics__v"],
  ["Percent_Complete_vod__c", "percent_complete__v"],
  ["Plan_Tactic_Progress_vod__c", "plan_tactic_progress__v"],
];

type RowInput = NonNullable<ObjectModuleInput["fields"]>[number];

export const account_plan = defineObject({
  key: "account_plan",
  source: "Account_Plan_vod__c",
  target: "account_plan__v",
  targetEvidence: "DOC",
  scope: { kind: "full" },
  countryOf: "account",
  dependsOn: ["account", "user"],
  objectTypes: { ...ACCOUNT_PLAN_OBJECT_TYPES },
  blockS: {
    statusFromFlag: {
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    },
  },
  fields: [
    // --- §6.3.28 rows (same-target rows replace Block S defaults)
    {
      source: ACCOUNT_PLAN_ACCOUNT_FIELD,
      target: "account__v",
      transform: "ref(account)",
      required: "Y",
      evidence: "UNV",
      sourceType: "reference",
      notes: "planned account; country-of lookup",
    },
    {
      source: "Name",
      target: "name__v",
      transform: "text(128)",
      required: "Y",
      evidence: "UNV",
      disabledBy: "preserveName",
    },
    {
      source: "Active_vod__c",
      target: "active__v",
      transform: "bool",
      required: "n",
      evidence: "UNV",
      sourceType: "boolean",
      notes:
        "business flag; also drives Block S status__v = inactive__v when false (§6.0.4) and the inactivate set (§4.4)",
    },
    {
      source: "Description_vod__c",
      target: "description__v",
      transform: "longtext",
      required: "n",
      evidence: "UNV",
      sourceType: "textarea",
    },
    {
      source: "OwnerId",
      target: "ownerid__v",
      transform: "refUser",
      required: "y?",
      evidence: "UNV",
      notes:
        "queue owners → §3.4; dropped by preflight when the target has no ownerid__v",
    },
    // --- roll-ups: skipped, Vault recomputes (§6.3.28, §2.5.6)
    ...ACCOUNT_PLAN_ROLLUPS.map(
      ([source, target]): RowInput => ({
        source,
        target,
        transform: "skip",
        required: "-",
        evidence: "UNV",
        notes: "roll-up — never loaded; postLoad.recalculateRollups (§2.5.6)",
      }),
    ),
  ],
  picklists: {},
  deletePolicy: "inactivate",
  inactivate: [{ field: "active__v", value: false }],
  createPolicy: "create",
  load: { noTriggers: false },
  match: [
    { method: "legacy_id" },
    {
      method: "mobile_id",
      keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }],
      evidence: "UNV",
    },
  ],
  notes:
    "Account plans (§6.3.28): full scope, country of the account, roll-ups skipped, status__v from Active_vod__c; inactivated on delete (status__v + active__v=false, §4.4); tactics/objectives children out of v1 (§6.2.1).",
});
