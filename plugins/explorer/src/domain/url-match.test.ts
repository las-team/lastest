import { describe, it, expect } from "vitest";
import { matchUrlPattern } from "./url-match";

const URL_BASE = "https://app.io";

describe("matchUrlPattern", () => {
  it("exact matches the path only", () => {
    expect(matchUrlPattern("/login", "exact", `${URL_BASE}/login`)).toBe(true);
    expect(matchUrlPattern("/login", "exact", `${URL_BASE}/login/`)).toBe(true);
    expect(matchUrlPattern("/login", "exact", `${URL_BASE}/login/2fa`)).toBe(
      false,
    );
  });

  it("'*' matches every page regardless of kind", () => {
    expect(matchUrlPattern("*", "exact", `${URL_BASE}/anything`)).toBe(true);
    expect(matchUrlPattern("*", "prefix", `${URL_BASE}/`)).toBe(true);
  });

  it("prefix wildcard matches the base and subpaths", () => {
    expect(matchUrlPattern("/admin/*", "prefix", `${URL_BASE}/admin`)).toBe(
      true,
    );
    expect(
      matchUrlPattern("/admin/*", "prefix", `${URL_BASE}/admin/users/3`),
    ).toBe(true);
    expect(
      matchUrlPattern("/admin/*", "prefix", `${URL_BASE}/administrator`),
    ).toBe(false);
  });

  it("bare prefix behaves like a wildcard prefix", () => {
    expect(matchUrlPattern("/admin", "prefix", `${URL_BASE}/admin/users`)).toBe(
      true,
    );
  });

  it("regex matches against the path", () => {
    expect(
      matchUrlPattern("^/users/\\d+$", "regex", `${URL_BASE}/users/42`),
    ).toBe(true);
    expect(
      matchUrlPattern("^/users/\\d+$", "regex", `${URL_BASE}/users/abc`),
    ).toBe(false);
  });

  it("malformed regex never matches (and never throws)", () => {
    expect(matchUrlPattern("([unclosed", "regex", `${URL_BASE}/x`)).toBe(false);
  });

  it("empty pattern never matches", () => {
    expect(matchUrlPattern("  ", "prefix", `${URL_BASE}/x`)).toBe(false);
  });
});
