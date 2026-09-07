import { describe, expect, it } from "vitest";

import { KNOWN_COUNTRY_CODES } from "../model/countries";
import { countryName, isCountryCode, normalizeCountry } from "./countries";

describe("countries", () => {
  it("has a full ISO-3166-1 alpha-2 table", () => {
    expect(KNOWN_COUNTRY_CODES.length).toBeGreaterThanOrEqual(240);
    for (const code of KNOWN_COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    expect(isCountryCode("DE")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("XX")).toBe("XX");
  });

  it("normalises codes, names, aliases and decorated values", () => {
    expect(normalizeCountry("de")).toBe("DE");
    expect(normalizeCountry(" FR ")).toBe("FR");
    expect(normalizeCountry("Germany")).toBe("DE");
    expect(normalizeCountry("germany")).toBe("DE");
    expect(normalizeCountry("Deutschland")).toBe("DE");
    expect(normalizeCountry("United States")).toBe("US");
    expect(normalizeCountry("USA")).toBe("US");
    expect(normalizeCountry("United Kingdom")).toBe("GB");
    expect(normalizeCountry("UK")).toBe("GB");
    expect(normalizeCountry("Türkiye")).toBe("TR");
    expect(normalizeCountry("Turkiye")).toBe("TR");
    expect(normalizeCountry("Côte d'Ivoire")).toBe("CI");
    expect(normalizeCountry("Cote d'Ivoire")).toBe("CI");
    expect(normalizeCountry("Germany (DE)")).toBe("DE");
    expect(normalizeCountry("DE - Germany")).toBe("DE");
    expect(normalizeCountry("Narnia")).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry("XX")).toBeNull();
  });
});
