import { describe, expect, it } from "vitest";
import { SAMPLE_INVENTORY_STATES, sample_inventory } from "./sample_inventory";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
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
const INV_ID = to18("a0I000000000001");
const STATE_NAMES = Object.values(SAMPLE_INVENTORY_STATES);

function makeConfig(
  opts: {
    sample_inventory?: Record<string, unknown>;
    countries?: Record<string, unknown>;
  } = {},
) {
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
    objects: { sample_inventory: opts.sample_inventory ?? {} },
    countries: { US: opts.countries ?? {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "sample_inventory__v",
      [
        {
          name: "inventory_for__v",
          type: "Object",
          object: { name: "user__sys" },
          required: true,
        },
        { name: "inventory_date_time__v", type: "DateTime", required: true },
        { name: "inventory_from_date__v", type: "Date" },
        { name: "previous_inventory_date_time__v", type: "DateTime" },
        { name: "submitted_date__v", type: "Date" },
        {
          name: "sample_inventory_status__v",
          type: "Picklist",
          picklist: "sample_inventory_status__v",
        },
        {
          name: "inventory_type__v",
          type: "Picklist",
          picklist: "inventory_type__v",
        },
        { name: "submitted__v", type: "Boolean" },
        { name: "audit__v", type: "Boolean" },
        { name: "no_sample_lots__v", type: "Boolean" },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
        { name: "unlock__v", type: "Boolean" },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        { name: "external_id__v", type: "String", max_length: 100 },
      ],
      { lifecycles: ["sample_inventory_lifecycle__c"] },
    ),
    {
      picklists: {
        sample_inventory_status__v: [
          "saved__v",
          "submitted__v",
          "in_progress__v",
        ],
        inventory_type__v: ["annual__v", "cycle_count__v"],
        status__v: ["active__v", "inactive__v"],
      },
      lifecycle: { name: "sample_inventory_lifecycle__c", states: STATE_NAMES },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: INV_ID,
    Name: "SI-000042",
    Inventory_For_vod__c: SAMPLE_USER_ID_2,
    Inventory_Date_Time_vod__c: "2026-02-15T09:00:00.000+0000",
    Inventory_From_Date_vod__c: "2026-01-01",
    Previous_Inventory_Date_Time_vod__c: "2025-12-31T17:00:00.000Z",
    Submitted_Date_vod__c: "2026-02-15",
    Status_vod__c: "Submitted_vod",
    Inventory_Type_vod__c: "Annual",
    Submitted_vod__c: "true",
    Audit_vod__c: "false",
    No_Sample_Lots_vod__c: "false",
    Unlock_vod__c: "true",
    Mobile_ID_vod__c: "mob-inv-1",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2026-02-15T09:05:00.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2026-02-16T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    config?: Parameters<typeof makeConfig>[0];
    knownInventoryFor?: boolean;
  } = {},
) {
  const config = makeConfig(opts.config);
  const mapping = materialise(
    sample_inventory,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const users: Record<string, number> = { [SAMPLE_USER_ID]: 101 };
  if (opts.knownInventoryFor !== false) users[SAMPLE_USER_ID_2] = 102;
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids: buildIdResolver({}, users),
      migrationUserId: 1,
      runMode: "init",
      custom: sample_inventory.custom,
    }),
  };
}

describe("sample_inventory module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(sample_inventory).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
    expect(sample_inventory.notes).not.toContain("STUB");
  });

  it("encodes the §6.2 / §6.1 / §4.4 catalogue facts", () => {
    expect(sample_inventory.source).toBe("Sample_Inventory_vod__c");
    expect(sample_inventory.target).toBe("sample_inventory__v");
    expect(sample_inventory.targetEvidence).toBe("DOC");
    expect(sample_inventory.scope).toEqual({
      kind: "dated",
      predicates: [{ field: "Inventory_Date_Time_vod__c", type: "datetime" }],
      retentionFamily: "samples",
    });
    expect(sample_inventory.countryOf).toEqual([
      { kind: "user", field: "Inventory_For_vod__c" },
      { kind: "user", field: "OwnerId" },
    ]);
    expect(sample_inventory.dependsOn).toEqual(["user"]);
    expect(sample_inventory.selfRefs).toEqual([]);
    expect(sample_inventory.deletePolicy).toBe("ignore");
    expect(sample_inventory.inactivate).toEqual([]);
    expect(sample_inventory.createPolicy).toBe("create");
    expect(sample_inventory.load.noTriggers).toBe(true);
    expect(sample_inventory.objectTypes).toEqual({});
    expect(sample_inventory.states).toEqual(SAMPLE_INVENTORY_STATES);
    expect(sample_inventory.blockS.name).toBe("autoNumber");
    expect(sample_inventory.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "mobile_id",
    ]);
  });

  it("maps every §6.3.36 row with the spec's transform, requirement and evidence", () => {
    const byTarget = new Map(sample_inventory.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      enabledBy: "preserveAutoNumberName",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("inventory_for__v")).toMatchObject({
      source: "Inventory_For_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("inventory_date_time__v")).toMatchObject({
      source: "Inventory_Date_Time_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("inventory_from_date__v")).toMatchObject({
      required: "n",
      transform: { kind: "date" },
    });
    expect(byTarget.get("previous_inventory_date_time__v")).toMatchObject({
      required: "n",
      transform: { kind: "datetime" },
    });
    expect(byTarget.get("submitted_date__v")).toMatchObject({
      required: "n",
      transform: { kind: "date" },
    });
    expect(byTarget.get("sample_inventory_status__v")).toMatchObject({
      source: "Status_vod__c",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "picklist", mapKey: "sample_inventory.status" },
    });
    expect(byTarget.get("state__v")).toMatchObject({
      source: "Status_vod__c",
      required: "Y",
      transform: { kind: "state", mapKey: "sample_inventory.state" },
    });
    expect(byTarget.get("inventory_type__v")).toMatchObject({
      source: "Inventory_Type_vod__c",
      evidence: "DOC",
      countryConfigurable: true,
      transform: { kind: "picklist", mapKey: "sample_inventory.inventoryType" },
    });
    for (const [t, src] of [
      ["submitted__v", "Submitted_vod__c"],
      ["audit__v", "Audit_vod__c"],
      ["no_sample_lots__v", "No_Sample_Lots_vod__c"],
    ] as const)
      expect(byTarget.get(t), t).toMatchObject({
        source: src,
        required: "n",
        evidence: "UNV",
        transform: { kind: "bool" },
      });
    expect(byTarget.get("ownerid__v")).toMatchObject({
      source: "OwnerId",
      required: "Y",
      evidence: "UNV",
      transform: { kind: "refUser" },
    });
    // Unlock_vod__c [OBS on sample_inventory__v] stays gated
    expect(byTarget.get("unlock__v")).toMatchObject({
      source: "Unlock_vod__c",
      enabledBy: "loadUnlockFlag",
    });
    expect(byTarget.get("status__v")).toBeUndefined(); // transactional: no statusFromFlag
    expect(sample_inventory.picklists["sample_inventory.status"]).toEqual({
      Saved_vod: "saved__v",
      Submitted_vod: "submitted__v",
      In_Progress_vod: "in_progress__v",
    });
    expect(
      sample_inventory.picklists["sample_inventory.inventoryType"],
    ).toEqual({});
  });

  it("transforms a realistic inventory row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: INV_ID,
      inventory_for__v: { $user: SAMPLE_USER_ID_2 },
      inventory_date_time__v: "2026-02-15T09:00:00.000Z",
      inventory_from_date__v: "2026-01-01",
      previous_inventory_date_time__v: "2025-12-31T17:00:00.000Z",
      submitted_date__v: "2026-02-15",
      sample_inventory_status__v: "submitted__v",
      state__v: "submitted_state__v",
      inventory_type__v: "annual__v",
      submitted__v: true,
      audit__v: false,
      no_sample_lots__v: false,
      mobile_id__v: "mob-inv-1",
      last_device__v: "data_load__v",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_by__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2026-02-15T09:05:00.000Z",
    });
    expect(result.payload.name__v).toBeUndefined(); // auto-number
    expect(result.payload.unlock__v).toBeUndefined(); // gated
    expect(result.payload.status__v).toBeUndefined();
    expect(result.secondPass).toEqual({});
    expect(result.fkEdges).toContainEqual({
      field: "inventory_for__v",
      targetObjectKey: "user",
      targetSfdcId: SAMPLE_USER_ID_2,
    });
  });

  it("carries the auto-number name and the unlock flag only when enabled", () => {
    const { result } = run(sampleRow(), {
      config: {
        sample_inventory: {
          preserveAutoNumberName: true,
          loadUnlockFlag: true,
        },
      },
    });
    expect(result.payload.name__v).toBe("SI-000042");
    expect(result.payload.unlock__v).toBe(true);
  });

  it("reports an unmapped required inventory_for__v user as pending_fk", () => {
    const { result } = run(sampleRow(), { knownInventoryFor: false });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      {
        field: "inventory_for__v",
        objectKey: "user",
        sfdcId: SAMPLE_USER_ID_2,
      },
    ]);
    expect(result.payload.inventory_for__v).toEqual({
      $user: SAMPLE_USER_ID_2,
    });
  });

  it("fails when the required inventory date is missing", () => {
    const { result } = run(sampleRow({ Inventory_Date_Time_vod__c: "" }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "inventory_date_time__v",
    });
  });

  it("crosswalks customer inventory types through the country overlay", () => {
    const { result } = run(sampleRow({ Inventory_Type_vod__c: "Zyklus" }), {
      config: {
        countries: {
          picklists: {
            "sample_inventory.inventoryType": { Zyklus: "cycle_count__v" },
          },
        },
      },
    });
    expect(result.status).toBe("ok");
    expect(result.payload.inventory_type__v).toBe("cycle_count__v");
  });

  it("builds the datetime scope predicate with samples retention widening", () => {
    const base = run(sampleRow());
    expect(base.mapping.scope.retentionFamily).toBe("samples");
    const build = buildScopePredicate(base.mapping.scope, { now: NOW });
    expect(build.kind).toBe("dated");
    expect(build.cutoffDate).toBe("2024-09-07");
    expect(build.predicate).toBe(
      "Inventory_Date_Time_vod__c >= 2024-09-07T00:00:00Z",
    );
    const us = run(sampleRow(), {
      config: { countries: { scope: { sampleRetentionMonths: 36 } } },
    });
    expect(buildScopePredicate(us.mapping.scope, { now: NOW }).predicate).toBe(
      "Inventory_Date_Time_vod__c >= 2023-09-07T00:00:00Z",
    );
  });
});
