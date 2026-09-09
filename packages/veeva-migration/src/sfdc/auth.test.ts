import { createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildJwtAssertion,
  createSfdcAuthenticator,
  decodeJwtClaims,
  parseIdentityUrl,
} from "./auth";
import { SfdcApiError } from "./errors";
import {
  IDENTITY_URL,
  INSTANCE_URL,
  LOGIN_URL,
  ORG_ID,
  USER_ID,
  jsonReply,
  mockFetch,
  testKeyPair,
  tokenRoute,
} from "./test-helpers";

const { privateKey, publicKey } = testKeyPair();
const NOW = Date.parse("2026-09-08T10:00:00Z");

afterEach(() => vi.unstubAllGlobals());

describe("JWT bearer assertion", () => {
  it("is RS256-signed with the expected claims and exp ≤ 3 min", () => {
    const jwt = buildJwtAssertion({
      clientId: "consumerKey",
      username: "mig@acme.com",
      aud: "https://test.salesforce.com",
      privateKey,
      nowMs: NOW,
    });
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = decodeJwtClaims(jwt);
    expect(claims).toEqual({
      iss: "consumerKey",
      sub: "mig@acme.com",
      aud: "https://test.salesforce.com",
      exp: Math.floor(NOW / 1000) + 180,
    });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    v.end();
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(jwt).not.toMatch(/[+/=]/);
  });

  it("caps the lifetime at 180 s and rejects a bad key", () => {
    const jwt = buildJwtAssertion({
      clientId: "c",
      username: "u",
      aud: "a",
      privateKey,
      nowMs: NOW,
      lifetimeSec: 9999,
    });
    expect(decodeJwtClaims(jwt).exp).toBe(Math.floor(NOW / 1000) + 180);
    expect(() =>
      buildJwtAssertion({
        clientId: "c",
        username: "u",
        aud: "a",
        privateKey: "not a key",
        nowMs: NOW,
      }),
    ).toThrow(SfdcApiError);
  });
});

describe("identity URL", () => {
  it("parses 18-char org and user ids (and upgrades 15-char ones)", () => {
    expect(parseIdentityUrl(IDENTITY_URL)).toEqual({
      orgId: ORG_ID,
      userId: USER_ID,
    });
    expect(
      parseIdentityUrl(`${LOGIN_URL}/id/00D000000000001/005000000000001`),
    ).toEqual({ orgId: ORG_ID, userId: USER_ID });
    expect(() => parseIdentityUrl("https://x/nope")).toThrow(/identity URL/);
  });
});

describe("createSfdcAuthenticator", () => {
  it("rejects the username-password flow before any network call", () => {
    const fm = mockFetch([tokenRoute()]);
    expect(() =>
      createSfdcAuthenticator({
        loginUrl: LOGIN_URL,
        auth: { kind: "password", username: "u", password: "p" },
        fetch: fm.fetch,
      }),
    ).toThrow(/username-password flow is retired/);
    try {
      createSfdcAuthenticator({
        loginUrl: LOGIN_URL,
        auth: { kind: "usernamePassword" },
        fetch: fm.fetch,
      });
    } catch (e) {
      expect((e as SfdcApiError).errorClass).toBe("auth");
      expect((e as SfdcApiError).errorCode).toBe("UNSUPPORTED_AUTH_FLOW");
    }
    expect(fm.calls).toHaveLength(0);
  });

  it("requires a private key for JWT and My Domain for client credentials", () => {
    expect(() =>
      createSfdcAuthenticator({
        loginUrl: LOGIN_URL,
        auth: { kind: "jwt", clientId: "c", username: "u" },
      }),
    ).toThrow(/privateKey/);
    expect(() =>
      createSfdcAuthenticator({
        loginUrl: "https://test.salesforce.com",
        auth: { kind: "clientCredentials", clientId: "c", clientSecret: "s" },
      }),
    ).toThrow(/My Domain/);
  });

  it("exchanges a JWT assertion on the token endpoint via the stubbed global fetch", async () => {
    const fm = mockFetch([tokenRoute()]);
    vi.stubGlobal("fetch", fm.fetch);
    const auth = createSfdcAuthenticator({
      loginUrl: `${LOGIN_URL}/`,
      auth: {
        kind: "jwt",
        clientId: "ck",
        username: "mig@acme.com",
        aud: LOGIN_URL,
        privateKey,
      },
      now: () => NOW,
    });
    const s = await auth.getSession();
    expect(s).toMatchObject({
      accessToken: "token1",
      instanceUrl: INSTANCE_URL,
      orgId: ORG_ID,
      userId: USER_ID,
      tokenType: "Bearer",
    });
    expect(s.serverDate).toBe("Tue, 08 Sep 2026 10:00:00 GMT");
    expect(fm.calls).toHaveLength(1);
    const call = fm.calls[0];
    expect(call.url).toBe(`${LOGIN_URL}/services/oauth2/token`);
    expect(call.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(call.body ?? "");
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(decodeJwtClaims(form.get("assertion") ?? "")).toMatchObject({
      iss: "ck",
      sub: "mig@acme.com",
      aud: LOGIN_URL,
    });
    // cached; concurrent callers share one exchange
    await Promise.all([auth.getSession(), auth.getSession()]);
    expect(auth.exchanges).toBe(1);
  });

  it("uses client_credentials form fields on a My Domain URL", async () => {
    const fm = mockFetch([tokenRoute()]);
    const auth = createSfdcAuthenticator({
      loginUrl: INSTANCE_URL,
      auth: { kind: "clientCredentials", clientId: "cid", clientSecret: "sec" },
      fetch: fm.fetch,
    });
    await auth.getSession();
    const form = new URLSearchParams(fm.calls[0].body ?? "");
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("sec");
    expect(fm.calls[0].url).toBe(`${INSTANCE_URL}/services/oauth2/token`);
  });

  it("refresh() re-runs the exchange once for a stale token and dedupes concurrent refreshes", async () => {
    const fm = mockFetch([tokenRoute()]);
    const auth = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
      fetch: fm.fetch,
    });
    const s1 = await auth.getSession();
    const [a, b] = await Promise.all([
      auth.refresh(s1.accessToken),
      auth.refresh(s1.accessToken),
    ]);
    expect(a.accessToken).toBe("token2");
    expect(b.accessToken).toBe("token2");
    // a caller holding an already-replaced token gets the current session without a new exchange
    const c = await auth.refresh(s1.accessToken);
    expect(c.accessToken).toBe("token2");
    expect(auth.exchanges).toBe(2);
    auth.invalidate();
    expect((await auth.getSession()).accessToken).toBe("token3");
  });

  it("surfaces OAuth errors as auth-class errors with a hint for unapproved consumers", async () => {
    const fm = mockFetch([
      {
        method: "POST",
        match: "/oauth2/token",
        reply: () =>
          jsonReply(
            {
              error: "invalid_grant",
              error_description: "user hasn't approved this consumer",
            },
            400,
          ),
      },
    ]);
    const auth = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
      fetch: fm.fetch,
    });
    const err = (await auth
      .getSession()
      .catch((e: unknown) => e)) as SfdcApiError;
    expect(err).toBeInstanceOf(SfdcApiError);
    expect(err.errorClass).toBe("auth");
    expect(err.errorCode).toBe("invalid_grant");
    expect(err.message).toMatch(/pre-authorize/);
  });

  it("classifies a 503 from the token endpoint as retryable and a bad body as auth", async () => {
    let n = 0;
    const fm = mockFetch([
      {
        method: "POST",
        match: "/oauth2/token",
        reply: () =>
          ++n === 1
            ? jsonReply({ error: "server_error" }, 503)
            : jsonReply({ access_token: "t" }, 200),
      },
    ]);
    const auth = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: { kind: "jwt", clientId: "c", username: "u", privateKey },
      fetch: fm.fetch,
    });
    const e1 = (await auth
      .getSession()
      .catch((e: unknown) => e)) as SfdcApiError;
    expect(e1.errorClass).toBe("retryable");
    const e2 = (await auth
      .getSession()
      .catch((e: unknown) => e)) as SfdcApiError;
    expect(e2.errorCode).toBe("INVALID_TOKEN_RESPONSE");
  });

  it("reads the private key from privateKeyPath", async () => {
    const { writeFile, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "sfkey-"));
    const path = join(dir, "sf.key");
    await writeFile(path, privateKey);
    const fm = mockFetch([tokenRoute()]);
    const auth = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: path },
      fetch: fm.fetch,
    });
    expect((await auth.getSession()).orgId).toBe(ORG_ID);
    const missing = createSfdcAuthenticator({
      loginUrl: LOGIN_URL,
      auth: {
        kind: "jwt",
        clientId: "c",
        username: "u",
        privateKeyPath: join(dir, "nope.key"),
      },
      fetch: fm.fetch,
    });
    await expect(missing.getSession()).rejects.toMatchObject({
      errorCode: "MISSING_PRIVATE_KEY",
    });
  });
});
