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

describe("classifyProfile fallbacks (DESIGN §2.1 steps 3–4)", () => {
  it("step 3: uses the majority User_Type_vod__c from the profile aggregate", () => {
    const p = profile("Standard User", { DE: 5 });
    p.repTypeCounts = { "Primary Care Rep": 4, MSL: 1 };
    const result = classifySnapshot(snapshot([p]));
    const cp = result.profiles[0]!;
    expect(cp.category).toBe("sales_rep");
    expect(cp.rationale.join("\n")).toMatch(
      /majority User_Type_vod__c "Primary Care Rep" \(4 active users\)/,
    );
  });

  it("step 3: falls back to snapshot.users when the profile has no aggregate", () => {
    const p = profile("Standard User", { FR: 3 });
    const result = classifySnapshot(
      snapshot([p], {
        users: [
          {
            profileId: p.id,
            profileName: p.name,
            country: "FR",
            userType: "MSL",
            language: "fr",
            activeUsers: 2,
          },
          {
            profileId: p.id,
            profileName: p.name,
            country: "FR",
            userType: "Sales Rep",
            language: "fr",
            activeUsers: 1,
          },
          {
            profileId: "other",
            profileName: "Other",
            country: "FR",
            userType: "Sales Rep",
            language: "fr",
            activeUsers: 50,
          },
        ],
      }),
    );
    expect(result.profiles[0]!.category).toBe("msl");
  });

  it("step 3: never overrides a name-based category", () => {
    const p = profile("DE Sales Rep", { DE: 5 });
    p.repTypeCounts = { MSL: 5 };
    expect(classifySnapshot(snapshot([p])).profiles[0]!.category).toBe(
      "sales_rep",
    );
  });

  it("step 3: an unrecognised user type leaves the profile at other with a note", () => {
    const p = profile("Standard User", { DE: 5 });
    p.repTypeCounts = { Contractor: 5 };
    const cp = classifySnapshot(snapshot([p])).profiles[0]!;
    expect(cp.category).toBe("other");
    expect(cp.rationale.join("\n")).toMatch(
      /majority User_Type_vod__c "Contractor" matched no classification rule/,
    );
  });

  it("step 4: a medical permission set → msl", () => {
    const p = profile("Standard User", { DE: 2 });
    p.permissionSetNames = ["CLM_User", "Medical_Insights_vod"];
    const cp = classifySnapshot(snapshot([p])).profiles[0]!;
    expect(cp.category).toBe("msl");
    expect(cp.rationale.join("\n")).toMatch(/Medical_Insights_vod/);
  });

  it("step 4: a platform / integration / identity licence → admin", () => {
    for (const licence of [
      "Salesforce Platform",
      "Salesforce Integration",
      "Identity",
    ]) {
      const p = profile("Standard User", {});
      p.userLicense = licence;
      const cp = classifySnapshot(snapshot([p])).profiles[0]!;
      expect(cp.category, licence).toBe("admin");
      expect(cp.rationale.join("\n")).toMatch(/user licence/);
    }
  });

  it("step 4: ModifyAllData with no active VMOC → admin, but not with mobile users", () => {
    const p = profile("Standard User", { DE: 1 });
    p.userPermissions = ["PermissionsModifyAllData", "PermissionsViewSetup"];
    expect(classifySnapshot(snapshot([p])).profiles[0]!.category).toBe("admin");

    const withVmoc = classifySnapshot(
      snapshot([p], {
        vmocs: [
          {
            id: "a0",
            name: "Account",
            objectApiName: "Account",
            profile: p.name,
            device: "iPad",
            active: true,
            whereClause: null,
            extra: {},
          },
        ],
      }),
    );
    expect(withVmoc.profiles[0]!.category).toBe("other");
  });

  it("step 4: the medical permission set wins over the licence hint", () => {
    const p = profile("Standard User", {});
    p.userLicense = "Identity";
    p.permissionSetNames = ["MSL Tools"];
    expect(classifySnapshot(snapshot([p])).profiles[0]!.category).toBe("msl");
  });

  it("keeps the ordinary 'Salesforce' licence at other", () => {
    const p = profile("Standard User", { DE: 1 });
    expect(classifySnapshot(snapshot([p])).profiles[0]!.category).toBe("other");
  });
});

describe("shared profiles (DESIGN §3.2)", () => {
  it("flags a profile with users spread over ≥ 2 countries and no dominant one", () => {
    const p = profile("MSL", { DE: 6, FR: 4 });
    const cp = classifySnapshot(snapshot([p])).profiles[0]!;
    expect(cp.shared).toBe(true);
    expect(cp.countries).toEqual(["DE", "FR"]);
    expect(cp.rationale.join("\n")).toMatch(
      /shared: users in 2 countries, largest share 60% < 80%/,
    );
  });

  it("is not shared when one country holds ≥ 80 % of the users", () => {
    const cp = classifySnapshot(snapshot([profile("MSL", { DE: 8, FR: 2 })]))
      .profiles[0]!;
    expect(cp.shared).toBeUndefined();
    expect(cp.countries).toEqual(["DE", "FR"]);
  });

  it("is not shared when the name carries a country token", () => {
    const cp = classifySnapshot(
      snapshot([profile("DE Sales Rep", { DE: 5, FR: 5 })]),
    ).profiles[0]!;
    expect(cp.shared).toBeUndefined();
  });

  it("is not shared with a single country or an override", () => {
    expect(
      classifySnapshot(snapshot([profile("MSL", { DE: 5 })])).profiles[0]!
        .shared,
    ).toBeUndefined();
    expect(
      classifySnapshot(snapshot([profile("MSL", { DE: 5, FR: 5 })]), {
        countryOverrides: { MSL: ["DE"] },
      }).profiles[0]!.shared,
    ).toBeUndefined();
  });
});

describe("classifySnapshot deltas", () => {
  it("computes deltas against the global profile of the category, none for the global bucket", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const de = profile("DE Sales Rep", { DE: 10 });
    const fr = profile("FR Sales Rep", { FR: 4 });
    const result = classifySnapshot(
      snapshot([global, de, fr], {
        veevaSettings: [
          {
            settingObject: "Veeva_Settings_vod__c",
            level: "org",
            ownerName: null,
            values: { ENABLE_X_vod__c: false },
          },
          {
            settingObject: "Veeva_Settings_vod__c",
            level: "profile",
            ownerName: "DE Sales Rep",
            values: { ENABLE_X_vod__c: true },
          },
        ],
      }),
    );
    const deRep = result.countries.find((c) => c.country.code === "DE")!
      .repConfigs[0]!;
    const frRep = result.countries.find((c) => c.country.code === "FR")!
      .repConfigs[0]!;
    expect(deRep.baselineProfile).toBe("Sales Rep");
    expect(frRep.baselineProfile).toBe("Sales Rep");
    // Layouts differ per profile in this fixture (Call2_vod__c-<name>), plus DE's setting.
    expect(deRep.deltas!.map((d) => [d.id, d.kind, d.item])).toEqual([
      ["DE-01", "setting", "Veeva_Settings_vod__c.ENABLE_X_vod__c"],
      ["DE-02", "layout", "Call2_vod__c.Master"],
    ]);
    expect(deRep.deltas![0]).toMatchObject({
      globalValue: "false",
      localValue: "true",
      evidence: "snapshot 2026-01-01, profile DE Sales Rep",
      reasonCode: "",
      status: "proposed",
    });
    expect(frRep.deltas!.map((d) => d.kind)).toEqual(["layout"]);
    expect(result.global[0]!.deltas).toEqual([]);
    expect(result.global[0]!.baselineProfile).toBe("Sales Rep");
  });

  it("uses a synthetic baseline (null profile) when the category has no global profile", () => {
    const result = classifySnapshot(
      snapshot([
        profile("DE Sales Rep", { DE: 10 }),
        profile("FR Sales Rep", { FR: 4 }),
      ]),
    );
    const de = result.countries[0]!.repConfigs[0]!;
    expect(de.baselineProfile).toBeNull();
    expect(de.deltas).toBeDefined();
  });
});
