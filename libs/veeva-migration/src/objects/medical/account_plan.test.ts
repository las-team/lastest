import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PLAN_ACCOUNT_FIELD,
  ACCOUNT_PLAN_OBJECT_TYPES,
  ACCOUNT_PLAN_ROLLUPS,
  account_plan,
} from "./account_plan";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const PLAN_ID = to18("a0Z000000000001");

function makeConfig(overrides: Record<string, unknown> = {}) {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "x.veevavault.com",
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 1,
    },
    objects: { account_plan: overrides },
    countries: { US: {} },
  });
}

function metadata(opts: { typed?: boolean } = { typed: true }) {
  return resolveMetadata(
    buildVaultMetadata(
      "account_plan__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        { name: "active__v", type: "Boolean" },
        { name: "description__v", type: "LongText" },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "mobile_id__v", type: "String", max_length: 100 },
      ],
      { objectTypes: opts.typed ? ["account_plan__v"] : [] },
    ),
    { picklists: { status__v: ["active__v", "inactive__v"] } },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: PLAN_ID,
    IsDeleted: false,
    Name: "Q3 Cardiology plan",
    "RecordType.DeveloperName": "Account_Plan_vod",
    [ACCOUNT_PLAN_ACCOUNT_FIELD]: IDS.account2,
    Active_vod__c: "true",
    Description_vod__c: "Grow share in the cardiology unit\r\n- 3 visits",
    Total_Plan_Tactics_vod__c: "4",
    Completed_Plan_Tactics_vod__c: "1",
    Percent_Complete_vod__c: "25",
    Plan_Tactic_Progress_vod__c: "1 of 4",
    Mobile_ID_vod__c: "7d2c5f4e-ap-0001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID_2,
    CreatedDate: "2024-01-02T03:04:05.000Z",
    LastModifiedDate: "2025-06-07T08:09:10.000Z",
    SystemModstamp: "2025-06-07T08:09:10.000Z",
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { overrides?: Record<string, unknown>; typed?: boolean } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    account_plan,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    { account: { [IDS.account2]: "V0A2" } },
    { [SAMPLE_USER_ID]: 101, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({ typed: opts.typed ?? true }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account_plan.custom,
    }),
  };
}

describe("account_plan module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(account_plan).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.28 / §3.3 / §4.4 catalogue facts", () => {
    expect(account_plan.source).toBe("Account_Plan_vod__c");
    expect(account_plan.target).toBe("account_plan__v");
    expect(account_plan.targetEvidence).toBe("DOC");
    expect(account_plan.scope).toEqual({ kind: "full" });
    expect(account_plan.countryOf).toEqual([{ kind: "account" }]);
    expect(account_plan.dependsOn).toEqual(["account", "user"]);
    expect(account_plan.selfRefs).toEqual([]);
    expect(account_plan.deletePolicy).toBe("inactivate");
    // §4.4: status__v = inactive__v implied + active__v = false
    expect(account_plan.inactivate).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(account_plan.createPolicy).toBe("create");
    expect(account_plan.load.noTriggers).toBe(false);
    expect(account_plan.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
    expect(account_plan.objectTypes).toEqual(ACCOUNT_PLAN_OBJECT_TYPES);
    expect(ACCOUNT_PLAN_OBJECT_TYPES.Account_Plan_vod).toBe("account_plan__v");
    expect(account_plan.blockS.statusFromFlag).toEqual({
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    expect(account_plan.notes).not.toContain("STUB");
  });

  it("carries every §6.3.28 row and skips the roll-ups", () => {
    const byTarget = new Map(account_plan.fields.map((f) => [f.target, f]));
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("name__v")).toMatchObject({
      transform: { kind: "text", max: 128 },
      required: "Y",
      evidence: "UNV",
    });
    expect(
      account_plan.fields.filter((f) => f.target === "name__v"),
    ).toHaveLength(1);
    expect(byTarget.get("active__v")).toMatchObject({
      transform: { kind: "bool" },
      required: "n",
    });
    expect(byTarget.get("description__v")).toMatchObject({
      transform: { kind: "longtext" },
      required: "n",
    });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      transform: { kind: "refUser" },
      required: "y?",
      evidence: "UNV",
    });
    expect(byTarget.get("status__v")?.transform).toMatchObject({
      kind: "statusFromFlag",
      sourceFlag: "Active_vod__c",
    });
    expect(byTarget.get("object_type__v.api_name__v")?.transform).toEqual({
      kind: "objectType",
      mapKey: "account_plan.objectType",
    });
    expect(ACCOUNT_PLAN_ROLLUPS).toHaveLength(4);
    for (const [source, target] of ACCOUNT_PLAN_ROLLUPS)
      expect(byTarget.get(target), target).toMatchObject({
        source,
        transform: { kind: "skip" },
        required: "-",
      });
    // children (tactics/objectives) are out of v1: no rows reference them
    expect(
      account_plan.fields.some((f) =>
        /tactic__v$|objective__v$/.test(f.target),
      ),
    ).toBe(false);
    for (const f of account_plan.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("transforms a realistic row: account ref, object type, flags, audit users, roll-ups skipped", () => {
    const { result } = run(sampleRow());
    expect(result.failure).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("account_plan__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: PLAN_ID,
      name__v: "Q3 Cardiology plan",
      "object_type__v.api_name__v": "account_plan__v",
      account__v: { $fk: { object: "account", sfdcId: IDS.account2 } },
      active__v: true,
      description__v: "Grow share in the cardiology unit\n- 3 visits",
      mobile_id__v: "7d2c5f4e-ap-0001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2024-01-02T03:04:05.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-06-07T08:09:10.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID_2 },
    });
    for (const [, target] of ACCOUNT_PLAN_ROLLUPS)
      expect(result.payload[target], target).toBeUndefined();
    expect(result.payload.status__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account2,
    });
  });

  it("derives status__v = inactive__v from Active_vod__c = false (§6.0.4)", () => {
    const { result } = run(sampleRow({ Active_vod__c: "false" }));
    expect(result.status).toBe("ok");
    expect(result.payload.active__v).toBe(false);
    expect(result.payload.status__v).toBe("inactive__v");
    const { result: disabled } = run(sampleRow({ Active_vod__c: "false" }), {
      overrides: { statusFromFlag: false },
    });
    expect(disabled.payload.status__v).toBeUndefined();
  });

  it("reports an unresolved required account as pending_fk and a missing one as failed", () => {
    const { result } = run(
      sampleRow({ [ACCOUNT_PLAN_ACCOUNT_FIELD]: IDS.account4 }),
    );
    expect(result.status).toBe("pending_fk");
    expect(result.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
    const { result: missing } = run(
      sampleRow({ [ACCOUNT_PLAN_ACCOUNT_FIELD]: "" }),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "account__v",
    });
  });

  it("fails an unknown record type on the typed target (VT_OBJECT_TYPE_MISSING)", () => {
    const { result: bad } = run(
      sampleRow({ "RecordType.DeveloperName": "Strategic_Plan_vod" }),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("is full scope with the account country rule and the §4.4 inactivate set", () => {
    const { mapping } = run(sampleRow());
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "full",
    });
    expect(mapping.scope.cutoffDate).toBeUndefined();
    expect(mapping.countryOf).toEqual([{ kind: "account" }]);
    expect(mapping.options.deletePolicy).toBe("inactivate");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "active__v", value: false },
    ]);
    expect(mapping.load.noTriggers).toBe(false);
  });
});
