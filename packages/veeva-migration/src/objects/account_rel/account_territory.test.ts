import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TERRITORY_NAME_SOURCE,
  ACCOUNT_TERRITORY_NAME_TEMPLATE,
  ACCOUNT_TERRITORY_SOURCE_FILTER,
  account_territory,
  accountTerritoryName,
  renderAccountTerritoryName,
} from "./account_territory";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildColumnList } from "../../extract/columns";
import { buildScopePredicate } from "../../extract/scope";
import {
  IDS,
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

const NOW = new Date("2026-09-07T00:00:00Z");
const ACCOUNT_ID = IDS.account1;
const TERRITORY_ID = to18("0MI000000000001");
const ROW_ID = to18("0MA000000000001");

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
    objects: { account_territory: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("account_territory__v", [
      // system-managed name: not required, synthesised when possible
      {
        name: "name__v",
        type: "String",
        max_length: 128,
        required: false,
        system_managed_name: true,
      },
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      {
        name: "territory__v",
        type: "Object",
        object: { name: "territory__v" },
        required: true,
      },
    ]),
    { picklists: { status__v: ["active__v", "inactive__v"] } },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ROW_ID,
    ObjectId: ACCOUNT_ID,
    Territory2Id: TERRITORY_ID,
    "Territory2.Name": "  Northeast ",
    AssociationCause: "Territory2Manual",
    SobjectType: "Account",
    CreatedDate: "2022-01-02T03:04:05.000Z",
    CreatedById: SAMPLE_USER_ID,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID,
    ...extra,
  };
}

function run(
  row: SourceRow,
  opts: {
    overrides?: Record<string, unknown>;
    territories?: Record<string, string>;
    nameTemplate?: string;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    account_territory,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: { [ACCOUNT_ID]: "V0A1" },
      territory: opts.territories ?? { [TERRITORY_ID]: "V0T1" },
    },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(
        opts.nameTemplate
          ? { nameTemplates: { accountTerritory: opts.nameTemplate } }
          : {},
      ),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account_territory.custom,
    }),
  };
}

describe("account_territory module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(account_territory).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.11 / §3.3 / §4.4 catalogue facts", () => {
    expect(account_territory.source).toBe("ObjectTerritory2Association");
    expect(account_territory.target).toBe("account_territory__v");
    expect(account_territory.targetEvidence).toBe("DOC");
    // optional, default disabled — Align owns alignment
    expect(account_territory.enabledByDefault).toBe(false);
    expect(account_territory.optionDefaults).toMatchObject({
      enabled: false,
      optional: true,
    });
    expect(account_territory.scope).toEqual({ kind: "full" });
    expect(account_territory.countryOf).toEqual([
      { kind: "account", field: "ObjectId" },
    ]);
    expect(account_territory.dependsOn).toEqual(["account", "territory"]);
    expect(account_territory.selfRefs).toEqual([]);
    expect(account_territory.deletePolicy).toBe("delete");
    expect(account_territory.inactivate).toEqual([]);
    expect(account_territory.createPolicy).toBe("create");
    expect(account_territory.load.noTriggers).toBe(false);
    expect(account_territory.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
    ]);
    expect(account_territory.match[1].keys?.map((k) => k.target)).toEqual([
      "account__v",
      "territory__v",
    ]);
    expect(ACCOUNT_TERRITORY_SOURCE_FILTER).toBe("SobjectType = 'Account'");
    expect(ACCOUNT_TERRITORY_NAME_SOURCE).toBe("Territory2.Name");
    expect(account_territory.notes).not.toContain("STUB");
  });

  it("carries the §6.3.11 rows and the association Block S opt-outs", () => {
    const byTarget = new Map(
      account_territory.fields.map((f) => [f.target, f]),
    );
    expect(account_territory.fields[0]).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    expect(byTarget.get("account__v")).toMatchObject({
      source: "ObjectId",
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "DOC",
    });
    expect(byTarget.get("territory__v")).toMatchObject({
      source: "Territory2Id",
      transform: { kind: "ref", objectKey: "territory" },
      required: "Y",
      evidence: "DOC",
    });
    // the name row's source is the relationship column itself, so it is selected
    expect(byTarget.get("name__v")).toMatchObject({
      source: "Territory2.Name",
      transform: { kind: "custom", fnName: "accountTerritoryName" },
      required: "y?",
      evidence: "UNV",
    });
    const cause = account_territory.fields.find(
      (f) => f.source === "AssociationCause",
    );
    expect(cause?.transform).toEqual({ kind: "skip" });
    expect(cause?.required).toBe("-");
    // association object: no Name column, no OwnerId, no Veeva stamps, no external id
    for (const absent of [
      "ownerid__v",
      "mobile_id__v",
      "last_device__v",
      "mobile_created_datetime__v",
      "lock__v",
      "unlock__v",
      "external_id__v",
      "local_currency__sys",
      "object_type__v.api_name__v",
    ])
      expect(byTarget.has(absent), absent).toBe(false);
    // audit columns exist on the association object
    for (const present of [
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
    ])
      expect(byTarget.has(present), present).toBe(true);
  });

  it("is disabled unless objects.account_territory.enabled = true", () => {
    expect(run(sampleRow()).mapping.options.enabled).toBe(false);
    expect(
      run(sampleRow(), { overrides: { enabled: true } }).mapping.options
        .enabled,
    ).toBe(true);
  });

  it("transforms an association row with a synthesised name", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toEqual({
      legacy_crm_id__v: ROW_ID,
      account__v: { $fk: { object: "account", sfdcId: ACCOUNT_ID } },
      territory__v: { $fk: { object: "territory", sfdcId: TERRITORY_ID } },
      name__v: `Northeast:${ACCOUNT_ID}`,
      created_date__v: "2022-01-02T03:04:05.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // business FKs plus the audit user references (all deferred, §2.3)
    expect(result.fkEdges).toEqual([
      {
        field: "created_by__v",
        targetObjectKey: "user",
        targetSfdcId: SAMPLE_USER_ID,
      },
      {
        field: "modified_by__v",
        targetObjectKey: "user",
        targetSfdcId: SAMPLE_USER_ID,
      },
      {
        field: "account__v",
        targetObjectKey: "account",
        targetSfdcId: ACCOUNT_ID,
      },
      {
        field: "territory__v",
        targetObjectKey: "territory",
        targetSfdcId: TERRITORY_ID,
      },
    ]);
  });

  it("honours nameTemplates.accountTerritory", () => {
    const { result } = run(sampleRow(), {
      nameTemplate: "{account}/{territory}",
    });
    expect(result.payload.name__v).toBe(`${ACCOUNT_ID}/Northeast`);
  });

  it("selects Territory2.Name as a mapped relationship column", () => {
    const { mapping } = run(sampleRow());
    const describe = buildDescribe(
      "ObjectTerritory2Association",
      [
        {
          name: "ObjectId",
          type: "reference",
          referenceTo: ["Account"],
          relationshipName: "Object",
        },
        {
          name: "Territory2Id",
          type: "reference",
          referenceTo: ["Territory2"],
          relationshipName: "Territory2",
        },
        { name: "AssociationCause", type: "picklist" },
        { name: "SobjectType", type: "picklist" },
      ],
      { systemFields: { name: false, owner: false } },
    );
    const { columns } = buildColumnList(mapping, { describe, columns: [] });
    expect(columns).toContain("Territory2.Name");
    expect(columns).toContain("ObjectId");
    expect(columns).toContain("Territory2Id");
    // a describe without the Territory2 relationship (legacy TM org) drops it
    const legacy = buildDescribe(
      "ObjectTerritory2Association",
      [
        { name: "ObjectId", type: "reference", referenceTo: ["Account"] },
        {
          name: "Territory2Id",
          type: "reference",
          referenceTo: ["Territory2"],
        },
      ],
      { systemFields: { name: false, owner: false } },
    );
    const dropped = buildColumnList(mapping, { describe: legacy, columns: [] });
    expect(dropped.columns).not.toContain("Territory2.Name");
    expect(dropped.dropped).toContain("Territory2.Name");
  });

  it("omits name__v (non-fatal) when Territory2.Name is empty", () => {
    const { result } = run(sampleRow({ "Territory2.Name": "" }));
    expect(result.status).toBe("ok");
    expect(result.payload.name__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "custom",
        code: "ACCOUNT_TERRITORY_NAME_INCOMPLETE",
        detail: "Territory2.Name missing",
      }),
    );
  });

  it("reports an unresolved territory as pending_fk", () => {
    const { result } = run(sampleRow(), { territories: {} });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "territory__v", objectKey: "territory", sfdcId: TERRITORY_ID },
    ]);
  });

  it("renderAccountTerritoryName / accountTerritoryName units", () => {
    expect(
      renderAccountTerritoryName(ACCOUNT_TERRITORY_NAME_TEMPLATE, {
        Id: ROW_ID,
        ObjectId: "001000000000001",
        "Territory2.Name": "West",
      }),
    ).toEqual({
      name: `West:${to18("001000000000001")}`,
      territory: "West",
      account: to18("001000000000001"),
    });
    const ctx = buildTransformContext({
      objectKey: "account_territory",
      field: { source: "Territory2.Name", target: "name__v" },
      targetField: { maxLength: 10 },
    });
    expect(
      accountTerritoryName(
        "West",
        { Id: ROW_ID, ObjectId: ACCOUNT_ID, "Territory2.Name": "West" },
        ctx,
      ),
    ).toMatchObject({
      value: `West:${ACCOUNT_ID}`.slice(0, 10),
      diagnostic: { kind: "truncated" },
    });
    // the account always comes from ObjectId, the territory from the source value
    const wide = buildTransformContext({
      objectKey: "account_territory",
      field: { source: "Territory2.Name", target: "name__v" },
      targetField: { maxLength: 128 },
    });
    expect(
      accountTerritoryName("East", { Id: ROW_ID, ObjectId: ACCOUNT_ID }, wide),
    ).toBe(`East:${ACCOUNT_ID}`);
  });

  it("is full scope (no predicate)", () => {
    const { mapping } = run(sampleRow());
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "full",
    });
    expect(mapping.options.deletePolicy).toBe("delete");
  });
});
