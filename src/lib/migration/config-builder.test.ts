import { describe, it, expect } from "vitest";
import { MigrationConfigSchema } from "@lastest/veeva-migration";
import {
  buildConfigSkeleton,
  withSecrets,
  describeEndpoints,
  MigrationConfigError,
  type BuildConfigInput,
} from "./config-builder";
import type { MigrationWave, SutConnector } from "@/lib/db/schema";

function connector(over: Partial<SutConnector> = {}): SutConnector {
  return {
    id: "c1",
    repositoryId: "r1",
    environmentId: "e1",
    type: "salesforce",
    name: "sfProd",
    label: "SFDC production",
    authMethod: "sf-client-credentials",
    config: {
      loginUrl: "https://x.my.salesforce.com",
      apiVersion: "v67.0",
      consumerKey: "3MVG9",
    },
    credentialId: "cred1",
    lastVerifiedAt: null,
    lastVerifyError: null,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  } as SutConnector;
}

const vault = connector({
  id: "c2",
  type: "vault",
  name: "vaultProd",
  label: "Vault production",
  authMethod: "vault-password",
  config: { vaultDns: "acme-crm.veevavault.com", apiVersion: "v26.2" },
});

function wave(over: Partial<MigrationWave> = {}): MigrationWave {
  return {
    id: "w1",
    projectId: "p1",
    key: "eu1",
    label: "EU wave 1",
    countries: ["DE", "FR"],
    status: "planned",
    freezeAt: null,
    plannedAt: null,
    signedOffAt: null,
    signedOffBy: null,
    signOffNote: null,
    sortOrder: 0,
    createdAt: null,
    updatedAt: null,
    ...over,
  } as MigrationWave;
}

function input(over: Partial<BuildConfigInput> = {}): BuildConfigInput {
  return {
    project: { config: {}, runDir: null },
    source: connector(),
    target: vault,
    waves: [wave()],
    ...over,
  };
}

describe("buildConfigSkeleton", () => {
  it("derives both endpoints from the connectors", () => {
    const cfg = buildConfigSkeleton(input());
    expect(cfg.source.loginUrl).toBe("https://x.my.salesforce.com");
    expect(cfg.target.vaultDns).toBe("acme-crm.veevavault.com");
    expect(cfg.target.apiVersion).toBe("v26.2");
  });

  it("strips the connector's leading `v` from the Salesforce API version", () => {
    // The connector stores Vault-style `v67.0`; the engine's source schema
    // wants `67.0`. Getting this wrong is a config-validation failure, not a
    // runtime one, so it is worth pinning.
    expect(buildConfigSkeleton(input()).source.apiVersion).toBe("67.0");
  });

  it("always turns Vault migration mode on", () => {
    expect(buildConfigSkeleton(input()).target.migrationMode).toBe(true);
  });

  it("refuses a browser-login Salesforce connector", () => {
    expect(() =>
      buildConfigSkeleton(
        input({ source: connector({ authMethod: "sf-ui-login" }) }),
      ),
    ).toThrow(MigrationConfigError);
  });

  it("refuses a connector of the wrong type on either end", () => {
    expect(() => buildConfigSkeleton(input({ source: vault }))).toThrow(
      /must be a Salesforce connector/,
    );
    expect(() => buildConfigSkeleton(input({ target: connector() }))).toThrow(
      /must be a Vault connector/,
    );
  });

  it("refuses a missing end with a message the Connect stage can show", () => {
    expect(() => buildConfigSkeleton(input({ source: null }))).toThrow(
      "No Salesforce org is connected.",
    );
    expect(() => buildConfigSkeleton(input({ target: null }))).toThrow(
      "No Vault is connected.",
    );
  });

  it("emits an empty overlay for every country in a wave", () => {
    // Without these the engine rejects the config with
    // CONFIG_COUNTRY_NO_OVERLAY, even though "no per-country override" is the
    // normal state of a new migration.
    const cfg = buildConfigSkeleton(input());
    expect(Object.keys(cfg.countries ?? {}).sort()).toEqual(["DE", "FR"]);
  });

  it("carries waves through with their freeze timestamp", () => {
    const freezeAt = new Date("2027-03-06T22:00:00.000Z");
    const cfg = buildConfigSkeleton(input({ waves: [wave({ freezeAt })] }));
    expect(cfg.waves).toEqual([
      {
        name: "eu1",
        countries: ["DE", "FR"],
        freezeAt: freezeAt.toISOString(),
      },
    ]);
  });

  it("drops a wave with no countries rather than emitting an invalid one", () => {
    const cfg = buildConfigSkeleton(
      input({ waves: [wave({ countries: [] })] }),
    );
    expect(cfg.waves).toEqual([]);
  });

  it("prefers an explicit cutoff date over a history window", () => {
    const cfg = buildConfigSkeleton(
      input({
        project: {
          config: { historyMonths: 24, cutoffDate: "2025-01-01" },
          runDir: null,
        },
      }),
    );
    expect(cfg.scope).toEqual({ cutoffDate: "2025-01-01" });
  });

  it("passes a history window through when there is no cutoff date", () => {
    const cfg = buildConfigSkeleton(
      input({ project: { config: { historyMonths: 36 }, runDir: null } }),
    );
    expect(cfg.scope).toEqual({ historyMonths: 36 });
  });

  it("merges `advanced` last, but never over the wave country overlays", () => {
    const cfg = buildConfigSkeleton(
      input({
        project: {
          config: {
            advanced: {
              objects: { account: { historyMonths: 12 } },
              countries: { DE: { region: "EU" } },
            },
          },
          runDir: null,
        },
      }),
    );
    expect(cfg.objects).toEqual({ account: { historyMonths: 12 } });
    // The hand-written DE overlay survives AND FR still gets its empty one.
    expect(cfg.countries).toEqual({ DE: { region: "EU" }, FR: {} });
  });

  it("produces a config the engine's own schema accepts", () => {
    // The whole point of the builder. `MigrationConfigSchema` is the only
    // definition of a valid config that cannot drift from the engine.
    const skeleton = buildConfigSkeleton(input());
    const full = withSecrets(
      skeleton,
      { authMethod: "sf-client-credentials", secrets: { consumerSecret: "s" } },
      {
        authMethod: "vault-password",
        secrets: { username: "u", password: "p" },
      },
    );
    const parsed = MigrationConfigSchema.safeParse(full);
    expect(parsed.success, JSON.stringify(parsed.error?.issues, null, 2)).toBe(
      true,
    );
  });

  it("produces a valid config for the JWT + OAuth pairing too", () => {
    const skeleton = buildConfigSkeleton(
      input({
        source: connector({
          authMethod: "sf-jwt-bearer",
          config: {
            loginUrl: "https://test.salesforce.com",
            apiVersion: "v62.0",
            consumerKey: "3MVG9",
            jwtSubject: "migration@acme.com",
          },
        }),
        target: connector({
          id: "c2",
          type: "vault",
          authMethod: "vault-oauth",
          config: {
            vaultDns: "acme.veevavault.com",
            apiVersion: "v26.2",
            oauthProfileId: "profile1",
          },
        }),
      }),
    );
    const full = withSecrets(
      skeleton,
      { authMethod: "sf-jwt-bearer", secrets: { privateKey: "-----BEGIN" } },
      { authMethod: "vault-oauth", secrets: { idpToken: "tok" } },
    );
    const parsed = MigrationConfigSchema.safeParse(full);
    expect(parsed.success, JSON.stringify(parsed.error?.issues, null, 2)).toBe(
      true,
    );
  });
});

describe("withSecrets", () => {
  const skeleton = () => buildConfigSkeleton(input());

  it("names the missing credential field rather than failing at run time", () => {
    expect(() =>
      withSecrets(
        skeleton(),
        { authMethod: "sf-client-credentials", secrets: {} },
        {
          authMethod: "vault-password",
          secrets: { username: "u", password: "p" },
        },
      ),
    ).toThrow(/consumerSecret/);

    expect(() =>
      withSecrets(
        skeleton(),
        {
          authMethod: "sf-client-credentials",
          secrets: { consumerSecret: "s" },
        },
        { authMethod: "vault-password", secrets: { username: "u" } },
      ),
    ).toThrow(/password/);
  });

  it("leaves the skeleton unmodified", () => {
    // The skeleton is the object the console renders; folding secrets into it
    // in place would put them on a page.
    const base = skeleton();
    const before = JSON.stringify(base);
    withSecrets(
      base,
      {
        authMethod: "sf-client-credentials",
        secrets: { consumerSecret: "SHHH-CONSUMER" },
      },
      {
        authMethod: "vault-password",
        secrets: { username: "u", password: "SHHH-PASSWORD" },
      },
    );
    const after = JSON.stringify(base);
    expect(after).toBe(before);
    // The auth METHOD names (`"kind":"password"`) legitimately appear in the
    // skeleton — it is the secret VALUES that must not.
    expect(after).not.toContain("SHHH-CONSUMER");
    expect(after).not.toContain("SHHH-PASSWORD");
  });
});

describe("describeEndpoints", () => {
  it("labels each end with its environment", () => {
    const result = describeEndpoints(
      input({
        sourceEnvironment: { label: "UAT" } as never,
        targetEnvironment: { label: "Vault UAT" } as never,
      }),
    );
    expect(result.source).toBe("https://x.my.salesforce.com (UAT)");
    expect(result.target).toBe("acme-crm.veevavault.com (Vault UAT)");
  });

  it("says so plainly when an end is missing", () => {
    const result = describeEndpoints(input({ source: null, target: null }));
    expect(result).toEqual({
      source: "not connected",
      target: "not connected",
    });
  });
});
