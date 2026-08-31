import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  MCP_AUTHORIZE_PATH,
  MCP_OAUTH_BASE,
  MCP_RESOURCE_PATH,
} from "./discovery";

const ORIGIN = "https://lastest.example.com";

/**
 * The discovery documents are a set of promises about which URLs exist. These
 * assertions are the cheap half of keeping them true: that every advertised
 * path resolves to a route we actually ship (or, for the better-auth-mounted
 * ones, to the plugin's basePath), and that the OAuth 2.1 posture we claim —
 * S256-only, code flow only — is what we advertise.
 */
describe("mcp discovery metadata", () => {
  const meta = authorizationServerMetadata(ORIGIN);

  it("advertises this origin as the issuer", () => {
    expect(meta.issuer).toBe(ORIGIN);
    for (const url of [
      meta.authorization_endpoint,
      meta.token_endpoint,
      meta.registration_endpoint,
    ]) {
      expect(url.startsWith(`${ORIGIN}/`)).toBe(true);
    }
  });

  it("is OAuth 2.1: code flow, PKCE S256 only", () => {
    expect(meta.response_types_supported).toEqual(["code"]);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.grant_types_supported).toContain("authorization_code");
    expect(meta.grant_types_supported).not.toContain("implicit");
    expect(meta.grant_types_supported).not.toContain("password");
  });

  it("routes the authorize endpoint through our consent-forcing front door", () => {
    // Advertising better-auth's endpoint directly would let a client skip the
    // consent screen by simply not sending prompt=consent.
    expect(meta.authorization_endpoint).toBe(`${ORIGIN}${MCP_AUTHORIZE_PATH}`);
    expect(meta.authorization_endpoint).not.toBe(
      `${ORIGIN}${MCP_OAUTH_BASE}/authorize`,
    );
    expect(
      existsSync(
        path.join(process.cwd(), "src/app", MCP_AUTHORIZE_PATH, "route.ts"),
      ),
      `${MCP_AUTHORIZE_PATH} has no route`,
    ).toBe(true);
  });

  it("points the protected-resource document at /api/mcp", () => {
    const prm = protectedResourceMetadata(ORIGIN);
    expect(prm.resource).toBe(`${ORIGIN}${MCP_RESOURCE_PATH}`);
    expect(prm.authorization_servers).toEqual([ORIGIN]);
    expect(prm.scopes_supported).toEqual(["lastest:read", "lastest:write"]);
    expect(
      existsSync(
        path.join(process.cwd(), "src/app", MCP_RESOURCE_PATH, "route.ts"),
      ),
    ).toBe(true);
  });

  it("ships both well-known spellings of the resource document", () => {
    const base = path.join(
      process.cwd(),
      "src/app/.well-known/oauth-protected-resource",
    );
    expect(existsSync(path.join(base, "route.ts"))).toBe(true);
    // RFC 9728 §3.1 path-suffixed form, for clients that derive it from the
    // resource's own path.
    expect(
      existsSync(path.join(base, "api/mcp/route.ts")),
      "missing /.well-known/oauth-protected-resource/api/mcp",
    ).toBe(true);
  });
});
