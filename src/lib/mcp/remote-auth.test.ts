import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above these declarations, so the factories have to build
// their own spies rather than close over module-level ones.
vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { getMcpSession: vi.fn() } },
}));
vi.mock("@/lib/auth/api-key", () => ({ verifyBearerToken: vi.fn() }));

import { auth } from "@/lib/auth/auth";
import { verifyBearerToken as verifyBearerTokenImport } from "@/lib/auth/api-key";
import { authenticateMcpRequest, wwwAuthenticate } from "./remote-auth";

const getMcpSession = vi.mocked(auth.api.getMcpSession);
const verifyBearerToken = vi.mocked(verifyBearerTokenImport);

const ORIGIN = "https://lastest.example.com";

function request(authorization?: string): Request {
  return new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

/** Minimal stand-in for the plugin's OAuthAccessToken row. */
function oauthToken(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "oauth-tok",
    refreshToken: "refresh-tok",
    refreshTokenExpiresAt: new Date(Date.now() + 600_000),
    userId: "user-1",
    clientId: "client-1",
    scopes: "openid lastest:read",
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  } as Parameters<typeof getMcpSession.mockResolvedValue>[0];
}

describe("authenticateMcpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    getMcpSession.mockResolvedValue(null);
    verifyBearerToken.mockResolvedValue(null);
  });

  it("rejects a request with no Bearer token", async () => {
    const result = await authenticateMcpRequest(request());
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("gives an API key the full tool surface", async () => {
    verifyBearerToken.mockResolvedValue({
      user: { id: "user-9" },
      sessionId: "s1",
      team: null,
    } as Awaited<ReturnType<typeof verifyBearerTokenImport>>);
    const result = await authenticateMcpRequest(request("Bearer key-123"));
    expect(result).toMatchObject({
      ok: true,
      caller: {
        accessLevel: "full",
        client: "api-key",
        loopbackToken: "key-123",
      },
    });
  });

  it("maps OAuth scopes onto read/write, never full", async () => {
    getMcpSession.mockResolvedValue(oauthToken());
    const read = await authenticateMcpRequest(request("Bearer oauth-tok"));
    expect(read).toMatchObject({ ok: true, caller: { accessLevel: "read" } });

    getMcpSession.mockResolvedValue(
      oauthToken({ scopes: "openid lastest:write" }),
    );
    const write = await authenticateMcpRequest(request("Bearer oauth-tok"));
    expect(write).toMatchObject({ ok: true, caller: { accessLevel: "write" } });
  });

  it("does not forward the OAuth token onward — it mints a loopback grant", async () => {
    getMcpSession.mockResolvedValue(oauthToken());
    const result = await authenticateMcpRequest(request("Bearer oauth-tok"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // /api/v1 deliberately does not accept OAuth tokens; handing one to the
    // loopback client would defeat the scope-derived tool policy.
    expect(result.caller.loopbackToken).not.toBe("oauth-tok");
    expect(result.caller.loopbackToken.startsWith("lmcp_")).toBe(true);
  });

  it("rejects an expired access token", async () => {
    // better-auth's getMcpSession looks the token up without checking expiry,
    // so this guard is ours. Without it a token would work forever.
    getMcpSession.mockResolvedValue(
      oauthToken({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
    );
    expect(
      await authenticateMcpRequest(request("Bearer oauth-tok")),
    ).toMatchObject({ ok: false, status: 401 });

    getMcpSession.mockResolvedValue(oauthToken({ accessTokenExpiresAt: null }));
    expect(
      await authenticateMcpRequest(request("Bearer oauth-tok")),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed when the instance cannot sign a loopback grant", async () => {
    delete process.env.ENCRYPTION_KEY;
    getMcpSession.mockResolvedValue(oauthToken());
    expect(
      await authenticateMcpRequest(request("Bearer oauth-tok")),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("points WWW-Authenticate at the protected-resource document", () => {
    expect(wwwAuthenticate(ORIGIN, "invalid_token")).toBe(
      `Bearer realm="lastest", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token"`,
    );
  });
});
