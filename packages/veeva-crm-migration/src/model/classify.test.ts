import { describe, expect, it } from "vitest";
import {
  classifyProfileName,
  classifySnapshot,
  countriesFromProfileName,
  countriesFromWhereClause,
} from "./classify";
import type { OrgSnapshot, ProfileConfig } from "./types";

function profile(
  name: string,
  users: Record<string, number> = {},
): ProfileConfig {
  return {
    id: `00e${name}`,
    name,
    userLicense: "Salesforce",
    custom: true,
    objectPermissions: [],
    fieldPermissions: [],
    recordTypeVisibilities: [],
    tabVisibilities: [],
    applicationVisibilities: [],
    layoutAssignments: [
      {
        object: "Call2_vod__c",
        recordType: null,
        layout: `Call2_vod__c-${name}`,
      },
    ],
    activeUsersByCountry: users,
    permissionSetNames: [],
  };
}

function snapshot(
  profiles: ProfileConfig[],
  extra: Partial<OrgSnapshot> = {},
): OrgSnapshot {
  return {
    schemaVersion: 1,
    extractedAt: "2026-01-01T00:00:00Z",
    instanceUrl: "https://example.my.salesforce.com",
    apiVersion: "v64.0",
    countries: [
      { code: "DE", name: "Germany", activeUsers: 10 },
      { code: "FR", name: "France", activeUsers: 5 },
    ],
    profiles,
    permissionSets: [],
    objects: [
      {
        apiName: "Call2_vod__c",
        label: "Call",
        labelPlural: "Calls",
        custom: true,
        managed: true,
        fields: [],
        recordTypes: [],
        layouts: profiles.map((p) => ({
          fullName: `Call2_vod__c-${p.name}`,
          object: "Call2_vod__c",
          recordTypes: [],
          sections: [],
          relatedLists: [],
        })),
        validationRules: [],
      },
    ],
    vmocs: [],
    veevaSettings: [],
    messages: [],
    warnings: [],
    ...extra,
  };
}

describe("classifyProfileName", () => {
  it.each([
    ["DE Sales Rep", "sales_rep"],
    ["FR - Specialty Rep", "specialty_rep"],
    ["Key Account Manager IT", "kam"],
    ["MSL UK", "msl"],
    ["Medical Science Liaison", "msl"],
    ["District Sales Manager", "manager"],
    ["Inside Sales ES", "inside_sales"],
    ["Business Admin", "admin"],
    ["System Administrator", "admin"],
    ["Integration User", "admin"],
    ["Standard User", "other"],
  ])("%s → %s", (name, expected) => {
    expect(classifyProfileName(name).category).toBe(expected);
  });

  it("lets caller rules win by prepending them", () => {
    const res = classifyProfileName("Sales Rep", [
      { pattern: "sales rep", category: "kam" },
    ]);
    expect(res.category).toBe("kam");
  });
});

describe("country inference", () => {
  it("reads country tokens from profile names", () => {
    expect(countriesFromProfileName("DE Sales Rep")).toEqual(["DE"]);
    expect(countriesFromProfileName("Sales Rep - FR")).toEqual(["FR"]);
    expect(countriesFromProfileName("Sales_Rep_IT")).toEqual(["IT"]);
    expect(countriesFromProfileName("MSL (UK)")).toEqual(["UK"]);
  });

  it("does not treat ordinary upper-case words as countries", () => {
    expect(countriesFromProfileName("Sales Rep")).toEqual([]);
    expect(countriesFromProfileName("MSL Rep", ["DE"])).toEqual([]);
  });

  it("filters to known countries when a list is given", () => {
    expect(countriesFromProfileName("XX Sales Rep DE", ["DE"])).toEqual(["DE"]);
  });

  it("parses VMOC where clauses", () => {
    expect(countriesFromWhereClause("Country_vod__c = 'DE'")).toEqual(["DE"]);
    expect(
      countriesFromWhereClause(
        "Country_Code_vod__c IN ('de', 'AT') AND Active_vod__c = true",
      ),
    ).toEqual(["DE", "AT"]);
    expect(countriesFromWhereClause("Active_vod__c = true")).toEqual([]);
    expect(countriesFromWhereClause(null)).toEqual([]);
  });
});

describe("classifySnapshot", () => {
  it("builds the country × category matrix and a global bucket", () => {
    const snap = snapshot([
      profile("DE Sales Rep", { DE: 8 }),
      profile("FR Sales Rep", { FR: 3 }),
      profile("MSL", { DE: 1, FR: 1 }),
      profile("System Administrator", {}),
    ]);
    const result = classifySnapshot(snap);

    expect(result.countries.map((c) => c.country.code)).toEqual(["DE", "FR"]);
    const de = result.countries[0]!;
    expect(de.repConfigs.map((r) => r.category)).toEqual(["msl", "sales_rep"]);
    expect(de.repConfigs[1]!.profiles[0]!.profile.name).toBe("DE Sales Rep");
    expect(de.repConfigs[1]!.layouts.map((l) => l.fullName)).toEqual([
      "Call2_vod__c-DE Sales Rep",
    ]);
    // MSL serves both countries → appears under both.
    expect(
      result.countries[1]!.repConfigs.some((r) => r.category === "msl"),
    ).toBe(true);
    // Admin without any country signal lands in global.
    expect(result.global.map((g) => g.category)).toEqual(["admin"]);
    expect(
      result.profiles.find((p) => p.profile.name === "System Administrator")!
        .rationale,
    ).toContain("no country signal: treated as global");
  });

  it("uses VMOC where clauses and settings scoped to the profile", () => {
    const snap = snapshot([profile("Hospital Rep")], {
      vmocs: [
        {
          id: "a0",
          name: "Account",
          objectApiName: "Account",
          profile: "Hospital Rep",
          device: "iPad",
          active: true,
          whereClause: "WHERE Country_vod__c = 'IT'",
          extra: {},
        },
      ],
      veevaSettings: [
        {
          settingObject: "Veeva_Settings_vod__c",
          level: "org",
          ownerName: null,
          values: { A: 1 },
        },
        {
          settingObject: "Veeva_Settings_vod__c",
          level: "profile",
          ownerName: "Hospital Rep",
          values: { A: 2 },
        },
      ],
      countries: [{ code: "IT", name: "Italy", activeUsers: 0 }],
    });
    const result = classifySnapshot(snap);
    const it_ = result.countries.find((c) => c.country.code === "IT")!;
    expect(it_.repConfigs[0]!.category).toBe("specialty_rep");
    expect(it_.repConfigs[0]!.vmocs).toHaveLength(1);
    expect(it_.repConfigs[0]!.settings).toHaveLength(1);
    expect(it_.repConfigs[0]!.settings[0]!.level).toBe("profile");
  });

  it("adds an empty page for countries that exist but have no mapped profile", () => {
    const result = classifySnapshot(
      snapshot([profile("DE Sales Rep", { DE: 1 })]),
    );
    expect(
      result.countries.find((c) => c.country.code === "FR")!.repConfigs,
    ).toEqual([]);
  });

  it("honours overrides", () => {
    const result = classifySnapshot(snapshot([profile("Weird Name")]), {
      categoryOverrides: { "Weird Name": "kam" },
      countryOverrides: { "Weird Name": ["FR"] },
    });
    expect(
      result.countries.find((c) => c.country.code === "FR")!.repConfigs[0]!
        .category,
    ).toBe("kam");
  });
});
