import { describe, expect, it } from "vitest";
import { MigrationConfigSchema, parseConfig } from "./schema";

const minimal = {
  version: 1,
  source: {
    loginUrl: "https://acme.my.salesforce.com",
    auth: {
      kind: "jwt",
      clientId: "cid",
      username: "u@acme.com",
      privateKeyPath: "./sf.key",
    },
  },
  target: {
    vaultDns: "acme-crm.veevavault.com",
    auth: { kind: "password", username: "v", password: "p" },
    migrationUserId: 12345,
  },
};

describe("MigrationConfigSchema (§7.2.1)", () => {
  it("applies defaults", () => {
    const c = parseConfig(minimal);
    expect(c.source.apiVersion).toBe("67.0");
    expect(c.target.apiVersion).toBe("v26.2");
    expect(c.target.migrationMode).toBe(true);
    expect(c.target.unchangedFieldBehavior).toBe("AlwaysIgnore");
    expect(c.legacyId.preferred).toEqual([
      "legacy_crm_id__v",
      "external_id__v",
      "legacy_crm_id__c",
    ]);
    expect(c.legacyId.externalIdFormat).toBe("SF:{orgId15}:{id18}");
    expect(c.delta.overlapMinutes).toBe(10);
    expect(c.performance).toMatchObject({
      sfdcBulkConcurrency: 4,
      sfdcRestConcurrency: 2,
      vaultConcurrency: 4,
      vaultBatch: 500,
      burstFloor: 200,
      sfdcApiFloorPct: 20,
      batchWallTimeMs: 60000,
      sortChunkRows: 500000,
    });
    expect(c.extract).toEqual({
      closureStrategy: "soqlIn",
      closureMaxRounds: 20,
    });
    expect(c.pendingFk.maxRounds).toBe(3);
    expect(c.preflight).toMatchObject({
      probeWrites: false,
      naturalKeyReview: true,
      reprobe: false,
    });
    expect(c.waves).toEqual([]);
  });
  it("accepts the §7.3 excerpt shape", () => {
    const c = parseConfig({
      ...minimal,
      scope: { historyMonths: 24 },
      picklists: {
        derive: "strip_vod_lowercase_v",
        onUnmapped: "error",
        "account.specialty": { CD: "cardiology__v", XX: null },
      },
      locales: {
        language: { en_US: "English" },
        locale: { en_US: "United States" },
      },
      objects: {
        user: { mode: "match" },
        account: {
          countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
          deletePolicy: "inactivate",
          externalIdOwnedBy: "integration",
          useParentIdFallback: false,
          vidField: "VeevaID_vod__c",
        },
        call2: {
          countryOf: ["account", "user:User_vod__c", "user:OwnerId"],
          deletePolicy: "ignore",
          load: {
            noTriggers: true,
            partitionBy: {
              field: "Parent_Call_vod__c",
              order: ["null", "notNull"],
            },
          },
          loadCallType: false,
        },
        sample_transaction: { load: { sampleStrategy: "noTriggersRecalc" } },
        multichannel_consent: {
          load: { orderBy: ["Capture_Datetime_vod__c", "Id"] },
          configMaps: {
            consentType: { a0X000000000AbCAAU: "external_id:AE_DE" },
          },
        },
        expense_header: { optional: true },
        key_message: { createPolicy: "match-only" },
        account_territory: { enabled: false },
      },
      regions: {
        EU: {
          dataResidency: "eu",
          scope: { tovRetentionMonths: 60 },
          privacy: { consentFullHistory: true },
          objects: { email_activity: { loadIpAddress: false } },
        },
      },
      countries: {
        DE: {
          region: "EU",
          defaultTimezone: "Europe/Berlin",
          objects: {
            account: {
              fields: {
                add: [
                  { source: "ID_vod__c", target: "id__v", transform: "text" },
                ],
                remove: ["npi__v"],
              },
            },
            address: { required: { state_province__v: false } },
          },
        },
        US: {
          dataResidency: "us",
          scope: { sampleRetentionMonths: 36, samplesIncludeCalls: true },
          postLoad: { recalculateRollups: "required" },
          objects: { call2: { blobs: { signature: "required" } } },
        },
      },
      waves: [
        { name: "eu1", countries: ["DE"] },
        { name: "na", countries: ["US"], freezeAt: "2027-03-06T22:00:00Z" },
      ],
    });
    expect(c.countries.DE.region).toBe("EU");
    expect(c.regions.EU.scope?.tovRetentionMonths).toBe(60);
    expect(c.picklists?.["account.specialty"]).toEqual({
      CD: "cardiology__v",
      XX: null,
    });
  });
  it("rejects unknown top-level keys, unknown object keys and bad enums", () => {
    expect(
      MigrationConfigSchema.safeParse({ ...minimal, bogus: 1 }).success,
    ).toBe(false);
    expect(
      MigrationConfigSchema.safeParse({ ...minimal, objects: { nope: {} } })
        .success,
    ).toBe(false);
    expect(
      MigrationConfigSchema.safeParse({
        ...minimal,
        objects: { account: { deletePolicy: "purge" } },
      }).success,
    ).toBe(false);
    expect(
      MigrationConfigSchema.safeParse({
        ...minimal,
        delta: { overlapMinutes: 60 },
      }).success,
    ).toBe(false);
    expect(
      MigrationConfigSchema.safeParse({
        ...minimal,
        target: { ...minimal.target, auth: { kind: "usernamePassword" } },
      }).success,
    ).toBe(false);
  });
  it("requires an overlay for every wave country and a known region", () => {
    const r = MigrationConfigSchema.safeParse({
      ...minimal,
      waves: [{ name: "x", countries: ["FR"] }],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? "" : r.error.issues)).toContain(
      "CONFIG_COUNTRY_NO_OVERLAY",
    );
    const r2 = MigrationConfigSchema.safeParse({
      ...minimal,
      countries: { FR: { region: "EMEA" } },
    });
    expect(JSON.stringify(r2.success ? "" : r2.error.issues)).toContain(
      "CONFIG_REGION_UNKNOWN",
    );
  });
  it("accepts the §7.3 bare-null partitionBy order and normalises it", () => {
    const c = parseConfig({
      ...minimal,
      objects: {
        call2: {
          load: {
            partitionBy: {
              field: "Parent_Call_vod__c",
              order: [null, "notNull"],
            },
          },
        },
      },
    });
    expect(c.objects?.call2?.load?.partitionBy?.order).toEqual([
      "null",
      "notNull",
    ]);
  });
  it("validates overlay transform strings at load time (MAP_TRANSFORM_INVALID)", () => {
    const bad = (transform: string) =>
      MigrationConfigSchema.safeParse({
        ...minimal,
        objects: {
          account: {
            fields: { add: [{ source: "X__c", target: "x__v", transform }] },
          },
        },
      });
    for (const t of ["picklsit(account.x)", "text(abc)", "number(x)"]) {
      const r = bad(t);
      expect(r.success, t).toBe(false);
      expect(JSON.stringify(r.success ? "" : r.error.issues)).toContain(
        "MAP_TRANSFORM_INVALID",
      );
    }
    expect(bad("text(128)").success).toBe(true);
    expect(bad("picklist(account.x)").success).toBe(true);
  });
  it("allows a per-country target (CN) and object-specific flags", () => {
    const c = parseConfig({
      ...minimal,
      countries: {
        CN: {
          dataResidency: "cn",
          target: {
            vaultDns: "acme-cn.veevavault.cn",
            auth: { kind: "password", username: "u", password: "p" },
          },
          objects: { account: { someModuleFlag: true } },
        },
      },
    });
    expect(c.countries.CN.target?.vaultDns).toBe("acme-cn.veevavault.cn");
    expect(
      (c.countries.CN.objects?.account as Record<string, unknown>)
        .someModuleFlag,
    ).toBe(true);
  });
});
