import { describe, expect, it } from "vitest";

import {
  OBJECT_MAPPINGS,
  isVeevaOwnedObject,
  lookupObjectMapping,
  mapFieldName,
  mapFieldType,
  mapLayoutName,
  mapObjectName,
  mapPersonaName,
  mapPicklistName,
  mapPicklistValueName,
  mapProfileName,
  mapRecordTypeName,
  mapTabName,
  resolveObjectMapping,
  splitSuffix,
  toLowerSnake,
} from "./mapping";

describe("object names", () => {
  it.each([
    ["Account", "account__v"],
    ["Call2_vod__c", "call2__v"],
    ["Call2_Detail_vod__c", "call2_detail__v"],
    ["Product_vod__c", "product__v"],
    ["TSF_vod__c", "tsf__v"],
    ["Key_Message_vod__c", "key_message__v"],
    ["Address_vod__c", "address__v"],
    ["Child_Account_vod__c", "child_account__v"],
    ["Medical_Inquiry_vod__c", "medical_inquiry__v"],
    ["Sample_Transaction_vod__c", "sample_transaction__v"],
    ["Time_Off_Territory_vod__c", "time_off_territory__v"],
    ["Cycle_Plan_vod__c", "cycle_plan__v"],
    ["Approved_Document_vod__c", "approved_document__v"],
    ["Sent_Email_vod__c", "sent_email__v"],
    ["CLM_Presentation_vod__c", "clm_presentation__v"],
    ["EM_Event_vod__c", "em_event__v"],
    ["Message_vod__c", "message__v"],
    ["VMobile_Object_Configuration_vod__c", "vmobile_object_configuration__v"],
    ["Veeva_Settings_vod__c", "veeva_settings__v"],
    // suffix rule for objects not in the table
    ["Some_Other_vod__c", "some_other__v"],
    ["Speaker_Engagement__c", "speaker_engagement__c"],
    ["User", "user__v"],
  ])("%s → %s", (source, target) => {
    expect(mapObjectName(source)).toBe(target);
  });

  it("marks confidence: confirmed for documented objects, assumed for the rest", () => {
    expect(lookupObjectMapping("Call2_vod__c")?.confidence).toBe("confirmed");
    expect(lookupObjectMapping("Call2_Detail_vod__c")?.confidence).toBe(
      "assumed",
    );
    expect(resolveObjectMapping("Foo_vod__c").confidence).toBe("assumed");
    expect(resolveObjectMapping("Foo__c").confidence).toBe("derived");
    const sources = OBJECT_MAPPINGS.map((m) => m.source);
    expect([...sources].sort()).toEqual(sources);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("knows which objects Veeva owns", () => {
    expect(isVeevaOwnedObject("Call2_vod__c")).toBe(true);
    expect(isVeevaOwnedObject("Account")).toBe(true);
    expect(isVeevaOwnedObject("Speaker_Engagement__c")).toBe(false);
  });
});

describe("field names", () => {
  it.each([
    ["Call_Type_vod__c", "call_type__v"],
    ["Foo__c", "foo__c"],
    ["DE_Pharmacy_Id__c", "de_pharmacy_id__c"],
    ["Name", "name__v"],
    ["Id", "id"],
    ["OwnerId", "owner__v"],
    ["LastModifiedDate", "modified_date__v"],
    ["Phone", "phone__v"],
    ["BillingCity", "billing_city__v"],
    ["Account_vod__r", "account__v"],
    ["ENABLE_SAMPLE_OPT_IN_vod__c", "enable_sample_opt_in__v"],
  ])("%s → %s", (source, target) => {
    expect(mapFieldName(source)).toBe(target);
  });

  it("lower-snakes camel case without splitting acronyms", () => {
    expect(toLowerSnake("CLMPresentation")).toBe("clm_presentation");
    expect(toLowerSnake("TSF")).toBe("tsf");
    expect(toLowerSnake("Call2Detail")).toBe("call2_detail");
    expect(toLowerSnake("Lunch & Learn")).toBe("lunch_learn");
  });

  it("splits suffixes", () => {
    expect(splitSuffix("Call2_vod__c")).toEqual({
      base: "Call2",
      managed: true,
      custom: true,
    });
    expect(splitSuffix("Foo__c")).toEqual({
      base: "Foo",
      managed: false,
      custom: true,
    });
    expect(splitSuffix("Submitted_vod")).toEqual({
      base: "Submitted",
      managed: true,
      custom: false,
    });
    expect(splitSuffix("Name")).toEqual({
      base: "Name",
      managed: false,
      custom: false,
    });
  });

  it("maps picklist / record type / layout / tab names", () => {
    expect(mapPicklistValueName("Submitted_vod")).toBe("submitted__v");
    expect(mapPicklistValueName("Lunch and Learn")).toBe("lunch_and_learn__c");
    expect(mapRecordTypeName("Detail_vod")).toBe("detail__v");
    expect(mapRecordTypeName("Hospital Visit")).toBe("hospital_visit__c");
    expect(mapPicklistName("Call2_vod__c", "Call_Type_vod__c")).toBe(
      "call_type__v",
    );
    expect(mapPicklistName("Call2_vod__c", "Visit_Purpose__c")).toBe(
      "call2_visit_purpose__c",
    );
    expect(mapPicklistName("Account", "Industry")).toBe("industry__v");
    expect(mapLayoutName("Call2_vod__c-Call Layout DE")).toEqual({
      object: "call2__v",
      name: "call_layout_de__c",
      label: "Call Layout DE",
    });
    expect(mapTabName("standard-Account")).toBe("account_tab__v");
    expect(mapTabName("Call2_vod__c")).toBe("call2_tab__v");
    expect(mapTabName("Speaker_Engagement__c")).toBe(
      "speaker_engagement_tab__c",
    );
  });
});

describe("profiles", () => {
  it("derives security profile / permission set / application profile names", () => {
    expect(mapProfileName("DE Sales Rep")).toEqual({
      securityProfile: "sp_de_sales_rep__c",
      permissionSet: "ps_de_sales_rep__c",
      applicationProfile: "app_de_sales_rep__c",
      label: "DE Sales Rep",
    });
    expect(mapPersonaName("FR", "specialty_rep")).toMatchObject({
      securityProfile: "sp_fr_specialty_rep__c",
      permissionSet: "ps_fr_specialty_rep__c",
      label: "FR specialty rep",
    });
  });
});

describe("field types", () => {
  it.each([
    ["string", "String"],
    ["Text", "String"],
    ["textarea", "LongText"],
    ["LongTextArea", "LongText"],
    ["double", "Number"],
    ["Number", "Number"],
    ["currency", "Number"],
    ["percent", "Number"],
    ["date", "Date"],
    ["datetime", "DateTime"],
    ["boolean", "Boolean"],
    ["Checkbox", "Boolean"],
    ["picklist", "Picklist"],
    ["reference", "Object"],
    ["Lookup", "Object"],
    ["MasterDetail", "Object"],
    ["email", "String"],
    ["phone", "String"],
    ["url", "String"],
    ["id", "Object"],
    ["location", "Unsupported"],
    ["weird", "Unsupported"],
  ])("%s → %s", (source, target) => {
    expect(mapFieldType(source).type).toBe(target);
  });

  it("marks multi-select picklists and formulas", () => {
    expect(mapFieldType("multipicklist")).toMatchObject({
      type: "Picklist",
      multiValue: true,
    });
    expect(mapFieldType("MultiselectPicklist").multiValue).toBe(true);
    expect(mapFieldType("double", { formula: "A__c * 2" }).type).toBe(
      "Formula",
    );
    expect(mapFieldType("currency").confidence).toBe("assumed");
    expect(mapFieldType("string").confidence).toBe("confirmed");
  });
});
