import { describe, expect, it } from "vitest";
import {
  ConfigError,
  configHash,
  interpolateEnv,
  loadConfigFromText,
} from "./load";

const yaml = `
version: 1
source:
  loginUrl: https://acme.my.salesforce.com
  auth: { kind: jwt, clientId: "\${SF_CLIENT_ID}", username: u@acme.com, privateKeyPath: ./sf.key }
target:
  vaultDns: acme-crm.veevavault.com
  auth: { kind: password, username: "\${VAULT_USER}", password: "\${VAULT_PASSWORD}" }
  migrationUserId: 12345
scope: { historyMonths: 24 }
countries:
  DE: { defaultTimezone: Europe/Berlin }
waves:
  - { name: pilot, countries: [DE] }
`;

describe("config loader", () => {
  it("interpolates \${ENV} (quoted inside YAML flow maps) and parses", () => {
    const c = loadConfigFromText(yaml, {
      SF_CLIENT_ID: "cid",
      VAULT_USER: "vu",
      VAULT_PASSWORD: "vp",
    });
    expect(c.source.auth).toMatchObject({ kind: "jwt", clientId: "cid" });
    expect(c.target.auth).toMatchObject({ username: "vu", password: "vp" });
    expect(c.countries.DE.defaultTimezone).toBe("Europe/Berlin");
  });
  it("reports every missing variable at once", () => {
    expect(() => loadConfigFromText(yaml, {})).toThrow(
      /CONFIG_ENV_MISSING.*SF_CLIENT_ID, VAULT_PASSWORD, VAULT_USER/,
    );
    expect(interpolateEnv({ a: "${X:-dflt}" }, {})).toEqual({ a: "dflt" });
  });
  it("wraps schema and YAML errors as ConfigError (exit 5)", () => {
    try {
      loadConfigFromText("version: 2\n", {});
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).exitCode).toBe(5);
      expect((e as ConfigError).issues.join("\n")).toMatch(/version/);
    }
    expect(() => loadConfigFromText("a: [", {})).toThrow(/CONFIG_YAML_INVALID/);
  });
  it("config hash ignores secret rotation", () => {
    const env = { SF_CLIENT_ID: "cid", VAULT_USER: "vu", VAULT_PASSWORD: "vp" };
    const a = configHash(loadConfigFromText(yaml, env));
    const b = configHash(
      loadConfigFromText(yaml, { ...env, VAULT_PASSWORD: "rotated" }),
    );
    const c = configHash(
      loadConfigFromText(
        yaml.replace("historyMonths: 24", "historyMonths: 36"),
        env,
      ),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
