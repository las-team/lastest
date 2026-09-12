import { describe, expect, it } from "vitest";
import {
  buildCountryPredicate,
  countryOfSoqlPath,
  formatCountryOf,
  isTerritoryCountryRule,
  parseCountryOf,
  parseCountryOfRule,
  relationshipName,
} from "./country-of";

describe("countryOf grammar (§6.0.5)", () => {
  it("parses every rule form", () => {
    expect(parseCountryOfRule("global")).toEqual({ kind: "global" });
    expect(parseCountryOfRule("account")).toEqual({ kind: "account" });
    expect(parseCountryOfRule("account:From_Account_vod__c")).toEqual({
      kind: "account",
      field: "From_Account_vod__c",
    });
    expect(parseCountryOfRule("user")).toEqual({ kind: "user" });
    expect(parseCountryOfRule("user:OwnerId")).toEqual({
      kind: "user",
      field: "OwnerId",
    });
    expect(
      parseCountryOfRule("field:Country_vod__r.Alpha_2_Code_vod__c"),
    ).toEqual({ kind: "field", path: "Country_vod__r.Alpha_2_Code_vod__c" });
    expect(parseCountryOfRule("parent:call2")).toEqual({
      kind: "parent",
      key: "call2",
    });
    expect(parseCountryOfRule("parent:call2:Call2_vod__c")).toEqual({
      kind: "parent",
      key: "call2",
      field: "Call2_vod__c",
    });
    expect(parseCountryOfRule("const:DE")).toEqual({
      kind: "const",
      iso2: "DE",
    });
  });
  it("rejects anything outside the closed grammar", () => {
    expect(() => parseCountryOfRule("owner")).toThrow(
      /MAP_COUNTRY_RULE_INVALID|Invalid countryOf/,
    );
    expect(() => parseCountryOfRule("parent:nope")).toThrow();
    expect(() => parseCountryOfRule("const:Germany")).toThrow();
    expect(() => parseCountryOf([])).toThrow();
  });
  it("recognises the territory country rule grammar (objects.territory.countryOf)", () => {
    for (const ok of ["fromUsers", "prefixMap", "field:Country__c", "const:DE"])
      expect(isTerritoryCountryRule(ok), ok).toBe(true);
    for (const no of [
      "global",
      "account",
      "user:OwnerId",
      "field:",
      "const:de",
      3,
      undefined,
      ["fromUsers"],
    ])
      expect(isTerritoryCountryRule(no), String(no)).toBe(false);
  });
  it("round-trips through formatCountryOf", () => {
    for (const r of [
      "global",
      "account",
      "account:X__c",
      "user",
      "user:OwnerId",
      "field:A.B",
      "parent:call2",
      "parent:call2:F__c",
      "const:US",
    ])
      expect(formatCountryOf(parseCountryOfRule(r))).toBe(r);
    expect(parseCountryOf("account")).toEqual([{ kind: "account" }]);
    expect(parseCountryOf(["account", "user:OwnerId"])).toHaveLength(2);
  });
  it("builds SOQL paths and fallback predicates", () => {
    expect(relationshipName("Account_vod__c")).toBe("Account_vod__r");
    expect(relationshipName("OwnerId")).toBe("Owner");
    expect(countryOfSoqlPath({ kind: "account" })).toBe(
      "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c",
    );
    expect(countryOfSoqlPath({ kind: "user", field: "OwnerId" })).toBe(
      "Owner.Country_vod__c",
    );
    expect(
      countryOfSoqlPath({ kind: "user" }, { userCountryIsLookup: true }),
    ).toBe("User_vod__r.Country_vod__r.Alpha_2_Code_vod__c");
    expect(
      countryOfSoqlPath(
        { kind: "parent", key: "call2", field: "Call2_vod__c" },
        {},
        "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c",
      ),
    ).toBe("Call2_vod__r.Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c");
    expect(
      buildCountryPredicate(parseCountryOf(["account", "user:OwnerId"]), "DE"),
    ).toBe(
      "(Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c = 'DE') OR (Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c = null AND Owner.Country_vod__c = 'DE')",
    );
    expect(buildCountryPredicate([{ kind: "global" }], "DE")).toBeUndefined();
    expect(
      buildCountryPredicate(
        [{ kind: "field", path: "Country_vod__r.Alpha_2_Code_vod__c" }],
        "US",
      ),
    ).toBe("(Country_vod__r.Alpha_2_Code_vod__c = 'US')");
  });
});
