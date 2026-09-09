import { describe, expect, it } from "vitest";
import {
  EM_VENUE_STATE_MAP_KEY,
  countryAuto,
  countryModeFor,
  em_venue,
  stateAuto,
} from "./em_venue";
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
type VenueField = Parameters<typeof buildVaultMetadata>[1][number];

const NOW = new Date("2026-09-07T00:00:00Z");
const VENUE_1 = to18("a0V000000000001");

const config = parseConfig({
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
  countries: { US: {} },
});

/** Target metadata; `country__v`/`state_province__v` types are [UNV] so tests vary them. */
function metadata(
  opts: {
    countryType?: "Object" | "Picklist" | "String";
    stateType?: "Picklist" | "String";
  } = {},
) {
  const countryField: VenueField =
    opts.countryType === "Picklist"
      ? { name: "country__v", type: "Picklist", picklist: "country__v" }
      : opts.countryType === "String"
        ? { name: "country__v", type: "String", max_length: 2 }
        : {
            name: "country__v",
            type: "Object",
            object: { name: "country__v" },
          };
  const stateField: VenueField =
    opts.stateType === "String"
      ? { name: "state_province__v", type: "String", max_length: 80 }
      : {
          name: "state_province__v",
          type: "Picklist",
          picklist: "state_province__v",
        };
  return resolveMetadata(
    buildVaultMetadata("em_venue__v", [
      { name: "external_id__v", type: "String", max_length: 100, unique: true },
      { name: "address_line_1__v", type: "String", max_length: 255 },
      { name: "address_line_2__v", type: "String", max_length: 255 },
      { name: "city__v", type: "String", max_length: 80 },
      stateField,
      { name: "postal_code__v", type: "String", max_length: 20 },
      countryField,
      { name: "phone__v", type: "String", max_length: 40 },
      { name: "venue_type__v", type: "Picklist", picklist: "venue_type__v" },
      {
        name: "em_venue_status__v",
        type: "Picklist",
        picklist: "em_venue_status__v",
      },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      {
        name: "ownerid__v",
        type: "Object",
        object: { name: "user__sys" },
        relationship_type: "reference",
      },
    ]),
    {
      picklists: {
        state_province__v: ["california__v", "new_york__v"],
        country__v: ["united_states__v", "germany__v"],
        venue_type__v: ["hotel__v", "restaurant__v"],
        em_venue_status__v: ["active__v", "inactive__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver({}, { [SAMPLE_USER_ID]: 11 });
const usCountry = buildCountryContext({
  picklists: { [EM_VENUE_STATE_MAP_KEY]: { CA: "california__v" } },
});

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: VENUE_1,
    IsDeleted: false,
    Name: "Grand Hotel Conference Center",
    External_ID_vod__c: "VEN-001",
    Address_Line_1_vod__c: "1 Main Street",
    Address_Line_2_vod__c: "Floor 2",
    City_vod__c: "San Francisco",
    State_Province_vod__c: "CA",
    Postal_Code_vod__c: "94105",
    Country_vod__c: IDS.countryUS,
    Phone_vod__c: "415-555-0100",
    Venue_Type_vod__c: "Hotel_vod",
    Status_vod__c: "Active_vod",
    Mobile_ID_vod__c: "7d2c5f4e-v001",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2021-05-04T10:11:12.000Z",
    LastModifiedDate: "2025-01-02T03:04:05.000Z",
    SystemModstamp: "2025-01-02T03:04:05.000Z",
    ...extra,
  };
}

function mapping() {
  return materialise(em_venue, resolveCountry(config, "US"), config, {
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
    custom: em_venue.custom,
    ...overrides,
  };
}

describe("em_venue module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_venue).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(em_venue.source).toBe("EM_Venue_vod__c");
    expect(em_venue.target).toBe("em_venue__v");
    expect(em_venue.targetEvidence).toBe("OBS");
    expect(em_venue.scope).toEqual({ kind: "full" });
    expect(em_venue.countryOf).toEqual([{ kind: "global" }]);
    expect(em_venue.dependsOn).toEqual([]);
    expect(em_venue.selfRefs).toEqual([]);
    expect(em_venue.deletePolicy).toBe("inactivate");
    expect(em_venue.inactivate).toEqual([]); // status__v = inactive__v implied
    expect(em_venue.createPolicy).toBe("create");
    expect(em_venue.load.noTriggers).toBe(false);
    expect(em_venue.blockS.statusFromFlag).toBeUndefined();
    expect(em_venue.match).toEqual([
      expect.objectContaining({
        method: "external_id",
        keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      }),
      { method: "legacy_id" },
    ]);
    expect(em_venue.notes).not.toContain("STUB");
  });

  it("carries every §6.3.19 row with evidence and unverified-source flags", () => {
    const byTarget = new Map(em_venue.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "external_id__v",
      "address_line_1__v",
      "address_line_2__v",
      "city__v",
      "state_province__v",
      "postal_code__v",
      "country__v",
      "phone__v",
      "venue_type__v",
      "em_venue_status__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "ownerid__v",
      "mobile_id__v",
      "external_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(em_venue.fields.filter((f) => f.target === "name__v")).toHaveLength(
      1,
    );
    expect(byTarget.get("name__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("external_id__v")?.evidence).toBe("OBS");
    for (const target of [
      "address_line_1__v",
      "address_line_2__v",
      "city__v",
      "state_province__v",
      "postal_code__v",
      "country__v",
      "phone__v",
      "venue_type__v",
      "em_venue_status__v",
    ]) {
      const f = byTarget.get(target)!;
      expect(f.evidence, target).toBe("UNV");
      expect(f.unverifiedSource, target).toBe(true);
      expect(f.required, target).toBe("n");
    }
    expect(byTarget.get("state_province__v")?.countryConfigurable).toBe(true);
    expect(byTarget.get("country__v")?.countryConfigurable).toBe(true);
    expect(byTarget.get("country__v")?.transform).toEqual({
      kind: "custom",
      fnName: "countryAuto",
    });
    expect(byTarget.get("venue_type__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "em_venue.venueType",
    });
    expect(byTarget.get("em_venue_status__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "em_venue.status",
    });
    expect(Object.keys(em_venue.picklists)).toEqual([
      EM_VENUE_STATE_MAP_KEY,
      "em_venue.venueType",
      "em_venue.status",
    ]);
    for (const f of em_venue.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("defaults externalIdOwnedBy to integration so external_id__v stays the match key (§3.2 step 4), overridable per object", () => {
    expect(mapping().options.externalIdOwnedBy).toBe("integration");
    const overridden = parseConfig({
      ...config,
      objects: { em_venue: { externalIdOwnedBy: "migration" } },
    });
    expect(
      materialise(em_venue, resolveCountry(overridden, "US"), overridden, {
        now: NOW,
      }).options.externalIdOwnedBy,
    ).toBe("migration");
  });

  it("is full scope: no predicate and no cutoff after materialisation", () => {
    const m = mapping();
    expect(m.scope.spec).toEqual({ kind: "full" });
    expect(m.scope.cutoffDate).toBeUndefined();
    expect(buildScopePredicate(m.scope).predicate).toBeUndefined();
    expect(m.options.deletePolicy).toBe("inactivate");
    expect(m.options.inactivateBy).toEqual([]);
  });

  it("transforms a row: legacy id, texts, state/venue-type/status picklists, country ref, audit users", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: VENUE_1,
      name__v: "Grand Hotel Conference Center",
      external_id__v: "VEN-001",
      address_line_1__v: "1 Main Street",
      address_line_2__v: "Floor 2",
      city__v: "San Francisco",
      state_province__v: "california__v",
      postal_code__v: "94105",
      country__v: "V0C000000000101", // country(ref): crosswalk vault id (§2.3 exception)
      phone__v: "415-555-0100",
      venue_type__v: "hotel__v",
      em_venue_status__v: "active__v",
      mobile_id__v: "7d2c5f4e-v001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-05-04T10:11:12.000Z",
      modified_date__v: "2025-01-02T03:04:05.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.status__v).toBeUndefined(); // no statusFromFlag on venues
    expect(r.payload.object_type__v).toBeUndefined();
    expect(r.payload["object_type__v.api_name__v"]).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toEqual([]);
  });

  it("picks the country mode from the target type (picklist / iso2) and the state text form", () => {
    const pick = applyMapping(
      row({ Country_vod__c: "US" }),
      mapping(),
      applyCtx({ metadata: metadata({ countryType: "Picklist" }) }),
    );
    expect(pick.status).toBe("ok");
    expect(pick.payload.country__v).toBe("united_states__v");
    const iso = applyMapping(
      row(),
      mapping(),
      applyCtx({
        metadata: metadata({ countryType: "String", stateType: "String" }),
      }),
    );
    expect(iso.status).toBe("ok");
    expect(iso.payload.country__v).toBe("US");
    expect(iso.payload.state_province__v).toBe("CA");
  });

  it("omits an unmatched country with a non-fatal VT_COUNTRY_UNMATCHED diagnostic (optional lookup)", () => {
    const r = applyMapping(
      row({ Country_vod__c: to18("a0C00000000XX01") }),
      mapping(),
      applyCtx(),
    );
    expect(r.status).toBe("ok");
    expect(r.payload.country__v).toBeUndefined();
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "country__v",
        code: "VT_COUNTRY_UNMATCHED",
      }),
    );
  });

  it("fails the row on an unmapped picklist value under the error policy and skips erased rows", () => {
    const bad = applyMapping(
      row({ Venue_Type_vod__c: "Stadium_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("venue_type__v");
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [VENUE_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });

  it("fails on a missing required name and keeps the same hash for identical rows", () => {
    const missing = applyMapping(row({ Name: "" }), mapping(), applyCtx());
    expect(missing.status).toBe("failed");
    expect(missing.failure?.code).toBe("REQUIRED_MISSING");
    const a = applyMapping(row(), mapping(), applyCtx());
    const b = applyMapping(row(), mapping(), applyCtx());
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(
      applyMapping(row({ City_vod__c: "Oakland" }), mapping(), applyCtx())
        .sourceHash,
    ).not.toBe(a.sourceHash);
  });
});

describe("em_venue custom transforms", () => {
  it("countryModeFor / countryAuto follow the target field type", () => {
    const base = { Id: VENUE_1 };
    const refCtx = buildTransformContext({
      field: { source: "Country_vod__c", target: "country__v" },
      targetField: { name: "country__v", type: "object" },
    });
    expect(countryModeFor(refCtx)).toBe("ref");
    expect(countryAuto(IDS.countryDE, base, refCtx)).toEqual({
      value: "V0C000000000102",
    });
    const pickCtx = buildTransformContext({
      field: { source: "Country_vod__c", target: "country__v" },
      targetField: { name: "country__v", type: "picklist" },
    });
    expect(countryModeFor(pickCtx)).toBe("picklist");
    expect(countryAuto("de", base, pickCtx)).toEqual({ value: "germany__v" });
    const strCtx = buildTransformContext({
      field: { source: "Country_vod__c", target: "country__v" },
      targetField: { name: "country__v", type: "string" },
    });
    expect(countryModeFor(strCtx)).toBe("iso2");
    expect(countryAuto("de", base, strCtx)).toEqual({ value: "DE" });
    expect(countryAuto("", base, strCtx)).toBeUndefined();
    expect(countryAuto(null, base, refCtx)).toBeUndefined();
  });

  it("stateAuto crosswalks picklist targets and passes text through otherwise", () => {
    const base = { Id: VENUE_1 };
    const pickCtx = buildTransformContext({
      field: { source: "State_Province_vod__c", target: "state_province__v" },
      targetField: {
        name: "state_province__v",
        type: "picklist",
        picklistValues: ["california__v"],
      },
      country: buildCountryContext({
        picklists: { [EM_VENUE_STATE_MAP_KEY]: { CA: "california__v" } },
      }),
    });
    expect(stateAuto("CA", base, pickCtx)).toMatchObject({
      value: "california__v",
    });
    const textCtx = buildTransformContext({
      field: { source: "State_Province_vod__c", target: "state_province__v" },
      targetField: { name: "state_province__v", type: "string", maxLength: 80 },
    });
    expect(stateAuto("  Bavaria ", base, textCtx)).toEqual({
      value: "Bavaria",
    });
    expect(stateAuto(undefined, base, textCtx)).toBeUndefined();
  });
});
