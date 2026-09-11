/**
 * Synthetic snapshot used by `render.test.ts`: 2 countries (DE, FR) × 2
 * categories (sales_rep, msl) plus a global MSL profile. Not a test file
 * itself (no `.test.` in the name) so scripts can import it.
 */
import type {
  FieldPermission,
  ObjectPermission,
  OrgSnapshot,
  ProfileConfig,
  VmocConfig,
} from "../model/types";

// ---------------------------------------------------------------------------
// Fixture: 2 countries (DE, FR) × 2 categories (sales_rep, msl) + a global
// MSL profile that becomes the msl baseline. `DE Sales Rep` differs from the
// synthetic sales_rep baseline (which is a majority vote of DE and FR) only
// where the two disagree.
// ---------------------------------------------------------------------------

export function objPerm(
  object: string,
  flags: Partial<Omit<ObjectPermission, "object">> = {},
): ObjectPermission {
  return {
    object,
    create: true,
    read: true,
    edit: true,
    delete: false,
    viewAll: false,
    modifyAll: false,
    ...flags,
  };
}

export function fls(
  object: string,
  field: string,
  readable = true,
  editable = true,
): FieldPermission {
  return { object, field, readable, editable };
}

export function profile(
  name: string,
  users: Record<string, number>,
  extra: Partial<ProfileConfig> = {},
): ProfileConfig {
  return {
    id: `00e${name.replace(/\W/g, "")}`,
    name,
    userLicense: "Salesforce",
    custom: true,
    objectPermissions: [
      objPerm("Account", { create: false }),
      objPerm("Call2_vod__c"),
    ],
    fieldPermissions: [
      fls("Call2_vod__c", "Call_Type_vod__c"),
      fls("Call2_vod__c", "Notes_vod__c"),
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
    applicationVisibilities: [
      { application: "Veeva_CRM", visible: true, default: true },
    ],
    layoutAssignments: [
      {
        object: "Call2_vod__c",
        recordType: null,
        layout: "Call2_vod__c-Call Layout",
      },
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout",
      },
    ],
    activeUsersByCountry: users,
    permissionSetNames: [],
    ...extra,
  };
}

export function vmoc(
  name: string,
  profile: string | null,
  where: string | null,
  extra: Partial<VmocConfig> = {},
): VmocConfig {
  return {
    id: `a0${name}`,
    name,
    objectApiName: "Account",
    profile,
    device: "iPad_vod",
    active: true,
    whereClause: where,
    extra: {},
    ...extra,
  };
}

export const PIPE_TEXT = "Pipe | in text\nand a newline";

export function fixture(): OrgSnapshot {
  return {
    schemaVersion: 1,
    extractedAt: "2026-09-07T10:00:00.000Z",
    instanceUrl: "https://example.my.salesforce.com",
    apiVersion: "v64.0",
    orgId: "00D000000000001",
    orgName: "Pharma EU",
    countries: [
      {
        code: "DE",
        name: "Germany",
        activeUsers: 12,
        sources: ["user_country_code_vod"],
      },
      {
        code: "FR",
        name: "France",
        activeUsers: 8,
        sources: ["user_country_code_vod"],
      },
    ],
    profiles: [
      profile(
        "DE Sales Rep",
        { DE: 10 },
        {
          // DE deviates: no delete on Account (same as FR) but extra field + hidden Notes.
          fieldPermissions: [
            fls("Call2_vod__c", "Call_Type_vod__c"),
            fls("Call2_vod__c", "Notes_vod__c", true, false),
            fls("Call2_vod__c", "DE_Pharmacy_Id__c"),
          ],
          layoutAssignments: [
            {
              object: "Call2_vod__c",
              recordType: null,
              layout: "Call2_vod__c-Call Layout DE",
            },
            {
              object: "Call2_vod__c",
              recordType: "Call_vod",
              layout: "Call2_vod__c-Call Layout DE",
            },
            {
              object: "Call2_vod__c",
              recordType: "Old_Call_vod",
              layout: "Call2_vod__c-Call Layout DE",
            },
          ],
          recordTypeVisibilities: [
            {
              object: "Call2_vod__c",
              recordType: "Call_vod",
              visible: true,
              default: true,
            },
            {
              object: "Call2_vod__c",
              recordType: "Old_Call_vod",
              visible: true,
              default: false,
            },
          ],
        },
      ),
      profile(
        "DE Sales Rep Legacy",
        {},
        {
          objectPermissions: [
            objPerm("Account", { create: true }),
            objPerm("Call2_vod__c"),
          ],
        },
      ),
      profile("FR Sales Rep", { FR: 6 }),
      profile("DE MSL", { DE: 2 }),
      profile("FR MSL", { FR: 2 }),
      profile("Global MSL", { DE: 0, FR: 0 }, { activeUsersByCountry: {} }),
    ],
    permissionSets: [],
    objects: [
      {
        apiName: "Call2_vod__c",
        label: "Call",
        labelPlural: "Calls",
        custom: true,
        managed: true,
        fields: [
          {
            apiName: "DE_Pharmacy_Id__c",
            label: "Pharmacy Id",
            type: "string",
            custom: true,
            managed: false,
            required: false,
          },
        ],
        recordTypes: [
          { id: "012A", developerName: "Call_vod", name: "Call", active: true },
          {
            id: "012B",
            developerName: "Old_Call_vod",
            name: "Old call",
            active: false,
          },
        ],
        layouts: [
          {
            fullName: "Call2_vod__c-Call Layout",
            object: "Call2_vod__c",
            recordTypes: ["Call_vod"],
            sections: [
              {
                heading: "Information",
                columns: 2,
                fields: ["Call_Type_vod__c", "Notes_vod__c"],
                items: [
                  { field: "Call_Type_vod__c", behavior: "Required" },
                  { field: "Notes_vod__c", behavior: "Edit" },
                ],
              },
            ],
            relatedLists: ["Call2_Key_Message_vod__c"],
          },
          {
            fullName: "Call2_vod__c-Call Layout DE",
            object: "Call2_vod__c",
            recordTypes: ["Call_vod"],
            sections: [
              {
                heading: PIPE_TEXT,
                columns: 2,
                fields: ["Call_Type_vod__c", "DE_Pharmacy_Id__c"],
              },
            ],
            relatedLists: [],
          },
        ],
        validationRules: [
          {
            object: "Call2_vod__c",
            name: "DE_Pharmacy_Required",
            active: true,
            errorMessage: PIPE_TEXT,
          },
        ],
      },
      {
        apiName: "Account",
        label: "Account",
        labelPlural: "Accounts",
        custom: false,
        managed: false,
        fields: [
          {
            apiName: "Local_Segment__c",
            label: "Segment",
            type: "picklist",
            custom: true,
            managed: false,
            required: false,
          },
        ],
        recordTypes: [],
        layouts: [],
        validationRules: [],
      },
    ],
    vmocs: [
      vmoc("Account DE", "DE Sales Rep", "Country_vod__c = 'DE'"),
      vmoc("Account FR", "FR Sales Rep", "Country_vod__c = 'FR'"),
      vmoc("Account MSL", "DE MSL", null),
      vmoc("Product all", null, PIPE_TEXT, { objectApiName: "Product_vod__c" }),
      vmoc(
        "Long where",
        "FR Sales Rep",
        `Country_vod__c = 'FR' AND ${"Name != 'x' AND ".repeat(12)}Id != null`,
        {
          objectApiName: "Product_vod__c",
          active: false,
        },
      ),
    ],
    veevaSettings: [
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "org",
        ownerName: null,
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: false, CALL_SUBMIT_vod__c: "1" },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "profile",
        ownerName: "DE Sales Rep",
        values: {
          ENABLE_SAMPLE_OPT_IN_vod__c: true,
          NO_ORG_DEFAULT_vod__c: "x",
        },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "user",
        ownerName: "someone",
        values: { CALL_SUBMIT_vod__c: "0" },
      },
    ],
    messages: [
      {
        name: "CALL_SUBMIT",
        category: "Common",
        language: "en_US",
        text: "Submit",
        country: null,
        active: true,
      },
      {
        name: "CALL_SUBMIT",
        category: "Common",
        language: "de",
        text: "Absenden",
        country: null,
        active: true,
      },
      {
        name: "CALL_CANCEL",
        category: "Common",
        language: "en_US",
        text: "Cancel",
        country: null,
        active: true,
      },
      {
        name: "DE_DISCLAIMER",
        category: "Signature",
        language: "de",
        text: PIPE_TEXT,
        country: "DE",
        active: false,
      },
    ],
    warnings: [
      {
        stage: "profiles",
        message: "Profile.Metadata not available | fallback",
      },
    ],
    users: [
      {
        profileId: "00eDESalesRep",
        profileName: "DE Sales Rep",
        country: "DE",
        userType: "Primary Care Rep",
        language: "de_DE",
        activeUsers: 9,
      },
      {
        profileId: "00eDESalesRep",
        profileName: "DE Sales Rep",
        country: "DE",
        userType: "Primary Care Rep",
        language: "en_US",
        activeUsers: 1,
      },
      {
        profileId: "00eFRSalesRep",
        profileName: "FR Sales Rep",
        country: "FR",
        userType: "Rep",
        language: "fr_FR",
        activeUsers: 6,
      },
      {
        profileId: "00eDEMSL",
        profileName: "DE MSL",
        country: "DE",
        userType: "MSL",
        language: "de_DE",
        activeUsers: 2,
      },
    ],
    automation: [
      {
        kind: "apex_trigger",
        name: "DECallTrigger",
        object: "Call2_vod__c",
        active: true,
        managed: false,
        countryLogic: true,
      },
    ],
    limits: {
      dailyApiRequestsMax: 100000,
      dailyApiRequestsRemaining: 99000,
      requestsUsed: 42,
    },
  };
}
