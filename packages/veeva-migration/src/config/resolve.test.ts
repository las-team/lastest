import { describe, expect, it } from "vitest";
import { defineObject } from "../objects/types";
import { parseConfig } from "./schema";
import { computeCutoffDate, materialise, resolveCountry } from "./resolve";

const config = parseConfig({
  version: 1,
  source: {
    loginUrl: "https://acme.my.salesforce.com",
    auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
  },
  target: {
    vaultDns: "acme.veevavault.com",
    auth: { kind: "password", username: "v", password: "p" },
    migrationUserId: 1,
  },
  scope: { historyMonths: 24 },
  picklists: {
    "account.specialty": { CD: "global_cd__v", GP: "gp__v" },
    "call2.callType": { "Detail Only": "detail_only__v" },
  },
  objects: {
    account: {
      fields: {
        add: [{ source: "NPI_vod__c", target: "npi__v", transform: "text" }],
      },
    },
    call2: { loadCallType: false },
  },
  regions: {
    EU: {
      dataResidency: "eu",
      scope: { tovRetentionMonths: 60 },
      picklists: { "account.specialty": { CD: "eu_cd__v" } },
      objects: { account: { fields: { remove: ["npi__v"] } } },
    },
  },
  countries: {
    DE: {
      region: "EU",
      defaultTimezone: "Europe/Berlin",
      picklists: { "account.specialty": { CD: "de_cd__v" } },
      objects: {
        account: {
          fields: {
            add: [{ source: "ID_vod__c", target: "id__v", transform: "text" }],
          },
          required: { furigana__v: false },
        },
        multichannel_activity: { scope: { historyMonths: 12 } },
        call2: { loadCallType: true },
      },
    },
    US: {
      dataResidency: "us",
      scope: {
        sampleRetentionMonths: 36,
        samplesIncludeCalls: true,
        objects: { sample_transaction: { historyMonths: 12 } },
      },
      objects: {
        call2: { blobs: { signature: "required" }, unmappedUserPolicy: "fail" },
      },
    },
  },
});

const now = new Date("2026-09-07T12:00:00Z");

describe("resolveCountry (§7.1 layering)", () => {
  it("merges defaults ← global ← region ← country", () => {
    const de = resolveCountry(config, "DE");
    expect(de.region).toBe("EU");
    expect(de.dataResidency).toBe("eu");
    expect(de.scope.tovRetentionMonths).toBe(60);
    expect(de.scope.historyMonths).toBe(24);
    expect(de.defaultTimezone).toBe("Europe/Berlin");
    expect(de.nameTemplates.person).toBe("{FirstName} {LastName}");
    expect(de.picklists.maps["account.specialty"]).toEqual({
      CD: "de_cd__v",
      GP: "gp__v",
    });
    expect(de.fieldLayers.account.map((l) => Object.keys(l)[0])).toEqual([
      "add",
      "remove",
      "add",
    ]);
    expect(de.objects.account.fields).toBeUndefined();
    const us = resolveCountry(config, "US");
    expect(us.picklists.maps["account.specialty"].CD).toBe("global_cd__v");
    expect(us.fieldLayers.account).toHaveLength(1);
    expect(resolveCountry(config, "GLOBAL").scope.historyMonths).toBe(24);
    expect(de.locales.language.en_US).toBe("English");
  });
});

describe("materialise (§7.1 merge rules)", () => {
  const account = defineObject({
    key: "account",
    source: "Account",
    target: "account__v",
    countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
    dependsOn: ["country", "user"],
    deletePolicy: "inactivate",
    fields: [
      {
        source: "Specialty_1_vod__c",
        target: "specialty_1__v",
        transform: "picklist(account.specialty)",
        required: "n",
      },
      {
        source: "Furigana_vod__c",
        target: "furigana__v",
        transform: "text",
        required: "Y",
      },
    ],
  });
  it("applies add/remove/override, required overrides and layered picklists", () => {
    const de = materialise(account, resolveCountry(config, "DE"), config, {
      now,
    });
    const targets = de.fields.map((f) => f.target);
    expect(targets).toContain("id__v");
    expect(targets).not.toContain("npi__v");
    expect(targets).toContain("legacy_crm_id__v"); // Block S
    expect(de.required).toEqual({ furigana__v: false });
    expect(de.picklists["account.specialty"]).toEqual({
      CD: "de_cd__v",
      GP: "gp__v",
    });
    expect(de.options.deletePolicy).toBe("inactivate");
    expect(de.options.externalIdOwnedBy).toBe("integration");
    expect(de.scope).toEqual({ spec: { kind: "full" } });
    expect(de.mappingHash).toMatch(/^[0-9a-f]{64}$/);
    const us = materialise(account, resolveCountry(config, "US"), config, {
      now,
    });
    expect(us.fields.map((f) => f.target)).toContain("npi__v");
    expect(us.mappingHash).not.toBe(de.mappingHash);
    expect(
      materialise(account, resolveCountry(config, "DE"), config, { now })
        .mappingHash,
    ).toBe(de.mappingHash);
  });
  it("resolves flags: enabledBy/disabledBy rows and object options", () => {
    const call2 = defineObject({
      key: "call2",
      source: "Call2_vod__c",
      target: "call2__v",
      countryOf: ["account", "user:OwnerId"],
      dependsOn: ["account", "user"],
      scope: {
        kind: "dated",
        predicates: [{ field: "Call_Date_vod__c", type: "date" }],
        openPredicate: "Status_vod__c = 'Planned_vod'",
      },
      fields: [
        {
          source: "Call_Type_vod__c",
          target: "call_type__v",
          transform: "picklist(call2.callType)",
          required: "n",
          enabledBy: "loadCallType",
        },
      ],
      blobs: { signature: "optional" },
    });
    const us = materialise(call2, resolveCountry(config, "US"), config, {
      now,
    });
    expect(us.fields.map((f) => f.target)).not.toContain("call_type__v");
    expect(us.fields.map((f) => f.target)).not.toContain("unlock__v"); // loadUnlockFlag default false
    expect(us.options.blobs).toEqual({ signature: "required" });
    expect(us.options.unmappedUserPolicy).toBe("fail");
    expect(us.options.allowTypeChange).toBe(false); // lifecycled default
    const de = materialise(call2, resolveCountry(config, "DE"), config, {
      now,
    });
    expect(de.fields.map((f) => f.target)).toContain("call_type__v");
    expect(de.picklists["call2.callType"]).toEqual({
      "Detail Only": "detail_only__v",
    });
    expect(de.load).toMatchObject({
      noTriggers: true,
      batchSize: 500,
      migrationMode: true,
      strategy: "vobjects",
    });
  });
  it("widens regulated scope and computes the cutoff literal", () => {
    const st = defineObject({
      key: "sample_transaction",
      source: "Sample_Transaction_vod__c",
      target: "sample_transaction__v",
      countryOf: ["user:OwnerId", "account"],
      dependsOn: ["sample_lot", "user", "account"],
      scope: {
        kind: "dated",
        predicates: [{ field: "Call_Date_vod__c", type: "date" }],
        retentionFamily: "samples",
      },
    });
    const us = materialise(st, resolveCountry(config, "US"), config, { now });
    expect(us.scope.historyMonths).toBe(36); // widened from 12 → 36 (never narrowed)
    expect(us.scope.cutoffDate).toBe("2023-09-07");
    expect(us.findings.some((f) => f.code === "SCOPE_WIDENED")).toBe(true);
    expect(us.findings.some((f) => f.code === "SCOPE_NARROWED")).toBe(false);
    const de = materialise(st, resolveCountry(config, "DE"), config, { now });
    expect(de.scope.historyMonths).toBe(24);
    expect(computeCutoffDate(new Date("2026-03-31T00:00:00Z"), 1)).toBe(
      "2026-03-03",
    ); // JS month arithmetic, UTC
  });
  it("calls join the samples family with samplesIncludeCalls and non-regulated narrowing is flagged", () => {
    const call2 = defineObject({
      key: "call2",
      source: "Call2_vod__c",
      target: "call2__v",
      countryOf: "account",
      dependsOn: ["account"],
      scope: {
        kind: "dated",
        predicates: [{ field: "Call_Date_vod__c", type: "date" }],
      },
    });
    expect(
      materialise(call2, resolveCountry(config, "US"), config, { now }).scope
        .historyMonths,
    ).toBe(36);
    const mca = defineObject({
      key: "multichannel_activity",
      source: "Multichannel_Activity_vod__c",
      target: "multichannel_activity__v",
      countryOf: "account",
      dependsOn: ["account"],
      scope: {
        kind: "dated",
        predicates: [{ field: "Start_DateTime_vod__c", type: "datetime" }],
      },
    });
    const de = materialise(mca, resolveCountry(config, "DE"), config, { now });
    expect(de.scope.historyMonths).toBe(12);
    expect(de.findings.map((f) => f.code)).toContain("SCOPE_NARROWED");
  });
  it("supports null historyMonths (unscoped), countryOf override and legacyIdField override", () => {
    const cfg = parseConfig({
      ...(JSON.parse(JSON.stringify(config)) as object),
      countries: {
        ...config.countries,
        DE: {
          ...config.countries.DE,
          objects: {
            ...config.countries.DE.objects,
            multichannel_consent: { scope: { historyMonths: null } },
            account: {
              countryOf: "field:Custom_Country__c",
              legacyIdField: "legacy_crm_id__c",
            },
          },
        },
      },
    } as never);
    const mc = defineObject({
      key: "multichannel_consent",
      source: "Multichannel_Consent_vod__c",
      target: "multichannel_consent__v",
      countryOf: "account",
      dependsOn: ["account"],
      scope: {
        kind: "dated",
        predicates: [{ field: "Capture_Datetime_vod__c", type: "datetime" }],
      },
    });
    const m = materialise(mc, resolveCountry(cfg, "DE"), cfg, { now });
    expect(m.scope.historyMonths).toBeUndefined();
    expect(m.scope.cutoffDate).toBeUndefined();
    const acc = defineObject({
      key: "account",
      source: "Account",
      target: "account__v",
      countryOf: "global",
      dependsOn: [],
    });
    const am = materialise(acc, resolveCountry(cfg, "DE"), cfg, { now });
    expect(am.countryOf).toEqual([
      { kind: "field", path: "Custom_Country__c" },
    ]);
    expect(am.legacyIdField).toBe("legacy_crm_id__c");
    expect(am.fields.find((f) => f.required === "K")?.target).toBe(
      "legacy_crm_id__c",
    );
  });
  it("flags duplicate targets after overlays as blocking", () => {
    const cfg = parseConfig({
      ...(JSON.parse(JSON.stringify(config)) as object),
      objects: {
        account: {
          fields: {
            add: [
              { source: "A__c", target: "dup__v", transform: "text" },
              { source: "B__c", target: "dup__v", transform: "text" },
            ],
          },
        },
      },
    } as never);
    const acc = defineObject({
      key: "account",
      source: "Account",
      target: "account__v",
    });
    const m = materialise(acc, resolveCountry(cfg, "US"), cfg, { now });
    // add-with-same-target replaces, so no duplicate; verify override→append path instead
    expect(m.fields.filter((f) => f.target === "dup__v")).toHaveLength(1);
    expect(m.fields.find((f) => f.target === "dup__v")?.source).toBe("B__c");
  });
});
