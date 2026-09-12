import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineObject } from "../objects/types";
import {
  BUILTIN_CONFIG_DIR,
  EMPTY_OVERLAYS,
  deepMergeOverlay,
  loadBuiltinCountryOverlays,
  mergeOverlays,
} from "./countries";
import { ConfigError, loadConfigFromText } from "./load";
import { materialise, resolveCountry } from "./resolve";
import { parseConfig, type MigrationConfigInput } from "./schema";

const EXPECTED_COUNTRIES = [
  "AU",
  "BR",
  "CA",
  "CH",
  "CN",
  "DE",
  "ES",
  "FR",
  "GB",
  "IT",
  "JP",
  "KR",
  "MX",
  "NL",
  "US",
];
const EXPECTED_REGIONS = ["APAC", "EU", "LATAM", "NA"];

const CN_ENV = {
  VAULT_CN_USER: "cn-user",
  VAULT_CN_PASSWORD: "cn-pass",
  MIG_DATABASE_URL_CN: "postgres://cn/mig",
};

function baseConfig(
  countries: Record<string, unknown>,
  extra: Partial<MigrationConfigInput> = {},
) {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://acme.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "acme-crm.veevavault.com",
      auth: { kind: "password", username: "v", password: "p" },
      migrationUserId: 1,
    },
    scope: { historyMonths: 24 },
    countries,
    ...extra,
  });
}

const overlays = loadBuiltinCountryOverlays();
const now = new Date("2026-09-07T12:00:00Z");

describe("shipped overlays (config/regions, config/countries)", () => {
  it("resolves the config dir relative to the package", () => {
    expect(existsSync(join(BUILTIN_CONFIG_DIR, "migration.example.yaml"))).toBe(
      true,
    );
  });
  it("every shipped YAML parses against the zod layer schema", () => {
    expect(Object.keys(overlays.countries).sort()).toEqual(EXPECTED_COUNTRIES);
    expect(Object.keys(overlays.regions).sort()).toEqual(EXPECTED_REGIONS);
    for (const [iso, entry] of Object.entries(overlays.countries)) {
      const region = entry.region as string | undefined;
      if (iso === "CN") expect(region).toBeUndefined();
      else expect(EXPECTED_REGIONS).toContain(region);
    }
  });
  it("the whole set merges into one valid config (includeAll)", () => {
    const merged = mergeOverlays(baseConfig({}), {
      overlays,
      env: CN_ENV,
      includeAll: true,
    });
    expect(Object.keys(merged.countries).sort()).toEqual(EXPECTED_COUNTRIES);
    expect(Object.keys(merged.regions).sort()).toEqual(EXPECTED_REGIONS);
    // no "…" ellipsis placeholders survive from the spec excerpts
    const text = JSON.stringify(merged);
    expect(text).not.toContain("…");
  });
  it("rejects a malformed overlay directory with a ConfigError", () => {
    expect(() => loadBuiltinCountryOverlays("/nonexistent/dir")).toThrow(
      ConfigError,
    );
  });
});

describe("migration.example.yaml", () => {
  const text = readFileSync(
    join(BUILTIN_CONFIG_DIR, "migration.example.yaml"),
    "utf8",
  );
  const env = {
    SF_CLIENT_ID: "sf-client",
    VAULT_USER: "vault-user",
    VAULT_PASSWORD: "vault-pass",
    MIG_DATABASE_URL: "postgres://localhost/mig",
    ...CN_ENV,
  };
  it("loads, lists every wave country and merges the shipped overlays", () => {
    const config = loadConfigFromText(text, env);
    expect(config.target.vaultDns).toBe("acme-crm.veevavault.com");
    expect(config.source.auth).toMatchObject({ clientId: "sf-client" });
    const waveCountries = config.waves.flatMap((w) => w.countries);
    for (const iso of waveCountries)
      expect(config.countries[iso]).toBeDefined();
    const merged = mergeOverlays(config, { overlays, env });
    expect(merged.countries.DE.region).toBe("EU");
    expect(merged.countries.US.scope?.sampleRetentionMonths).toBe(36);
    expect(merged.countries.CN.target?.vaultDns).toBe(
      "acme-crm-cn.veevavault.cn",
    );
    // CH ships but is not referenced by the example → not merged
    expect(merged.countries.CH).toBeUndefined();
    // the example's own values are untouched
    expect(merged.scope?.historyMonths).toBe(24);
    expect(merged.objects?.account?.vidField).toBe("VeevaID_vod__c");
  });
});

describe("resolveCountry over the shipped overlays", () => {
  const config = mergeOverlays(
    baseConfig({ US: {}, DE: {}, FR: {}, CN: {}, JP: {}, CA: {} }),
    { overlays, env: CN_ENV },
  );

  it("US: 36-month sample retention (PDMA), calls in the samples family", () => {
    const us = resolveCountry(config, "US");
    expect(us.region).toBe("NA");
    expect(us.dataResidency).toBe("us");
    expect(us.scope.sampleRetentionMonths).toBe(36);
    expect(us.scope.samplesIncludeCalls).toBe(true);
    expect(us.scope.historyMonths).toBe(24);
    expect(us.scope.objects.sample_transaction?.historyMonths).toBe(36);
    expect(us.postLoad.recalculateRollups).toBe("required");
    expect(us.objects.address?.line1Overflow).toBe("spillToLine2");
    expect(us.objects.call2?.blobs).toEqual({ signature: "required" });
    expect(us.picklists.maps["address.state"]).toMatchObject({
      AL: "al__v",
      PR: "pr__v",
    });
    expect(Object.keys(us.picklists.maps["address.state"])).toHaveLength(52);

    const sampleTransaction = defineObject({
      key: "sample_transaction",
      source: "Sample_Transaction_vod__c",
      target: "sample_transaction__v",
      scope: {
        kind: "dated",
        predicates: [{ field: "Transaction_Date_vod__c", type: "date" }],
        retentionFamily: "samples",
      },
      countryOf: "account:Account_vod__c",
      dependsOn: ["account"],
      fields: [],
    });
    const mapping = materialise(sampleTransaction, us, config, { now });
    expect(mapping.scope.historyMonths).toBe(36);
    expect(mapping.scope.cutoffDate).toBe("2023-09-07");
    expect(mapping.load.sampleStrategy).toBe("noTriggersRecalc");
    expect(mapping.load.fallbackStrategy).toBe("triggersOnTransactions");
  });

  it("DE: inherits regions.EU (tovRetentionMonths, residency, consent, IP policy)", () => {
    const de = resolveCountry(config, "DE");
    expect(de.region).toBe("EU");
    expect(de.dataResidency).toBe("eu");
    expect(de.scope.tovRetentionMonths).toBe(60);
    expect(de.privacy.consentFullHistory).toBe(true);
    expect(de.privacy.erasureListPath).toBe("./privacy/de-erasures.csv");
    expect(de.objects.email_activity?.loadIpAddress).toBe(false);
    expect(de.nameTemplates.person).toBe("{Salutation} {FirstName} {LastName}");
    expect(de.objects.multichannel_consent?.scope?.historyMonths).toBeNull();
    // FR has no scope block of its own — the 60 months come from the region
    const fr = resolveCountry(config, "FR");
    expect(overlays.countries.FR.scope).toBeUndefined();
    expect(fr.scope.tovRetentionMonths).toBe(60);
    expect(fr.scope.historyMonths).toBe(24);
  });

  it("CN: separate China-hosted vault, cn residency, no cross-border transfer", () => {
    const cn = resolveCountry(config, "CN");
    expect(cn.region).toBeUndefined();
    expect(cn.dataResidency).toBe("cn");
    expect(cn.target.vaultDns).toBe("acme-crm-cn.veevavault.cn");
    expect(cn.target.auth).toEqual({
      kind: "password",
      username: "cn-user",
      password: "cn-pass",
    });
    expect(cn.privacy.crossBorderTransfer).toBe("forbidden");
    expect(cn.objects.sample_transaction?.enabled).toBe(false);
    expect(cn.nameTemplates.separator).toBe("");
    // the global vault is untouched for everyone else
    expect(resolveCountry(config, "JP").target.vaultDns).toBe(
      "acme-crm.veevavault.com",
    );
  });

  it("JP: kana name template with a full-width separator", () => {
    const jp = resolveCountry(config, "JP");
    expect(jp.region).toBe("APAC");
    expect(jp.dataResidency).toBe("jp");
    expect(jp.nameTemplates.person).toBe("{LastName}{separator}{FirstName}");
    expect(jp.nameTemplates.separator).toBe("　");
    expect(jp.objects.account?.required).toEqual({ furigana__v: true });
    expect(jp.objects.address?.line1Overflow).toBe("fail");
    expect(jp.phone.normalise).toBe(false);
    expect(jp.fieldLayers.account.at(-1)?.add).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "furigana__v" }),
      ]),
    );
    expect(jp.fieldLayers.account.at(-1)?.remove).toContain("salutation__v");
    expect(Object.keys(jp.picklists.maps["address.state"])).toHaveLength(47);
  });

  it("CA: bilingual language handling (NA region, language-neutral values)", () => {
    const ca = resolveCountry(config, "CA");
    expect(ca.region).toBe("NA");
    expect(ca.dataResidency).toBe("us");
    expect(ca.privacy.consentFullHistory).toBe(true);
    expect(ca.picklists.maps["account.language"]).toEqual({
      en_US: "en__v",
      fr: "fr__v",
      fr_CA: "fr__v",
    });
    expect(ca.picklists.maps["account.preferredLanguage"]).toEqual({
      EN: "en__c",
      FR: "fr__c",
    });
    const added = ca.fieldLayers.account.at(-1)?.add?.map((r) => r.target);
    expect(added).toEqual([
      "language__v",
      "preferred_language__c",
      "spec_1_cda__v",
    ]);
    expect(Object.keys(ca.picklists.maps["address.state"])).toHaveLength(13);
    expect(ca.picklists.maps["account.specialty"]).toMatchObject({
      Cardiology: "cardiology__c",
      "Médecine familiale": "family_medicine__c",
    });
  });

  it("materialises the US npi__v row and drops it for DE (region-independent overlays)", () => {
    const account = defineObject({
      key: "account",
      source: "Account",
      target: "account__v",
      countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c",
      dependsOn: ["country", "user"],
      fields: [
        {
          source: "NPI_vod__c",
          target: "npi__v",
          transform: "text",
          required: "n",
        },
        {
          source: "Furigana_vod__c",
          target: "furigana__v",
          transform: "text",
          required: "n",
        },
      ],
    });
    const us = materialise(account, resolveCountry(config, "US"), config, {
      now,
    });
    expect(us.fields.map((f) => f.target)).toEqual(
      expect.arrayContaining(["npi__v", "pdrp_opt_out__v"]),
    );
    expect(us.required).toEqual({ npi__v: false, primary_country__v: true });
    const de = materialise(account, resolveCountry(config, "DE"), config, {
      now,
    });
    expect(de.fields.map((f) => f.target)).not.toContain("npi__v");
    expect(de.fields.map((f) => f.target)).toEqual(
      expect.arrayContaining(["id__v", "id2__v", "dhg_type__c"]),
    );
    expect(de.findings.filter((f) => f.severity === "blocking")).toEqual([]);
  });
});

describe("mergeOverlays (user config wins)", () => {
  it("user scalars replace, field rows merge by target, remove lists union", () => {
    const config = mergeOverlays(
      baseConfig({
        US: {
          defaultTimezone: "America/Chicago",
          scope: { sampleRetentionMonths: 48 },
          objects: {
            account: {
              fields: {
                add: [
                  {
                    source: "NPI_Override__c",
                    target: "npi__v",
                    transform: "text(10)",
                  },
                  { source: "Extra__c", target: "extra__c", transform: "text" },
                ],
                remove: ["furigana__v"],
              },
            },
            address: { line1Overflow: "fail" },
          },
          picklists: { "address.state": { AL: "alabama__v", ZZ: null } },
        },
      }),
      { overlays },
    );
    const us = resolveCountry(config, "US");
    expect(us.defaultTimezone).toBe("America/Chicago");
    expect(us.scope.sampleRetentionMonths).toBe(48);
    expect(us.scope.samplesIncludeCalls).toBe(true); // builtin kept
    expect(us.objects.address?.line1Overflow).toBe("fail");
    const add = us.fieldLayers.account[0].add!;
    expect(add.map((r) => r.target)).toEqual([
      "npi__v",
      "pdrp_opt_out__v",
      "pdrp_opt_out_date__v",
      "extra__c",
    ]);
    expect(add[0]).toMatchObject({
      source: "NPI_Override__c",
      transform: "text(10)",
    });
    expect(us.fieldLayers.account[0].remove).toEqual(["furigana__v"]);
    expect(us.picklists.maps["address.state"]).toMatchObject({
      AL: "alabama__v",
      AK: "ak__v",
      ZZ: null,
    });
  });

  it("user region wins over the shipped one; a user-only country passes through", () => {
    const config = mergeOverlays(
      baseConfig(
        {
          DE: { region: "DACH" },
          FR: { region: "DACH" },
          AT: { region: "DACH", defaultTimezone: "Europe/Vienna" },
        },
        {
          regions: {
            DACH: { dataResidency: "eu", scope: { tovRetentionMonths: 72 } },
          },
        },
      ),
      { overlays },
    );
    expect(config.countries.DE.region).toBe("DACH");
    expect(config.regions.EU).toBeUndefined();
    // FR carries no scope of its own → the user's region supplies it
    expect(resolveCountry(config, "FR").scope.tovRetentionMonths).toBe(72);
    // DE.yaml sets 60 at country level, which still beats any region
    expect(resolveCountry(config, "DE").scope.tovRetentionMonths).toBe(60);
    expect(resolveCountry(config, "AT").defaultTimezone).toBe("Europe/Vienna");
    expect(resolveCountry(config, "DE").defaultTimezone).toBe("Europe/Berlin");
    expect(resolveCountry(config, "AT").dataResidency).toBe("eu");
  });

  it("only referenced countries are merged, so CN env vars are optional until CN is used", () => {
    const withoutCn = mergeOverlays(baseConfig({ DE: {} }), {
      overlays,
      env: {},
    });
    expect(withoutCn.countries.CN).toBeUndefined();
    expect(withoutCn.countries.DE.defaultTimezone).toBe("Europe/Berlin");
    expect(Object.keys(withoutCn.regions)).toEqual(["EU"]);

    expect(() =>
      mergeOverlays(baseConfig({ CN: {} }), { overlays, env: {} }),
    ).toThrow(/CONFIG_ENV_MISSING.*VAULT_CN_PASSWORD, VAULT_CN_USER/);

    // a user-supplied auth removes the need for the env variables
    const own = mergeOverlays(
      baseConfig({
        CN: {
          target: { auth: { kind: "accessToken", token: "t" } },
        },
      }),
      { overlays, env: {} },
    );
    expect(own.countries.CN.target?.auth).toEqual({
      kind: "accessToken",
      token: "t",
    });
    expect(own.countries.CN.target?.vaultDns).toBe("acme-crm-cn.veevavault.cn");
  });

  it("EMPTY_OVERLAYS leaves the config as-is; the input is never mutated", () => {
    const input = baseConfig({ US: { defaultTimezone: "America/Denver" } });
    const before = JSON.stringify(input);
    const merged = mergeOverlays(input, { overlays: EMPTY_OVERLAYS });
    expect(merged.countries.US).toEqual({ defaultTimezone: "America/Denver" });
    mergeOverlays(input, { overlays });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("re-validates the merged result (schema errors surface as ConfigError)", () => {
    const bad = {
      ...overlays,
      countries: { ...overlays.countries, US: { defaultTimezone: 5 } },
    } as typeof overlays;
    expect(() =>
      mergeOverlays(baseConfig({ US: {} }), { overlays: bad }),
    ).toThrow(ConfigError);
  });

  it("deepMergeOverlay replaces plain arrays and merges nested objects", () => {
    expect(
      deepMergeOverlay(
        { a: { b: 1, list: [1, 2] }, keep: "x" },
        { a: { list: [3] }, add: true },
      ),
    ).toEqual({ a: { b: 1, list: [3] }, keep: "x", add: true });
  });
});
