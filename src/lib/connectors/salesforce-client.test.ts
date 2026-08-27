/**
 * Salesforce OAuth client, against a stubbed token endpoint.
 *
 * The two behaviours worth pinning: `instance_url` comes back DIFFERENT from
 * the login URL and must be captured (getting this wrong sends every later API
 * call to the wrong host and fails confusingly), and `invalid_grant` on the JWT
 * flow must be explained as clock skew rather than passed through raw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("./fetch", () => ({
  connectorFetch: (...a: unknown[]) => fetchMock(...a),
}));
vi.mock("server-only", () => ({}));

const { verifySalesforceClientCredentials, verifySalesforceJwtBearer } =
  await import("./salesforce-client");

/** A throwaway RSA key so the JWT flow reaches the network stub. */
async function testPrivateKey(): Promise<string> {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return privateKey as string;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const SF_CONFIG = {
  loginUrl: "https://test.salesforce.com",
  apiVersion: "v62.0",
  consumerKey: "3MVG9consumer",
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.useRealTimers());

describe("client credentials flow", () => {
  it("captures the instance URL, which differs from the login URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        access_token: "00Dxx!secret",
        instance_url: "https://mycompany--uat.sandbox.my.salesforce.com",
      }),
    );
    const res = await verifySalesforceClientCredentials(SF_CONFIG, {
      consumerSecret: "shh",
    });
    expect(res.ok).toBe(true);
    expect(res.instanceUrl).toBe(
      "https://mycompany--uat.sandbox.my.salesforce.com",
    );
    expect(res.instanceUrl).not.toBe(SF_CONFIG.loginUrl);
  });

  it("posts to the login host's token endpoint with the client_credentials grant", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "t", instance_url: "https://i" }),
    );
    await verifySalesforceClientCredentials(SF_CONFIG, {
      consumerSecret: "shh",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test.salesforce.com/services/oauth2/token");
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain("client_secret=shh");
  });

  it("never returns the access token to the caller", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        access_token: "00Dxx!secret",
        instance_url: "https://i",
      }),
    );
    const res = await verifySalesforceClientCredentials(SF_CONFIG, {
      consumerSecret: "shh",
    });
    expect(JSON.stringify(res)).not.toContain("00Dxx!secret");
  });

  it("refuses before the network when the secret is missing", async () => {
    const res = await verifySalesforceClientCredentials(SF_CONFIG, {});
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains an invalid_client as the Spring '26 app-model change", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        error: "invalid_client",
        error_description: "client identifier invalid",
      }),
    );
    const res = await verifySalesforceClientCredentials(SF_CONFIG, {
      consumerSecret: "wrong",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/External Client App/);
  });
});

describe("JWT bearer flow", () => {
  const jwtConfig = { ...SF_CONFIG, jwtSubject: "svc@example.com" };

  it("signs an assertion whose exp is inside Salesforce's 5-minute window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "t", instance_url: "https://i" }),
    );
    const res = await verifySalesforceJwtBearer(jwtConfig, {
      privateKey: await testPrivateKey(),
    });
    expect(res.ok).toBe(true);

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const [, claimsB64] = body.get("assertion")!.split(".");
    const claims = JSON.parse(
      Buffer.from(claimsB64, "base64url").toString("utf8"),
    );
    const now = Math.floor(Date.now() / 1000);
    expect(claims.exp - now).toBeGreaterThan(0);
    expect(claims.exp - now).toBeLessThan(300);
    expect(claims.iss).toBe(jwtConfig.consumerKey);
    expect(claims.sub).toBe("svc@example.com");
    // `aud` must be the host the assertion is presented to, so a sandbox
    // assertion is not silently minted for production.
    expect(claims.aud).toBe("https://test.salesforce.com");
  });

  it("maps invalid_grant to the clock-skew explanation", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: "invalid_grant", error_description: "" }),
    );
    const res = await verifySalesforceJwtBearer(jwtConfig, {
      privateKey: await testPrivateKey(),
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/clock/i);
    expect(res.error).toMatch(/5 minutes/);
  });

  it("reports an unusable key without echoing the key material", async () => {
    const res = await verifySalesforceJwtBearer(jwtConfig, {
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/PEM/);
    expect(res.error).not.toContain("not-a-key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
