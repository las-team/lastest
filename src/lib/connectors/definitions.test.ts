import { describe, it, expect } from "vitest";
import {
  CONNECTOR_TYPES,
  getAuthMethod,
  getConnectorType,
  normalizeConnectorConfig,
} from "./definitions";
import { redactSecrets } from "@/lib/security/redact";

/** True when the host-side log redactor would strip a field with this key. */
const isRedacted = (key: string) =>
  (redactSecrets({ [key]: "sensitive-value" }) as Record<string, string>)[
    key
  ] === "[REDACTED]";

describe("connector definitions", () => {
  it("declares both SUT types with at least one method each", () => {
    expect(CONNECTOR_TYPES.map((t) => t.type).sort()).toEqual([
      "salesforce",
      "vault",
    ]);
    for (const t of CONNECTOR_TYPES) {
      expect(t.methods.length).toBeGreaterThan(0);
    }
  });

  it("gives every method at least one credential field", () => {
    for (const t of CONNECTOR_TYPES) {
      for (const m of t.methods) {
        expect(m.credentialFields.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The invariant that makes redaction work: BOTH redactors key off the field
   * NAME, not the `secret` flag. A secret whose key does not look secret is
   * encrypted at rest and then printed in plaintext in logs and run output.
   *
   * This asserts the host-side redactor. The EB-side twin
   * (`defaultIsSecretKey` in packages/embedded-browser) is asserted against
   * the same key names in that package's own test — the two lists are
   * deliberately separate copies, so both need a guard.
   */
  it("names every secret field so the log redactor recognizes it", () => {
    for (const t of CONNECTOR_TYPES) {
      for (const m of t.methods) {
        for (const f of m.credentialFields) {
          if (!f.secret) continue;
          expect(
            isRedacted(f.key),
            `${t.type}/${m.method}: secret field "${f.key}" is not redacted — it would leak into logs`,
          ).toBe(true);
        }
      }
    }
  });

  it("never puts a secret-looking value in the plaintext config", () => {
    for (const t of CONNECTOR_TYPES) {
      for (const m of t.methods) {
        for (const f of m.configFields) {
          expect(
            isRedacted(f.key),
            `${t.type}/${m.method}: config field "${f.key}" looks like a secret but is stored unencrypted in sut_connectors.config`,
          ).toBe(false);
        }
      }
    }
  });

  it("rejects an unknown type or a method from the wrong type", () => {
    expect(() => getConnectorType("nope" as never)).toThrow(/Unknown/);
    expect(() => getAuthMethod("vault", "sf-jwt-bearer")).toThrow(/not valid/);
    expect(() => getAuthMethod("salesforce", "vault-password")).toThrow(
      /not valid/,
    );
  });
});

describe("normalizeConnectorConfig", () => {
  it("keeps only the fields the method declares", () => {
    const out = normalizeConnectorConfig("vault", "vault-password", {
      vaultDns: "my-vault.veevavault.com",
      apiVersion: "v25.1",
      // A client posting extra keys must not get them written to plaintext.
      password: "hunter2",
      oauthClientId: "should-not-appear",
    });
    expect(out).toEqual({
      vaultDns: "my-vault.veevavault.com",
      apiVersion: "v25.1",
    });
  });

  it("applies the declared default for an omitted field", () => {
    const out = normalizeConnectorConfig("vault", "vault-password", {
      vaultDns: "my-vault.veevavault.com",
    });
    expect(out.apiVersion).toBe("v25.1");
  });

  it("requires a host with no scheme or path", () => {
    expect(() =>
      normalizeConnectorConfig("vault", "vault-password", {
        vaultDns: "https://my-vault.veevavault.com",
      }),
    ).toThrow(/host name only/);
    expect(() =>
      normalizeConnectorConfig("vault", "vault-password", {
        vaultDns: "my-vault.veevavault.com/api",
      }),
    ).toThrow(/host name only/);
  });

  it("requires https for a URL field", () => {
    expect(() =>
      normalizeConnectorConfig("salesforce", "sf-ui-login", {
        loginUrl: "http://test.salesforce.com",
      }),
    ).toThrow(/https/);
    expect(
      normalizeConnectorConfig("salesforce", "sf-ui-login", {
        loginUrl: "https://test.salesforce.com",
      }).loginUrl,
    ).toBe("https://test.salesforce.com");
  });

  it("throws when a required field with no default is missing", () => {
    expect(() =>
      normalizeConnectorConfig("salesforce", "sf-jwt-bearer", {
        loginUrl: "https://login.salesforce.com",
        consumerKey: "3MVG9",
      }),
    ).toThrow(/Run-as user name is required/);
  });
});
