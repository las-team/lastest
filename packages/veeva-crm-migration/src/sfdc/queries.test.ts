import { describe, expect, it } from "vitest";

import {
  chunkIds,
  fieldPermissionsQuery,
  invalidFieldFromMessage,
  isSkippedObject,
  isVeevaManaged,
  isVeevaSettingObject,
  messageQuery,
  objectPermissionsQuery,
  profileLayoutQuery,
  profileMetadataQuery,
  profileQuery,
  sameId,
  settingLevel,
  settingRecordsQuery,
  soqlString,
  to18,
  userSummaryQuery,
  validationRuleQuery,
  vmocQuery,
} from "./queries";

describe("queries", () => {
  it("settingLevel derives the hierarchy level from the SetupOwnerId prefix", () => {
    expect(settingLevel("00D000000000001EAA")).toBe("org");
    expect(settingLevel("00e00000000000DEAA")).toBe("profile");
    expect(settingLevel("005000000000001AAA")).toBe("user");
    expect(settingLevel(null)).toBe("org");
  });

  it("to18 / sameId handle 15- and 18-character ids", () => {
    expect(to18("00e00000000000D")).toHaveLength(18);
    expect(to18("00e00000000000DEAA")).toBe("00e00000000000DEAA");
    expect(to18("001A0000006Vm9r")).toBe("001A0000006Vm9rIAC");
    expect(sameId("00e00000000000DEAA", "00e00000000000D")).toBe(true);
    expect(sameId("00e00000000000DEAA", "00e00000000000FRAA")).toBe(false);
    expect(sameId(null, "x")).toBe(false);
  });

  it("chunkIds splits into ≤ 200 by default", () => {
    const ids = Array.from({ length: 401 }, (_, i) => `id${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 1]);
    expect(chunkIds([], 10)).toEqual([]);
  });

  it("escapes SOQL string literals", () => {
    expect(soqlString("O'Neil\\x")).toBe("O\\'Neil\\\\x");
    expect(fieldPermissionsQuery(["A", "B'C"])).toBe(
      "SELECT ParentId, SobjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType IN ('A', 'B\\'C')",
    );
  });

  it("builds SELECT lists only from confirmed columns", () => {
    expect(profileQuery(["PermissionsApiEnabled"])).toBe(
      "SELECT Id, Name, UserLicenseId, UserLicense.Name, UserType, Description, PermissionsApiEnabled FROM Profile",
    );
    expect(objectPermissionsQuery(["Account"], true)).toContain(
      "PermissionsViewAllFields",
    );
    expect(objectPermissionsQuery(["Account"])).not.toContain(
      "PermissionsViewAllFields",
    );
    expect(vmocQuery(["Object_Name_vod__c", "Name"])).toBe(
      "SELECT Id, Name, Object_Name_vod__c FROM VMobile_Object_Configuration_vod__c",
    );
    expect(
      settingRecordsQuery("Veeva_Settings_vod__c", ["A_vod__c"], true),
    ).toBe(
      "SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name, A_vod__c FROM Veeva_Settings_vod__c",
    );
    expect(
      settingRecordsQuery("List_Settings_vod__c", ["A_vod__c"], false),
    ).toBe("SELECT Id, Name, A_vod__c FROM List_Settings_vod__c");
    expect(messageQuery(["Name", "Language_vod__c"], ["de", "en_US"])).toBe(
      "SELECT Id, Name, Language_vod__c FROM Message_vod__c WHERE Language_vod__c IN ('de', 'en_US')",
    );
    expect(messageQuery(["Name"], ["de"])).toBe(
      "SELECT Id, Name FROM Message_vod__c",
    );
    expect(validationRuleQuery(["Call2_vod__c"])).toContain(
      "WHERE EntityDefinition.QualifiedApiName IN ('Call2_vod__c')",
    );
    expect(profileLayoutQuery(["Account", "01I0000000000CALLA"])).toContain(
      "IN ('Account', '01I0000000000CALLA')",
    );
    expect(profileMetadataQuery("00e1")).toBe(
      "SELECT Id, FullName, Metadata FROM Profile WHERE Id = '00e1'",
    );
  });

  it("userSummaryQuery drops columns that do not exist", () => {
    expect(
      userSummaryQuery({
        countryField: "Country_Code_vod__c",
        userType: true,
        language: true,
      }),
    ).toBe(
      "SELECT ProfileId profileId, Country_Code_vod__c country, User_Type_vod__c userType, LanguageLocaleKey language, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, Country_Code_vod__c, User_Type_vod__c, LanguageLocaleKey",
    );
    expect(
      userSummaryQuery({
        countryField: "CountryCode",
        userType: false,
        language: false,
      }),
    ).toBe(
      "SELECT ProfileId profileId, CountryCode country, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, CountryCode",
    );
    expect(
      userSummaryQuery({ countryField: null, userType: false, language: true }),
    ).toBe(
      "SELECT ProfileId profileId, LanguageLocaleKey language, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, LanguageLocaleKey",
    );
  });

  it("classifies names", () => {
    expect(isVeevaManaged("Call2_vod__c")).toBe(true);
    expect(isVeevaManaged("Call_vod")).toBe(true);
    expect(isVeevaManaged("DE_Pharmacy__c")).toBe(false);
    expect(isVeevaManaged("Account")).toBe(false);
    expect(isVeevaSettingObject("Veeva_Settings_vod__c")).toBe(true);
    expect(isVeevaSettingObject("Approved_Email_Settings_vod__c")).toBe(true);
    expect(isVeevaSettingObject("Veeva_Common_vod__c")).toBe(true);
    expect(isVeevaSettingObject("Message_vod__c")).toBe(false);
    expect(isSkippedObject("Call2_vod__Share")).toBe(true);
    expect(isSkippedObject("Account")).toBe(false);
  });

  it("parses INVALID_FIELD messages", () => {
    expect(
      invalidFieldFromMessage(
        "\nSELECT Id, Foo FROM User\n           ^\nERROR at Row:1:Column:12\nNo such column 'Foo' on entity 'User'.",
      ),
    ).toBe("Foo");
    expect(
      invalidFieldFromMessage(
        "Didn't understand relationship 'SetupOwner' in field path.",
      ),
    ).toBe("SetupOwner");
    expect(invalidFieldFromMessage("something else")).toBeNull();
  });
});
