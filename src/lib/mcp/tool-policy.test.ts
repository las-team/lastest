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

  it("defaults to read for everything else", () => {
    expect(accessLevelForScopes("openid profile email")).toBe("read");
    expect(accessLevelForScopes(MCP_READ_SCOPE)).toBe("read");
    expect(accessLevelForScopes("")).toBe("read");
    expect(accessLevelForScopes(null)).toBe("read");
    expect(accessLevelForScopes(undefined)).toBe("read");
  });

  it("never grants full — deletes and public shares stay behind an API key", () => {
    for (const scope of MCP_OAUTH_SCOPES) {
      expect(accessLevelForScopes(scope)).not.toBe("full");
    }
    expect(accessLevelForScopes(MCP_OAUTH_SCOPES.join(" "))).not.toBe("full");
  });

  it("does not match a scope by prefix or substring", () => {
    expect(accessLevelForScopes("lastest:write-ish")).toBe("read");
    expect(accessLevelForScopes("notlastest:write")).toBe("read");
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
