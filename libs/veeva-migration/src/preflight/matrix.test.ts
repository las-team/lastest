import { describe, expect, it } from "vitest";
import {
  autoSwitchTransform,
  checkCompatibility,
  rewrap,
  sfdcTypeGroup,
} from "./matrix";

describe("checkCompatibility (§5.4)", () => {
  it("accepts the documented rows", () => {
    expect(
      checkCompatibility({
        transform: { kind: "legacyId" },
        sfdcType: "id",
        targetType: "string",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "text", max: 128 },
        sfdcType: "string",
        targetType: "string",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "longtext" },
        sfdcType: "textarea",
        targetType: "longtext",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "bool" },
        sfdcType: "boolean",
        targetType: "picklist",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "number", scale: 2 },
        sfdcType: "currency",
        targetType: "currency",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "date" },
        sfdcType: "date",
        targetType: "date",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "datetimeToDate" },
        sfdcType: "datetime",
        targetType: "date",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "multipicklist", mapKey: "x" },
        sfdcType: "multipicklist",
        targetType: "picklist",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "ref", objectKey: "account" },
        sfdcType: "reference",
        targetType: "object",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "country", mode: "ref" },
        sfdcType: "reference",
        targetType: "object",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "country", mode: "iso2" },
        sfdcType: "string",
        targetType: "string",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: {
          kind: "deferredBlob",
          inner: { kind: "longtext" },
          blobName: "signature",
        },
        sfdcType: "textarea",
        targetType: "longtext",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: {
          kind: "secondPass",
          inner: { kind: "ref", objectKey: "call2" },
        },
        sfdcType: "reference",
        targetType: "object",
      }).ok,
    ).toBe(true);
  });

  it("rejects incompatible targets", () => {
    const r = checkCompatibility({
      transform: { kind: "date" },
      sfdcType: "date",
      targetType: "string",
    });
    expect(r.ok).toBe(false);
    expect(r.side).toBe("target");
    expect(
      checkCompatibility({
        transform: { kind: "datetime" },
        sfdcType: "datetime",
        targetType: "date",
      }).ok,
    ).toBe(false);
    expect(
      checkCompatibility({
        transform: { kind: "ref", objectKey: "account" },
        targetType: "string",
      }).ok,
    ).toBe(false);
    expect(
      checkCompatibility({
        transform: { kind: "number" },
        targetType: "string",
      }).ok,
    ).toBe(false);
  });

  it("rejects incompatible sources and compound fields", () => {
    const r = checkCompatibility({
      transform: { kind: "date" },
      sfdcType: "string",
      targetType: "date",
    });
    expect(r.ok).toBe(false);
    expect(r.side).toBe("source");
    expect(
      checkCompatibility({
        transform: { kind: "ref", objectKey: "account" },
        sfdcType: "string",
        targetType: "object",
      }).ok,
    ).toBe(false);
    expect(
      checkCompatibility({
        transform: { kind: "text" },
        sfdcType: "address",
        targetType: "string",
      }).reason,
    ).toMatch(/compound/);
  });

  it("does not check skip / copy / custom targets and unknown types", () => {
    expect(
      checkCompatibility({
        transform: { kind: "skip" },
        sfdcType: "address",
        targetType: "string",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "copy" },
        sfdcType: "string",
        targetType: "number",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({
        transform: { kind: "custom", fnName: "x" },
        sfdcType: "picklist",
        targetType: "date",
      }).ok,
    ).toBe(true);
    expect(
      checkCompatibility({ transform: { kind: "date" }, targetType: "unknown" })
        .ok,
    ).toBe(true);
  });
});

describe("autoSwitchTransform", () => {
  it("switches country mode by the actual type", () => {
    expect(
      autoSwitchTransform({ kind: "country", mode: "picklist" }, "reference"),
    ).toEqual({ kind: "country", mode: "ref" });
    expect(
      autoSwitchTransform({ kind: "country", mode: "ref" }, "picklist"),
    ).toEqual({ kind: "country", mode: "picklist" });
    expect(
      autoSwitchTransform({ kind: "country", mode: "ref" }, "string", {
        length: 2,
      }),
    ).toEqual({ kind: "country", mode: "iso2" });
    expect(
      autoSwitchTransform({ kind: "country", mode: "ref" }, "string", {
        length: 80,
      }),
    ).toEqual({ kind: "country", mode: "name" });
    expect(
      autoSwitchTransform({ kind: "country", mode: "ref" }, "reference"),
    ).toBeUndefined();
  });
  it("switches date/datetime and picklist arity, keeping wrappers", () => {
    expect(autoSwitchTransform({ kind: "date" }, "datetime")).toEqual({
      kind: "datetimeToDate",
    });
    expect(autoSwitchTransform({ kind: "datetime" }, "date")).toEqual({
      kind: "date",
    });
    expect(
      autoSwitchTransform({ kind: "picklist", mapKey: "k" }, "multipicklist"),
    ).toEqual({ kind: "multipicklist", mapKey: "k" });
    expect(
      autoSwitchTransform(
        { kind: "secondPass", inner: { kind: "date" } },
        "datetime",
      ),
    ).toEqual({
      kind: "secondPass",
      inner: { kind: "datetimeToDate" },
    });
    expect(autoSwitchTransform({ kind: "text" }, "string")).toBeUndefined();
  });
  it("rewrap keeps deferredBlob options", () => {
    expect(
      rewrap(
        { kind: "deferredBlob", inner: { kind: "text" }, blobName: "b" },
        { kind: "longtext" },
      ),
    ).toEqual({
      kind: "deferredBlob",
      inner: { kind: "longtext" },
      blobName: "b",
    });
  });
  it("sfdcTypeGroup groups textual and numeric types", () => {
    expect(sfdcTypeGroup("email")).toBe("text");
    expect(sfdcTypeGroup("string")).toBe("text");
    expect(sfdcTypeGroup("textarea")).toBe("textarea");
    expect(sfdcTypeGroup("percent")).toBe("number");
    expect(sfdcTypeGroup("reference")).toBe("reference");
  });
});
