import { describe, expect, it } from "vitest";
import {
  renameField,
  renameObject,
  renameObjectType,
  renamePicklistValue,
  renameStatusField,
  renameTimezone,
} from "./rename";
import {
  formatTransform,
  parseTransform,
  refTarget,
  innerTransform,
} from "./spec";

describe("§6.0.2 rename rule", () => {
  it("renames objects", () => {
    expect(renameObject("Call2_vod__c")).toBe("call2__v");
    expect(renameObject("Account")).toBe("account__v");
    expect(renameObject("User")).toBe("user__sys");
    expect(renameObject("EM_Event_vod__c")).toBe("em_event__v");
  });
  it("renames fields with the documented exceptions", () => {
    expect(renameField("Call_Datetime_vod__c")).toBe("call_datetime__v");
    expect(renameField("Foo__c")).toBe("foo__c");
    expect(renameField("zvod_Sample_Lines_vod__c")).toBeNull();
    expect(renameField("Id")).toBeNull();
    expect(renameField("Name")).toBe("name__v");
    expect(renameField("OwnerId")).toBe("ownerid__v");
    expect(renameField("CreatedById")).toBe("created_by__v");
    expect(renameField("LastModifiedDate")).toBe("modified_date__v");
    expect(renameField("RecordTypeId")).toBe("object_type__v.api_name__v");
    expect(renameField("CurrencyIsoCode")).toBe("local_currency__sys");
    expect(renameField("IsDeleted")).toBeNull();
    expect(renameField("FirstName")).toBe("firstname__v");
  });
  it("renames picklist values", () => {
    expect(renamePicklistValue("Submitted_vod")).toBe("submitted__v");
    expect(renamePicklistValue("Opt_In_vod")).toBe("opt_in__v");
    expect(renamePicklistValue("Detail Only")).toBe("detail_only__v");
    expect(renamePicklistValue("Dr. med.", true)).toBe("dr_med__c");
    expect(renamePicklistValue("In Range")).toBe("in_range__v");
  });
  it("renames object types, status fields and timezones", () => {
    expect(renameObjectType("Speaker_Program_vod")).toBe("speaker_program__v");
    expect(renameObjectType("Approved_Email_vod")).toBe("approved_email__v");
    expect(renameStatusField("em_event__v")).toBe("em_event_status__v");
    expect(renameTimezone("America/New_York")).toBe("america_new_york__sys");
  });
});

describe("transform spec text form", () => {
  it("round-trips every kind", () => {
    const samples = [
      "copy",
      "text",
      "text(128)",
      "longtext",
      "richtext",
      "bool",
      "number",
      "number(2)",
      "date",
      "datetime",
      "datetimeToDate",
      "picklist(account.specialty)",
      "multipicklist(account.credentials)",
      "objectType(call2.objectType)",
      "state(call2.state)",
      "ref(account)",
      "refUser",
      "refLookup(product, external_id__v)",
      "legacyId",
      "country(ref)",
      "territoryRef",
      "nameTemplate(person)",
      "currency",
      "userTimezone",
      "localeLookup(language)",
      "statusFromFlag(Inactive_vod__c, true)",
      "statusFromFlag(Status_vod__c, in:Closed_vod,Cancelled_vod)",
      "const(data_load__v)",
      "compositeExternalId('{u}__{t}', u=user:UserId, t=ref:territory:Territory2Id)",
      "ref(territory) secondPass",
      "deferredBlob(signature)",
      "text deferredBlob",
      "skip",
      "custom(userStatus)",
    ];
    for (const s of samples) {
      const spec = parseTransform(s);
      expect(formatTransform(spec)).toBe(s);
      expect(parseTransform(formatTransform(spec))).toEqual(spec);
    }
  });
  it("parses arguments precisely", () => {
    expect(parseTransform("statusFromFlag(Active_vod__c, false)")).toEqual({
      kind: "statusFromFlag",
      sourceFlag: "Active_vod__c",
      inactiveWhen: { equals: false },
    });
    expect(parseTransform("const(42)")).toEqual({ kind: "const", value: 42 });
    expect(parseTransform("const(null)")).toEqual({
      kind: "const",
      value: null,
    });
    expect(parseTransform(" ref(product)  secondPass ")).toEqual({
      kind: "secondPass",
      inner: { kind: "ref", objectKey: "product" },
    });
  });
  it("rejects unknown kinds and bad refs", () => {
    expect(() => parseTransform("frobnicate")).toThrow(/Unknown transform/);
    expect(() => parseTransform("ref(nope)")).toThrow(/not an object key/);
    expect(() => parseTransform("picklist()")).toThrow();
    expect(() => parseTransform("country(x)")).toThrow();
  });
  it("finds the ref target through wrappers", () => {
    expect(refTarget(parseTransform("ref(account) secondPass"))).toBe(
      "account",
    );
    expect(refTarget(parseTransform("refUser"))).toBe("user");
    expect(refTarget(parseTransform("text"))).toBeUndefined();
    expect(innerTransform(parseTransform("text(10) deferredBlob"))).toEqual({
      kind: "text",
      max: 10,
    });
  });
});
