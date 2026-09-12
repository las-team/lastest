import { describe, expect, it } from "vitest";
import {
  COUNTRY_KEY_FIELD_CANDIDATES,
  COUNTRY_SOURCE_COLUMNS,
  country,
} from "./country";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";

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

const NOW = new Date("2026-09-07T00:00:00Z");

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("country__v", [
      {
        name: "legacy_crm_id__v",
        type: "String",
        max_length: 18,
        unique: true,
      },
      { name: "alpha_2_code__v", type: "String", max_length: 2 },
      { name: "country_code__v", type: "String", max_length: 3 },
      { name: "external_id__v", type: "String", max_length: 50 },
    ]),
  );
}

describe("country module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(country).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.3.1 / §6.2 catalogue facts", () => {
    expect(country.source).toBe("Country_vod__c");
    expect(country.target).toBe("country__v");
    expect(country.targetEvidence).toBe("DOC");
    expect(country.scope).toEqual({ kind: "full" });
    expect(country.countryOf).toEqual([{ kind: "global" }]);
    expect(country.dependsOn).toEqual([]);
    expect(country.createPolicy).toBe("match-only");
    expect(country.deletePolicy).toBe("ignore");
    expect(country.inactivate).toEqual([]);
    // never loaded: no audit / owner / mobile / lock / external-id Block S rows
    const targets = country.fields.map((f) => f.target);
    expect(targets).toEqual([
      "legacy_crm_id__v",
      "alpha_2_code__v",
      "name__v",
      "country_code__v",
    ]);
    for (const absent of [
      "created_date__v",
      "created_by__v",
      "ownerid__v",
      "mobile_id__v",
      "lock__v",
      "external_id__v",
    ])
      expect(targets).not.toContain(absent);
    // exactly one K legacyId row
    expect(
      country.fields.filter(
        (f) => f.required === "K" && f.transform.kind === "legacyId",
      ),
    ).toHaveLength(1);
    // the target key field is [UNV] — carried as evidence, resolved by preflight
    const alpha = country.fields.find((f) => f.target === "alpha_2_code__v")!;
    expect(alpha.evidence).toBe("UNV");
    expect(alpha.source).toBe("Alpha_2_Code_vod__c");
    const name = country.fields.find((f) => f.target === "name__v")!;
    expect(name.evidence).toBe("OBS");
    expect(name.transform).toEqual({ kind: "text", max: 128 });
    // Country_Code_vod__c is informational only
    expect(
      country.fields.find((f) => f.source === "Country_Code_vod__c")!.transform,
    ).toEqual({ kind: "skip" });
  });

  it("matches by ISO alpha-2 first, then case-insensitive name (§3.3)", () => {
    expect(country.match.map((m) => m.method)).toEqual([
      "external_id",
      "natural_key",
    ]);
    expect(country.match[0].keys).toEqual([
      { target: "alpha_2_code__v", source: "Alpha_2_Code_vod__c" },
    ]);
    expect(country.match[0].evidence).toBe("UNV");
    expect(country.match[1].keys?.[0]).toMatchObject({
      target: "name__v",
      source: "Name",
      caseInsensitive: true,
    });
  });

  it("publishes the preflight key-field candidates in spec order and the crosswalk columns", () => {
    expect([...COUNTRY_KEY_FIELD_CANDIDATES]).toEqual([
      "alpha_2_code__v",
      "country_code__v",
      "abbreviation__v",
      "external_id__v",
    ]);
    expect([...COUNTRY_SOURCE_COLUMNS]).toEqual([
      "Id",
      "Name",
      "Alpha_2_Code_vod__c",
      "Country_Code_vod__c",
    ]);
    // every mapped source column is extracted for the crosswalk
    for (const f of country.fields)
      expect(COUNTRY_SOURCE_COLUMNS).toContain(f.source);
  });

  it("transforms a source country into the crosswalk match keys", () => {
    const mapping = materialise(country, resolveCountry(config, "US"), config, {
      now: NOW,
    });
    expect(mapping.findings.filter((f) => f.severity === "blocking")).toEqual(
      [],
    );
    const r = applyMapping(
      {
        Id: "a0C00000000US01",
        Name: "United States",
        Alpha_2_Code_vod__c: "US",
        Country_Code_vod__c: "840",
        CreatedDate: "2020-01-01T00:00:00.000Z",
      },
      mapping,
      {
        country: buildCountryContext(),
        metadata: metadata(),
        ids: buildIdResolver(),
        runMode: "preflight",
      },
    );
    expect(r.status).toBe("ok");
    expect(r.sfdcId).toBe(IDS.countryUS);
    expect(r.payload).toEqual({
      legacy_crm_id__v: to18("a0C00000000US01"),
      alpha_2_code__v: "US",
      name__v: "United States",
    });
    expect(r.payload.country_code__v).toBeUndefined();
    expect(r.payload.created_date__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const mapping = materialise(country, resolveCountry(config, "US"), config, {
      now: NOW,
    });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});
