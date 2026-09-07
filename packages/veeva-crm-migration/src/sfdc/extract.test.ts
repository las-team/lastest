import { describe, expect, it } from "vitest";

import { createSfdcClient, type SfdcClient } from "./client";
import {
  decideObjectSet,
  decodeLayoutMetadata,
  decodeProfileMetadata,
  dropSelectColumn,
  extractOrgSnapshot,
  resolveUserCountry,
} from "./extract";
import {
  fakeFetch,
  queryResult,
  sfdcError,
  type FakeFetch,
  type Route,
} from "./fake-fetch";
import type {
  DescribeField,
  DescribeGlobalSObject,
  DescribeSObject,
} from "./api-types";

// ---------------------------------------------------------------------------
// A tiny synthetic Veeva org: 2 profiles (DE / FR Sales Rep), 2 countries,
// Account + Call2_vod__c + a customer object, VMOCs, settings, messages.
// ---------------------------------------------------------------------------

const INSTANCE = "https://mini.my.salesforce.com";
const ORG_ID = "00D000000000001EAA";
const P_DE = "00e00000000000DEAA";
const P_FR = "00e00000000000FRAA";
const PS_DE = "0PS0000000000DEAAA";
const PS_FR = "0PS0000000000FRAAA";
const PS_AE = "0PS00000000000AEAA";
const RT_CALL = "012000000000CALLAA";
const RT_CALL_DE = "012000000000CADEAA";
const CO_CALL = "01I0000000000CALLA";
const CO_PHARM = "01I000000000PHARMA";
const L_DE = "00h000000000CALLDE";
const L_FR = "00h000000000CALLFR";
const L_ACC = "00h0000000000ACCAA";
const APP_ID = "02u00000000000VEEV";

function gs(
  name: string,
  o: Partial<DescribeGlobalSObject> = {},
): DescribeGlobalSObject {
  return {
    name,
    label: name,
    custom: name.endsWith("__c"),
    customSetting: false,
    layoutable: true,
    queryable: true,
    keyPrefix: null,
    ...o,
  };
}

function field(name: string, o: Partial<DescribeField> = {}): DescribeField {
  return {
    name,
    label: name.replace(/_vod__c$|__c$/, "").replace(/_/g, " "),
    type: "string",
    custom: name.endsWith("__c"),
    nillable: true,
    createable: true,
    updateable: true,
    permissionable: true,
    length: 255,
    ...o,
  };
}

const idName = [
  field("Id", {
    type: "id",
    permissionable: false,
    updateable: false,
    createable: false,
    nillable: false,
  }),
  field("Name", { permissionable: false, nillable: false }),
];

function describeOf(
  name: string,
  userCountryField: "vod" | "country",
): DescribeSObject | null {
  const base = {
    name,
    label: name,
    labelPlural: name + "s",
    custom: name.endsWith("__c"),
    customSetting: /Settings_vod__c$/.test(name),
    layoutable: true,
    queryable: true,
    keyPrefix: null,
    recordTypeInfos: [],
  };
  switch (name) {
    case "Account":
      return {
        ...base,
        fields: [
          ...idName,
          field("Country_vod__c", {
            type: "picklist",
            picklistValues: [
              {
                value: "DE",
                label: "Germany",
                active: true,
                defaultValue: false,
              },
              {
                value: "FR",
                label: "France",
                active: true,
                defaultValue: false,
              },
              {
                value: "US",
                label: "United States",
                active: false,
                defaultValue: false,
              },
            ],
          }),
        ],
      };
    case "Call2_vod__c":
      return {
        ...base,
        fields: [
          ...idName,
          field("Call_Type_vod__c", {
            type: "picklist",
            picklistValues: [
              {
                value: "Detail_vod",
                label: "Detail",
                active: true,
                defaultValue: true,
              },
              {
                value: "Group_vod",
                label: "Group",
                active: true,
                defaultValue: false,
              },
            ],
          }),
          field("Account_vod__c", {
            type: "reference",
            referenceTo: ["Account"],
            nillable: false,
          }),
          field("Custom_Field__c", {
            type: "double",
            precision: 10,
            scale: 2,
            inlineHelpText: "help",
          }),
          field("Total_Formula__c", {
            type: "double",
            calculated: true,
            calculatedFormula: "1 + 1",
            permissionable: false,
            updateable: false,
          }),
        ],
        recordTypeInfos: [
          {
            recordTypeId: "012000000000000AAA",
            name: "Master",
            developerName: "Master",
            active: true,
            available: true,
            master: true,
            defaultRecordTypeMapping: false,
          },
          {
            recordTypeId: RT_CALL,
            name: "Call",
            developerName: "Call_vod",
            active: true,
            available: true,
            master: false,
            defaultRecordTypeMapping: true,
          },
          {
            recordTypeId: RT_CALL_DE,
            name: "Call DE",
            developerName: "Call_DE",
            active: true,
            available: false,
            master: false,
            defaultRecordTypeMapping: false,
          },
        ],
      };
    case "DE_Pharmacy__c":
      return { ...base, fields: [...idName, field("Pharmacy_Id__c")] };
    case "User":
      return {
        ...base,
        custom: false,
        fields: [
          ...idName,
          ...(userCountryField === "vod"
            ? [
                field("Country_Code_vod__c"),
                field("User_Type_vod__c", { type: "picklist" }),
              ]
            : []),
          field("Country", { custom: false }),
          field("LanguageLocaleKey", { custom: false, type: "picklist" }),
        ],
      };
    case "Profile":
      return {
        ...base,
        custom: false,
        fields: [
          ...idName,
          field("PermissionsApiEnabled", { type: "boolean", custom: false }),
          field("PermissionsModifyAllData", { type: "boolean", custom: false }),
        ],
      };
    case "VMobile_Object_Configuration_vod__c":
      return {
        ...base,
        fields: [
          ...idName,
          field("Object_Name_vod__c"),
          field("Profile_ID_vod__c"),
          field("Profile_Name_vod__c"),
          field("Device_vod__c", { type: "picklist" }),
          field("Active_vod__c", { type: "boolean" }),
          field("Where_Clause_vod__c", { type: "textarea" }),
          field("Type_vod__c", { type: "picklist" }),
          field("Enable_Enhanced_Sync_vod__c", { type: "boolean" }),
          field("Meta_Data_Only_vod__c", { type: "boolean" }),
          field("Field_List_vod__c", { type: "textarea" }),
        ],
      };
    case "Message_vod__c":
      return {
        ...base,
        fields: [
          ...idName,
          field("Category_vod__c"),
          field("Language_vod__c"),
          field("Text_vod__c", { type: "textarea" }),
          field("Active_vod__c", { type: "boolean" }),
        ],
      };
    case "Veeva_Settings_vod__c":
      return {
        ...base,
        layoutable: false,
        fields: [
          idName[0]!,
          field("SetupOwnerId", { custom: false, type: "reference" }),
          field("ENABLE_SAMPLE_OPT_IN_vod__c", { type: "double" }),
          field("CALL_TYPE_vod__c"),
        ],
      };
    case "Approved_Email_Settings_vod__c":
      return {
        ...base,
        layoutable: false,
        fields: [
          idName[0]!,
          field("SetupOwnerId", { custom: false, type: "reference" }),
          field("APPROVED_EMAIL_TEST_ADDRESS_vod__c"),
        ],
      };
    case "Zip_to_Terr_vod__c":
      return { ...base, fields: [...idName, field("Zip_vod__c")] };
    default:
      return null;
  }
}

const callLayoutDescribe = (
  id: string,
  rtByLayout: Record<string, string>,
) => ({
  layouts: [
    {
      id,
      detailLayoutSections: [
        {
          heading: "Information",
          columns: 2,
          layoutRows: [
            {
              layoutItems: [
                {
                  label: "Account",
                  required: true,
                  editableForNew: true,
                  editableForUpdate: false,
                  layoutComponents: [
                    { type: "Field", value: "Account_vod__c" },
                  ],
                },
                {
                  label: "Call Type",
                  required: false,
                  editableForNew: true,
                  editableForUpdate: true,
                  layoutComponents: [
                    { type: "Field", value: "Call_Type_vod__c" },
                  ],
                },
              ],
            },
            {
              layoutItems: [
                {
                  label: "Total",
                  required: false,
                  editableForNew: false,
                  editableForUpdate: false,
                  layoutComponents: [
                    { type: "Field", value: "Total_Formula__c" },
                  ],
                },
                { layoutComponents: [{ type: "EmptySpace", value: null }] },
              ],
            },
          ],
        },
      ],
      relatedLists: [
        { name: "Call2_Detail_vod__r", sobject: "Call2_Detail_vod__c" },
      ],
      buttonLayoutSection: {
        detailButtons: [{ name: "Submit_vod", custom: true }],
      },
      quickActionList: {
        quickActionListItems: [{ quickActionName: "Call2_vod__c.Log_Call" }],
      },
    },
  ],
  recordTypeMappings: Object.entries(rtByLayout).map(([rtId, layoutId]) => ({
    recordTypeId: rtId,
    name: rtId === RT_CALL ? "Call" : "Call DE",
    developerName: rtId === RT_CALL ? "Call_vod" : "Call_DE",
    available: true,
    master: false,
    defaultRecordTypeMapping: rtId === RT_CALL,
    layoutId,
    picklistsForRecordType: [
      {
        picklistName: "Call_Type_vod__c",
        picklistValues: [
          {
            value: "Detail_vod",
            label: "Detail",
            active: true,
            defaultValue: true,
          },
        ],
      },
    ],
  })),
});

const profileMetadataOf: Record<string, unknown> = {
  [P_DE]: {
    layoutAssignments: [
      {
        layout: "Call2_vod__c-Call Layout DE",
        recordType: "Call2_vod__c.Call_vod",
      },
      { layout: "Account-Account Layout" },
      { layout: "Contact-Contact Layout" },
    ],
    recordTypeVisibilities: [
      { recordType: "Call2_vod__c.Call_vod", visible: true, default: true },
      { recordType: "Call2_vod__c.Call_DE", visible: true, default: false },
    ],
    tabVisibilities: [
      { tab: "Call2_vod__c", visibility: "DefaultOn" },
      { tab: "standard-Account", visibility: "DefaultOn" },
    ],
    applicationVisibilities: [
      { application: "vod__Veeva_CRM", visible: true, default: true },
    ],
    userPermissions: [
      { name: "ApiEnabled", enabled: true },
      { name: "ModifyAllData", enabled: false },
    ],
  },
  [P_FR]: {
    layoutAssignments: [
      {
        layout: "Call2_vod__c-Call Layout FR",
        recordType: "Call2_vod__c.Call_vod",
      },
    ],
    recordTypeVisibilities: [
      { recordType: "Call2_vod__c.Call_vod", visible: true, default: true },
    ],
    tabVisibilities: [{ tab: "Call2_vod__c", visibility: "DefaultOff" }],
    applicationVisibilities: [
      { application: "vod__Veeva_CRM", visible: true, default: false },
    ],
  },
};

interface MiniOrgOptions {
  /** `true` (default): Tooling `Profile.Metadata` works; `false`: the query fails with 400. */
  profileMetadata?: boolean;
  /** `true`: Tooling `ValidationRule` query fails. */
  validationRulesFail?: boolean;
  /** Which country column the User object exposes. */
  userCountryField?: "vod" | "country";
}

function miniOrg(opts: MiniOrgOptions = {}): { ff: FakeFetch } {
  const profileMetadata = opts.profileMetadata ?? true;
  const userCountryField = opts.userCountryField ?? "vod";
  const users: Record<string, unknown>[] =
    userCountryField === "vod"
      ? [
          {
            profileId: P_DE,
            country: "DE",
            userType: "Primary Care Rep",
            language: "de",
            n: 10,
          },
          {
            profileId: P_FR,
            country: "fr",
            userType: "Primary Care Rep",
            language: "fr",
            n: 4,
          },
          {
            profileId: P_FR,
            country: null,
            userType: null,
            language: "en_US",
            n: 1,
          },
        ]
      : [
          { profileId: P_DE, country: "Germany", language: "de", n: 10 },
          { profileId: P_FR, country: "France", language: "fr", n: 4 },
          { profileId: P_FR, country: "Atlantis", language: "en_US", n: 1 },
        ];

  const soqlRules: [
    RegExp,
    (
      m: RegExpMatchArray,
    ) => ReturnType<typeof queryResult> | ReturnType<typeof sfdcError>,
  ][] = [
    [
      /FROM Organization/,
      () =>
        queryResult([
          {
            Id: ORG_ID,
            Name: "Acme Pharma",
            OrganizationType: "Enterprise Edition",
            IsSandbox: true,
          },
        ]),
    ],
    [
      /FROM Profile$/,
      () =>
        queryResult([
          {
            Id: P_DE,
            Name: "DE Sales Rep",
            UserLicenseId: "100",
            UserLicense: { Name: "Salesforce" },
            UserType: "Standard",
            Description: "German reps",
            PermissionsApiEnabled: true,
            PermissionsModifyAllData: false,
          },
          {
            Id: P_FR,
            Name: "FR Sales Rep",
            UserLicenseId: "100",
            UserLicense: { Name: "Salesforce" },
            UserType: "Standard",
            Description: null,
            PermissionsApiEnabled: true,
            PermissionsModifyAllData: false,
          },
        ]),
    ],
    [
      /FROM PermissionSet$/,
      () =>
        queryResult([
          {
            Id: PS_DE,
            Name: "X00e00000000000DEAA",
            Label: "DE Sales Rep",
            IsOwnedByProfile: true,
            ProfileId: P_DE,
            NamespacePrefix: null,
            IsCustom: true,
            Type: "Profile",
          },
          {
            Id: PS_FR,
            Name: "X00e00000000000FRAA",
            Label: "FR Sales Rep",
            IsOwnedByProfile: true,
            ProfileId: P_FR,
            NamespacePrefix: null,
            IsCustom: true,
            Type: "Profile",
          },
          {
            Id: PS_AE,
            Name: "Approved_Email_User",
            Label: "Approved Email User",
            IsOwnedByProfile: false,
            ProfileId: null,
            NamespacePrefix: null,
            IsCustom: true,
            Type: "Regular",
            Description: "AE feature set",
          },
        ]),
    ],
    [
      /FROM ObjectPermissions/,
      () =>
        queryResult([
          {
            ParentId: PS_DE,
            SobjectType: "Account",
            PermissionsCreate: true,
            PermissionsRead: true,
            PermissionsEdit: true,
            PermissionsDelete: false,
            PermissionsViewAllRecords: false,
            PermissionsModifyAllRecords: false,
          },
          {
            ParentId: PS_DE,
            SobjectType: "Call2_vod__c",
            PermissionsCreate: true,
            PermissionsRead: true,
            PermissionsEdit: true,
            PermissionsDelete: true,
            PermissionsViewAllRecords: false,
            PermissionsModifyAllRecords: false,
          },
          {
            ParentId: PS_FR,
            SobjectType: "Call2_vod__c",
            PermissionsCreate: false,
            PermissionsRead: true,
            PermissionsEdit: false,
            PermissionsDelete: false,
            PermissionsViewAllRecords: false,
            PermissionsModifyAllRecords: false,
          },
          {
            ParentId: PS_AE,
            SobjectType: "Account",
            PermissionsCreate: false,
            PermissionsRead: true,
            PermissionsEdit: false,
            PermissionsDelete: false,
            PermissionsViewAllRecords: true,
            PermissionsModifyAllRecords: false,
          },
        ]),
    ],
    [
      /FROM FieldPermissions/,
      () =>
        queryResult([
          {
            ParentId: PS_DE,
            SobjectType: "Call2_vod__c",
            Field: "Call2_vod__c.Custom_Field__c",
            PermissionsRead: true,
            PermissionsEdit: true,
          },
          {
            ParentId: PS_DE,
            SobjectType: "Call2_vod__c",
            Field: "Call2_vod__c.Call_Type_vod__c",
            PermissionsRead: true,
            PermissionsEdit: true,
          },
          {
            ParentId: PS_FR,
            SobjectType: "Call2_vod__c",
            Field: "Call2_vod__c.Custom_Field__c",
            PermissionsRead: true,
            PermissionsEdit: false,
          },
          {
            ParentId: PS_AE,
            SobjectType: "Account",
            Field: "Account.Country_vod__c",
            PermissionsRead: true,
            PermissionsEdit: false,
          },
        ]),
    ],
    [
      /FROM RecordType/,
      () =>
        queryResult([
          {
            Id: RT_CALL,
            Name: "Call",
            DeveloperName: "Call_vod",
            SobjectType: "Call2_vod__c",
            IsActive: true,
            NamespacePrefix: null,
            Description: "Standard call",
          },
          {
            Id: RT_CALL_DE,
            Name: "Call DE",
            DeveloperName: "Call_DE",
            SobjectType: "Call2_vod__c",
            IsActive: true,
            NamespacePrefix: null,
            Description: null,
          },
        ]),
    ],
    [
      /FROM PermissionSetAssignment .*GROUP BY PermissionSetId$/,
      () => queryResult([{ psId: PS_AE, n: 5 }]),
    ],
    [
      /FROM PermissionSetAssignment .*GROUP BY Assignee\.ProfileId/,
      () => queryResult([{ profileId: P_DE, psId: PS_AE, n: 5 }]),
    ],
    [/FROM User WHERE/, () => queryResult(users)],
    [
      /FROM VMobile_Object_Configuration_vod__c/,
      () =>
        queryResult([
          {
            Id: "a0V000000000001AAA",
            Name: "Call2_vod__c DE iPad",
            Object_Name_vod__c: "Call2_vod__c",
            Profile_ID_vod__c: P_DE,
            Profile_Name_vod__c: "DE Sales Rep",
            Device_vod__c: "iPad",
            Active_vod__c: true,
            Where_Clause_vod__c: "WHERE Country_vod__c = 'DE'",
            Type_vod__c: "Top Level",
            Enable_Enhanced_Sync_vod__c: true,
            Meta_Data_Only_vod__c: false,
            Field_List_vod__c: "Name,Call_Type_vod__c",
          },
          {
            Id: "a0V000000000002AAA",
            Name: "Call2_vod__c FR iPad",
            Object_Name_vod__c: "Call2_vod__c",
            Profile_ID_vod__c: P_FR.slice(0, 15),
            Profile_Name_vod__c: "FR Sales Rep",
            Device_vod__c: "iPad",
            Active_vod__c: true,
            Where_Clause_vod__c: "WHERE Country_vod__c IN ('FR','BE')",
            Type_vod__c: null,
            Enable_Enhanced_Sync_vod__c: false,
            Meta_Data_Only_vod__c: false,
            Field_List_vod__c: null,
          },
          {
            Id: "a0V000000000003AAA",
            Name: "Message_vod__c all",
            Object_Name_vod__c: "Message_vod__c",
            Profile_ID_vod__c: null,
            Profile_Name_vod__c: null,
            Device_vod__c: "iPad",
            Active_vod__c: true,
            Where_Clause_vod__c:
              "WHERE Language_vod__c IN (@@VOD_USER_LANG_CD@@, 'en_US')",
            Type_vod__c: "Top Level",
            Enable_Enhanced_Sync_vod__c: false,
            Meta_Data_Only_vod__c: false,
            Field_List_vod__c: null,
          },
        ]),
    ],
    [
      /FROM Veeva_Settings_vod__c/,
      () =>
        queryResult([
          {
            Id: "a0S1",
            SetupOwnerId: ORG_ID,
            SetupOwner: { Type: "Organization", Name: "Acme Pharma" },
            ENABLE_SAMPLE_OPT_IN_vod__c: 0,
            CALL_TYPE_vod__c: "Detail_vod",
          },
          {
            Id: "a0S2",
            SetupOwnerId: P_DE,
            SetupOwner: { Type: "Profile", Name: "DE Sales Rep" },
            ENABLE_SAMPLE_OPT_IN_vod__c: 1,
            CALL_TYPE_vod__c: null,
          },
          {
            Id: "a0S3",
            SetupOwnerId: "005000000000001AAA",
            SetupOwner: { Type: "User", Name: "Some User" },
            ENABLE_SAMPLE_OPT_IN_vod__c: 2,
            CALL_TYPE_vod__c: null,
          },
        ]),
    ],
    [
      /FROM Approved_Email_Settings_vod__c/,
      () =>
        queryResult([
          {
            Id: "a0A1",
            SetupOwnerId: ORG_ID,
            SetupOwner: { Type: "Organization", Name: "Acme Pharma" },
            APPROVED_EMAIL_TEST_ADDRESS_vod__c: "test@acme.com",
          },
        ]),
    ],
    [
      /FROM Message_vod__c/,
      () =>
        queryResult([
          {
            Id: "m1",
            Name: "SUBMIT",
            Category_vod__c: "Common",
            Language_vod__c: "en_US",
            Text_vod__c: "Submit",
            Active_vod__c: true,
          },
          {
            Id: "m2",
            Name: "SUBMIT",
            Category_vod__c: "Common",
            Language_vod__c: "de",
            Text_vod__c: "Absenden",
            Active_vod__c: true,
          },
          {
            Id: "m3",
            Name: "SUBMIT",
            Category_vod__c: "Common",
            Language_vod__c: "fr",
            Text_vod__c: "Soumettre",
            Active_vod__c: false,
          },
        ]),
    ],
    [
      /FROM PermissionSetTabSetting/,
      () =>
        queryResult([
          { ParentId: PS_DE, Name: "Call2_vod__c", Visibility: "DefaultOn" },
          { ParentId: PS_FR, Name: "Call2_vod__c", Visibility: "Hidden" },
        ]),
    ],
    [
      /FROM SetupEntityAccess/,
      () => queryResult([{ ParentId: PS_DE, SetupEntityId: APP_ID }]),
    ],
    [
      /FROM AppMenuItem/,
      () =>
        queryResult([
          {
            ApplicationId: APP_ID,
            Name: "Veeva_CRM",
            Label: "Veeva CRM",
            NamespacePrefix: "vod",
          },
        ]),
    ],
  ];

  const toolingRules: typeof soqlRules = [
    [
      /FROM CustomObject/,
      () =>
        queryResult([
          { Id: CO_CALL, DeveloperName: "Call2_vod", NamespacePrefix: null },
          { Id: CO_PHARM, DeveloperName: "DE_Pharmacy", NamespacePrefix: null },
        ]),
    ],
    [
      /FROM Layout WHERE Id = '(\w+)'/,
      (m) =>
        m[1] === L_FR
          ? queryResult([
              {
                Id: L_FR,
                FullName: "Call2_vod__c-Call Layout FR",
                Metadata: {
                  layoutSections: [
                    {
                      label: "Informations",
                      layoutColumns: [
                        {
                          layoutItems: [
                            { field: "Account_vod__c", behavior: "Required" },
                            { field: "Call_Type_vod__c", behavior: "Edit" },
                          ],
                        },
                        {
                          layoutItems: [
                            { field: "Custom_Field__c", behavior: "Readonly" },
                            { emptySpace: true },
                          ],
                        },
                      ],
                    },
                  ],
                  relatedLists: [{ relatedList: "Call2_Detail_vod__r" }],
                  customButtons: ["Submit_vod"],
                },
              },
            ])
          : queryResult([]),
    ],
    [
      /FROM Layout$/,
      () =>
        queryResult([
          {
            Id: L_DE,
            Name: "Call Layout DE",
            TableEnumOrId: CO_CALL,
            LayoutType: "Standard",
            NamespacePrefix: null,
            ManageableState: "unmanaged",
          },
          {
            Id: L_FR,
            Name: "Call Layout FR",
            TableEnumOrId: CO_CALL,
            LayoutType: "Standard",
            NamespacePrefix: null,
            ManageableState: "unmanaged",
          },
          {
            Id: L_ACC,
            Name: "Account Layout",
            TableEnumOrId: "Account",
            LayoutType: "Standard",
            NamespacePrefix: null,
            ManageableState: "unmanaged",
          },
        ]),
    ],
    [
      /FROM ProfileLayout/,
      () =>
        queryResult([
          {
            Id: "pl1",
            ProfileId: P_DE,
            LayoutId: L_DE,
            RecordTypeId: RT_CALL,
            TableEnumOrId: CO_CALL,
          },
          {
            Id: "pl2",
            ProfileId: P_FR,
            LayoutId: L_FR,
            RecordTypeId: RT_CALL,
            TableEnumOrId: CO_CALL,
          },
          {
            Id: "pl3",
            ProfileId: P_DE,
            LayoutId: L_ACC,
            RecordTypeId: null,
            TableEnumOrId: "Account",
          },
        ]),
    ],
    [
      /FROM Profile WHERE Id = '(\w+)'/,
      (m) =>
        profileMetadata
          ? queryResult([
              { Id: m[1], FullName: "x", Metadata: profileMetadataOf[m[1]!] },
            ])
          : sfdcError(
              400,
              "INVALID_FIELD",
              "No such column 'Metadata' on entity 'Profile'",
            ),
    ],
    [
      /FROM ValidationRule/,
      () =>
        opts.validationRulesFail
          ? sfdcError(
              400,
              "INVALID_TYPE",
              "sObject type 'ValidationRule' is not supported",
            )
          : queryResult([
              {
                Id: "03d1",
                ValidationName: "Account_Required",
                Active: true,
                EntityDefinition: { QualifiedApiName: "Call2_vod__c" },
                ErrorMessage: "Account is required",
                ErrorDisplayField: "Account_vod__c",
                NamespacePrefix: null,
              },
            ]),
    ],
    [
      /FROM ApexTrigger/,
      () =>
        queryResult([
          {
            Id: "01q1",
            Name: "AccountCountryTrigger",
            TableEnumOrId: "Account",
            Status: "Active",
            NamespacePrefix: null,
            Body: "if (a.Country_vod__c == 'DE') {}",
          },
          {
            Id: "01q2",
            Name: "VOD_CALL",
            TableEnumOrId: CO_CALL,
            Status: "Active",
            NamespacePrefix: "vod",
            Body: "(hidden)",
          },
        ]),
    ],
    [
      /FROM FlowDefinition/,
      () =>
        queryResult([
          {
            Id: "300",
            DeveloperName: "Notify_Manager",
            MasterLabel: "Notify Manager",
            ActiveVersionId: null,
            NamespacePrefix: null,
          },
        ]),
    ],
    [/FROM WorkflowRule/, () => queryResult([])],
  ];

  const dispatch = (rules: typeof soqlRules, soql: string) => {
    for (const [re, reply] of rules) {
      const m = soql.match(re);
      if (m) return reply(m);
    }
    return sfdcError(
      400,
      "MALFORMED_QUERY",
      `unexpected SOQL in test: ${soql}`,
    );
  };

  const routes: Route[] = [
    {
      match: /\/services\/data\/$/,
      reply: () => ({
        json: [
          { label: "Winter '27", url: "/services/data/v68.0", version: "68.0" },
        ],
      }),
    },
    {
      match: "/limits",
      reply: () => ({
        json: { DailyApiRequests: { Max: 100000, Remaining: 99000 } },
      }),
    },
    {
      match: /\/sobjects\/?$/,
      reply: () => ({
        json: {
          sobjects: [
            gs("Account", { custom: false }),
            gs("Contact", { custom: false }),
            gs("User", { custom: false }),
            gs("Profile", { custom: false, layoutable: false }),
            gs("Call2_vod__c"),
            gs("Call2_vod__Share", { layoutable: false }),
            gs("DE_Pharmacy__c"),
            gs("Zip_to_Terr_vod__c"),
            gs("VMobile_Object_Configuration_vod__c"),
            gs("Message_vod__c"),
            gs("Veeva_Settings_vod__c", {
              customSetting: true,
              layoutable: false,
            }),
            gs("Approved_Email_Settings_vod__c", {
              customSetting: true,
              layoutable: false,
            }),
            gs("Customer_Config__mdt", { layoutable: false }),
          ],
        },
      }),
    },
    {
      match: /\/sobjects\/([\w%]+)\/describe\/layouts$/,
      reply: (req) => {
        const name = decodeURIComponent(req.url.pathname.split("/").at(-3)!);
        if (name === "Call2_vod__c")
          return {
            json: callLayoutDescribe(L_DE, {
              [RT_CALL]: L_DE,
              [RT_CALL_DE]: L_DE,
            }),
          };
        if (name === "Account")
          return {
            json: {
              layouts: [
                { id: L_ACC, detailLayoutSections: [], relatedLists: [] },
              ],
              recordTypeMappings: [],
            },
          };
        return { json: { layouts: [], recordTypeMappings: [] } };
      },
    },
    {
      match: /\/sobjects\/([\w%]+)\/describe$/,
      reply: (req) => {
        const name = decodeURIComponent(req.url.pathname.split("/").at(-2)!);
        const d = describeOf(name, userCountryField);
        return d
          ? { json: d }
          : sfdcError(
              404,
              "NOT_FOUND",
              `The requested resource does not exist: ${name}`,
            );
      },
    },
    {
      match: "/tooling/query",
      reply: (req) => dispatch(toolingRules, req.soql ?? ""),
    },
    { match: "/query?q=", reply: (req) => dispatch(soqlRules, req.soql ?? "") },
  ];
  return { ff: fakeFetch(routes) };
}

async function clientFor(ff: FakeFetch): Promise<SfdcClient> {
  return createSfdcClient(
    { kind: "token", instanceUrl: INSTANCE, accessToken: "t" },
    { fetch: ff.fetch, sleep: async () => {} },
  );
}

const NOW = () => new Date("2026-09-07T12:00:00Z");

describe("extractOrgSnapshot — mini org with Profile.Metadata available", () => {
  it("produces a complete snapshot", async () => {
    const { ff } = miniOrg();
    const client = await clientFor(ff);
    const logs: string[] = [];
    const snap = await extractOrgSnapshot(client, {
      now: NOW,
      log: (m) => logs.push(m),
    });

    expect(snap.schemaVersion).toBe(1);
    expect(snap.extractedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(snap.instanceUrl).toBe(INSTANCE);
    expect(snap.apiVersion).toBe("v68.0");
    expect(snap.orgId).toBe(ORG_ID);
    expect(snap.orgName).toBe("Acme Pharma");
    expect(snap.limits).toEqual({
      dailyApiRequestsMax: 100000,
      dailyApiRequestsRemaining: 99000,
      requestsUsed: client.requestCount,
    });
    expect(snap.extract).toEqual({
      objectsRequested: [
        "Account",
        "Call2_vod__c",
        "Contact",
        "DE_Pharmacy__c",
        "Message_vod__c",
        "User",
        "VMobile_Object_Configuration_vod__c",
      ],
      profileMetadataAvailable: true,
      compositeAvailable: false,
    });

    // objects — Contact has no describe in the fake org → warning, others present
    expect(snap.objects.map((o) => o.apiName)).toEqual([
      "Account",
      "Call2_vod__c",
      "DE_Pharmacy__c",
      "Message_vod__c",
      "User",
      "VMobile_Object_Configuration_vod__c",
    ]);
    expect(snap.warnings.some((w) => w.stage === "object:Contact")).toBe(true);
    const call = snap.objects.find((o) => o.apiName === "Call2_vod__c")!;
    expect(call.managed).toBe(true);
    expect(call.custom).toBe(true);
    const custom = call.fields.find((f) => f.apiName === "Custom_Field__c")!;
    expect(custom).toMatchObject({
      custom: true,
      managed: false,
      type: "double",
      precision: 10,
      scale: 2,
      helpText: "help",
      required: false,
    });
    expect(
      call.fields.find((f) => f.apiName === "Account_vod__c"),
    ).toMatchObject({
      required: true,
      referenceTo: ["Account"],
      managed: true,
    });
    expect(
      call.fields.find((f) => f.apiName === "Total_Formula__c")?.formula,
    ).toBe("1 + 1");
    expect(
      call.fields.find((f) => f.apiName === "Call_Type_vod__c")?.picklistValues,
    ).toEqual([
      { value: "Detail_vod", label: "Detail", active: true, default: true },
      { value: "Group_vod", label: "Group", active: true, default: false },
    ]);
    expect(call.recordTypes).toEqual([
      {
        id: RT_CALL,
        developerName: "Call_vod",
        name: "Call",
        active: true,
        object: "Call2_vod__c",
        description: "Standard call",
        picklistValues: { Call_Type_vod__c: ["Detail_vod"] },
      },
      {
        id: RT_CALL_DE,
        developerName: "Call_DE",
        name: "Call DE",
        active: true,
        object: "Call2_vod__c",
        picklistValues: { Call_Type_vod__c: ["Detail_vod"] },
      },
    ]);
    expect(call.validationRules).toEqual([
      {
        object: "Call2_vod__c",
        name: "Account_Required",
        active: true,
        errorMessage: "Account is required",
        errorDisplayField: "Account_vod__c",
      },
    ]);

    // layouts: DE from describe/layouts, FR from Tooling Layout.Metadata
    const layoutDe = call.layouts.find(
      (l) => l.fullName === "Call2_vod__c-Call Layout DE",
    )!;
    expect(layoutDe.recordTypes.sort()).toEqual(["Call_DE", "Call_vod"]);
    expect(layoutDe.managed).toBe(false);
    expect(layoutDe.sections).toEqual([
      {
        heading: "Information",
        columns: 2,
        fields: ["Account_vod__c", "Call_Type_vod__c", "Total_Formula__c"],
        items: [
          { field: "Account_vod__c", behavior: "Required" },
          { field: "Call_Type_vod__c", behavior: "Edit" },
          { field: "Total_Formula__c", behavior: "Readonly" },
        ],
      },
    ]);
    expect(layoutDe.relatedLists).toEqual(["Call2_Detail_vod__r"]);
    expect(layoutDe.buttons).toEqual(["Submit_vod"]);
    expect(layoutDe.actions).toEqual(["Call2_vod__c.Log_Call"]);
    const layoutFr = call.layouts.find(
      (l) => l.fullName === "Call2_vod__c-Call Layout FR",
    )!;
    expect(layoutFr.recordTypes).toEqual(["Call_vod"]);
    expect(layoutFr.sections).toEqual([
      {
        heading: "Informations",
        columns: 2,
        fields: ["Account_vod__c", "Call_Type_vod__c", "Custom_Field__c"],
        items: [
          { field: "Account_vod__c", behavior: "Required" },
          { field: "Call_Type_vod__c", behavior: "Edit" },
          { field: "Custom_Field__c", behavior: "Readonly" },
        ],
      },
    ]);
    expect(layoutFr.buttons).toEqual(["Submit_vod"]);
    expect(
      ff.toolingSoqls().filter((q) => /FROM Layout WHERE Id/.test(q)),
    ).toEqual([
      `SELECT Id, FullName, Metadata FROM Layout WHERE Id = '${L_FR}'`,
    ]);

    // profiles
    expect(snap.profiles.map((p) => p.name)).toEqual([
      "DE Sales Rep",
      "FR Sales Rep",
    ]);
    const de = snap.profiles[0]!;
    expect(de).toMatchObject({
      id: P_DE,
      userLicense: "Salesforce",
      custom: true,
      description: "German reps",
      permissionSetId: PS_DE,
      activeUsersByCountry: { DE: 10 },
      repTypeCounts: { "Primary Care Rep": 10 },
      permissionSetNames: ["Approved_Email_User"],
      userPermissions: ["PermissionsApiEnabled"],
    });
    expect(de.objectPermissions).toEqual([
      {
        object: "Account",
        create: true,
        read: true,
        edit: true,
        delete: false,
        viewAll: false,
        modifyAll: false,
      },
      {
        object: "Call2_vod__c",
        create: true,
        read: true,
        edit: true,
        delete: true,
        viewAll: false,
        modifyAll: false,
      },
    ]);
    expect(de.fieldPermissions).toContainEqual({
      object: "Call2_vod__c",
      field: "Custom_Field__c",
      readable: true,
      editable: true,
    });
    // non-permissionable fields of readable objects are implicitly readable
    expect(de.fieldPermissions).toContainEqual({
      object: "Call2_vod__c",
      field: "Total_Formula__c",
      readable: true,
      editable: false,
    });
    expect(de.fieldPermissions).toContainEqual({
      object: "Account",
      field: "Name",
      readable: true,
      editable: true,
    });
    expect(de.layoutAssignments).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout DE",
      },
      { object: "Account", recordType: null, layout: "Account-Account Layout" },
      // Contact is in scope (core set) even though its describe failed
      { object: "Contact", recordType: null, layout: "Contact-Contact Layout" },
    ]);
    expect(de.recordTypeVisibilities).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        visible: true,
        default: true,
      },
      {
        object: "Call2_vod__c",
        recordType: "Call_DE",
        visible: true,
        default: false,
      },
    ]);
    expect(de.tabVisibilities).toEqual([
      { tab: "Call2_vod__c", visibility: "DefaultOn" },
      { tab: "standard-Account", visibility: "DefaultOn" },
    ]);
    expect(de.applicationVisibilities).toEqual([
      { application: "vod__Veeva_CRM", visible: true, default: true },
    ]);
    const fr = snap.profiles[1]!;
    expect(fr.activeUsersByCountry).toEqual({ FR: 4, GLOBAL: 1 });
    expect(fr.tabVisibilities).toEqual([
      { tab: "Call2_vod__c", visibility: "DefaultOff" },
    ]);
    expect(fr.userPermissions).toEqual(["PermissionsApiEnabled"]); // from SOQL flags (no userPermissions in blob)
    // no fallback tooling queries were needed
    expect(ff.toolingSoqls().some((q) => /FROM ProfileLayout/.test(q))).toBe(
      false,
    );
    expect(
      ff
        .soqls()
        .some((q) => /PermissionSetTabSetting|SetupEntityAccess/.test(q)),
    ).toBe(false);

    // permission sets
    expect(snap.permissionSets).toEqual([
      {
        id: PS_AE,
        name: "Approved_Email_User",
        label: "Approved Email User",
        description: "AE feature set",
        objectPermissions: [
          {
            object: "Account",
            create: false,
            read: true,
            edit: false,
            delete: false,
            viewAll: true,
            modifyAll: false,
          },
        ],
        fieldPermissions: [
          {
            object: "Account",
            field: "Country_vod__c",
            readable: true,
            editable: false,
          },
        ],
        assignedUserCount: 5,
      },
    ]);

    // users aggregate
    expect(snap.users).toEqual([
      {
        profileId: P_DE,
        profileName: "DE Sales Rep",
        country: "DE",
        userType: "Primary Care Rep",
        language: "de",
        activeUsers: 10,
      },
      {
        profileId: P_FR,
        profileName: "FR Sales Rep",
        country: "FR",
        userType: "Primary Care Rep",
        language: "fr",
        activeUsers: 4,
      },
      {
        profileId: P_FR,
        profileName: "FR Sales Rep",
        country: "GLOBAL",
        userType: null,
        language: "en_US",
        activeUsers: 1,
      },
    ]);
    expect(ff.soqls().find((q) => /FROM User/.test(q))).toBe(
      "SELECT ProfileId profileId, Country_Code_vod__c country, User_Type_vod__c userType, LanguageLocaleKey language, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, Country_Code_vod__c, User_Type_vod__c, LanguageLocaleKey",
    );

    // vmocs
    expect(snap.vmocs).toHaveLength(3);
    expect(snap.vmocs[0]).toEqual({
      id: "a0V000000000001AAA",
      name: "Call2_vod__c DE iPad",
      objectApiName: "Call2_vod__c",
      profile: "DE Sales Rep",
      device: "iPad",
      active: true,
      whereClause: "WHERE Country_vod__c = 'DE'",
      extra: {
        Field_List_vod__c: "Name,Call_Type_vod__c",
        Type_vod__c: "Top Level",
      },
      profileId: P_DE,
      enhancedSync: true,
      metaDataOnly: false,
    });
    expect(snap.vmocs[1]).toMatchObject({
      profile: "FR Sales Rep",
      profileId: P_FR.slice(0, 15),
    });
    expect(snap.vmocs[2]).toMatchObject({ profile: null, profileId: null });
    expect(snap.warnings.find((w) => w.stage === "vmocs")?.message).toMatch(
      /15-character Profile_ID_vod__c/,
    );
    const vmocSoql = ff
      .soqls()
      .find((q) => /FROM VMobile_Object_Configuration_vod__c/.test(q))!;
    expect(
      vmocSoql.startsWith(
        "SELECT Id, Name, Object_Name_vod__c, Profile_ID_vod__c",
      ),
    ).toBe(true);
    expect(vmocSoql).toContain("Field_List_vod__c");

    // settings — level from SetupOwnerId prefix
    expect(snap.settingObjects).toEqual([
      {
        apiName: "Approved_Email_Settings_vod__c",
        label: "Approved_Email_Settings_vod__c",
        type: "Hierarchy",
        fields: ["APPROVED_EMAIL_TEST_ADDRESS_vod__c"],
      },
      {
        apiName: "Veeva_Settings_vod__c",
        label: "Veeva_Settings_vod__c",
        type: "Hierarchy",
        fields: ["ENABLE_SAMPLE_OPT_IN_vod__c", "CALL_TYPE_vod__c"],
      },
    ]);
    expect(snap.veevaSettings).toEqual([
      {
        settingObject: "Approved_Email_Settings_vod__c",
        level: "org",
        ownerName: null,
        values: { APPROVED_EMAIL_TEST_ADDRESS_vod__c: "test@acme.com" },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "org",
        ownerName: null,
        values: {
          ENABLE_SAMPLE_OPT_IN_vod__c: 0,
          CALL_TYPE_vod__c: "Detail_vod",
        },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "profile",
        ownerName: "DE Sales Rep",
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: 1 },
      },
      {
        settingObject: "Veeva_Settings_vod__c",
        level: "user",
        ownerName: "Some User",
        values: { ENABLE_SAMPLE_OPT_IN_vod__c: 2 },
      },
    ]);
    expect(ff.soqls().find((q) => /FROM Veeva_Settings_vod__c/.test(q))).toBe(
      "SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name, ENABLE_SAMPLE_OPT_IN_vod__c, CALL_TYPE_vod__c FROM Veeva_Settings_vod__c",
    );

    // messages — restricted to languages in use + en_US
    expect(ff.soqls().find((q) => /FROM Message_vod__c/.test(q))).toBe(
      "SELECT Id, Name, Category_vod__c, Language_vod__c, Text_vod__c, Active_vod__c FROM Message_vod__c WHERE Language_vod__c IN ('de', 'en_US', 'fr')",
    );
    expect(snap.messages).toEqual([
      {
        name: "SUBMIT",
        category: "Common",
        language: "en_US",
        text: "Submit",
        country: null,
        active: true,
      },
      {
        name: "SUBMIT",
        category: "Common",
        language: "de",
        text: "Absenden",
        country: null,
        active: true,
      },
      {
        name: "SUBMIT",
        category: "Common",
        language: "fr",
        text: "Soumettre",
        country: null,
        active: false,
      },
    ]);

    // automation
    expect(snap.automation).toEqual([
      {
        kind: "apex_trigger",
        name: "AccountCountryTrigger",
        object: "Account",
        active: true,
        managed: false,
        countryLogic: true,
      },
      {
        kind: "apex_trigger",
        name: "VOD_CALL",
        object: "Call2_vod__c",
        active: true,
        managed: true,
        countryLogic: false,
      },
      {
        kind: "flow",
        name: "Notify_Manager",
        object: null,
        active: false,
        managed: false,
        countryLogic: false,
      },
    ]);

    // countries — users + picklist + vmoc where clauses + profile-name tokens
    expect(snap.countries).toEqual([
      { code: "BE", name: "Belgium", activeUsers: 0, sources: ["vmoc"] },
      {
        code: "DE",
        name: "Germany",
        activeUsers: 10,
        sources: ["user_country_code_vod", "picklist", "vmoc", "profile_name"],
      },
      {
        code: "FR",
        name: "France",
        activeUsers: 4,
        sources: ["user_country_code_vod", "picklist", "vmoc", "profile_name"],
      },
      {
        code: "US",
        name: "United States",
        activeUsers: 0,
        sources: ["picklist"],
      },
    ]);

    // economy: each describe exactly once, one FieldPermissions cursor, one ObjectPermissions cursor
    const describes = ff
      .callsTo("/describe")
      .filter((c) => !c.url.pathname.endsWith("/layouts"))
      .map((c) => c.url.pathname);
    expect(new Set(describes).size).toBe(describes.length);
    expect(
      ff.soqls().filter((q) => /FROM FieldPermissions/.test(q)),
    ).toHaveLength(1);
    expect(
      ff.soqls().filter((q) => /FROM ObjectPermissions/.test(q)),
    ).toHaveLength(1);
    expect(ff.soqls().find((q) => /FROM ObjectPermissions/.test(q))).toContain(
      "WHERE SobjectType IN ('Account', 'Call2_vod__c'",
    );
    expect(logs.some((l) => /extraction finished/.test(l))).toBe(true);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain JSON
  });

  it("honours objects / includeManagedObjects / apiVersion / messageFilter", async () => {
    const { ff } = miniOrg();
    const client = await clientFor(ff);
    const snap = await extractOrgSnapshot(client, {
      now: NOW,
      objects: ["Call2_vod__c", "Nope__c"],
      apiVersion: "66.0",
      messageFilter: "all",
    });
    expect(snap.apiVersion).toBe("v66.0");
    expect(
      ff.calls.every((c) => !c.url.pathname.includes("/services/data/v68.0/")),
    ).toBe(true);
    expect(snap.extract?.objectsRequested).toEqual(["Call2_vod__c"]);
    expect(snap.warnings.find((w) => w.stage === "objects")?.message).toMatch(
      /Nope__c/,
    );
    expect(snap.objects.map((o) => o.apiName)).toEqual(["Call2_vod__c"]);
    expect(ff.soqls().find((q) => /FROM Message_vod__c/.test(q))).not.toContain(
      "WHERE",
    );

    const { ff: ff2 } = miniOrg();
    const snap2 = await extractOrgSnapshot(await clientFor(ff2), {
      now: NOW,
      includeManagedObjects: true,
    });
    expect(snap2.extract?.objectsRequested).toContain("Zip_to_Terr_vod__c");
    expect(snap2.extract?.objectsRequested).not.toContain("Call2_vod__Share");
  });

  it("falls back to User.Country and normalises free-text names", async () => {
    const { ff } = miniOrg({ userCountryField: "country" });
    const snap = await extractOrgSnapshot(await clientFor(ff), { now: NOW });
    expect(ff.soqls().find((q) => /FROM User/.test(q))).toBe(
      "SELECT ProfileId profileId, Country country, LanguageLocaleKey language, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, Country, LanguageLocaleKey",
    );
    expect(snap.users?.map((u) => [u.country, u.userType])).toEqual([
      ["DE", null],
      ["FR", null],
      ["GLOBAL", null],
    ]);
    expect(snap.countries.find((c) => c.code === "DE")?.sources).toContain(
      "user_country",
    );
    expect(snap.warnings.find((w) => w.stage === "users")?.message).toMatch(
      /Atlantis/,
    );
  });

  it("aborts when the request budget is exhausted", async () => {
    const { ff } = miniOrg();
    const client = await clientFor(ff);
    await expect(
      extractOrgSnapshot(client, { now: NOW, maxRequests: 5 }),
    ).rejects.toMatchObject({
      errorCode: "REQUEST_BUDGET_EXCEEDED",
    });
    expect(client.requestCount).toBe(5);
  });
});

describe("extractOrgSnapshot — Tooling failures are warnings, not aborts", () => {
  it("falls back to ProfileLayout / PermissionSetTabSetting / SetupEntityAccess when Profile.Metadata is unavailable", async () => {
    const { ff } = miniOrg({
      profileMetadata: false,
      validationRulesFail: true,
    });
    const snap = await extractOrgSnapshot(await clientFor(ff), { now: NOW });

    expect(snap.extract?.profileMetadataAvailable).toBe(false);
    // only ONE metadata attempt — do not burn a call per profile once it failed
    expect(
      ff.toolingSoqls().filter((q) => /FROM Profile WHERE Id/.test(q)),
    ).toHaveLength(1);
    const stages = snap.warnings.map((w) => w.stage);
    expect(stages).toContain("profile_metadata");
    expect(stages).toContain("record_type_visibility");
    expect(stages).toContain("validation_rules");
    expect(
      snap.warnings.find((w) => w.stage === "validation_rules"),
    ).toMatchObject({
      detail: { status: 400, errorCode: "INVALID_TYPE" },
    });
    expect(snap.objects.flatMap((o) => o.validationRules)).toEqual([]);

    const de = snap.profiles.find((p) => p.name === "DE Sales Rep")!;
    const fr = snap.profiles.find((p) => p.name === "FR Sales Rep")!;
    expect(de.layoutAssignments).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout DE",
      },
      { object: "Account", recordType: null, layout: "Account-Account Layout" },
    ]);
    expect(fr.layoutAssignments).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout FR",
      },
    ]);
    expect(de.tabVisibilities).toEqual([
      { tab: "Call2_vod__c", visibility: "DefaultOn" },
    ]);
    expect(fr.tabVisibilities).toEqual([
      { tab: "Call2_vod__c", visibility: "Hidden" },
    ]);
    expect(de.applicationVisibilities).toEqual([
      { application: "vod__Veeva_CRM", visible: true, default: false },
    ]);
    expect(fr.applicationVisibilities).toEqual([]);
    // record-type visibility approximated from the running user's describe, flagged
    expect(de.recordTypeVisibilities).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        visible: true,
        default: true,
      },
      {
        object: "Call2_vod__c",
        recordType: "Call_DE",
        visible: false,
        default: false,
      },
    ]);
    expect(de.userPermissions).toEqual(["PermissionsApiEnabled"]);
    // the FR layout still got its sections via Tooling Layout.Metadata
    const call = snap.objects.find((o) => o.apiName === "Call2_vod__c")!;
    expect(
      call.layouts.find((l) => l.fullName === "Call2_vod__c-Call Layout FR")
        ?.sections,
    ).toHaveLength(1);
    expect(
      ff
        .toolingSoqls()
        .some((q) =>
          /FROM ProfileLayout WHERE TableEnumOrId IN \('Account', '01I0000000000CALLA'/.test(
            q,
          ),
        ),
    ).toBe(true);
  });

  it("keeps going when whole stages fail (settings, VMOCs, users) and when describe is denied", async () => {
    const { ff } = miniOrg();
    const broken = fakeFetch([
      {
        match: /FROM(%20|\+| )User/,
        reply: () =>
          sfdcError(
            400,
            "INVALID_FIELD",
            "No such column 'Country_Code_vod__c' on entity 'User'",
          ),
      },
      {
        match: "/sobjects/Veeva_Settings_vod__c/describe",
        reply: () => sfdcError(403, "INSUFFICIENT_ACCESS", "no"),
      },
      {
        match: /FROM(%20|\+| )VMobile/,
        reply: () => ({ status: 500, text: "Internal Server Error" }),
      },
      {
        match: "",
        reply: async (req) => {
          const res = await ff.fetch(req.url.href, {
            method: req.method,
            headers: req.headers,
          });
          return {
            status: res.status,
            text: await res.text(),
            headers: Object.fromEntries(res.headers.entries()),
          };
        },
      },
    ]);
    const client = await createSfdcClient(
      { kind: "token", instanceUrl: INSTANCE, accessToken: "t" },
      { fetch: broken.fetch, sleep: async () => {}, retryDelaysMs: [1] },
    );
    const snap = await extractOrgSnapshot(client, { now: NOW });
    const byStage = Object.fromEntries(
      snap.warnings.map((w) => [w.stage, w.message]),
    );
    // users: the column-drop retry removed Country_Code_vod__c, then the fake still rejects → warning, empty aggregate
    expect(byStage.users).toBeDefined();
    expect(snap.users).toEqual([]);
    expect(snap.profiles[0]!.activeUsersByCountry).toEqual({});
    expect(byStage["settings:Veeva_Settings_vod__c"]).toMatch(/403/);
    expect(snap.veevaSettings.map((s) => s.settingObject)).toEqual([
      "Approved_Email_Settings_vod__c",
    ]);
    expect(byStage.vmocs).toMatch(/500/);
    expect(snap.vmocs).toEqual([]);
    expect(snap.countries.map((c) => c.code)).toEqual(["DE", "FR", "US"]); // picklist + profile names only
    expect(snap.messages.length).toBe(3); // language filter fell back to en_US only in the query, fake returns all
    expect(ff.soqls().find((q) => /FROM Message_vod__c/.test(q))).toContain(
      "IN ('en_US')",
    );
  });
});

describe("pure helpers", () => {
  it("decideObjectSet: core ∩ org + non-managed custom, managed only on request, skips __Share/__mdt/settings", () => {
    const sobjects = [
      gs("Account", { custom: false }),
      gs("Call2_vod__c"),
      gs("Call2_vod__Share", { layoutable: false }),
      gs("Zip_to_Terr_vod__c"),
      gs("Custom__c"),
      gs("Config__mdt"),
      gs("Veeva_Settings_vod__c", { customSetting: true }),
      gs("Lead", { custom: false }),
    ];
    expect(decideObjectSet(sobjects, {})).toEqual([
      "Account",
      "Call2_vod__c",
      "Custom__c",
    ]);
    expect(decideObjectSet(sobjects, { includeManagedObjects: true })).toEqual([
      "Account",
      "Call2_vod__c",
      "Custom__c",
      "Zip_to_Terr_vod__c",
    ]);
    const warnings: string[] = [];
    expect(
      decideObjectSet(sobjects, { objects: ["Lead", "Missing__c"] }, (m) =>
        warnings.push(m),
      ),
    ).toEqual(["Lead"]);
    expect(warnings[0]).toMatch(/Missing__c/);
  });

  it("decodeProfileMetadata splits layout / record type names and filters to scope", () => {
    const out = decodeProfileMetadata(
      {
        layoutAssignments: [
          {
            layout: "Call2_vod__c-Call Layout",
            recordType: "Call2_vod__c.Call_vod",
          },
          { layout: "Lead-Lead Layout" },
        ],
        recordTypeVisibilities: [
          {
            recordType: "Account.Professional_vod",
            visible: true,
            default: false,
          },
        ],
        tabVisibilities: [
          { tab: "standard-Account", visibility: "Visible" },
          { tab: "X", visibility: "Weird" },
        ],
      },
      new Set(["Call2_vod__c", "Account"]),
    );
    expect(out.layoutAssignments).toEqual([
      {
        object: "Call2_vod__c",
        recordType: "Call_vod",
        layout: "Call2_vod__c-Call Layout",
      },
    ]);
    expect(out.recordTypeVisibilities).toEqual([
      {
        object: "Account",
        recordType: "Professional_vod",
        visible: true,
        default: false,
      },
    ]);
    expect(out.tabVisibilities).toEqual([
      { tab: "standard-Account", visibility: "DefaultOn" },
      { tab: "X", visibility: "Hidden" },
    ]);
    expect(out.applicationVisibilities).toBeNull();
    expect(out.userPermissions).toBeNull();
  });

  it("decodeLayoutMetadata / dropSelectColumn / resolveUserCountry", () => {
    expect(
      decodeLayoutMetadata({
        layoutSections: [
          {
            label: "A",
            layoutColumns: [
              {
                layoutItems: [
                  { field: "X__c", behavior: "Edit" },
                  { emptySpace: true },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      sections: [
        {
          heading: "A",
          columns: 1,
          fields: ["X__c"],
          items: [{ field: "X__c", behavior: "Edit" }],
        },
      ],
      relatedLists: [],
      buttons: [],
      actions: [],
    });
    expect(
      dropSelectColumn(
        "SELECT Id, Name, SetupOwner.Name, X__c FROM S",
        "SetupOwner.Name",
      ),
    ).toBe("SELECT Id, Name, X__c FROM S");
    expect(
      dropSelectColumn(
        "SELECT ProfileId profileId, Country_Code_vod__c country, COUNT(Id) n FROM User WHERE IsActive = true GROUP BY ProfileId",
        "Country_Code_vod__c",
      ),
    ).toBe(
      "SELECT ProfileId profileId, COUNT(Id) n FROM User WHERE IsActive = true GROUP BY ProfileId",
    );
    const unknown = new Set<string>();
    expect(resolveUserCountry("de", unknown)).toBe("DE");
    expect(resolveUserCountry("Deutschland", unknown)).toBe("DE");
    expect(resolveUserCountry(null, unknown)).toBe("GLOBAL");
    expect(resolveUserCountry("Narnia", unknown)).toBe("GLOBAL");
    expect([...unknown]).toEqual(["Narnia"]);
  });
});
