import { describe, expect, it } from "vitest";
import {
  COUNTRY_NAMES,
  KNOWN_COUNTRY_CODES,
  countryName,
  normalizeCountry,
} from "./countries";

describe("COUNTRY_NAMES", () => {
  it("covers every UN member (≥ 240 alpha-2 codes, lower-cased keys)", () => {
    expect(KNOWN_COUNTRY_CODES.length).toBeGreaterThanOrEqual(240);
    expect(new Set(Object.values(COUNTRY_NAMES)).size).toBe(
      KNOWN_COUNTRY_CODES.length,
    );
    for (const key of Object.keys(COUNTRY_NAMES))
      expect(key).toBe(key.toLowerCase());
    expect(COUNTRY_NAMES["germany"]).toBe("DE");
    expect(COUNTRY_NAMES["deutschland"]).toBe("DE");
    expect(COUNTRY_NAMES["united states"]).toBe("US");
  });

  it("has unique, valid alpha-2 codes", () => {
    for (const code of KNOWN_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(new Set(KNOWN_COUNTRY_CODES).size).toBe(KNOWN_COUNTRY_CODES.length);
  });
});

describe("normalizeCountry", () => {
  it.each([
    ["DE", "DE"],
    ["de", "DE"],
    ["  fr ", "FR"],
    ["DEU", "DE"],
    ["usa", "US"],
    ["GBR", "GB"],
    ["UK", "GB"],
    ["U.K.", "GB"],
    ["Great Britain", "GB"],
    ["United Kingdom", "GB"],
    ["United States", "US"],
    ["United States of America", "US"],
    ["U.S.", "US"],
    ["U.S.A.", "US"],
    ["Germany", "DE"],
    ["Deutschland", "DE"],
    ["GERMANY", "DE"],
    ["Österreich", "AT"],
    ["Osterreich", "AT"],
    ["Czech Republic", "CZ"],
    ["Czechia", "CZ"],
    ["South Korea", "KR"],
    ["Korea, Republic of", "KR"],
    ["Republic of Korea", "KR"],
    ["Hong Kong", "HK"],
    ["Türkiye", "TR"],
    ["Turkey", "TR"],
    ["Côte d'Ivoire", "CI"],
    ["Ivory Coast", "CI"],
    ["The Netherlands", "NL"],
    ["Holland", "NL"],
    ["Russian Federation", "RU"],
    ["Viet Nam", "VN"],
    ["Taiwan", "TW"],
    ["Kosovo", "XK"],
    ["south  africa", "ZA"],
    ["United_Arab_Emirates", "AE"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeCountry(raw)).toBe(expected);
  });

  it("returns null for empty, unknown and non-country input", () => {
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry("   ")).toBeNull();
    expect(normalizeCountry("Atlantis")).toBeNull();
    expect(normalizeCountry("XX")).toBeNull();
    expect(normalizeCountry("ZZZ")).toBeNull();
    expect(normalizeCountry("GLOBAL")).toBeNull();
  });
});

describe("countryName", () => {
  it("returns the English short name", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("de")).toBe("Germany");
    expect(countryName("US")).toBe("United States");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("UK")).toBe("United Kingdom");
  });

  it("falls back to the code itself and names the global bucket", () => {
    expect(countryName("GLOBAL")).toBe("Global");
    expect(countryName("XX")).toBe("XX");
  });
});
