import { describe, expect, it } from "vitest";
import {
  applyTransform,
  crosswalkPicklist,
  normaliseDatetime,
  sanitiseRichText,
  TRANSFORMS,
} from "./registry";
import { TRANSFORM_KINDS, type SourceRow, type TransformSpec } from "../types";
import {
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  IDS,
  SAMPLE_QUEUE_ID,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
} from "../testkit/fixtures";
import { to18 } from "./ids";

const row: SourceRow = { Id: "001000000000001AAA" };
const run = (
  spec: TransformSpec,
  value: unknown,
  ctxOpts: Parameters<typeof buildTransformContext>[0] = {},
  r: SourceRow = row,
) => applyTransform(spec, value, r, buildTransformContext(ctxOpts));

describe("registry completeness", () => {
  it("implements every §6.0.3 kind", () => {
    for (const k of TRANSFORM_KINDS)
      expect(typeof TRANSFORMS[k], k).toBe("function");
  });
});

describe("scalar transforms", () => {
  it("copy omits empties and passes scalars", () => {
    expect(run({ kind: "copy" }, "")).toEqual({ omit: true });
    expect(run({ kind: "copy" }, null)).toEqual({ omit: true });
    expect(run({ kind: "copy" }, "abc")).toEqual({ value: "abc" });
    expect(run({ kind: "copy" }, 5)).toEqual({ value: 5 });
  });
  it("text trims, NFC-normalises, strips control chars and truncates per policy", () => {
    expect(run({ kind: "text" }, "  Jane Doe  ")).toEqual({
      value: "Jane Doe",
    });
    expect(run({ kind: "text" }, "é")).toEqual({ value: "é" });
    expect(run({ kind: "text" }, "ab")).toEqual({ value: "ab" });
    const t = run({ kind: "text", max: 3 }, "abcdef");
    expect(t).toMatchObject({
      value: "abc",
      diagnostic: { kind: "truncated" },
    });
    const fail = run({ kind: "text", max: 3 }, "abcdef", {
      field: { truncation: "fail" },
    });
    expect(fail).toMatchObject({
      omit: true,
      diagnostic: { kind: "truncated", fatal: true },
    });
    const omit = run({ kind: "text", max: 3 }, "abcdef", {
      field: { truncation: "omit" },
    });
    expect(omit).toMatchObject({
      omit: true,
      diagnostic: { code: "TRUNCATION_OMIT" },
    });
    // target metadata max_length applies when the spec has none
    expect(
      run({ kind: "text" }, "abcdef", { targetField: { maxLength: 4 } }),
    ).toMatchObject({ value: "abcd" });
  });
  it("longtext keeps newlines, richtext sanitises", () => {
    expect(run({ kind: "longtext" }, "a\r\nb c")).toEqual({ value: "a\nb c" });
    expect(
      sanitiseRichText(
        '<p>Hi <b>there</b><script>x()</script> <a href="javascript:evil()">l</a> <img src=x></p>',
      ),
    ).toBe("<p>Hi <b>there</b> <a>l</a> </p>");
    expect(
      run({ kind: "richtext" }, "<p>Hi <b>x</b></p>", {
        targetField: { type: "longtext" },
      }),
    ).toEqual({ value: "Hi x" });
  });
  it("bool accepts true/false strings", () => {
    expect(run({ kind: "bool" }, "true")).toEqual({ value: true });
    expect(run({ kind: "bool" }, false)).toEqual({ value: false });
    expect(run({ kind: "bool" }, "maybe")).toMatchObject({
      omit: true,
      diagnostic: { kind: "invalid_value" },
    });
  });
  it("number rounds to scale and checks range", () => {
    expect(run({ kind: "number", scale: 2 }, "1.239")).toEqual({ value: 1.24 });
    expect(
      run({ kind: "number" }, "12", {
        targetField: { scale: 0, maxValue: 10 },
      }),
    ).toMatchObject({ omit: true, diagnostic: { kind: "out_of_range" } });
    expect(run({ kind: "number" }, "abc")).toMatchObject({
      omit: true,
      diagnostic: { code: "INVALID_NUMBER" },
    });
  });
  it("date/datetime normalise and apply the 1700-4000 range", () => {
    expect(run({ kind: "date" }, "2025-03-04")).toEqual({
      value: "2025-03-04",
    });
    expect(run({ kind: "date" }, "2025-03-04T10:00:00.000Z")).toEqual({
      value: "2025-03-04",
    });
    expect(run({ kind: "datetime" }, "2025-03-04T10:11:12Z")).toEqual({
      value: "2025-03-04T10:11:12.000Z",
    });
    expect(run({ kind: "datetime" }, "2025-03-04T10:11:12.5+02:00")).toEqual({
      value: "2025-03-04T08:11:12.500Z",
    });
    expect(normaliseDatetime("2025-03-04 10:11:12")).toBe(
      "2025-03-04T10:11:12.000Z",
    );
    expect(run({ kind: "datetimeToDate" }, "2025-03-04T10:11:12.000Z")).toEqual(
      { value: "2025-03-04" },
    );
    expect(run({ kind: "date" }, "1600-01-01")).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "out_of_range",
        code: "SF_DATETIME_RANGE",
        fatal: false,
      },
    });
    expect(
      run({ kind: "date" }, "1600-01-01", {
        mapping: { options: { dateRange: "fail" } as never },
      }),
    ).toMatchObject({ diagnostic: { fatal: true } });
    expect(run({ kind: "date" }, "not-a-date")).toMatchObject({
      omit: true,
      diagnostic: { code: "INVALID_DATE" },
    });
  });
  it("const, skip, userTimezone", () => {
    expect(run({ kind: "const", value: "data_load__v" }, null)).toEqual({
      value: "data_load__v",
    });
    expect(run({ kind: "skip" }, "x")).toEqual({ omit: true });
    expect(run({ kind: "userTimezone" }, "America/New_York")).toEqual({
      value: "america_new_york__sys",
    });
  });
});

describe("picklists (§7.1 order)", () => {
  const spec: TransformSpec = { kind: "picklist", mapKey: "account.specialty" };
  it("explicit crosswalk wins, then derivation, then onUnmapped", () => {
    const country = buildCountryContext({
      picklists: {
        "account.specialty": { CD: "cardiovascular_disease__v", XX: null },
      },
    });
    expect(run(spec, "CD", { country })).toEqual({
      value: "cardiovascular_disease__v",
    });
    expect(run(spec, "XX", { country })).toEqual({
      omit: true,
      diagnostic: undefined,
    });
    expect(run(spec, "Submitted_vod", { country })).toEqual({
      value: "submitted__v",
    });
    expect(
      run(spec, "Detail Only", { country, targetField: { name: "x__c" } }),
    ).toEqual({ value: "detail_only__c" });
  });
  it("mapping-level defaults are consulted after the country map", () => {
    expect(
      run(spec, "CD", {
        mapping: {
          picklists: { "account.specialty": { CD: "from_module__v" } },
        },
      }),
    ).toEqual({ value: "from_module__v" });
  });
  it("validates against known target values and applies onUnmapped policies", () => {
    const tf = { picklistValues: ["cardiology__v"] };
    expect(run(spec, "Cardiology", { targetField: tf })).toEqual({
      value: "cardiology__v",
    });
    expect(run(spec, "Neurology", { targetField: tf })).toMatchObject({
      omit: true,
      diagnostic: { kind: "unmapped_picklist", fatal: true },
    });
    const skip = buildCountryContext({
      picklistPolicy: { onUnmapped: "skip" },
    });
    expect(
      run(spec, "Neurology", { targetField: tf, country: skip }),
    ).toMatchObject({
      omit: true,
      diagnostic: { kind: "unmapped_picklist", code: "UNMAPPED_PICKLIST" },
    });
    const create = buildCountryContext({
      picklistPolicy: { onUnmapped: "createValue" },
    });
    expect(
      run(spec, "Neurology", { targetField: tf, country: create }),
    ).toMatchObject({
      value: "neurology__v",
      diagnostic: { code: "PICKLIST_VALUE_CREATED" },
    });
    const derivOff = buildCountryContext({
      picklistPolicy: { derive: "none" },
    });
    expect(
      crosswalkPicklist(
        buildTransformContext({ country: derivOff }),
        "x.y",
        "Foo",
      ).diagnostic?.fatal,
    ).toBe(true);
  });
  it("multipicklist maps each value and joins with commas", () => {
    const country = buildCountryContext({
      picklists: {
        "account.credentials": { MD: "md__v", "Dr, med": "dr_med__v" },
      },
    });
    expect(
      run(
        { kind: "multipicklist", mapKey: "account.credentials" },
        "MD;Dr, med;Foo_vod",
        { country },
      ),
    ).toEqual({ value: "md__v,dr_med__v,foo__v", diagnostic: undefined });
  });
});

describe("object types and states", () => {
  it("objectType uses the crosswalk, then rename, and validates against metadata", () => {
    const r = run(
      { kind: "objectType", mapKey: "call2.objectType" },
      undefined,
      { mapping: { objectTypes: { CallReport_vod: "call_report__v" } } },
      { Id: row.Id, "RecordType.DeveloperName": "CallReport_vod" },
    );
    expect(r).toEqual({
      value: "call_report__v",
      targetField: "object_type__v.api_name__v",
    });
    expect(
      run(
        { kind: "objectType", mapKey: "x.objectType" },
        "Speaker_Program_vod",
      ),
    ).toMatchObject({ value: "speaker_program__v" });
    const meta = {
      allowTypes: true,
      objectTypes: { professional__v: { active: true, requiredFields: [] } },
    };
    expect(
      run({ kind: "objectType", mapKey: "x" }, "Hospital_vod", {
        metadata: meta,
      }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_OBJECT_TYPE_MISSING", fatal: true },
    });
    expect(
      run({ kind: "objectType", mapKey: "x" }, "Professional_vod", {
        metadata: meta,
      }),
    ).toMatchObject({ value: "professional__v" });
  });
  it("state maps business status to a lifecycle state", () => {
    const lifecycle = {
      name: "call2_lifecycle__v",
      states: ["submitted_state__v"],
    };
    expect(
      run({ kind: "state", mapKey: "call2.state" }, "Submitted_vod", {
        mapping: { states: { Submitted_vod: "submitted_state__v" } },
        metadata: { lifecycle },
      }),
    ).toEqual({ value: "submitted_state__v", targetField: "state__v" });
    expect(
      run({ kind: "state", mapKey: "call2.state" }, "Planned_vod", {
        metadata: { lifecycle },
      }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_LIFECYCLE_STATE_MISSING", fatal: true },
    });
    expect(
      run({ kind: "state", mapKey: "call2.state" }, "Planned_vod"),
    ).toMatchObject({ omit: true, diagnostic: { fatal: false } });
  });
});

describe("references (§2.3, §3.5)", () => {
  const ids = buildIdResolver(
    { account: { "001000000000009AAA": "V0A1" } },
    { [SAMPLE_USER_ID]: 111 },
    { "US-NE-01": "V0T1" },
  );
  it("ref emits a deferred $fk and flags unresolved ids", () => {
    expect(
      run({ kind: "ref", objectKey: "account" }, "001000000000009AAA", { ids }),
    ).toEqual({
      value: { $fk: { object: "account", sfdcId: "001000000000009AAA" } },
    });
    expect(
      run({ kind: "ref", objectKey: "account" }, "001000000000008", { ids }),
    ).toMatchObject({
      value: { $fk: { object: "account", sfdcId: "001000000000008AAA" } },
      unresolved: { objectKey: "account", sfdcId: "001000000000008AAA" },
      diagnostic: { kind: "unresolved_fk" },
    });
    expect(
      run({ kind: "ref", objectKey: "account" }, "003000000000001AAA", { ids }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "CONTACT_REF_DROPPED" },
    });
    expect(
      run({ kind: "ref", objectKey: "account" }, "garbage", { ids }),
    ).toMatchObject({ omit: true, diagnostic: { code: "INVALID_ID" } });
  });
  it("refUser emits $user, applies audit fallback and unmappedUserPolicy", () => {
    expect(run({ kind: "refUser" }, SAMPLE_USER_ID, { ids })).toEqual({
      value: { $user: SAMPLE_USER_ID },
    });
    // audit field -> migration user fallback
    expect(
      run({ kind: "refUser" }, SAMPLE_USER_ID_2, {
        ids,
        field: { target: "created_by__v" },
        migrationUserId: 999,
      }),
    ).toMatchObject({
      value: 999,
      diagnostic: { code: "AUDIT_USER_FALLBACK" },
    });
    // business field, default policy omit -> deferred kept + unresolved
    expect(
      run({ kind: "refUser" }, SAMPLE_USER_ID_2, {
        ids,
        field: { target: "user__v" },
      }),
    ).toMatchObject({
      value: { $user: SAMPLE_USER_ID_2 },
      unresolved: { objectKey: "user" },
    });
    for (const [policy, expected] of [
      [
        "fail",
        { omit: true, diagnostic: { code: "UNMAPPED_USER", fatal: true } },
      ],
      ["skipRow", { omit: true, diagnostic: { kind: "skipped", fatal: true } }],
      [
        "migrationUser",
        { value: 999, diagnostic: { code: "UNMAPPED_USER_REPLACED" } },
      ],
    ] as const) {
      expect(
        run({ kind: "refUser" }, SAMPLE_USER_ID_2, {
          ids,
          field: { target: "ownerid__v" },
          migrationUserId: 999,
          mapping: { options: { unmappedUserPolicy: policy } as never },
        }),
      ).toMatchObject(expected);
    }
  });
  it("refUser replaces queue owners with the rep or the migration user (§3.4)", () => {
    expect(
      run(
        { kind: "refUser" },
        SAMPLE_QUEUE_ID,
        { ids, field: { target: "ownerid__v" } },
        { Id: row.Id, User_vod__c: SAMPLE_USER_ID },
      ),
    ).toMatchObject({
      value: { $user: SAMPLE_USER_ID },
      diagnostic: { code: "QUEUE_OWNER_REPLACED" },
    });
    expect(
      run({ kind: "refUser" }, SAMPLE_QUEUE_ID, {
        ids,
        field: { target: "ownerid__v" },
        migrationUserId: 999,
      }),
    ).toMatchObject({
      value: 999,
      diagnostic: { code: "QUEUE_OWNER_REPLACED" },
    });
    expect(
      run({ kind: "refUser" }, SAMPLE_QUEUE_ID, {
        ids,
        field: { target: "ownerid__v" },
      }),
    ).toMatchObject({ omit: true });
  });
  it("refLookup emits field.lookup, legacyId formats and retargets", () => {
    expect(
      run(
        {
          kind: "refLookup",
          objectKey: "product",
          lookupField: "external_id__v",
        },
        "P-1",
        { field: { target: "product__v" } },
      ),
    ).toEqual({ value: "P-1", targetField: "product__v.external_id__v" });
    expect(
      run({ kind: "legacyId" }, "001000000000001", {
        metadata: { legacyIdField: "legacy_crm_id__c" },
      }),
    ).toEqual({ value: "001000000000001AAA", targetField: "legacy_crm_id__c" });
    expect(
      run({ kind: "legacyId" }, undefined, {
        metadata: {
          legacyIdField: "external_id__v",
          legacyIdFormat: "SF:{orgId15}:{id18}",
        },
        orgId15: "00D000000000001",
      }),
    ).toEqual({
      value: "SF:00D000000000001:001000000000001AAA",
      targetField: "external_id__v",
    });
    expect(
      run({ kind: "legacyId" }, undefined, {}, { Id: "bad" }),
    ).toMatchObject({ omit: true, diagnostic: { fatal: true } });
  });
  it("territoryRef resolves by name or falls back to text", () => {
    expect(
      run({ kind: "territoryRef" }, "US-NE-01", {
        ids,
        targetField: { type: "object" },
      }),
    ).toEqual({ value: "V0T1" });
    expect(
      run({ kind: "territoryRef" }, "US-XX", {
        ids,
        targetField: { type: "object" },
      }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "TERRITORY_UNRESOLVED" },
    });
    expect(
      run({ kind: "territoryRef" }, "US-XX", {
        ids,
        targetField: { type: "string", maxLength: 100 },
      }),
    ).toEqual({ value: "US-XX" });
  });
  it("country modes", () => {
    expect(run({ kind: "country", mode: "ref" }, IDS.countryUS)).toEqual({
      value: "V0C000000000101",
    });
    expect(run({ kind: "country", mode: "iso2" }, IDS.countryDE)).toEqual({
      value: "DE",
    });
    expect(run({ kind: "country", mode: "iso2" }, "de")).toEqual({
      value: "DE",
    });
    expect(run({ kind: "country", mode: "name" }, "US")).toEqual({
      value: "United States",
    });
    expect(run({ kind: "country", mode: "picklist" }, "US")).toEqual({
      value: "united_states__v",
    });
    expect(run({ kind: "country", mode: "ref" }, "ZZ")).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_COUNTRY_UNMATCHED" },
    });
  });
  it("currency and localeLookup retarget", () => {
    expect(run({ kind: "currency" }, "usd")).toEqual({
      value: "USD",
      targetField: "local_currency__sys",
    });
    expect(
      run({ kind: "currency" }, "USD", {
        country: buildCountryContext({ currencies: { EUR: "V0X" } }),
      }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_CURRENCY_UNMATCHED" },
    });
    expect(
      run({ kind: "localeLookup", localeKind: "language" }, "en_US", {
        field: { target: "language__sys" },
      }),
    ).toEqual({ value: "English", targetField: "language__sys.name__v" });
    expect(
      run({ kind: "localeLookup", localeKind: "locale" }, "xx_XX"),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "VT_LOCALE_UNMATCHED" },
    });
  });
});

describe("derived fields", () => {
  it("nameTemplate uses country templates and separators", () => {
    const r = {
      Id: row.Id,
      FirstName: "Jane",
      LastName: "Doe",
      Salutation: "Dr.",
    };
    expect(
      run({ kind: "nameTemplate", templateKey: "person" }, undefined, {}, r),
    ).toEqual({ value: "Jane Doe" });
    const de = buildCountryContext({
      nameTemplates: { person: "{Salutation} {FirstName} {LastName}" },
    });
    expect(
      run(
        { kind: "nameTemplate", templateKey: "person" },
        undefined,
        { country: de },
        r,
      ),
    ).toEqual({ value: "Dr. Jane Doe" });
    const jp = buildCountryContext({
      nameTemplates: {
        person: "{LastName}{separator}{FirstName}",
        separator: "　",
      },
    });
    expect(
      run(
        { kind: "nameTemplate", templateKey: "person" },
        undefined,
        { country: jp },
        { Id: row.Id, FirstName: "太郎", LastName: "山田" },
      ),
    ).toEqual({ value: "山田　太郎" });
    expect(
      run(
        { kind: "nameTemplate", templateKey: "person" },
        undefined,
        {},
        { Id: row.Id, LastName: "Solo" },
      ),
    ).toEqual({ value: "Solo" });
    expect(
      run(
        { kind: "nameTemplate", templateKey: "userTerritory" },
        undefined,
        {},
        { Id: row.Id, username: "u@x", territory: "T1" },
      ),
    ).toEqual({ value: "u@x:T1" });
  });
  it("statusFromFlag derives inactive__v only when the flag holds", () => {
    expect(
      run(
        {
          kind: "statusFromFlag",
          sourceFlag: "Inactive_vod__c",
          inactiveWhen: { equals: true },
        },
        undefined,
        {},
        { Id: row.Id, Inactive_vod__c: "true" },
      ),
    ).toEqual({ value: "inactive__v", targetField: "status__v" });
    expect(
      run(
        {
          kind: "statusFromFlag",
          sourceFlag: "Active_vod__c",
          inactiveWhen: { equals: false },
        },
        undefined,
        {},
        { Id: row.Id, Active_vod__c: true },
      ),
    ).toEqual({ omit: true });
    expect(
      run(
        {
          kind: "statusFromFlag",
          sourceFlag: "Status_vod__c",
          inactiveWhen: { in: ["Closed_vod"] },
        },
        undefined,
        {},
        { Id: row.Id, Status_vod__c: "Closed_vod" },
      ),
    ).toMatchObject({ value: "inactive__v" });
  });
  it("compositeExternalId renders literals or defers", () => {
    const spec: TransformSpec = {
      kind: "compositeExternalId",
      template: "{u}__{t}",
      parts: {
        u: { user: "UserId" },
        t: { ref: "territory", source: "Territory2Id" },
      },
    };
    const r = {
      Id: row.Id,
      UserId: SAMPLE_USER_ID,
      Territory2Id: "0MI000000000001",
    };
    expect(run(spec, undefined, {}, r)).toEqual({
      value: {
        $composite: {
          template: "{u}__{t}",
          parts: {
            u: { $user: SAMPLE_USER_ID },
            t: {
              $fk: { object: "territory", sfdcId: to18("0MI000000000001") },
            },
          },
        },
      },
    });
    expect(
      run(
        {
          kind: "compositeExternalId",
          template: "{a}-{b}",
          parts: { a: { field: "Name" }, b: { const: "X" } },
        },
        undefined,
        {},
        { Id: row.Id, Name: "N" },
      ),
    ).toEqual({ value: "N-X" });
    expect(run(spec, undefined, {}, { Id: row.Id })).toMatchObject({
      omit: true,
      diagnostic: { code: "COMPOSITE_PART_MISSING" },
    });
  });
  it("secondPass and deferredBlob defer values", () => {
    const ids = buildIdResolver({
      territory: { [to18("0MI000000000001")]: "V0T" },
    });
    expect(
      run(
        { kind: "secondPass", inner: { kind: "ref", objectKey: "territory" } },
        "0MI000000000001",
        { ids },
      ),
    ).toMatchObject({
      omit: true,
      defer: "secondPass",
      deferredValue: { $fk: { object: "territory" } },
    });
    expect(
      run(
        { kind: "secondPass", inner: { kind: "ref", objectKey: "territory" } },
        null,
        { ids },
      ),
    ).toEqual({ omit: true });
    expect(
      run({ kind: "deferredBlob", blobName: "signature" }, "iVBOR"),
    ).toMatchObject({
      omit: true,
      defer: "blob",
      deferredValue: "iVBOR",
      diagnostic: { kind: "deferred_blob", code: "signature" },
    });
  });
  it("custom dispatches to module functions", () => {
    const custom = {
      upper: (v: unknown) => String(v).toUpperCase(),
      omit: () => ({ omit: true as const }),
    };
    expect(run({ kind: "custom", fnName: "upper" }, "a", { custom })).toEqual({
      value: "A",
    });
    expect(run({ kind: "custom", fnName: "omit" }, "a", { custom })).toEqual({
      omit: true,
    });
    expect(
      run({ kind: "custom", fnName: "nope" }, "a", { custom }),
    ).toMatchObject({
      omit: true,
      diagnostic: { code: "MAP_CUSTOM_FN_MISSING", fatal: true },
    });
  });
});
