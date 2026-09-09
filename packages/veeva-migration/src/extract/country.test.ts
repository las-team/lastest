import { describe, expect, it } from "vitest";
import { parseCountryOf } from "../country-of";
import { buildMaterialisedMapping, IDS, SAMPLE_USER_ID } from "../testkit";
import { to18 } from "../transform/ids";
import type { CountryOfSpec } from "../types";
import {
  attributeCountry,
  buildCountryStrategy,
  chainPredicate,
  countryColumns,
  expandCountryRules,
  parentFieldFromMapping,
} from "./country";

const ACC = "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c";

describe("buildCountryStrategy — SOQL fallback chains (§6.0.5)", () => {
  it("'account (fallback user)' nests null guards", () => {
    const s = buildCountryStrategy(
      parseCountryOf(["account", "user:OwnerId"]),
      "US",
    );
    expect(s.kind).toBe("predicate");
    if (s.kind !== "predicate") return;
    expect(s.predicate).toBe(
      `(${ACC} = 'US') OR (${ACC} = null AND Owner.Country_vod__c = 'US')`,
    );
    expect(s.paths).toEqual([ACC, "Owner.Country_vod__c"]);
  });

  it("field rule and user lookup type resolved at preflight", () => {
    const f = buildCountryStrategy(
      parseCountryOf("field:Country_vod__r.Alpha_2_Code_vod__c"),
      "DE",
    );
    expect(f.kind === "predicate" && f.predicate).toBe(
      "(Country_vod__r.Alpha_2_Code_vod__c = 'DE')",
    );
    const u = buildCountryStrategy(
      parseCountryOf("user:Inventory_For_vod__c"),
      "JP",
      {
        userCountryIsLookup: true,
      },
    );
    expect(u.kind === "predicate" && u.predicate).toBe(
      "(Inventory_For_vod__r.Country_vod__r.Alpha_2_Code_vod__c = 'JP')",
    );
  });

  it("parent:<key>:<field> expands the parent's chain through the relationship (registry default)", () => {
    const s = buildCountryStrategy(
      parseCountryOf("parent:call2:Call2_vod__c"),
      "US",
    );
    expect(s.kind).toBe("predicate");
    if (s.kind !== "predicate") return;
    const p = `Call2_vod__r.${ACC}`;
    const u1 = "Call2_vod__r.User_vod__r.Country_vod__c";
    const u2 = "Call2_vod__r.Owner.Country_vod__c";
    expect(s.predicate).toBe(
      `(${p} = 'US') OR (${p} = null AND ${u1} = 'US') OR (${p} = null AND ${u1} = null AND ${u2} = 'US')`,
    );
  });

  it("two-level parent chains (call2_detail → call2 → account) stay within 5 hops; deeper falls back to id-set", () => {
    const parentCountryOf = (key: string): CountryOfSpec[] | undefined =>
      key === "call2"
        ? parseCountryOf("account")
        : key === "account"
          ? parseCountryOf("field:Country_vod__r.Alpha_2_Code_vod__c")
          : undefined;
    const ok = buildCountryStrategy(
      parseCountryOf("parent:call2:Call2_vod__c"),
      "US",
      {
        parentCountryOf: parentCountryOf as never,
      },
    );
    expect(ok.kind === "predicate" && ok.predicate).toBe(
      `(Call2_vod__r.${ACC} = 'US')`,
    );
    const deep = buildCountryStrategy(
      parseCountryOf("parent:call2:Call2_vod__c"),
      "US",
      {
        parentCountryOf: parentCountryOf as never,
        maxHops: 2,
      },
    );
    expect(deep.kind).toBe("idSet");
    if (deep.kind === "idSet") {
      expect(deep.parentKey).toBe("call2");
      expect(deep.field).toBe("Call2_vod__c");
    }
  });

  it("parent without a country chain → id-set; lookup field taken from the mapping's ref() row", () => {
    const mapping = buildMaterialisedMapping({
      objectKey: "call2_detail",
      fields: [
        {
          source: "Call2_vod__c",
          target: "call2__v",
          transform: { kind: "ref", objectKey: "call2" },
          required: "Y",
        },
      ],
    });
    const s = buildCountryStrategy(parseCountryOf("parent:call2"), "US", {
      parentCountryOf: () => undefined,
      parentFieldFor: parentFieldFromMapping(mapping),
    });
    expect(s).toMatchObject({
      kind: "idSet",
      parentKey: "call2",
      field: "Call2_vod__c",
      paths: [],
    });
    expect(countryColumns(s)).toEqual(["Call2_vod__c"]);
  });

  it("global objects and GLOBAL units have no predicate", () => {
    expect(buildCountryStrategy(parseCountryOf("global"), "US")).toEqual({
      kind: "global",
    });
    expect(buildCountryStrategy(parseCountryOf("account"), "GLOBAL")).toEqual({
      kind: "global",
    });
  });

  it("const rules: matching tail claims the null rows, other-country const yields nothing", () => {
    const specs = parseCountryOf(["field:Country_Code__c", "const:US"]);
    const us = buildCountryStrategy(specs, "US");
    expect(us.kind === "all" && us.predicate).toBe(
      "(Country_Code__c = 'US') OR (Country_Code__c = null)",
    );
    const de = buildCountryStrategy(specs, "DE");
    expect(de.kind === "predicate" && de.predicate).toBe(
      "(Country_Code__c = 'DE')",
    );
    expect(buildCountryStrategy(parseCountryOf("const:US"), "DE")).toEqual({
      kind: "none",
    });
    const only = buildCountryStrategy(parseCountryOf("const:US"), "US");
    expect(only.kind).toBe("all");
    expect(only.kind === "all" && only.predicate).toBeUndefined();
  });

  it("escapes the ISO literal", () => {
    expect(chainPredicate(["A"], "U'S")).toBe("(A = 'U\\'S')");
  });

  it("expandCountryRules reports the reason for unexpressible rules", () => {
    const r = expandCountryRules(parseCountryOf("parent:call2"), {
      parentCountryOf: () => undefined,
    });
    expect(r[0].paths).toEqual([]);
    expect(r[0].reason).toMatch(/names no lookup field/);
  });
});

describe("attributeCountry — per-row evaluation of the chain", () => {
  const specs = parseCountryOf(["account", "user:User_vod__c", "user:OwnerId"]);

  it("first non-null rule wins; values are upper-cased", () => {
    expect(
      attributeCountry(
        { Id: IDS.call1, [ACC]: "us", "User_vod__r.Country_vod__c": "DE" },
        specs,
      ),
    ).toBe("US");
    expect(
      attributeCountry(
        {
          Id: IDS.call1,
          [ACC]: null,
          "User_vod__r.Country_vod__c": null,
          "Owner.Country_vod__c": "FR",
        },
        specs,
      ),
    ).toBe("FR");
    expect(attributeCountry({ Id: IDS.call1 }, specs)).toBeUndefined();
  });

  it("global → GLOBAL, const → the constant", () => {
    expect(attributeCountry({ Id: IDS.call1 }, parseCountryOf("global"))).toBe(
      "GLOBAL",
    );
    expect(
      attributeCountry(
        { Id: IDS.call1 },
        parseCountryOf(["field:X", "const:JP"]),
      ),
    ).toBe("JP");
  });

  it("parent rules fall back to the caller's parent-country lookup (id map / this run)", () => {
    const callId = to18("a0K000000000009");
    const row = { Id: to18("a0D000000000001"), Call2_vod__c: callId };
    const c = attributeCountry(
      row,
      parseCountryOf("parent:call2:Call2_vod__c"),
      {
        parentCountryOf: () => undefined,
        parentCountry: (k, id) =>
          k === "call2" && id === callId ? "BR" : undefined,
      },
    );
    expect(c).toBe("BR");
    expect(
      attributeCountry(row, parseCountryOf("parent:call2:Call2_vod__c"), {
        parentCountryOf: () => undefined,
      }),
    ).toBeUndefined();
  });

  it("reads nested REST objects as well as flattened CSV keys", () => {
    const row = {
      Id: IDS.call1,
      Account_vod__r: { Country_vod__r: { Alpha_2_Code_vod__c: "CA" } },
      OwnerId: SAMPLE_USER_ID,
    };
    expect(attributeCountry(row, specs)).toBe("CA");
  });
});
