import { describe, it, expect } from "vitest";
import {
  accessLevelForScopes,
  parseScopes,
  MCP_OAUTH_SCOPES,
  MCP_WRITE_SCOPE,
  MCP_READ_SCOPE,
} from "./tool-policy";

describe("mcp scope → access level", () => {
  it("grants write only for the write scope", () => {
    expect(accessLevelForScopes("openid lastest:write")).toBe("write");
    expect(accessLevelForScopes(["openid", MCP_WRITE_SCOPE])).toBe("write");
  });

  it("grants read for the read scope", () => {
    expect(accessLevelForScopes(MCP_READ_SCOPE)).toBe("read");
    expect(accessLevelForScopes(`openid ${MCP_READ_SCOPE}`)).toBe("read");
  });

  it("refuses a token carrying no Lastest scope", () => {
    // "Sign in with Lastest" and "read everything in Lastest" are different
    // consents. Defaulting to read granted the second off the first — and the
    // unparseable cases below all collapse to [], so they took the same path.
    expect(accessLevelForScopes("openid profile email")).toBeNull();
    expect(accessLevelForScopes("")).toBeNull();
    expect(accessLevelForScopes(null)).toBeNull();
    expect(accessLevelForScopes(undefined)).toBeNull();
    expect(accessLevelForScopes([])).toBeNull();
  });

  it("never grants full — deletes and public shares stay behind an API key", () => {
    for (const scope of MCP_OAUTH_SCOPES) {
      expect(accessLevelForScopes(scope)).not.toBe("full");
    }
    expect(accessLevelForScopes(MCP_OAUTH_SCOPES.join(" "))).toBe("write");
    expect(accessLevelForScopes(MCP_OAUTH_SCOPES.join(" "))).not.toBe("full");
  });

  it("does not match a scope by prefix or substring", () => {
    expect(accessLevelForScopes("lastest:write-ish")).toBeNull();
    expect(accessLevelForScopes("notlastest:write")).toBeNull();
    expect(accessLevelForScopes(`lastest:read-only`)).toBeNull();
  });

  it("parses space- and comma-separated lists", () => {
    expect(parseScopes("a b  c")).toEqual(["a", "b", "c"]);
    expect(parseScopes("a,b, c")).toEqual(["a", "b", "c"]);
  });

  it("advertises both Lastest scopes", () => {
    expect(MCP_OAUTH_SCOPES).toContain(MCP_READ_SCOPE);
    expect(MCP_OAUTH_SCOPES).toContain(MCP_WRITE_SCOPE);
  });
});
