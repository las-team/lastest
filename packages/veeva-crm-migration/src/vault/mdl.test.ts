import { describe, expect, it } from "vitest";

import {
  convertWhereClause,
  mdlAddField,
  mdlEscape,
  mdlObject,
  mdlObjectType,
  mdlPageLayout,
  mdlPermissionSet,
  mdlPicklist,
  mdlSecurityProfile,
  sanitizeName,
} from "./mdl";
import { field, object } from "./test-helpers";

describe("sanitisation", () => {
  it("lower-cases, strips odd characters and appends __c", () => {
    expect(sanitizeName("Speaker Engagement")).toBe("speaker_engagement__c");
    expect(sanitizeName("DE-Pharmacy (Id)")).toBe("de_pharmacy_id__c");
    expect(sanitizeName("Foo__c")).toBe("foo__c");
    expect(sanitizeName("123 Go")).toBe("x_123_go__c");
    expect(sanitizeName("")).toBe("unnamed__c");
  });

  it("never emits __v for customer components", () => {
    expect(sanitizeName("Call2_vod__c")).toBe("call2__c");
    expect(sanitizeName("something__v")).toBe("something__c");
  });

  it("escapes single quotes", () => {
    expect(mdlEscape("O'Brien's")).toBe("O''Brien''s");
  });
});

describe("mdlObject", () => {
  it("renders RECREATE Object with name__v, fields and a base object type", () => {
    const stmt = mdlObject(
      object("Speaker_Engagement__c", [
        field("Account__c", "reference", {
          referenceTo: ["Account"],
          required: true,
        }),
        field("Status__c", "picklist", { picklistValues: [] }),
        field("Fee__c", "currency", { precision: 10, scale: 2 }),
        field("Notes__c", "textarea", { length: 32000 }),
        field("Active__c", "boolean"),
        field("Geo__c", "location"),
      ]),
    );
    expect(stmt.name).toBe("speaker_engagement__c");
    expect(stmt.mdl).toBe(
      [
        "RECREATE Object speaker_engagement__c (",
        "  label('Speaker Engagement'),",
        "  label_plural('Speaker Engagements'),",
        "  active(true),",
        "  in_menu(true),",
        "  Field name__v (",
        "    label('Name'),",
        "    type('String'),",
        "    max_length(128),",
        "    required(true),",
        "    unique(false)",
        "  ),",
        "  Field account__c (",
        "    label('Account'),",
        "    type('Object'),",
        "    object('account__v'),",
        "    required(true)",
        "  ),",
        "  Field active__c (",
        "    label('Active'),",
        "    type('Boolean')",
        "  ),",
        "  Field fee__c (",
        "    label('Fee'),",
        "    type('Number'),",
        "    max_length(8),",
        "    scale(2)",
        "  ),",
        "  Field notes__c (",
        "    label('Notes'),",
        "    type('LongText'),",
        "    max_length(32000)",
        "  ),",
        "  Field status__c (",
        "    label('Status'),",
        "    type('Picklist'),",
        "    picklist('speaker_engagement_status__c'),",
        "    multi_value(false)",
        "  ),",
        "  Objecttype base__v (",
        "    label('Base'),",
        "    active(true)",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt.picklists).toEqual(["speaker_engagement_status__c"]);
    expect(stmt.references).toEqual(["account__v"]);
    expect(stmt.unmapped).toEqual([
      { field: "Geo__c", reason: "type location has no Vault equivalent" },
    ]);
    expect(stmt.review).toBe(true); // currency / boolean / longtext are assumed mappings
  });

  it("can exclude fields (deferred lookups) and escapes labels", () => {
    const stmt = mdlObject(
      object(
        "Thing__c",
        [field("Parent__c", "reference", { referenceTo: ["Thing__c"] })],
        {
          label: "Bob's Thing",
        },
      ),
      { excludeFields: ["Parent__c"] },
    );
    expect(stmt.mdl).toContain("label('Bob''s Thing')");
    expect(stmt.mdl).not.toContain("parent__c");
  });
});

describe("mdlAddField", () => {
  it("renders ALTER Object … ADD Field on the mapped object", () => {
    const stmt = mdlAddField(
      "Call2_vod__c",
      field("Visit_Purpose__c", "string", { length: 80, helpText: "Why" }),
    );
    expect(stmt?.mdl).toBe(
      [
        "ALTER Object call2__v (",
        "  ADD Field visit_purpose__c (",
        "    label('Visit Purpose'),",
        "    type('String'),",
        "    max_length(80),",
        "    help_content('Why')",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt?.review).toBe(false);
  });

  it("carries simple formulas (review) and refuses complex ones", () => {
    const simple = mdlAddField(
      "Call2_vod__c",
      field("Score__c", "double", { formula: "Attendees_vod__c * 2" }),
    );
    expect(simple?.mdl).toContain("type('Formula')");
    expect(simple?.mdl).toContain("formula('attendees__v * 2')");
    expect(simple?.review).toBe(true);
    const complex = mdlAddField(
      "Call2_vod__c",
      field("Flag__c", "boolean", { formula: "ISBLANK(Foo__c)" }),
    );
    expect(complex).toBeNull();
  });

  it("returns null for unsupported types", () => {
    expect(mdlAddField("Account", field("Geo__c", "location"))).toBeNull();
  });
});

describe("mdlPicklist / mdlObjectType", () => {
  it("renders picklist entries with ordered values and Veeva/customer suffixes", () => {
    const stmt = mdlPicklist("call2_visit_purpose__c", "Visit Purpose", [
      { value: "Follow-up", label: "Follow-up", active: true, default: false },
      { value: "Detail_vod", label: "Detail", active: false, default: false },
      { value: "Follow up", label: "Follow up", active: true, default: false },
    ]);
    expect(stmt.mdl).toBe(
      [
        "RECREATE Picklist call2_visit_purpose__c (",
        "  label('Visit Purpose'),",
        "  active(true),",
        "  Picklistentry follow_up__c (",
        "    value('Follow-up'),",
        "    order(1),",
        "    active(true)",
        "  ),",
        "  Picklistentry detail__v (",
        "    value('Detail'),",
        "    order(2),",
        "    active(false)",
        "  ),",
        "  Picklistentry follow_up_3__c (",
        "    value('Follow up'),",
        "    order(3),",
        "    active(true)",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt.notes[0]).toMatch(/duplicate value name/);
  });

  it("renders object types as ALTER … ADD Objecttype flagged for review", () => {
    const stmt = mdlObjectType("Call2_vod__c", {
      developerName: "Hospital Visit",
      name: "Hospital Visit",
      active: true,
    });
    expect(stmt.name).toBe("hospital_visit__c");
    expect(stmt.mdl).toBe(
      [
        "ALTER Object call2__v (",
        "  ADD Objecttype hospital_visit__c (",
        "    label('Hospital Visit'),",
        "    active(true)",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt.review).toBe(true);
  });
});

describe("mdlPageLayout", () => {
  it("renders sections and layout fields, always review", () => {
    const stmt = mdlPageLayout(
      {
        fullName: "Call2_vod__c-Call Layout DE",
        object: "Call2_vod__c",
        recordTypes: [],
        sections: [
          {
            heading: "Information",
            columns: 2,
            fields: ["Account_vod__c", "Visit_Purpose__c"],
            items: [
              { field: "Account_vod__c", behavior: "Required" },
              { field: "Visit_Purpose__c", behavior: "Readonly" },
            ],
          },
        ],
        relatedLists: ["Call2_Detail_vod__c"],
      },
      {
        object: "call2__v",
        name: "call_layout_de__c",
        label: "Call Layout DE",
      },
    );
    expect(stmt.mdl).toBe(
      [
        "RECREATE Pagelayout call2__v.call_layout_de__c (",
        "  label('Call Layout DE'),",
        "  active(true),",
        "  Section information__c (",
        "    label('Information'),",
        "    columns(2),",
        "    Layoutfield account__v (",
        "      required(true)",
        "    ),",
        "    Layoutfield visit_purpose__c (",
        "      read_only(true)",
        "    )",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt.review).toBe(true);
    expect(stmt.notes.some((n) => n.includes("call2_detail__v"))).toBe(true);
  });
});

describe("permission sets and security profiles", () => {
  it("renders object, field and tab permissions sorted", () => {
    const stmt = mdlPermissionSet({
      name: "ps_de_sales_rep__c",
      label: "DE Sales Rep",
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
          viewAll: true,
          modifyAll: false,
        },
        {
          object: "Lead",
          create: true,
          read: true,
          edit: true,
          delete: true,
          viewAll: false,
          modifyAll: false,
        },
      ],
      fieldPermissions: [
        {
          object: "Call2_vod__c",
          field: "Visit_Purpose__c",
          readable: true,
          editable: true,
        },
      ],
      tabs: [{ tab: "call2_tab__v", visible: true }],
      objectFilter: (o) => o !== "Lead",
    });
    expect(stmt.mdl).toBe(
      [
        "RECREATE Permissionset ps_de_sales_rep__c (",
        "  label('DE Sales Rep'),",
        "  active(true),",
        "  Objectpermission account__v (",
        "    create(false),",
        "    read(true),",
        "    edit(true),",
        "    delete(false)",
        "  ),",
        "  Objectpermission call2__v (",
        "    create(true),",
        "    read(true),",
        "    edit(true),",
        "    delete(false)",
        "  ),",
        "  Fieldpermission call2__v.visit_purpose__c (",
        "    read(true),",
        "    edit(true)",
        "  ),",
        "  Tabpermission call2_tab__v (",
        "    visible(true)",
        "  )",
        ");",
      ].join("\n"),
    );
    expect(stmt.review).toBe(true);
  });

  it("renders a security profile referencing its permission sets", () => {
    const stmt = mdlSecurityProfile("sp_de_sales_rep__c", "DE Sales Rep", [
      "ps_de_sales_rep__c",
    ]);
    expect(stmt.mdl).toBe(
      [
        "RECREATE Securityprofile sp_de_sales_rep__c (",
        "  label('DE Sales Rep'),",
        "  active(true),",
        "  permission_sets('ps_de_sales_rep__c')",
        ");",
      ].join("\n"),
    );
    expect(mdlSecurityProfile("Sales Rep", "x", []).mdl).toContain(
      "Securityprofile sales_rep__c",
    );
  });
});

describe("convertWhereClause", () => {
  it("rewrites field references and keeps @@ tokens", () => {
    const res = convertWhereClause(
      "WHERE Country_vod__c = 'DE' AND Custom_Flag__c = true AND Owner_vod__r.Id = @@VOD_USER_ID@@",
    );
    expect(res.text).toBe(
      "WHERE country__v = 'DE' AND custom_flag__c = true AND owner__v.Id = @@VOD_USER_ID@@",
    );
    expect(res.unresolvedTokens).toEqual(["@@VOD_USER_ID@@"]);
  });
});
