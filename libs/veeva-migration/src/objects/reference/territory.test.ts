import { describe, expect, it } from "vitest";
import {
  TERRITORY_ACTIVE_MODEL_PREDICATE,
  TERRITORY_MODEL_INACTIVE,
  TERRITORY_USERS_COUNTRY_COLUMN,
  countryFromPrefixMap,
  enrichTerritoryRows,
  majorityCountry,
  parseTerritoryCountryRule,
  territory,
  territoryCountry,
  territoryExternalId,
  territoryExtraColumns,
  territoryLegacy,
  territoryStatus,
} from "./territory";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { isGlobalModule } from "../../run/plan";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

/** Flat source row for custom-transform unit tests (Id unused by the functions under test). */
function row(fields: Record<string, unknown> = {}): SourceRow {
  return { Id: "000000000000001", ...fields };
}

const NOW = new Date("2026-09-07T00:00:00Z");

function makeConfig(territoryOverrides: Record<string, unknown> = {}) {
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
    objects: { territory: territoryOverrides },
    countries: { US: {} },
  });
}

function metadata(opts: { countryRequired?: boolean } = {}) {
  return resolveMetadata(
    buildVaultMetadata("territory__v", [
      {
        name: "legacy_crm_id__v",
        type: "String",
        max_length: 18,
        unique: true,
      },
      { name: "external_id__v", type: "String", max_length: 100 },
      {
        name: "parent_territory__v",
        type: "Object",
        object: { name: "territory__v" },
      },
      { name: "description__v", type: "String", max_length: 1500 },
      {
        name: "country__v",
        type: "Object",
        object: { name: "country__v" },
        required: opts.countryRequired ?? false,
      },
      { name: "status__v", type: "Picklist", picklist: "status__v" },
      { name: "created_date__v", type: "DateTime", editable: false },
      { name: "created_by__v", type: "Object", object: { name: "user__sys" } },
    ]),
    { picklists: { status__v: ["active__v", "inactive__v"] } },
  );
}

const PARENT_ID = to18("0MI000000000001");
const CHILD_ID = to18("0MI000000000002");

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "0MI000000000002",
    Name: "US East",
    DeveloperName: "US_East",
    ParentTerritory2Id: PARENT_ID,
    Description: "  East coast reps ",
    Territory2ModelId: "0MA000000000001",
    Territory2TypeId: "0MT000000000001",
    "Territory2Model.State": "Active",
    [TERRITORY_USERS_COUNTRY_COLUMN]: "US;US;DE",
    CreatedDate: "2021-02-03T04:05:06.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    territory?: Record<string, unknown>;
    countryRequired?: boolean;
    knownParent?: boolean;
  } = {},
) {
  const config = makeConfig(opts.territory);
  const mapping = materialise(territory, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const ids = buildIdResolver(
    { territory: opts.knownParent === false ? {} : { [PARENT_ID]: "V0T1" } },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata({ countryRequired: opts.countryRequired }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: territory.custom,
    }),
  };
}

describe("territory module", () => {
  it("is structurally valid (Territory2 and legacy Territory variants)", () => {
    for (const m of [territory, territoryLegacy])
      expect(
        validateObjectModule(m).filter((i) => i.severity === "blocking"),
        m.source,
      ).toEqual([]);
  });

  it("encodes the §6.3.3 / §6.2 / §3.3 / §4.4 catalogue facts", () => {
    expect(territory.source).toBe("Territory2");
    expect(territory.target).toBe("territory__v");
    expect(territory.targetEvidence).toBe("OBS");
    expect(territory.scope).toEqual({ kind: "full" });
    expect(territory.countryOf).toEqual([{ kind: "global" }]);
    expect(territory.dependsOn).toEqual([]);
    expect(territory.createPolicy).toBe("match-only");
    expect(territory.deletePolicy).toBe("inactivate");
    expect(territory.inactivate).toEqual([]); // status__v = inactive__v implied
    expect(territory.load.noTriggers).toBe(false);
    // roots first: depth ordering + pass-2 patch of the self reference
    expect(territory.depthOrderBy).toBe("ParentTerritory2Id");
    expect(territory.load.depthOrderBy).toBe("ParentTerritory2Id");
    expect(territory.selfRefs).toEqual([
      { target: "parent_territory__v", source: "ParentTerritory2Id" },
    ]);
    expect(territory.optionDefaults).toMatchObject({
      countryRule: "fromUsers",
      countryPrefixMap: {},
      activeModelOnly: true,
    });
    expect(TERRITORY_ACTIVE_MODEL_PREDICATE).toBe(
      "Territory2Model.State = 'Active'",
    );
    // the territory country rule never re-scopes the GLOBAL unit
    const config = makeConfig({
      countryRule: "prefixMap",
      countryPrefixMap: { US_: "US" },
    });
    expect(isGlobalModule(territory, resolveCountry(config, "US"))).toBe(true);
  });

  it("maps every §6.3.3 row with the spec's transforms, requirement and evidence", () => {
    const byTarget = new Map(territory.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      evidence: "UNV",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Name",
      required: "Y",
      evidence: "OBS",
      transform: { kind: "text", max: 128 },
    });
    // ownership-gated copy (Align owns external_id__v by default)
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "DeveloperName",
      required: "n",
      evidence: "UNV",
      transform: { kind: "custom", fnName: "territoryExternalId" },
    });
    expect(byTarget.get("parent_territory__v")).toMatchObject({
      source: "ParentTerritory2Id",
      evidence: "OBS",
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "territory" },
      },
    });
    expect(byTarget.get("description__v")).toMatchObject({
      source: "Description",
      evidence: "UNV",
      transform: { kind: "text" },
    });
    for (const src of ["Territory2ModelId", "Territory2TypeId"])
      expect(
        territory.fields.find((f) => f.source === src)!.transform,
        src,
      ).toEqual({ kind: "skip" });
    expect(byTarget.get("country__v")).toMatchObject({
      required: "y?",
      evidence: "UNV",
      countryConfigurable: true,
      transform: { kind: "custom", fnName: "territoryCountry" },
    });
    // §6.0.4: status__v derived from the model state; the row also carries the
    // active-model filter, so `statusFromFlag` is honoured inside the transform
    // rather than removing the row
    expect(byTarget.get("status__v")).toMatchObject({
      source: "Territory2Model.State",
      transform: { kind: "custom", fnName: "territoryStatus" },
    });
    expect(byTarget.get("status__v")!.disabledBy).toBeUndefined();
    // Align-owned territories carry no owner / mobile / lock stamps
    for (const t of ["ownerid__v", "mobile_id__v", "lock__v", "unlock__v"])
      expect(byTarget.has(t), t).toBe(false);
  });

  it("matches by DeveloperName then Name; never creates unless configured (§3.3)", () => {
    expect(territory.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "natural_key",
    ]);
    expect(territory.match[1]).toMatchObject({
      keys: [{ target: "external_id__v", source: "DeveloperName" }],
      evidence: "UNV",
    });
    expect(territory.match[2].keys).toEqual([
      { target: "name__v", source: "Name" },
    ]);
    const config = makeConfig({ createPolicy: "create" });
    const mapping = materialise(
      territory,
      resolveCountry(config, "US"),
      config,
      {
        now: NOW,
      },
    );
    expect(mapping.options.createPolicy).toBe("create");
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
  });

  it("transforms a realistic Territory2 row (fromUsers country, parent in pass 2)", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: CHILD_ID,
      name__v: "US East",
      description__v: "East coast reps",
      country__v: "V0C000000000101",
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    // Align owns external_id__v by default → never written (§3.2 step 4)
    expect(r.payload.external_id__v).toBeUndefined();
    // active model → status__v omitted (Vault defaults active__v)
    expect(r.payload.status__v).toBeUndefined();
    // skipped columns never reach the payload
    expect(r.payload.territory2modelid__v).toBeUndefined();
    expect(r.payload.territory2typeid__v).toBeUndefined();
    // self reference deferred to pass 2, not in the pass-1 payload
    expect(r.payload.parent_territory__v).toBeUndefined();
    expect(r.secondPass).toEqual({
      parent_territory__v: { $fk: { object: "territory", sfdcId: PARENT_ID } },
    });
    expect(r.fkEdges).toContainEqual({
      field: "parent_territory__v",
      targetObjectKey: "territory",
      targetSfdcId: PARENT_ID,
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("writes external_id__v = DeveloperName only when the migration owns the field", () => {
    const { result: r } = run(sampleRow(), {
      territory: { externalIdOwnedBy: "migration" },
    });
    expect(r.status).toBe("ok");
    expect(r.payload.external_id__v).toBe("US_East");
    const ctx = buildTransformContext({
      objectKey: "territory",
      field: { target: "external_id__v" },
      mapping: { options: { externalIdOwnedBy: "integration" } as never },
    });
    expect(territoryExternalId("US_East", row({}), ctx)).toBeUndefined();
  });

  it("skips rows of a non-active model by default (only the active model is loaded, §6.3.3)", () => {
    const { result: r } = run(
      sampleRow({ "Territory2Model.State": "Planning" }),
    );
    expect(r.status).toBe("skipped");
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "skipped",
        code: TERRITORY_MODEL_INACTIVE,
        value: "Planning",
        fatal: true,
      }),
    );
    // activeModelOnly = false → §6.0.4 applies: loaded as inactive__v
    const loaded = run(sampleRow({ "Territory2Model.State": "Planning" }), {
      territory: { activeModelOnly: false },
    });
    expect(loaded.result.status).toBe("ok");
    expect(loaded.result.payload.status__v).toBe("inactive__v");
    // …unless statusFromFlag is off (the filter switch is independent)
    const noStatus = run(sampleRow({ "Territory2Model.State": "Planning" }), {
      territory: { activeModelOnly: false, statusFromFlag: false },
    });
    expect(noStatus.result.status).toBe("ok");
    expect(noStatus.result.payload.status__v).toBeUndefined();
    const stillSkipped = run(
      sampleRow({ "Territory2Model.State": "Archived" }),
      { territory: { statusFromFlag: false } },
    );
    expect(stillSkipped.result.status).toBe("skipped");
  });

  it("resolves the country through prefixMap / field / const rules from config", () => {
    const prefix = run(sampleRow({ [TERRITORY_USERS_COUNTRY_COLUMN]: "" }), {
      territory: {
        countryRule: "prefixMap",
        countryPrefixMap: { "DE-": "DE", US_: "US" },
      },
    });
    expect(prefix.result.payload.country__v).toBe("V0C000000000101");

    const field = run(sampleRow({ Country__c: "DE" }), {
      territory: { countryRule: "field:Country__c" },
    });
    expect(field.result.payload.country__v).toBe("V0C000000000102");
    // the custom field is a declared extra column of the rule
    expect(territoryExtraColumns({ countryRule: "field:Country__c" })).toEqual([
      "Country__c",
    ]);
    expect(territoryExtraColumns({ countryOf: "prefixMap" })).toEqual([]);
    // column not selected at all → unresolved with an actionable detail
    const unselected = run(sampleRow(), {
      territory: { countryRule: "field:Country__c" },
    });
    expect(unselected.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TERRITORY_COUNTRY_UNRESOLVED",
        detail: expect.stringContaining("extraColumns"),
      }),
    );

    const konst = run(sampleRow(), {
      territory: { countryRule: "const:DE" },
    });
    expect(konst.result.payload.country__v).toBe("V0C000000000102");

    // the spec key `objects.territory.countryOf` is honoured when it reaches the options
    const specKey = buildTransformContext({
      objectKey: "territory",
      field: { target: "country__v" },
      mapping: { options: { countryOf: "const:DE" } as never },
    });
    expect(territoryCountry(undefined, row({}), specKey)).toBe(
      "V0C000000000102",
    );
  });

  it("fromUsers resolves out of the box once the rows are enriched from the associations", () => {
    const { [TERRITORY_USERS_COUNTRY_COLUMN]: _unset, ...raw } = sampleRow();
    const bare = raw as SourceRow;
    // not enriched → unresolved, and the detail names the missing step
    const unenriched = run(bare);
    expect(unenriched.result.payload.country__v).toBeUndefined();
    expect(unenriched.result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TERRITORY_COUNTRY_UNRESOLVED",
        detail: expect.stringContaining("enrichTerritoryRows"),
      }),
    );
    const u = (n: number) => to18(`00500000000000${n}`);
    const [enriched, other] = enrichTerritoryRows(
      [bare, { ...bare, Id: "0MI000000000009" }],
      [
        { TerritoryId: bare.Id, UserId: u(1), IsActive: "true" },
        { TerritoryId: bare.Id, UserId: u(2), IsActive: true },
        { TerritoryId: bare.Id, UserId: u(3), IsActive: "false" }, // inactive: ignored
        { TerritoryId: bare.Id, UserId: u(4) }, // unknown country: ignored
        { TerritoryId: bare.Id, UserId: u(5), IsActive: "true" },
      ],
      { [u(1)]: "US", [u(2)]: "us", [u(3)]: "DE", [u(5)]: "DE" },
    );
    expect(enriched[TERRITORY_USERS_COUNTRY_COLUMN]).toEqual([
      "US",
      "US",
      "DE",
    ]);
    expect(other[TERRITORY_USERS_COUNTRY_COLUMN]).toEqual([]);
    expect(run(enriched).result.payload.country__v).toBe("V0C000000000101");
    expect(run(other).result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TERRITORY_COUNTRY_UNRESOLVED" }),
    );
    // idempotent: rows already carrying the column are left alone
    expect(
      enrichTerritoryRows([enriched], [], new Map())[0][
        TERRITORY_USERS_COUNTRY_COLUMN
      ],
    ).toEqual(["US", "US", "DE"]);
  });

  it("fails the row when the required country is unresolved/ambiguous, loads it when optional", () => {
    const ambiguousRow = sampleRow({
      [TERRITORY_USERS_COUNTRY_COLUMN]: "US;DE",
    });
    const optional = run(ambiguousRow, { countryRequired: false });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.country__v).toBeUndefined();
    expect(optional.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "country_unresolved",
        code: "TERRITORY_COUNTRY_AMBIGUOUS",
        field: "country__v",
      }),
    );

    // required: countries are never created, so a pending_fk hold could never
    // resolve — the row fails now with the real code
    const required = run(ambiguousRow, { countryRequired: true });
    expect(required.result.status).toBe("failed");
    expect(required.result.failure).toMatchObject({
      code: "TERRITORY_COUNTRY_AMBIGUOUS",
      field: "country__v",
    });
    expect(required.result.unresolvedRequiredFks).toEqual([]);
    expect(required.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "required_missing",
        code: "TERRITORY_COUNTRY_AMBIGUOUS",
        fatal: true,
      }),
    );

    const none = run(sampleRow({ [TERRITORY_USERS_COUNTRY_COLUMN]: "" }));
    expect(none.result.status).toBe("ok");
    expect(none.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "country_unresolved",
        code: "TERRITORY_COUNTRY_UNRESOLVED",
      }),
    );
    const noneRequired = run(
      sampleRow({ [TERRITORY_USERS_COUNTRY_COLUMN]: "" }),
      { countryRequired: true },
    );
    expect(noneRequired.result.status).toBe("failed");
    expect(noneRequired.result.failure?.code).toBe(
      "TERRITORY_COUNTRY_UNRESOLVED",
    );
  });

  it("keeps an unknown parent as a deferred optional reference (resolved after the step)", () => {
    const { result: r } = run(sampleRow(), { knownParent: false });
    expect(r.status).toBe("ok");
    expect(r.secondPass.parent_territory__v).toEqual({
      $fk: { object: "territory", sfdcId: PARENT_ID },
    });
    expect(r.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({
        field: "parent_territory__v",
        objectKey: "territory",
        sfdcId: PARENT_ID,
        secondPass: true,
      }),
    );
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const config = makeConfig();
    const mapping = materialise(
      territory,
      resolveCountry(config, "US"),
      config,
      {
        now: NOW,
      },
    );
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });

  it("legacy Territory variant swaps the source columns and keeps the targets", () => {
    expect(territoryLegacy.key).toBe("territory");
    expect(territoryLegacy.source).toBe("Territory");
    expect(territoryLegacy.target).toBe("territory__v");
    expect(territoryLegacy.depthOrderBy).toBe("ParentTerritoryId");
    expect(territoryLegacy.selfRefs).toEqual([
      { target: "parent_territory__v", source: "ParentTerritoryId" },
    ]);
    const byTarget = new Map(territoryLegacy.fields.map((f) => [f.target, f]));
    expect(byTarget.get("external_id__v")!.source).toBe("Name");
    expect(byTarget.get("parent_territory__v")!.source).toBe(
      "ParentTerritoryId",
    );
    expect(byTarget.get("country__v")!.transform).toEqual({
      kind: "custom",
      fnName: "territoryCountry",
    });
    expect(byTarget.has("status__v")).toBe(false); // no Territory2Model on legacy orgs
    expect(territoryLegacy.match[1].keys).toEqual([
      { target: "external_id__v", source: "Name" },
    ]);
    // same target set as Territory2 apart from the model-state status row and skipped model columns
    const t2 = new Set(territory.fields.map((f) => f.target));
    for (const t of byTarget.keys()) expect(t2.has(t), t).toBe(true);
  });
});

describe("territory helpers", () => {
  it("parseTerritoryCountryRule accepts the four documented forms", () => {
    expect(parseTerritoryCountryRule(undefined)).toEqual({ kind: "fromUsers" });
    expect(parseTerritoryCountryRule("fromUsers")).toEqual({
      kind: "fromUsers",
    });
    expect(parseTerritoryCountryRule("prefixMap")).toEqual({
      kind: "prefixMap",
    });
    expect(parseTerritoryCountryRule("field:Country__c")).toEqual({
      kind: "field",
      field: "Country__c",
    });
    expect(parseTerritoryCountryRule("const:DE")).toEqual({
      kind: "const",
      iso2: "DE",
    });
    expect(parseTerritoryCountryRule("const:de")).toBeUndefined();
    expect(parseTerritoryCountryRule("account")).toBeUndefined();
    expect(parseTerritoryCountryRule(42)).toBeUndefined();
  });

  it("majorityCountry votes case-insensitively and flags ties", () => {
    expect(majorityCountry(["us", "US", "de"])).toEqual({
      iso2: "US",
      ambiguous: false,
    });
    expect(majorityCountry(["US", "DE"])).toEqual({ ambiguous: true });
    expect(majorityCountry(["", " "])).toEqual({ ambiguous: false });
  });

  it("countryFromPrefixMap prefers DeveloperName, longest prefix first", () => {
    const map = { US: "XX", US_: "US", "DE-": "DE" };
    expect(countryFromPrefixMap(map, "US_East", "DE-Nord")).toBe("US");
    expect(countryFromPrefixMap(map, null, "DE-Nord")).toBe("DE");
    expect(countryFromPrefixMap(map, "FR_Sud", "FR Sud")).toBeUndefined();
  });

  it("territoryCountry reports an invalid rule as unresolved, territoryStatus reads the model state", () => {
    const ctx = buildTransformContext({
      objectKey: "territory",
      field: { target: "country__v" },
      mapping: { options: { countryRule: "bogus" } as never },
    });
    expect(territoryCountry(undefined, row({}), ctx)).toMatchObject({
      omit: true,
      diagnostic: { code: "TERRITORY_COUNTRY_UNRESOLVED" },
    });
    const sctx = buildTransformContext({ objectKey: "territory" });
    expect(
      territoryStatus(
        undefined,
        row({ "Territory2Model.State": "Active" }),
        sctx,
      ),
    ).toBeUndefined();
    // default (activeModelOnly): non-active model rows are skipped
    expect(
      territoryStatus(
        undefined,
        row({ "Territory2Model.State": "Archived" }),
        sctx,
      ),
    ).toMatchObject({
      omit: true,
      diagnostic: { kind: "skipped", code: TERRITORY_MODEL_INACTIVE },
    });
    const loadAll = buildTransformContext({
      objectKey: "territory",
      mapping: { options: { activeModelOnly: false } as never },
    });
    expect(
      territoryStatus(
        undefined,
        row({ "Territory2Model.State": "Archived" }),
        loadAll,
      ),
    ).toBe("inactive__v");
    expect(territoryStatus(undefined, row({}), sctx)).toBeUndefined();
  });
});
