import { describe, expect, it } from "vitest";
import { em_catalog } from "./em_catalog";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const CATALOG_1 = to18("a0E000000000001");

function makeConfig(catalogOverrides: Record<string, unknown> = {}) {
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
    objects: { em_catalog: { ...catalogOverrides } },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "em_catalog__v",
      [
        { name: "em_catalog_name__v", type: "String", max_length: 255 },
        {
          name: "external_id__v",
          type: "String",
          max_length: 100,
          unique: true,
        },
        { name: "description__v", type: "String", max_length: 1500 },
        {
          name: "em_catalog_status__v",
          type: "Picklist",
          picklist: "em_catalog_status__v",
        },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        {
          name: "ownerid__v",
          type: "Object",
          object: { name: "user__sys" },
          relationship_type: "reference",
        },
      ],
      { objectTypes: ["topic__v", "presentation__v"] },
    ),
    {
      picklists: {
        em_catalog_status__v: ["active__v", "inactive__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver({}, { [SAMPLE_USER_ID]: 11 });

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: CATALOG_1,
    IsDeleted: false,
    Name: "Cardiology Update 2025",
    External_ID_vod__c: "CAT-001",
    "RecordType.DeveloperName": "Topic_vod",
    Description_vod__c: "  Latest guidance on heart failure management ",
    Status_vod__c: "Active_vod",
    Mobile_ID_vod__c: "7d2c5f4e-c001",
    OwnerId: SAMPLE_USER_ID,
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
  return materialise(em_catalog, resolveCountry(config, "US"), config, {
    now: NOW,
  });
}

function applyCtx(overrides: Partial<Parameters<typeof applyMapping>[2]> = {}) {
  return {
    country: buildCountryContext(),
    metadata: metadata(),
    ids,
    migrationUserId: 1,
    runMode: "init" as const,
    custom: em_catalog.custom,
    ...overrides,
  };
}

describe("em_catalog module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_catalog).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(em_catalog.source).toBe("EM_Catalog_vod__c");
    expect(em_catalog.target).toBe("em_catalog__v");
    expect(em_catalog.targetEvidence).toBe("OBS");
    expect(em_catalog.scope).toEqual({ kind: "full" });
    expect(em_catalog.countryOf).toEqual([{ kind: "global" }]);
    expect(em_catalog.dependsOn).toEqual([]);
    expect(em_catalog.selfRefs).toEqual([]);
    expect(em_catalog.deletePolicy).toBe("inactivate");
    expect(em_catalog.inactivate).toEqual([]); // status__v = inactive__v implied
    expect(em_catalog.createPolicy).toBe("create");
    expect(em_catalog.load.noTriggers).toBe(false);
    expect(em_catalog.blockS.objectType).toBe(true);
    expect(em_catalog.blockS.statusFromFlag).toBeUndefined();
    expect(em_catalog.objectTypes).toEqual({});
    expect(em_catalog.match).toEqual([
      expect.objectContaining({
        method: "external_id",
        keys: [{ target: "external_id__v", source: "External_ID_vod__c" }],
      }),
      { method: "legacy_id" },
    ]);
    expect(em_catalog.notes).not.toContain("STUB");
  });

  it("carries every §6.3.20 row (all targets OBS, unverified sources flagged)", () => {
    const byTarget = new Map(em_catalog.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "em_catalog_name__v",
      "external_id__v",
      "description__v",
      "em_catalog_status__v",
      "object_type__v.api_name__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "ownerid__v",
      "mobile_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    for (const target of [
      "name__v",
      "em_catalog_name__v",
      "external_id__v",
      "description__v",
      "em_catalog_status__v",
      "object_type__v.api_name__v",
    ])
      expect(byTarget.get(target)?.evidence, target).toBe("OBS");
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      transform: { kind: "text", max: 128 },
    });
    expect(byTarget.get("em_catalog_name__v")?.source).toBe("Name");
    expect(byTarget.get("description__v")?.unverifiedSource).toBe(true);
    expect(byTarget.get("em_catalog_status__v")).toMatchObject({
      unverifiedSource: true,
      transform: { kind: "picklist", mapKey: "em_catalog.status" },
    });
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: "RecordType.DeveloperName",
      required: "Y",
      transform: { kind: "objectType", mapKey: "em_catalog.objectType" },
    });
    expect(em_catalog.picklists).toEqual({ "em_catalog.status": {} });
    for (const f of em_catalog.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("is full scope: no predicate after materialisation", () => {
    const m = mappingFor();
    expect(m.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(m.scope).predicate).toBeUndefined();
    expect(m.options.deletePolicy).toBe("inactivate");
    expect(m.options.allowTypeChange).toBe(true);
  });

  it("transforms a row: legacy id, both name targets, derived object type, cleaned description, status picklist", () => {
    const r = applyMapping(row(), mappingFor(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: CATALOG_1,
      name__v: "Cardiology Update 2025",
      em_catalog_name__v: "Cardiology Update 2025",
      external_id__v: "CAT-001",
      "object_type__v.api_name__v": "topic__v",
      description__v: "Latest guidance on heart failure management",
      em_catalog_status__v: "active__v",
      mobile_id__v: "7d2c5f4e-c001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-05-04T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.objectType).toBe("topic__v");
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("honours a configured object-type crosswalk and fails on an unknown type", () => {
    const mapped = applyMapping(
      row({ "RecordType.DeveloperName": "Slide_Deck_vod" }),
      mappingFor({ objectType: { Slide_Deck_vod: "presentation__v" } }),
      applyCtx(),
    );
    expect(mapped.status).toBe("ok");
    expect(mapped.payload["object_type__v.api_name__v"]).toBe(
      "presentation__v",
    );
    const unknown = applyMapping(
      row({ "RecordType.DeveloperName": "Webinar_vod" }),
      mappingFor(),
      applyCtx(),
    );
    expect(unknown.status).toBe("failed");
    expect(unknown.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("fails an unmapped status under the error policy and skips it under the skip policy", () => {
    const failed = applyMapping(
      row({ Status_vod__c: "Retired_vod" }),
      mappingFor(),
      applyCtx(),
    );
    expect(failed.status).toBe("failed");
    expect(failed.failure?.field).toBe("em_catalog_status__v");
    const skipped = applyMapping(
      row({ Status_vod__c: "Retired_vod" }),
      mappingFor(),
      applyCtx({
        country: buildCountryContext({
          picklistPolicy: { onUnmapped: "skip" },
        }),
      }),
    );
    expect(skipped.status).toBe("ok");
    expect(skipped.payload.em_catalog_status__v).toBeUndefined();
    expect(skipped.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unmapped_picklist",
        field: "em_catalog_status__v",
      }),
    );
  });

  it("omits empty optional fields and treats a missing Name as a required miss", () => {
    const sparse = applyMapping(
      row({
        Description_vod__c: "",
        Status_vod__c: null,
        External_ID_vod__c: "",
      }),
      mappingFor(),
      applyCtx(),
    );
    expect(sparse.status).toBe("ok");
    expect(sparse.payload.description__v).toBeUndefined();
    expect(sparse.payload.em_catalog_status__v).toBeUndefined();
    expect(sparse.payload.external_id__v).toBeUndefined();
    const noName = applyMapping(row({ Name: "" }), mappingFor(), applyCtx());
    expect(noName.status).toBe("failed");
    expect(noName.failure?.code).toBe("REQUIRED_MISSING");
  });
});
