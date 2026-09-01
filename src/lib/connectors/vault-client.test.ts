/**
 * Vault connector verification, against a stubbed Vault.
 *
 * The password path delegates to `VaultProfiler` on purpose — there must be one
 * Vault auth implementation, not two — so these tests also pin that delegation:
 * if someone re-implements `POST /api/{version}/auth` here, the URL assertions
 * are what catch the drift.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();

/**
 * A transport failure is expressed as a marker object rather than by having the
 * mock reject: vitest awaits a `vi.fn()`'s returned promise to record its
 * settled result, so a rejection returned FROM the mock surfaces as an
 * unhandled error and fails the test even when the code under test catches it.
 * Creating the rejection outside the mock keeps that machinery out of the way.
 */
const NETWORK_FAILURE = { __reject: "ECONNREFUSED" };

vi.mock("./fetch", () => ({
  connectorFetch: (...a: unknown[]) => {
    const result = fetchMock(...a);
    return result === NETWORK_FAILURE
      ? Promise.reject(new Error(String(NETWORK_FAILURE.__reject)))
      : result;
  },
}));
vi.mock("server-only", () => ({}));

const { verifyVaultPassword, verifyVaultOAuth, vaultBaseUrl } =
  await import("./vault-client");

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const VAULT_CONFIG = {
  vaultDns: "my-vault.veevavault.com",
  apiVersion: "v25.1",
};

beforeEach(() => fetchMock.mockReset());

describe("vaultBaseUrl", () => {
  it("builds an https origin from a bare host", () => {
    expect(vaultBaseUrl(VAULT_CONFIG)).toBe("https://my-vault.veevavault.com");
  });

  it("tolerates a host a user pasted with a scheme or trailing slash", () => {
    expect(
      vaultBaseUrl({
        ...VAULT_CONFIG,
        vaultDns: "https://my-vault.veevavault.com/",
      }),
    ).toBe("https://my-vault.veevavault.com");
  });
});

describe("password authentication", () => {
  it("authenticates against /api/{version}/auth and reports the user", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { responseStatus: "SUCCESS", sessionId: "sess-1" }),
    );
    const res = await verifyVaultPassword(VAULT_CONFIG, {
      username: "svc@pharma.com",
      password: "hunter2",
    });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("svc@pharma.com");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://my-vault.veevavault.com/api/v25.1/auth",
    );
  });

  it("surfaces Vault's own error message on a rejected login", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        responseStatus: "FAILURE",
        errors: [{ message: "Invalid username or password" }],
      }),
    );
    const res = await verifyVaultPassword(VAULT_CONFIG, {
      username: "svc@pharma.com",
      password: "wrong",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Invalid username or password");
  });

  it("never echoes the password into the result", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { responseStatus: "FAILURE", errors: [] }),
    );
    const res = await verifyVaultPassword(VAULT_CONFIG, {
      username: "u",
      password: "hunter2",
    });
    expect(JSON.stringify(res)).not.toContain("hunter2");
  });

  it("refuses before the network when credentials are missing", async () => {
    const res = await verifyVaultPassword(VAULT_CONFIG, { username: "u" });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("OAuth/OIDC session exchange", () => {
  const oauthConfig = {
    ...VAULT_CONFIG,
    oauthProfileId: "profile-1",
    oauthClientId: "client-1",
  };

  it("exchanges the IdP token at Veeva's login host, not the customer's Vault", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        responseStatus: "SUCCESS",
        sessionId: "sess-2",
        vaultId: "1234",
      }),
    );
    const res = await verifyVaultOAuth(oauthConfig, { idpToken: "idp-jwt" });
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("1234");

    const [url, init] = fetchMock.mock.calls[0];
    // The exchange host is fixed and is NOT the vault DNS — pointing it at the
    // customer's Vault produces a confusing 404.
    expect(url).toBe(
      "https://login.veevavault.com/auth/oauth/session/profile-1",
    );
    expect(init.headers.Authorization).toBe("Bearer idp-jwt");
    expect(String(init.body)).toContain("client_id=client-1");
    expect(String(init.body)).toContain("veevavault.com");
  });

  it("requires a profile id before reaching the network", async () => {
    const res = await verifyVaultOAuth(
      { ...VAULT_CONFIG, oauthProfileId: undefined },
      { idpToken: "idp-jwt" },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/profile id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a failure rather than throwing when the network is down", async () => {
    fetchMock.mockReturnValue(NETWORK_FAILURE);
    const res = await verifyVaultOAuth(oauthConfig, { idpToken: "idp-jwt" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });
});
