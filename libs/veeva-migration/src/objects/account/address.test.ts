import { describe, expect, it } from "vitest";
import {
  CITY_TARGETS,
  DEFAULT_LINE1_MAX,
  POSTAL_CODE_TARGETS,
  address,
  addressLine1,
  addressLine2,
  hasLine2Target,
  line1Policy,
  naturalKeyRules,
  postalCode,
  splitLine1,
} from "./address";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const ADDRESS_1 = to18("a0A000000000001");
const ADDRESS_2 = to18("a0A000000000002");

function makeConfig(addressOverrides: Record<string, unknown> = {}) {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: "x.veevavault.com",
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 1,
    },
    objects: { address: { ...addressOverrides } },
    countries: { US: {} },
  });
}

const ADDRESS_FIELDS: Parameters<typeof buildVaultMetadata>[1] = [
  {
    name: "account__v",
    type: "Object",
    object: { name: "account__v" },
    required: true,
    relationship_type: "parent",
  },
  { name: "street_address_2_cda__v", type: "String", max_length: 100 },
  { name: "city_cda__v", type: "String", max_length: 40 },
  {
    name: "state_province__v",
    type: "Picklist",
    picklist: "state_province__v",
  },
  { name: "postal_code_cda__v", type: "String", max_length: 20 },
  { name: "zip_4__v", type: "String", max_length: 4 },
  { name: "country__v", type: "Picklist", picklist: "country__v" },
  {
    name: "external_id__v",
    type: "String",
    max_length: 120,
    unique: true,
  },
  { name: "mobile_id__v", type: "String", max_length: 100 },
  { name: "primary__v", type: "Boolean" },
  { name: "inactive__v", type: "Boolean" },
  { name: "business__v", type: "Boolean" },
  { name: "phone__v", type: "String", max_length: 40 },
  { name: "latitude__v", type: "Number", scale: 6 },
  { name: "license__v", type: "String", max_length: 25 },
  {
    name: "license_status__v",
    type: "Picklist",
    picklist: "license_status__v",
  },
  { name: "license_expiration_date__v", type: "Date" },
  {
    name: "dea_schedule__v",
    type: "Picklist",
    picklist: "dea_schedule__v",
    multi_value: true,
  },
  {
    name: "controlling_address__v",
    type: "Object",
    object: { name: "address__v" },
  },
  { name: "office_notes__v", type: "LongText" },
];

function metadata(exclude: string[] = []) {
  return resolveMetadata(
    buildVaultMetadata(
      "address__v",
      ADDRESS_FIELDS.filter((f) => !exclude.includes(f.name)),
    ),
    {
      picklists: {
        state_province__v: ["california__v", "new_york__v"],
        country__v: ["united_states__v", "germany__v"],
        license_status__v: ["valid__v", "invalid__v", "expired__v"],
        dea_schedule__v: ["2__v", "2n__v", "3__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  {
    account: { [IDS.account1]: "V0A000000000001" },
    address: { [ADDRESS_2]: "V0D000000000002" },
  },
  { [SAMPLE_USER_ID]: 11 },
);

const usCountry = buildCountryContext({
  picklists: { "address.state": { CA: "california__v" } },
});

const LONG_LINE_1 =
  "Building 7, Northern Campus of the Metropolitan University Teaching Hospital, Department of Cardiology and Vascular Medicine, Wing B";

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: ADDRESS_1,
    IsDeleted: false,
    Name: "123 Market Street",
    Account_vod__c: IDS.account1,
    Address_line_2_vod__c: "Suite 100",
    City_vod__c: "San Francisco",
    State_vod__c: "CA",
    Zip_vod__c: "94105",
    Zip_4_vod__c: "1234",
    Country_vod__c: "US",
    External_ID_vod__c: "NET-ADDR-1",
    Mobile_ID_vod__c: "7d2c5f4e-a001",
    Primary_vod__c: "true",
    Business_vod__c: true,
    Inactive_vod__c: "false",
    Phone_vod__c: "415-555-0100",
    Latitude_vod__c: "37.7936",
    License_vod__c: "A12345",
    License_Status_vod__c: "Valid_vod",
    License_Expiration_Date_vod__c: "2027-06-30",
    DEA_Schedule_vod__c: "2;2N",
    Controlling_Address_vod__c: ADDRESS_2,
    Office_Notes_vod__c: "Ring the bell",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2021-05-04T10:11:12.000Z",
    LastModifiedDate: "2025-01-02T03:04:05.000Z",
    SystemModstamp: "2025-01-02T03:04:05.000Z",
    ...extra,
  };
}

function mappingFor(overrides: Record<string, unknown> = {}) {
  const config = makeConfig(overrides);
  return materialise(address, resolveCountry(config, "US"), config, {
    now: NOW,
  });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: usCountry,
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: address.custom,
    ...overrides,
  };
}

describe("address module", () => {
  it("is structurally valid and encodes the §6.2 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(address).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(address.source).toBe("Address_vod__c");
    expect(address.target).toBe("address__v");
    expect(address.dependsOn).toEqual(["account"]);
    expect(address.countryOf).toEqual([{ kind: "account" }]);
    expect(address.deletePolicy).toBe("inactivate");
    expect(address.inactivate).toEqual([{ field: "inactive__v", value: true }]);
    expect(address.load.noTriggers).toBe(false);
    expect(address.createPolicy).toBe("create");
    expect(address.notes).not.toContain("STUB");
    expect(address.selfRefs).toEqual([
      {
        target: "controlling_address__v",
        source: "Controlling_Address_vod__c",
      },
    ]);
    expect(address.blockS.ownerId).toBe(false);
    expect(address.blockS.statusFromFlag).toEqual({
      sourceFlag: "Inactive_vod__c",
      inactiveWhen: { equals: true },
    });
    expect(address.optionDefaults).toEqual({ line1Overflow: "truncate" });
  });

  it("carries every §6.3.8 row (fallback spellings, UNV targets, skips) with evidence tags", () => {
    const byTarget = new Map(address.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "account__v",
      "name__v",
      "status__v",
      "street_address_2_cda__v",
      "address_line_2__v",
      "city_cda__v",
      "city__v",
      "state_province__v",
      "postal_code_cda__v",
      "postal_code__v",
      "zip__v",
      "zip_4__v",
      "country__v",
      "external_id__v",
      "primary__v",
      "business__v",
      "home__v",
      "mailing__v",
      "shipping__v",
      "billing__v",
      "inactive__v",
      "include_in_territory_assignment__v",
      "appt_required__v",
      "controlled_address__v",
      "no_address_copy__v",
      "dea_address__v",
      "phone__v",
      "phone_2__v",
      "fax__v",
      "fax_2__v",
      "phone_cda__v",
      "fax_cda__v",
      "brick__v",
      "latitude__v",
      "longitude__v",
      "license__v",
      "license_status__v",
      "license_expiration_date__v",
      "dea__v",
      "dea_status__v",
      "dea_expiration_date__v",
      "dea_schedule__v",
      "dea_license_address__v",
      "cds__v",
      "cds_status__v",
      "cds_expiration_date__v",
      "assmca__v",
      "network_license_entity_id__v",
      "network_dea_entity_id__v",
      "network_cds_entity_id__v",
      "network_assmca_entity_id__v",
      "network_sample_eligibility__v",
      "sample_send_status__v",
      "source__v",
      "customer_master_status__v",
      "controlling_address__v",
      "best_times__v",
      "office_notes__v",
      "staff_notes__v",
      "comment__v",
      "entity_reference_id__v",
      "master_align_id__v",
      "map__v",
      "sample_status__v",
      "license_valid_to_sample__v",
      "mobile_id__v",
      "created_by__v",
      "modified_date__v",
    ]) {
      expect(byTarget.has(target), target).toBe(true);
    }
    expect(byTarget.has("ownerid__v")).toBe(false); // master-detail: no OwnerId
    for (const f of address.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "OBS",
    });
    expect(byTarget.get("status__v")?.transform).toEqual({
      kind: "statusFromFlag",
      sourceFlag: "Inactive_vod__c",
      inactiveWhen: { equals: true },
    });
    expect(byTarget.get("inactive__v")?.evidence).toBe("DOC");
    expect(byTarget.get("controlling_address__v")?.transform).toEqual({
      kind: "secondPass",
      inner: { kind: "ref", objectKey: "address" },
    });
    expect(byTarget.get("state_province__v")?.countryConfigurable).toBe(true);
    expect(byTarget.get("map__v")?.transform.kind).toBe("skip");
    expect(address.fields.filter((f) => f.target === "name__v")).toHaveLength(
      1,
    );
  });

  it("declares default picklists and the §3.3 match precedence incl. the natural key", () => {
    expect(address.picklists["address.licenseStatus"].Sampled_vod).toBe(
      "sampled__v",
    );
    expect(address.picklists["address.source"]).toEqual({
      Manual: "manual__v",
      HMS: "hms__v",
    });
    expect(address.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "mobile_id",
      ...naturalKeyRules().map(() => "natural_key"),
    ]);
    const natural = address.match[3];
    expect(natural.keys?.map((k) => k.target)).toEqual([
      "account__v",
      "name__v",
      "city_cda__v",
      "postal_code_cda__v",
      "country__v",
    ]);
    expect(natural.keys?.[1].caseInsensitive).toBe(true);
    expect(natural.evidence).toBe("OBS");
    // one natural-key rule per city / postal-code spelling pair, OBS pair first,
    // so the matcher (which skips a rule whose key target is missing) always
    // finds the variant the vault has
    const naturals = address.match.filter((m) => m.method === "natural_key");
    expect(naturals).toHaveLength(
      CITY_TARGETS.length * POSTAL_CODE_TARGETS.length,
    );
    const pairs = naturals.map((m) => [m.keys![2].target, m.keys![3].target]);
    for (const city of CITY_TARGETS)
      for (const postal of POSTAL_CODE_TARGETS)
        expect(pairs).toContainEqual([city, postal]);
    expect(new Set(pairs.map((p) => p.join("/"))).size).toBe(naturals.length);
    for (const m of naturals.slice(1)) {
      expect(m.evidence).toBe("UNV");
      expect(m.sameCountry).toBe(true);
      expect(m.keys!.map((k) => k.source)).toEqual(
        natural.keys!.map((k) => k.source),
      );
      expect(m.keys![2].caseInsensitive).toBe(true);
    }
  });

  it("is full scope (no predicate) and materialises with the line-1 policy default", () => {
    expect(address.scope).toEqual({ kind: "full" });
    const mapping = mappingFor();
    expect(buildScopePredicate(mapping.scope).predicate).toBeUndefined();
    expect(mapping.options.line1Overflow).toBe("truncate");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.inactivateBy).toEqual([
      { field: "inactive__v", value: true },
    ]);
    expect(
      mappingFor({ line1Overflow: "spillToLine2" }).options.line1Overflow,
    ).toBe("spillToLine2");
  });

  it("transforms a row: parent ref, picklists, country picklist, dates, numbers, self ref deferred", () => {
    const r = applyMapping(row(), mappingFor(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ADDRESS_1,
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      name__v: "123 Market Street",
      street_address_2_cda__v: "Suite 100",
      city_cda__v: "San Francisco",
      state_province__v: "california__v",
      postal_code_cda__v: "94105",
      zip_4__v: "1234",
      country__v: "united_states__v",
      external_id__v: "NET-ADDR-1",
      mobile_id__v: "7d2c5f4e-a001",
      primary__v: true,
      business__v: true,
      inactive__v: false,
      phone__v: "415-555-0100",
      latitude__v: 37.7936,
      license__v: "A12345",
      license_status__v: "valid__v",
      license_expiration_date__v: "2027-06-30",
      dea_schedule__v: "2__v,2n__v",
      office_notes__v: "Ring the bell",
      created_date__v: "2021-05-04T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    // active row: status__v omitted (Vault defaults active__v)
    expect(r.payload.status__v).toBeUndefined();
    expect(r.payload.ownerid__v).toBeUndefined();
    expect(r.payload.controlling_address__v).toBeUndefined();
    expect(r.secondPass.controlling_address__v).toEqual({
      $fk: { object: "address", sfdcId: ADDRESS_2 },
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account1,
    });
  });

  it("reports an unresolved parent account as pending_fk and keeps the deferred ref", () => {
    const r = applyMapping(
      row({ Account_vod__c: IDS.account4 }),
      mappingFor(),
      applyCtx(),
    );
    expect(r.status).toBe("pending_fk");
    expect(r.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(r.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
  });

  it("derives status__v = inactive__v from Inactive_vod__c next to the business flag", () => {
    const r = applyMapping(
      row({ Inactive_vod__c: "true" }),
      mappingFor(),
      applyCtx(),
    );
    expect(r.status).toBe("ok");
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.inactive__v).toBe(true);
    // objects.address.statusFromFlag = false drops the derivation row only
    const off = applyMapping(
      row({ Inactive_vod__c: "true" }),
      mappingFor({ statusFromFlag: false }),
      applyCtx(),
    );
    expect(off.payload.status__v).toBeUndefined();
    expect(off.payload.inactive__v).toBe(true);
  });

  it("honours objects.address.line1Overflow end to end", () => {
    const truncated = applyMapping(
      row({ Name: LONG_LINE_1 }),
      mappingFor(),
      applyCtx(),
    );
    expect(truncated.status).toBe("ok");
    expect(truncated.payload.name__v).toBe(LONG_LINE_1.slice(0, 128));
    expect(truncated.payload.street_address_2_cda__v).toBe("Suite 100");
    expect(truncated.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "truncated", field: "name__v" }),
    );

    const spilled = applyMapping(
      row({ Name: LONG_LINE_1 }),
      mappingFor({ line1Overflow: "spillToLine2" }),
      applyCtx(),
    );
    expect(spilled.status).toBe("ok");
    const line1 = spilled.payload.name__v as string;
    expect(line1.length).toBeLessThanOrEqual(128);
    expect(line1.length).toBeGreaterThan(100);
    // cut on a word boundary, remainder spilled ahead of the original line 2, nothing lost
    expect(LONG_LINE_1.startsWith(`${line1} `)).toBe(true);
    expect(spilled.payload.street_address_2_cda__v).toBe(
      `${splitLine1(LONG_LINE_1, 128).spill} Suite 100`,
    );
    expect(`${line1} ${spilled.payload.street_address_2_cda__v}`).toBe(
      `${LONG_LINE_1} Suite 100`,
    );
    expect(spilled.diagnostics).toContainEqual(
      expect.objectContaining({ code: "LINE1_SPILLED", field: "name__v" }),
    );

    const failed = applyMapping(
      row({ Name: LONG_LINE_1 }),
      mappingFor({ line1Overflow: "fail" }),
      applyCtx(),
    );
    expect(failed.status).toBe("failed");
    expect(failed.failure?.code).toBe("TRUNCATION_FAIL");

    // spillToLine2 on a vault without any line-2 field (both spellings pruned
    // by preflight): the overflow has nowhere to go, so line 1 is truncated
    // with a diagnostic that names the missing target — never a silent cut
    const noLine2 = applyMapping(
      row({ Name: LONG_LINE_1 }),
      mappingFor({
        line1Overflow: "spillToLine2",
        fields: { remove: ["street_address_2_cda__v", "address_line_2__v"] },
      }),
      applyCtx({ metadata: metadata(["street_address_2_cda__v"]) }),
    );
    expect(noLine2.status).toBe("ok");
    expect(noLine2.payload.name__v).toBe(LONG_LINE_1.slice(0, 128));
    expect(noLine2.payload.street_address_2_cda__v).toBeUndefined();
    expect(noLine2.payload.address_line_2__v).toBeUndefined();
    expect(noLine2.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "truncated",
        code: "LINE1_SPILL_TARGET_MISSING",
        field: "name__v",
      }),
    );
    expect(noLine2.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "LINE1_SPILLED" }),
    );
    // an explicit row-level `truncation: fail` still fails the row instead
    const noLine2Fail = applyMapping(
      row({ Name: LONG_LINE_1 }),
      mappingFor({
        line1Overflow: "spillToLine2",
        fields: {
          remove: ["street_address_2_cda__v", "address_line_2__v"],
          override: [
            {
              source: "Name",
              target: "name__v",
              transform: "custom(addressLine1)",
              truncation: "fail",
            },
          ],
        },
      }),
      applyCtx({ metadata: metadata(["street_address_2_cda__v"]) }),
    );
    expect(noLine2Fail.status).toBe("failed");
    expect(noLine2Fail.failure?.code).toBe("TRUNCATION_FAIL");
  });

  it("validates the postal code against the country pattern (warn keeps, fail rejects)", () => {
    const warn = applyMapping(
      row({ Zip_vod__c: "ABCDE" }),
      mappingFor(),
      applyCtx({
        country: {
          ...usCountry,
          postalCode: { pattern: "^\\d{5}(-\\d{4})?$", onMismatch: "warn" },
        },
      }),
    );
    expect(warn.status).toBe("ok");
    expect(warn.payload.postal_code_cda__v).toBe("ABCDE");
    expect(warn.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "POSTAL_CODE_FORMAT",
        field: "postal_code_cda__v",
      }),
    );
    const fail = applyMapping(
      row({ Zip_vod__c: "ABCDE" }),
      mappingFor(),
      applyCtx({
        country: {
          ...usCountry,
          postalCode: { pattern: "^\\d{5}(-\\d{4})?$", onMismatch: "fail" },
        },
      }),
    );
    expect(fail.status).toBe("failed");
    expect(fail.failure?.code).toBe("POSTAL_CODE_FORMAT");
  });

  it("skips erased rows and rejects unmapped state values under the error policy", () => {
    const erased = applyMapping(
      row(),
      mappingFor(),
      applyCtx({
        country: buildCountryContext({ erased: [ADDRESS_1] }),
      }),
    );
    expect(erased.status).toBe("skipped");
    const unmapped = applyMapping(
      row({ State_vod__c: "ZZ" }),
      mappingFor(),
      applyCtx(),
    );
    expect(unmapped.status).toBe("failed");
    expect(unmapped.failure?.field).toBe("state_province__v");
  });
});

describe("address custom transforms", () => {
  const base = (): SourceRow => ({ Id: ADDRESS_1 });

  it("splitLine1 cuts at the last word boundary and hard-cuts unbroken text", () => {
    expect(splitLine1("short", 10)).toEqual({ line1: "short", spill: "" });
    expect(splitLine1("one two three four", 9)).toEqual({
      line1: "one two",
      spill: "three four",
    });
    expect(splitLine1("one two three four", 13)).toEqual({
      line1: "one two three",
      spill: "four",
    });
    expect(splitLine1("abcdefghijkl", 5)).toEqual({
      line1: "abcde",
      spill: "fghijkl",
    });
    expect(DEFAULT_LINE1_MAX).toBe(128);
  });

  it("line1Policy defaults to truncate for unknown values", () => {
    const ctx = buildTransformContext();
    expect(line1Policy(ctx)).toBe("truncate");
    ctx.mapping.options.line1Overflow = "bogus";
    expect(line1Policy(ctx)).toBe("truncate");
    ctx.mapping.options.line1Overflow = "fail";
    expect(line1Policy(ctx)).toBe("fail");
  });

  it("addressLine1 / addressLine2 agree on the split and respect the row truncation policy", () => {
    const opts = {
      ...buildTransformContext().mapping.options,
      line1Overflow: "spillToLine2",
    };
    const nameField = { name: "name__v", maxLength: 10 };
    const line2Field = { name: "street_address_2_cda__v", maxLength: 100 };
    const line1Ctx = buildTransformContext({
      field: { source: "Name", target: "name__v" },
      targetField: nameField,
      metadata: {
        fields: {
          name__v: { ...nameField } as never,
          street_address_2_cda__v: { ...line2Field } as never,
        },
      },
      mapping: { options: opts },
    });
    const line2Ctx = buildTransformContext({
      field: {
        source: "Address_line_2_vod__c",
        target: "street_address_2_cda__v",
      },
      targetField: { name: "street_address_2_cda__v", maxLength: 100 },
      metadata: { fields: { name__v: { ...line1Ctx.targetField! } } },
      mapping: { options: opts },
    });
    const r = {
      ...base(),
      Name: "one two three four",
      Address_line_2_vod__c: "Suite 9",
    };
    expect(addressLine1(r.Name, r, line1Ctx)).toMatchObject({
      value: "one two",
      diagnostic: { code: "LINE1_SPILLED" },
    });
    expect(hasLine2Target(line1Ctx)).toBe(true);
    // metadata known but no line-2 spelling on the object → truncate loudly
    const noLine2Ctx = buildTransformContext({
      field: { source: "Name", target: "name__v" },
      targetField: nameField,
      metadata: { fields: { name__v: { ...nameField } as never } },
      mapping: { options: opts },
    });
    expect(hasLine2Target(noLine2Ctx)).toBe(false);
    expect(addressLine1(r.Name, r, noLine2Ctx)).toEqual({
      value: "one two th",
      diagnostic: {
        kind: "truncated",
        field: "name__v",
        code: "LINE1_SPILL_TARGET_MISSING",
        detail: expect.stringContaining("street_address_2_cda__v"),
      },
    });
    // the UNV spelling counts too
    const altCtx = buildTransformContext({
      field: { source: "Name", target: "name__v" },
      targetField: nameField,
      metadata: {
        fields: {
          name__v: { ...nameField } as never,
          address_line_2__v: {
            ...line2Field,
            name: "address_line_2__v",
          } as never,
        },
      },
      mapping: { options: opts },
    });
    expect(addressLine1(r.Name, r, altCtx)).toMatchObject({
      value: "one two",
      diagnostic: { code: "LINE1_SPILLED" },
    });
    // no metadata at all (field list unknown) → trust the policy
    const unknownCtx = buildTransformContext({
      field: { source: "Name", target: "name__v" },
      mapping: { options: opts },
    });
    expect(hasLine2Target(unknownCtx)).toBe(true);
    expect(addressLine2(r.Address_line_2_vod__c, r, line2Ctx)).toEqual({
      value: "three four Suite 9",
    });
    expect(addressLine2(undefined, r, line2Ctx)).toEqual({
      value: "three four",
    });
    expect(
      addressLine2(undefined, { ...base(), Name: "short" }, line2Ctx),
    ).toBeUndefined();
    // an explicit row-level `truncation: fail` beats the object policy
    const failCtx = buildTransformContext({
      field: { source: "Name", target: "name__v", truncation: "fail" },
      targetField: nameField,
      mapping: { options: opts },
    });
    expect(addressLine1(r.Name, r, failCtx)).toMatchObject({
      omit: true,
      diagnostic: { fatal: true },
    });
    expect(addressLine1("", r, failCtx)).toBeUndefined();
  });

  it("postalCode tolerates a malformed pattern and trims the value", () => {
    const ctx = buildTransformContext({
      field: { source: "Zip_vod__c", target: "postal_code_cda__v" },
      targetField: { name: "postal_code_cda__v", maxLength: 20 },
      country: {
        ...buildCountryContext(),
        postalCode: { pattern: "(", onMismatch: "fail" },
      },
    });
    expect(postalCode(" 94105 ", base(), ctx)).toEqual({ value: "94105" });
    expect(postalCode("", base(), ctx)).toBeUndefined();
  });
});
