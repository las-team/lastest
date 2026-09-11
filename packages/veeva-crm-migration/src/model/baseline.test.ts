import { describe, expect, it } from "vitest";
import {
  computeBaseline,
  computeDeltas,
  renderFieldPermission,
  renderObjectPermission,
  renderRecordTypeVisibility,
  renderSettingValue,
  renderVmoc,
} from "./baseline";
import type {
  ClassifiedProfile,
  CountryRepConfig,
  OrgSnapshot,
  ProfileConfig,
  RepCategory,
  VeevaSettingRecord,
  VmocConfig,
} from "./types";

function profile(
  name: string,
  users: Record<string, number>,
  overrides: Partial<ProfileConfig> = {},
): ProfileConfig {
  return {
    id: `00e${name}`,
    name,
    userLicense: "Salesforce",
    custom: true,
    objectPermissions: [
      {
        object: "Call2_vod__c",
        create: true,
        read: true,
        edit: true,
        delete: false,
        viewAll: false,
        modifyAll: false,
      },
      {
        object: "Account",
        create: false,
        read: true,
        edit: true,
        delete: false,
        viewAll: false,
        modifyAll: false,
      },
    ],
    fieldPermissions: [
      {
        object: "Call2_vod__c",
        field: "Call_Type_vod__c",
        readable: true,
        editable: true,
      },
      {
        object: "Account",
        field: "Specialty_1_vod__c",
        readable: true,
        editable: false,
      },
    ],
    recordTypeVisibilities: [
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        visible: true,
        default: true,
      },
    ],
    tabVisibilities: [{ tab: "Call2_vod__c", visibility: "DefaultOn" }],
    applicationVisibilities: [],
    layoutAssignments: [
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout",
      },
      { object: "Account", recordType: null, layout: "Account-Account Layout" },
    ],
    activeUsersByCountry: users,
    permissionSetNames: [],
    ...overrides,
  };
}

function classified(
  p: ProfileConfig,
  countries: string[],
  category: RepCategory = "sales_rep",
): ClassifiedProfile {
  return { profile: p, category, countries, rationale: [] };
}

function vmoc(
  profileName: string | null,
  object: string,
  device: string,
  where: string | null = null,
  active = true,
): VmocConfig {
  return {
    id: `a0${object}${device}${profileName ?? ""}`,
    name: `${object} ${device}`,
    objectApiName: object,
    profile: profileName,
    device,
    active,
    whereClause: where,
    extra: {},
  };
}

function setting(
  level: VeevaSettingRecord["level"],
  ownerName: string | null,
  values: Record<string, unknown>,
  settingObject = "Veeva_Settings_vod__c",
): VeevaSettingRecord {
  return { settingObject, level, ownerName, values };
}

function snapshot(extra: Partial<OrgSnapshot> = {}): OrgSnapshot {
  return {
    schemaVersion: 1,
    extractedAt: "2026-09-07T10:11:12Z",
    instanceUrl: "https://example.my.salesforce.com",
    apiVersion: "v64.0",
    countries: [],
    profiles: [],
    permissionSets: [],
    objects: [],
    vmocs: [],
    veevaSettings: [],
    messages: [],
    warnings: [],
    ...extra,
  };
}

function repConfig(
  country: string,
  profiles: ClassifiedProfile[],
  snap: OrgSnapshot,
  category: RepCategory = "sales_rep",
): CountryRepConfig {
  const names = new Set(profiles.map((p) => p.profile.name));
  return {
    country,
    category,
    profiles,
    layouts: [],
    vmocs: snap.vmocs.filter((v) => v.profile !== null && names.has(v.profile)),
    settings: snap.veevaSettings.filter(
      (s) =>
        s.level === "profile" && s.ownerName !== null && names.has(s.ownerName),
    ),
    messages: [],
  };
}

describe("value rendering", () => {
  it("renders object permissions as CRED letters", () => {
    expect(
      renderObjectPermission({
        object: "X",
        create: true,
        read: true,
        edit: true,
        delete: true,
        viewAll: true,
        modifyAll: true,
      }),
    ).toBe("C R E D VA MA");
    expect(
      renderObjectPermission({
        object: "X",
        create: false,
        read: true,
        edit: false,
        delete: false,
        viewAll: false,
        modifyAll: false,
      }),
    ).toBe("R");
    expect(
      renderObjectPermission({
        object: "X",
        create: false,
        read: false,
        edit: false,
        delete: false,
        viewAll: false,
        modifyAll: false,
      }),
    ).toBe("-");
    expect(renderObjectPermission(undefined)).toBe("-");
  });

  it("renders FLS, record types, settings and VMOCs", () => {
    expect(
      renderFieldPermission({
        object: "X",
        field: "f",
        readable: true,
        editable: true,
      }),
    ).toBe("R/E");
    expect(
      renderFieldPermission({
        object: "X",
        field: "f",
        readable: true,
        editable: false,
      }),
    ).toBe("R");
    expect(renderFieldPermission(undefined)).toBe("-");
    expect(
      renderRecordTypeVisibility({
        object: "X",
        recordType: "r",
        visible: true,
        default: true,
      }),
    ).toBe("visible default");
    expect(renderRecordTypeVisibility(undefined)).toBe("hidden");
    expect(renderSettingValue(true)).toBe("true");
    expect(renderSettingValue("a;b")).toBe('"a;b"');
    expect(renderSettingValue(null)).toBe("(unset)");
    expect(
      renderVmoc({
        objectApiName: "Account",
        device: "iPad",
        active: true,
        whereClause: "  Country_vod__c   = 'DE' ",
        enhancedSync: true,
      }),
    ).toBe("active where Country_vod__c = 'DE' enhanced-sync");
    expect(renderVmoc(undefined)).toBe("(none)");
  });
});

describe("computeBaseline", () => {
  it("picks the GLOBAL-bucket profile with the most active users", () => {
    const small = profile("Sales Rep Legacy", { GLOBAL: 2 });
    const big = profile("Sales Rep", { GLOBAL: 40 });
    const de = profile("DE Sales Rep", { DE: 10 });
    const snap = snapshot({
      vmocs: [vmoc("Sales Rep", "Account", "iPad", null)],
      veevaSettings: [
        setting("org", null, { ENABLE_X_vod__c: false, LIMIT_vod__c: 5 }),
        setting("profile", "Sales Rep", { ENABLE_X_vod__c: true }),
      ],
    });
    const b = computeBaseline(
      "sales_rep",
      [
        classified(small, ["GLOBAL"]),
        classified(big, ["GLOBAL"]),
        classified(de, ["DE"]),
        classified(profile("MSL", { GLOBAL: 3 }), ["GLOBAL"], "msl"),
      ],
      snap,
    );
    expect(b.profile).toBe("Sales Rep");
    expect(b.category).toBe("sales_rep");
    expect(b.extractedAt).toBe(snap.extractedAt);
    expect(b.objectPermissions["Call2_vod__c"]?.create).toBe(true);
    expect(b.fieldPermissions["Call2_vod__c.Call_Type_vod__c"]?.editable).toBe(
      true,
    );
    expect(b.recordTypeVisibilities["Call2_vod__c.Call_vod"]?.default).toBe(
      true,
    );
    expect(b.tabVisibilities["Call2_vod__c"]).toBe("DefaultOn");
    expect(b.layoutByObjectRecordType).toEqual({
      "Call2_vod__c.Call_vod": "Call2_vod__c-Call Layout",
      "Account.Master": "Account-Account Layout",
    });
    // Effective settings = org default overridden by the profile record.
    expect(b.settings).toEqual({
      "Veeva_Settings_vod__c.ENABLE_X_vod__c": "true",
      "Veeva_Settings_vod__c.LIMIT_vod__c": "5",
    });
    expect(b.orgSettings["Veeva_Settings_vod__c.ENABLE_X_vod__c"]).toBe(
      "false",
    );
    expect(Object.keys(b.vmocByObjectDevice)).toEqual(["Account|iPad"]);
  });

  it("builds a synthetic majority baseline when the category has no global profile", () => {
    const de = profile("DE Sales Rep", { DE: 10 });
    const fr = profile("FR Sales Rep", { FR: 8 });
    const it_ = profile(
      "IT Sales Rep",
      { IT: 6 },
      {
        objectPermissions: [
          {
            object: "Call2_vod__c",
            create: true,
            read: true,
            edit: true,
            delete: true,
            viewAll: false,
            modifyAll: false,
          },
        ],
        tabVisibilities: [],
      },
    );
    const snap = snapshot({
      vmocs: [
        vmoc("DE Sales Rep", "Account", "iPad", "Country_vod__c = 'DE'"),
        vmoc("FR Sales Rep", "Account", "iPad", "Country_vod__c = 'FR'"),
      ],
      veevaSettings: [
        setting("org", null, { A: 1 }),
        setting("profile", "DE Sales Rep", { A: 2 }),
        setting("profile", "FR Sales Rep", { A: 2 }),
      ],
    });
    const b = computeBaseline(
      "sales_rep",
      [classified(de, ["DE"]), classified(fr, ["FR"]), classified(it_, ["IT"])],
      snap,
    );
    expect(b.profile).toBeNull();
    // 2 of 3 profiles: Call2 without delete, Account read/edit, tab DefaultOn.
    expect(b.objectPermissions["Call2_vod__c"]?.delete).toBe(false);
    expect(b.objectPermissions["Account"]?.read).toBe(true);
    expect(b.tabVisibilities["Call2_vod__c"]).toBe("DefaultOn");
    // Settings vote on the effective value: 2 × "2" beats 1 × "1".
    expect(b.settings["Veeva_Settings_vod__c.A"]).toBe("2");
    // VMOC: three distinct renderings (DE where, FR where, absent) → tie broken
    // deterministically by the smallest rendering, which is "(none)".
    expect(b.vmocByObjectDevice["Account|iPad"]).toBeUndefined();
  });

  it("returns an empty baseline carrying org settings when the category has no profile", () => {
    const b = computeBaseline(
      "kam",
      [],
      snapshot({ veevaSettings: [setting("org", null, { A: 1 })] }),
    );
    expect(b.profile).toBeNull();
    expect(b.objectPermissions).toEqual({});
    expect(b.settings).toEqual({ "Veeva_Settings_vod__c.A": "1" });
  });
});

describe("computeDeltas", () => {
  it("emits nothing when the country profile is identical to the baseline", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const de = profile("DE Sales Rep", { DE: 10 });
    const snap = snapshot({
      vmocs: [
        vmoc("Sales Rep", "Account", "iPad", "Active_vod__c = true"),
        vmoc("DE Sales Rep", "Account", "iPad", "Active_vod__c = true"),
      ],
      veevaSettings: [
        setting("org", null, { A: 1, B: "x" }),
        setting("profile", "Sales Rep", { A: 2 }),
        setting("profile", "DE Sales Rep", { A: 2 }),
      ],
    });
    const cps = [classified(global, ["GLOBAL"]), classified(de, ["DE"])];
    const baseline = computeBaseline("sales_rep", cps, snap);
    expect(
      computeDeltas("DE", repConfig("DE", [cps[1]!], snap), baseline),
    ).toEqual([]);
  });

  it("does not report a setting the country inherits from the org default", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const de = profile("DE Sales Rep", { DE: 10 });
    const snap = snapshot({
      veevaSettings: [
        setting("org", null, { A: 1 }),
        // DE has a profile-level record that merely restates the org default.
        setting("profile", "DE Sales Rep", { A: 1 }),
      ],
    });
    const cps = [classified(global, ["GLOBAL"]), classified(de, ["DE"])];
    const baseline = computeBaseline("sales_rep", cps, snap);
    expect(
      computeDeltas("DE", repConfig("DE", [cps[1]!], snap), baseline),
    ).toEqual([]);
  });

  it("one flipped setting → exactly one setting delta with id, evidence and JSON values", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const de = profile("DE Sales Rep", { DE: 10 });
    const snap = snapshot({
      veevaSettings: [
        setting("org", null, {
          ENABLE_SAMPLE_OPT_IN_vod__c: false,
          OTHER_vod__c: "keep",
        }),
        setting("profile", "DE Sales Rep", {
          ENABLE_SAMPLE_OPT_IN_vod__c: true,
        }),
      ],
    });
    const cps = [classified(global, ["GLOBAL"]), classified(de, ["DE"])];
    const baseline = computeBaseline("sales_rep", cps, snap);
    const deltas = computeDeltas(
      "DE",
      repConfig("DE", [cps[1]!], snap),
      baseline,
    );
    expect(deltas).toEqual([
      {
        id: "DE-01",
        kind: "setting",
        item: "Veeva_Settings_vod__c.ENABLE_SAMPLE_OPT_IN_vod__c",
        globalValue: "false",
        localValue: "true",
        evidence: "snapshot 2026-09-07, profile DE Sales Rep",
        reasonCode: "",
        status: "proposed",
      },
    ]);
  });

  it("covers every kind in a stable order with zero-padded ids", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const fr = profile(
      "FR Sales Rep",
      { FR: 4 },
      {
        objectPermissions: [
          {
            object: "Call2_vod__c",
            create: true,
            read: true,
            edit: true,
            delete: true,
            viewAll: false,
            modifyAll: false,
          },
          // Account dropped entirely → "-"
        ],
        fieldPermissions: [
          {
            object: "Call2_vod__c",
            field: "Call_Type_vod__c",
            readable: true,
            editable: false,
          },
          {
            object: "Account",
            field: "Specialty_1_vod__c",
            readable: true,
            editable: false,
          },
        ],
        recordTypeVisibilities: [
          {
            object: "Call2_vod__c",
            recordType: "Call_vod",
            visible: true,
            default: false,
          },
          {
            object: "Call2_vod__c",
            recordType: "Pharmacy_Call_FR",
            visible: true,
            default: true,
          },
        ],
        tabVisibilities: [{ tab: "Call2_vod__c", visibility: "Hidden" }],
        layoutAssignments: [
          {
            object: "Call2_vod__c",
            recordType: "Call_vod",
            layout: "Call2_vod__c-Call Layout FR",
          },
          {
            object: "Account",
            recordType: null,
            layout: "Account-Account Layout",
          },
        ],
      },
    );
    const snap = snapshot({
      vmocs: [
        vmoc("Sales Rep", "Account", "iPad", null),
        vmoc("FR Sales Rep", "Account", "iPad", "Country_vod__c = 'FR'"),
        vmoc("FR Sales Rep", "TSF_vod__c", "iPad", null, false),
      ],
      veevaSettings: [
        setting("org", null, { A: 1 }),
        setting("profile", "FR Sales Rep", { A: 3 }),
      ],
    });
    const cps = [classified(global, ["GLOBAL"]), classified(fr, ["FR"])];
    const baseline = computeBaseline("sales_rep", cps, snap);
    const deltas = computeDeltas(
      "FR",
      repConfig("FR", [cps[1]!], snap),
      baseline,
    );
    expect(
      deltas.map((d) => [d.id, d.kind, d.item, d.globalValue, d.localValue]),
    ).toEqual([
      ["FR-01", "setting", "Veeva_Settings_vod__c.A", "1", "3"],
      [
        "FR-02",
        "vmoc",
        "Account|iPad",
        "active",
        "active where Country_vod__c = 'FR'",
      ],
      ["FR-03", "vmoc", "TSF_vod__c|iPad", "(none)", "inactive"],
      ["FR-04", "object_perm", "Account", "R E", "-"],
      ["FR-05", "object_perm", "Call2_vod__c", "C R E", "C R E D"],
      ["FR-06", "field_perm", "Call2_vod__c.Call_Type_vod__c", "R/E", "R"],
      [
        "FR-07",
        "record_type",
        "Call2_vod__c.Call_vod",
        "visible default",
        "visible",
      ],
      [
        "FR-08",
        "record_type",
        "Call2_vod__c.Pharmacy_Call_FR",
        "hidden",
        "visible default",
      ],
      [
        "FR-09",
        "layout",
        "Call2_vod__c.Call_vod",
        "Call2_vod__c-Call Layout",
        "Call2_vod__c-Call Layout FR",
      ],
      ["FR-10", "tab", "Call2_vod__c", "DefaultOn", "Hidden"],
    ]);
    for (const d of deltas) {
      expect(d.reasonCode).toBe("");
      expect(d.status).toBe("proposed");
      expect(d.evidence).toBe("snapshot 2026-09-07, profile FR Sales Rep");
    }
  });

  it("merges the same deviation from several profiles and keeps distinct ones apart", () => {
    const global = profile("Sales Rep", { GLOBAL: 20 });
    const a = profile("DE Sales Rep", { DE: 10 });
    const b = profile("DE Sales Rep North", { DE: 3 });
    const snap = snapshot({
      veevaSettings: [
        setting("org", null, { A: 1, B: 1 }),
        setting("profile", "DE Sales Rep", { A: 2, B: 5 }),
        setting("profile", "DE Sales Rep North", { A: 2, B: 6 }),
      ],
    });
    const cps = [
      classified(global, ["GLOBAL"]),
      classified(a, ["DE"]),
      classified(b, ["DE"]),
    ];
    const baseline = computeBaseline("sales_rep", cps, snap);
    const deltas = computeDeltas(
      "DE",
      repConfig("DE", [cps[1]!, cps[2]!], snap),
      baseline,
    );
    expect(deltas.map((d) => [d.id, d.item, d.localValue, d.evidence])).toEqual(
      [
        [
          "DE-01",
          "Veeva_Settings_vod__c.A",
          "2",
          "snapshot 2026-09-07, profiles DE Sales Rep, DE Sales Rep North",
        ],
        [
          "DE-02",
          "Veeva_Settings_vod__c.B",
          "5",
          "snapshot 2026-09-07, profile DE Sales Rep",
        ],
        [
          "DE-03",
          "Veeva_Settings_vod__c.B",
          "6",
          "snapshot 2026-09-07, profile DE Sales Rep North",
        ],
      ],
    );
  });
});
