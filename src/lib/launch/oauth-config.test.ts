import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isValidClientId,
  isAllowedRedirectUri,
  scopeIncludes,
  LAUNCH_CLIENT_ID,
} from "./oauth-config";

describe("launch/oauth-config", () => {
  afterEach(() => {
    delete process.env.LAUNCH_REDIRECT_ORIGINS;
    vi.unstubAllEnvs();
  });

  it("only accepts the launch-www client id", () => {
    expect(isValidClientId(LAUNCH_CLIENT_ID)).toBe(true);
    expect(isValidClientId("something-else")).toBe(false);
    expect(isValidClientId(null)).toBe(false);
  });

  it("allows the production launch origin by default and localhost in dev", () => {
    // Stub NODE_ENV explicitly — the Dockerfile sets NODE_ENV=production before
    // running vitest, which would otherwise hide the dev-mode localhost branch.
    vi.stubEnv("NODE_ENV", "development");
    expect(
      isAllowedRedirectUri("https://launch.lastest.cloud/auth/callback"),
    ).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3000/x")).toBe(true);
    // 3001-3003 are Next's automatic fallbacks when 3000 is busy.
    expect(isAllowedRedirectUri("http://localhost:3001/x")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3002/launch/submit")).toBe(
      true,
    );
    expect(isAllowedRedirectUri("http://localhost:3003/x")).toBe(true);
    expect(isAllowedRedirectUri("https://evil.example.com/x")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
    expect(isAllowedRedirectUri(null)).toBe(false);
  });

  it("rejects localhost in production, accepts apex + subdomain", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      isAllowedRedirectUri("https://launch.lastest.cloud/auth/callback"),
    ).toBe(true);
    expect(isAllowedRedirectUri("https://lastest.cloud/launch/submit")).toBe(
      true,
    );
    expect(
      isAllowedRedirectUri("https://www.lastest.cloud/launch/submit"),
    ).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3000/x")).toBe(false);
    expect(isAllowedRedirectUri("https://evil.example.com/x")).toBe(false);
  });

  it("honors the LAUNCH_REDIRECT_ORIGINS env allowlist", () => {
    process.env.LAUNCH_REDIRECT_ORIGINS =
      "https://staging.launch.lastest.cloud";
    expect(
      isAllowedRedirectUri("https://staging.launch.lastest.cloud/cb"),
    ).toBe(true);
    expect(isAllowedRedirectUri("https://launch.lastest.cloud/cb")).toBe(false);
  });

  it("scopeIncludes checks a space-separated scope string", () => {
    expect(scopeIncludes("launch:vote launch:submit", "launch:vote")).toBe(
      true,
    );
    expect(scopeIncludes("launch:submit", "launch:vote")).toBe(false);
    expect(scopeIncludes(null, "launch:vote")).toBe(false);
    expect(scopeIncludes("", "launch:vote")).toBe(false);
  });
});
