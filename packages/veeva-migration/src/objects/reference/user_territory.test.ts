import { describe, expect, it } from "vitest";
import {
  USER_TERRITORY_EXTRA_COLUMNS,
  USER_TERRITORY_LEGACY_EXTRA_COLUMNS,
  renderUserTerritoryName,
  userTerritoryName,
  userTerritoryStatus,
  user_territory,
  user_territoryLegacy,
} from "./user_territory";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { buildColumnList } from "../../extract/columns";
import { extraColumnsOf } from "../../preflight/source";
import {
  SAMPLE_USER_ID,
  buildCountryContext,
  buildDescribe,
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

function makeConfig(overrides: Record<string, unknown> = {}) {
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
    objects: { user_territory: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("user_territory__v", [
      {
        name: "legacy_crm_id__v",
        type: "String",
        max_length: 18,
        unique: true,
      },
      {
        name: "user__v",
        type: "Object",
        object: { name: "user__sys" },
        required: true,
      },
      {
        name: "territory__v",
        type: "Object",
        object: { name: "territory__v" },
        required: true,
      },
      { name: "external_id__v", type: "String", max_length: 100 },
      { name: "role__v", type: "Picklist", picklist: "role__v" },
      { name: "status__v", type: "Picklist", picklist: "status__v" },
      { name: "created_date__v", type: "DateTime", editable: false },
      { name: "created_by__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        role__v: ["manager__v", "rep__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const TERRITORY_ID = to18("0MI000000000001");
const ROW_ID = to18("0MJ000000000001");
const UNKNOWN_USER = to18("005000000000077");

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "0MJ000000000001",
    UserId: SAMPLE_USER_ID,
    Territory2Id: TERRITORY_ID,
    "User.Username": "jdoe@acme.com",
    "Territory2.Name": "US East",
    RoleInTerritory2: "Manager",
    IsActive: "true",
    CreatedDate: "2022-03-04T05:06:07.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: { overrides?: Record<string, unknown>; knownTerritory?: boolean } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    user_territory,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      territory:
        opts.knownTerritory === false ? {} : { [TERRITORY_ID]: "V0T1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: user_territory.custom,
    }),
  };
}

describe("user_territory module", () => {
  it("is structurally valid (UserTerritory2Association and legacy UserTerritory variants)", () => {
    for (const m of [user_territory, user_territoryLegacy])
      expect(
        validateObjectModule(m).filter((i) => i.severity === "blocking"),
        m.source,
      ).toEqual([]);
  });

  it("encodes the §6.3.4 / §6.2 / §3.3 / §3.5 / §4.4 catalogue facts", () => {
    expect(user_territory.source).toBe("UserTerritory2Association");
    expect(user_territory.target).toBe("user_territory__v");
    expect(user_territory.targetEvidence).toBe("OBS");
    expect(user_territory.scope).toEqual({ kind: "full" });
    expect(user_territory.countryOf).toEqual([{ kind: "global" }]);
    expect(user_territory.dependsOn).toEqual(["user", "territory"]);
    expect(user_territory.createPolicy).toBe("create");
    expect(user_territory.deletePolicy).toBe("delete");
    expect(user_territory.inactivate).toEqual([]);
    expect(user_territory.load.noTriggers).toBe(false);
    expect(user_territory.selfRefs).toEqual([]);
    // §3.5: required business user field → never silently fall back
    expect(user_territory.optionDefaults).toMatchObject({
      unmappedUserPolicy: "fail",
    });
    // §3.3: id map → legacy id → (user__v, territory__v) pair
    expect(user_territory.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
    ]);
    expect(user_territory.match[1].keys).toEqual([
      { target: "user__v", source: "UserId" },
      { target: "territory__v", source: "Territory2Id" },
    ]);
    expect([...USER_TERRITORY_EXTRA_COLUMNS]).toEqual([
      "User.Username",
      "Territory2.Name",
    ]);
    expect([...USER_TERRITORY_LEGACY_EXTRA_COLUMNS]).toEqual([
      "User.Username",
      "Territory.Name",
    ]);
  });

  it("maps every §6.3.4 row with the spec's transforms, requirement and evidence", () => {
    const byTarget = new Map(user_territory.fields.map((f) => [f.target, f]));
    expect(byTarget.get("legacy_crm_id__v")).toMatchObject({
      source: "Id",
      required: "K",
      evidence: "UNV",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("user__v")).toMatchObject({
      source: "UserId",
      required: "Y",
      evidence: "OBS",
      transform: { kind: "refUser" },
    });
    expect(byTarget.get("territory__v")).toMatchObject({
      source: "Territory2Id",
      required: "Y",
      evidence: "OBS",
      transform: { kind: "ref", objectKey: "territory" },
    });
    expect(byTarget.get("name__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      transform: { kind: "custom", fnName: "userTerritoryName" },
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      required: "n",
      evidence: "OBS",
      transform: {
        kind: "compositeExternalId",
        template: "{u}__{t}",
        parts: {
          u: { user: "UserId" },
          t: { ref: "territory", source: "Territory2Id" },
        },
      },
    });
    // [UNV] targets stay in the mapping with optionalSource so preflight can drop them
    expect(byTarget.get("role__v")).toMatchObject({
      source: "RoleInTerritory2",
      evidence: "UNV",
      optionalSource: true,
      transform: { kind: "picklist", mapKey: "user_territory.role" },
    });
    expect(byTarget.get("status__v")).toMatchObject({
      source: "IsActive",
      evidence: "UNV",
      optionalSource: true,
      disabledBy: "statusFromFlag",
      transform: { kind: "custom", fnName: "userTerritoryStatus" },
    });
    // association object: no Name column, no owner, no Veeva stamps, no plain external id copy
    for (const t of ["ownerid__v", "mobile_id__v", "lock__v", "unlock__v"])
      expect(byTarget.has(t), t).toBe(false);
    expect(
      user_territory.fields.filter(
        (f) => f.target === "name__v" || f.target === "external_id__v",
      ),
    ).toHaveLength(2);
  });

  it("transforms a realistic association row", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: ROW_ID,
      user__v: { $user: SAMPLE_USER_ID },
      territory__v: { $fk: { object: "territory", sfdcId: TERRITORY_ID } },
      name__v: "jdoe@acme.com:US East",
      external_id__v: {
        $composite: {
          template: "{u}__{t}",
          parts: {
            u: { $user: SAMPLE_USER_ID },
            t: { $fk: { object: "territory", sfdcId: TERRITORY_ID } },
          },
        },
      },
      role__v: "manager__v",
      created_date__v: "2022-03-04T05:06:07.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
    });
    // active association → status__v omitted (Vault defaults active__v)
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "territory__v",
      targetObjectKey: "territory",
      targetSfdcId: TERRITORY_ID,
    });
    expect(r.fkEdges).toContainEqual({
      field: "user__v",
      targetObjectKey: "user",
      targetSfdcId: SAMPLE_USER_ID,
    });
  });

  it("derives status__v = inactive__v for inactive associations and honours the country name template", () => {
    const config = makeConfig();
    const mapping = materialise(
      user_territory,
      resolveCountry(config, "US"),
      config,
      { now: NOW },
    );
    const r = applyMapping(sampleRow({ IsActive: "false" }), mapping, {
      country: buildCountryContext({
        nameTemplates: { userTerritory: "{territory} / {username}" },
      }),
      metadata: metadata(),
      ids: buildIdResolver(
        { territory: { [TERRITORY_ID]: "V0T1" } },
        { [SAMPLE_USER_ID]: 101 },
      ),
      runMode: "init",
      custom: user_territory.custom,
    });
    expect(r.status).toBe("ok");
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.name__v).toBe("US East / jdoe@acme.com");
  });

  it("reports an unresolved required territory as pending_fk with the deferred reference kept", () => {
    const { result: r } = run(sampleRow(), { knownTerritory: false });
    expect(r.status).toBe("pending_fk");
    expect(r.failure).toBeUndefined();
    expect(r.payload.territory__v).toEqual({
      $fk: { object: "territory", sfdcId: TERRITORY_ID },
    });
    expect(r.unresolvedRequiredFks).toEqual([
      { field: "territory__v", objectKey: "territory", sfdcId: TERRITORY_ID },
    ]);
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        field: "territory__v",
        code: "UNRESOLVED_FK",
      }),
    );
  });

  it("fails rows whose user is unmapped (default unmappedUserPolicy = fail) unless overridden", () => {
    const failed = run(sampleRow({ UserId: UNKNOWN_USER }));
    expect(failed.result.status).toBe("failed");
    expect(failed.result.failure).toMatchObject({
      code: "UNMAPPED_USER",
      field: "user__v",
    });
    const skipped = run(sampleRow({ UserId: UNKNOWN_USER }), {
      overrides: { unmappedUserPolicy: "skipRow" },
    });
    expect(skipped.result.status).toBe("skipped");
    // skip reasons are canonicalised (`rule`); the code stays on the diagnostic
    expect(skipped.result.skipReason).toBe("rule");
    expect(skipped.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "skipped",
        code: "UNMAPPED_USER_SKIP",
        fatal: true,
      }),
    );
  });

  it("fails the row (never silently drops the required name__v) when a relationship column is missing", () => {
    const empty = run(sampleRow({ "Territory2.Name": "" }));
    expect(empty.result.status).toBe("failed");
    expect(empty.result.failure).toMatchObject({
      code: "USER_TERRITORY_NAME_INCOMPLETE",
      field: "name__v",
    });
    expect(empty.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "required_missing",
        code: "USER_TERRITORY_NAME_INCOMPLETE",
        field: "name__v",
        fatal: true,
      }),
    );
    // column not selected at all → the detail points at extraColumns
    const { "Territory2.Name": _dropped, ...withoutColumn } = sampleRow();
    const absent = run(withoutColumn as SourceRow);
    expect(absent.result.status).toBe("failed");
    expect(absent.result.failure?.message).toContain("extraColumns");
    // operator made name__v optional → loaded without it, non-fatal diagnostic
    const optional = run(sampleRow({ "Territory2.Name": "" }), {
      overrides: { required: { name__v: false } },
    });
    expect(optional.result.status).toBe("ok");
    expect(optional.result.payload.name__v).toBeUndefined();
    expect(optional.result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        code: "USER_TERRITORY_NAME_INCOMPLETE",
        field: "name__v",
      }),
    );
  });

  it("declares the territory Name relationship column so the column builder selects it", () => {
    const config = makeConfig();
    const mapping = materialise(
      user_territory,
      resolveCountry(config, "US"),
      config,
      { now: NOW },
    );
    expect(mapping.options.extraColumns).toEqual([
      ...USER_TERRITORY_EXTRA_COLUMNS,
    ]);
    expect(extraColumnsOf(mapping)).toEqual([
      "User.Username",
      "Territory2.Name",
    ]);
    const describe = buildDescribe("UserTerritory2Association", [
      {
        name: "UserId",
        type: "reference",
        referenceTo: ["User"],
        relationshipName: "User",
      },
      {
        name: "Territory2Id",
        type: "reference",
        referenceTo: ["Territory2"],
        relationshipName: "Territory2",
      },
      { name: "RoleInTerritory2", type: "picklist" },
      { name: "IsActive", type: "boolean" },
    ]);
    const { columns } = buildColumnList(
      mapping,
      { describe, columns: [] },
      { extra: extraColumnsOf(mapping) },
    );
    expect(columns).toContain("User.Username");
    expect(columns).toContain("Territory2.Name");
    // the row's own `source` alone would not bring the territory name along
    const bare = buildColumnList(mapping, { describe, columns: [] });
    expect(bare.columns).toContain("User.Username");
    expect(bare.columns).not.toContain("Territory2.Name");
    // legacy variant declares the legacy relationship column
    expect(user_territoryLegacy.optionDefaults?.extraColumns).toEqual([
      "User.Username",
      "Territory.Name",
    ]);
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const config = makeConfig();
    const mapping = materialise(
      user_territory,
      resolveCountry(config, "US"),
      config,
      { now: NOW },
    );
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });

  it("legacy UserTerritory variant swaps the territory column and drops the role row", () => {
    expect(user_territoryLegacy.key).toBe("user_territory");
    expect(user_territoryLegacy.source).toBe("UserTerritory");
    expect(user_territoryLegacy.target).toBe("user_territory__v");
    const byTarget = new Map(
      user_territoryLegacy.fields.map((f) => [f.target, f]),
    );
    expect(byTarget.get("territory__v")!.source).toBe("TerritoryId");
    expect(byTarget.get("user__v")!.source).toBe("UserId");
    expect(byTarget.get("status__v")!.source).toBe("IsActive");
    expect(byTarget.has("role__v")).toBe(false);
    expect(byTarget.get("external_id__v")!.transform).toMatchObject({
      kind: "compositeExternalId",
      parts: { t: { ref: "territory", source: "TerritoryId" } },
    });
    expect(user_territoryLegacy.match[1].keys).toEqual([
      { target: "user__v", source: "UserId" },
      { target: "territory__v", source: "TerritoryId" },
    ]);
    expect(user_territoryLegacy.optionDefaults).toMatchObject({
      unmappedUserPolicy: "fail",
    });
  });
});

describe("user_territory custom transforms", () => {
  it("renderUserTerritoryName reads the relationship columns of either variant", () => {
    expect(
      renderUserTerritoryName(
        "{username}:{territory}",
        row({
          "User.Username": "a@x",
          "Territory2.Name": "T1",
        }),
      ),
    ).toEqual({ name: "a@x:T1", username: "a@x", territory: "T1" });
    expect(
      renderUserTerritoryName(
        "{username}:{territory}",
        row({
          "User.Username": "a@x",
          "Territory.Name": "Legacy",
        }),
      ).name,
    ).toBe("a@x:Legacy");
  });

  it("userTerritoryName truncates to the target length and flags incomplete inputs", () => {
    const ctx = buildTransformContext({
      objectKey: "user_territory",
      field: { target: "name__v" },
      targetField: { name: "name__v", type: "string", maxLength: 8 },
    });
    const r = userTerritoryName(
      undefined,
      row({ "User.Username": "abc", "Territory2.Name": "defghijk" }),
      ctx,
    );
    expect(r).toMatchObject({
      value: "abc:defg",
      diagnostic: { kind: "truncated", field: "name__v" },
    });
    // optional target (`n` row, target not required): non-fatal
    expect(
      userTerritoryName(undefined, row({ "User.Username": "abc" }), ctx),
    ).toMatchObject({
      omit: true,
      diagnostic: { kind: "custom", code: "USER_TERRITORY_NAME_INCOMPLETE" },
    });
    // required target (`Y` row): fatal required_missing
    const requiredCtx = buildTransformContext({
      objectKey: "user_territory",
      field: { target: "name__v", required: "Y" },
    });
    expect(
      userTerritoryName(
        undefined,
        row({ "User.Username": "abc" }),
        requiredCtx,
      ),
    ).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "required_missing",
        code: "USER_TERRITORY_NAME_INCOMPLETE",
        fatal: true,
      },
    });
  });

  it("userTerritoryStatus only emits inactive__v", () => {
    const ctx = buildTransformContext({ objectKey: "user_territory" });
    expect(userTerritoryStatus("true", row({}), ctx)).toBeUndefined();
    expect(userTerritoryStatus(false, row({}), ctx)).toBe("inactive__v");
    expect(userTerritoryStatus("", row({}), ctx)).toBeUndefined();
  });
});
