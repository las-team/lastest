import { describe, expect, it } from "vitest";
import {
  TSF_ACCOUNT_FIELD,
  TSF_ACCOUNT_TYPE_COLUMN,
  TSF_OBJECT_TYPES,
  TSF_TERRITORY_FIELD,
  tsf,
  tsfObjectType,
  tsfTerritory,
} from "./tsf";
import { ACCOUNT_OBJECT_TYPES } from "../account/account";
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
const ACCOUNT_ID = IDS.account1;
const PREFERRED_ID = IDS.account2;
const ADDRESS_ID = to18("a0T000000000001");
const ROW_ID = to18("a0U000000000001");
const TERRITORY_NAME = "Northeast";

function makeConfig(
  overrides: Record<string, unknown> = {},
  objects: Record<string, Record<string, unknown>> = {},
) {
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
    objects: { ...objects, tsf: overrides },
    countries: { US: {} },
  });
}

function metadata(
  opts: { typed?: boolean; territoryAsText?: boolean } = { typed: true },
) {
  return resolveMetadata(
    buildVaultMetadata(
      "tsf__v",
      [
        {
          name: "account__v",
          type: "Object",
          object: { name: "account__v" },
          required: true,
        },
        opts.territoryAsText
          ? { name: "territory__v", type: "String", max_length: 80 }
          : {
              name: "territory__v",
              type: "Object",
              object: { name: "territory__v" },
              required: true,
            },
        {
          name: "external_id__v",
          type: "String",
          max_length: 255,
          unique: true,
        },
        { name: "address__v", type: "Object", object: { name: "address__v" } },
        {
          name: "preferred_account__v",
          type: "Object",
          object: { name: "account__v" },
        },
        { name: "my_target__v", type: "Boolean" },
        { name: "last_activity_date__v", type: "Date" },
        { name: "ytd_activity__v", type: "Number", scale: 0 },
        { name: "route__v", type: "Picklist", picklist: "route__v" },
        { name: "allowed_products__v", type: "LongText" },
      ],
      { objectTypes: opts.typed ? ["professional__v", "hospital__v"] : [] },
    ),
    {
      picklists: {
        route__v: ["north__v", "south__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ROW_ID,
    Name: "TSF-0001",
    [TSF_ACCOUNT_FIELD]: ACCOUNT_ID,
    [TSF_TERRITORY_FIELD]: ` ${TERRITORY_NAME} `,
    [TSF_ACCOUNT_TYPE_COLUMN]: "Professional_vod",
    External_Id_vod__c: `${ACCOUNT_ID.slice(0, 15)}__${TERRITORY_NAME}`,
    Address_vod__c: ADDRESS_ID,
    Preferred_Account_vod__c: PREFERRED_ID,
    My_Target_vod__c: "true",
    Last_Activity_Date_vod__c: "2025-03-04",
    YTD_Activity_vod__c: "12",
    Route_vod__c: "North_vod",
    Allowed_Products_vod__c: "Cholecap;Restolar",
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
    overrides?: Record<string, unknown>;
    /** Other objects' overlays (e.g. `objects.account.objectType`). */
    objects?: Record<string, Record<string, unknown>>;
    /** Layered `picklists.maps` seen by the country context. */
    picklists?: Record<string, Record<string, string | null>>;
    territories?: Record<string, string>;
    typed?: boolean;
    territoryAsText?: boolean;
  } = {},
) {
  const config = makeConfig(opts.overrides, opts.objects);
  const mapping = materialise(tsf, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const ids = buildIdResolver(
    {
      account: { [ACCOUNT_ID]: "V0A1", [PREFERRED_ID]: "V0A2" },
      address: { [ADDRESS_ID]: "V0D1" },
    },
    { [SAMPLE_USER_ID]: 101 },
    opts.territories ?? { [TERRITORY_NAME]: "V0T1" },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext({ picklists: opts.picklists }),
      metadata: metadata({
        typed: opts.typed ?? true,
        territoryAsText: opts.territoryAsText,
      }),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: tsf.custom,
    }),
  };
}

describe("tsf module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(tsf).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.12 / §3.3 / §4.4 catalogue facts", () => {
    expect(tsf.source).toBe("TSF_vod__c");
    expect(tsf.target).toBe("tsf__v");
    expect(tsf.targetEvidence).toBe("DOC");
    expect(tsf.scope).toEqual({ kind: "full" });
    expect(tsf.countryOf).toEqual([{ kind: "account" }]);
    // account_territory precedes tsf (§6.1 step 7): its upsert auto-creates tsf__v rows
    expect(tsf.dependsOn).toEqual([
      "account",
      "territory",
      "address",
      "account_territory",
    ]);
    expect(tsf.selfRefs).toEqual([]);
    expect(tsf.deletePolicy).toBe("inactivate");
    expect(tsf.inactivate).toEqual([]);
    expect(tsf.createPolicy).toBe("create");
    // YTD_Activity may be trigger-maintained → triggers on
    expect(tsf.load.noTriggers).toBe(false);
    expect(tsf.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
      "external_id",
    ]);
    // the matcher compares payload values (the territory id already resolved by
    // custom(tsfTerritory)) — no key transform is declared
    expect(tsf.match[1].keys).toEqual([
      { target: "account__v", source: "Account_vod__c" },
      { target: "territory__v", source: "Territory_vod__c" },
    ]);
    // object types mirror the account crosswalk (§6.3.12)
    expect(tsf.objectTypes).toEqual(ACCOUNT_OBJECT_TYPES);
    expect(TSF_OBJECT_TYPES.Professional_vod).toBe("professional__v");
    expect(tsf.optionDefaults?.rewriteCompositeExternalId).toBe(true);
    expect(tsf.notes).not.toContain("STUB");
  });

  it("carries every §6.3.12 row and the master-detail Block S opt-outs", () => {
    const byTarget = new Map(tsf.fields.map((f) => [f.target, f]));
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "DOC",
    });
    expect(byTarget.get("territory__v")).toMatchObject({
      source: "Territory_vod__c",
      transform: { kind: "custom", fnName: "tsfTerritory" },
      required: "Y",
      evidence: "DOC",
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_Id_vod__c",
      transform: { kind: "custom", fnName: "tsfExternalId" },
      evidence: "UNV",
    });
    expect(byTarget.get("address__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "address" },
      required: "n",
      evidence: "DOC",
    });
    expect(byTarget.get("preferred_account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      evidence: "DOC",
    });
    for (const [target, kind] of [
      ["my_target__v", "bool"],
      ["last_activity_date__v", "date"],
      ["ytd_activity__v", "number"],
      ["route__v", "picklist"],
      ["allowed_products__v", "longtext"],
    ])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind },
        required: "n",
        evidence: "UNV",
        countryConfigurable: true,
      });
    // the module's object-type row replaced the Block S RecordType row
    expect(byTarget.get("object_type__v.api_name__v")).toMatchObject({
      source: TSF_ACCOUNT_TYPE_COLUMN,
      transform: { kind: "custom", fnName: "tsfObjectType" },
      evidence: "DOC",
    });
    expect(
      tsf.fields.filter((f) => f.target === "object_type__v.api_name__v"),
    ).toHaveLength(1);
    // master-detail: no OwnerId; no currency
    expect(byTarget.has("ownerid__v")).toBe(false);
    expect(byTarget.has("local_currency__sys")).toBe(false);
    expect(byTarget.get("name__v")?.required).toBe("Y");
  });

  it("transforms a realistic row on a typed target", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("professional__v");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ROW_ID,
      name__v: "TSF-0001",
      account__v: { $fk: { object: "account", sfdcId: ACCOUNT_ID } },
      // territoryRef resolves the name to the territory id (the crosswalk exception, §6.0.3)
      territory__v: "V0T1",
      "object_type__v.api_name__v": "professional__v",
      external_id__v: {
        $composite: {
          template: "{a}__{t}",
          parts: {
            a: { $fk: { object: "account", sfdcId: ACCOUNT_ID } },
            t: ` ${TERRITORY_NAME} `,
          },
        },
      },
      address__v: { $fk: { object: "address", sfdcId: ADDRESS_ID } },
      preferred_account__v: {
        $fk: { object: "account", sfdcId: PREFERRED_ID },
      },
      my_target__v: true,
      last_activity_date__v: "2025-03-04",
      ytd_activity__v: 12,
      route__v: "north__v",
      allowed_products__v: "Cholecap;Restolar",
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(result.payload.ownerid__v).toBeUndefined();
    expect(
      result.fkEdges
        .filter((e) => e.targetObjectKey !== "user")
        .map((e) => e.field)
        .sort(),
    ).toEqual([
      "account__v",
      "address__v",
      "external_id__v",
      "preferred_account__v",
    ]);
  });

  it("fails a row whose territory name is unknown to the vault (UNRESOLVED_FK, §6.3.12/§3.5)", () => {
    const { result } = run(sampleRow(), { territories: {} });
    // territories are complete after step 1 and the pending queue is id-keyed:
    // the row fails now, with the name in the report, instead of parking
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "UNRESOLVED_FK",
      field: "territory__v",
    });
    expect(result.failure?.message).toContain(TERRITORY_NAME);
    expect(result.unresolvedRequiredFks).toEqual([]);
    expect(result.payload.territory__v).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "unresolved_fk",
        code: "UNRESOLVED_FK",
        objectKey: "territory",
        value: TERRITORY_NAME,
        fatal: true,
      }),
    );
  });

  it("sends the territory name as text when the target field is a String", () => {
    const { result } = run(sampleRow(), { territoryAsText: true });
    expect(result.status).toBe("ok");
    expect(result.payload.territory__v).toBe(TERRITORY_NAME);
  });

  it("fails a typed row whose account has no record type (TSF_ACCOUNT_TYPE_MISSING)", () => {
    const { result } = run(sampleRow({ [TSF_ACCOUNT_TYPE_COLUMN]: "" }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "TSF_ACCOUNT_TYPE_MISSING",
      field: "object_type__v.api_name__v",
    });
  });

  it("fails on an account object type unknown to the target (VT_OBJECT_TYPE_MISSING)", () => {
    const { result } = run(sampleRow({ [TSF_ACCOUNT_TYPE_COLUMN]: "MCO_vod" }));
    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("omits the object type on an untyped target", () => {
    const { result } = run(sampleRow(), { typed: false });
    expect(result.status).toBe("ok");
    expect(result.objectType).toBeUndefined();
    expect(result.payload["object_type__v.api_name__v"]).toBeUndefined();
    const { result: noType } = run(
      sampleRow({ [TSF_ACCOUNT_TYPE_COLUMN]: "" }),
      {
        typed: false,
      },
    );
    expect(noType.status).toBe("ok");
  });

  it("honours objects.tsf.objectType overrides through the crosswalk", () => {
    const { result } = run(sampleRow({ [TSF_ACCOUNT_TYPE_COLUMN]: "Clinic" }), {
      overrides: { objectType: { Clinic: "hospital__v" } },
    });
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("hospital__v");
  });

  it("mirrors the country's account.objectType picklist map when tsf.objectType has no entry", () => {
    const clinic = sampleRow({ [TSF_ACCOUNT_TYPE_COLUMN]: "Clinic" });
    // layered picklists.maps["account.objectType"] reaches tsf__v
    const { result } = run(clinic, {
      picklists: { "account.objectType": { Clinic: "hospital__v" } },
    });
    expect(result.status).toBe("ok");
    expect(result.objectType).toBe("hospital__v");
    // a null there (skip rows of that type) skips the tsf row too
    const { result: skipped } = run(clinic, {
      picklists: { "account.objectType": { Clinic: null } },
    });
    expect(skipped.status).toBe("skipped");
    expect(skipped.diagnostics).toContainEqual(
      expect.objectContaining({ code: "OBJECT_TYPE_SKIPPED", value: "Clinic" }),
    );
    // an explicit tsf entry wins over the account map
    const { result: own } = run(clinic, {
      overrides: { objectType: { Clinic: "professional__v" } },
      picklists: { "account.objectType": { Clinic: "hospital__v" } },
    });
    expect(own.objectType).toBe("professional__v");
    // the per-object objects.account.objectType overlay is NOT visible from
    // the tsf context — it has to be mirrored under objects.tsf.objectType
    const { result: accountOverlayOnly } = run(clinic, {
      objects: { account: { objectType: { Clinic: "hospital__v" } } },
    });
    expect(accountOverlayOnly.status).toBe("failed");
    expect(accountOverlayOnly.failure?.code).toBe("VT_OBJECT_TYPE_MISSING");
  });

  it("copies external_id__v verbatim when rewriteCompositeExternalId = false and omits an empty one", () => {
    const { result } = run(sampleRow(), {
      overrides: { rewriteCompositeExternalId: false },
    });
    expect(result.payload.external_id__v).toBe(
      `${ACCOUNT_ID.slice(0, 15)}__${TERRITORY_NAME}`,
    );
    const { result: empty } = run(sampleRow({ External_Id_vod__c: "" }));
    expect(empty.payload.external_id__v).toBeUndefined();
  });

  it("reports an unresolved required account as pending_fk", () => {
    const { result } = run(sampleRow({ [TSF_ACCOUNT_FIELD]: IDS.account3 }));
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account3 },
    ]);
  });

  it("tsfTerritory / tsfObjectType units", () => {
    const ctx = buildTransformContext({
      objectKey: "tsf",
      field: { source: TSF_TERRITORY_FIELD, target: "territory__v" },
      targetField: { type: "object", rawType: "Object" },
      ids: buildIdResolver({}, {}, { West: "V0T9" }),
    });
    expect(tsfTerritory("West", { Id: ROW_ID }, ctx)).toEqual({
      value: "V0T9",
    });
    expect(tsfTerritory("", { Id: ROW_ID }, ctx)).toBeUndefined();
    const unknown = tsfTerritory("Nowhere", { Id: ROW_ID }, ctx);
    expect(unknown).toMatchObject({
      omit: true,
      diagnostic: { code: "UNRESOLVED_FK", value: "Nowhere", fatal: true },
    });
    // never an `unresolved` marker: its sfdcId must be an 18-char id (CONTRACTS.md)
    expect(unknown).not.toHaveProperty("unresolved");
    const untyped = buildTransformContext({
      objectKey: "tsf",
      field: {
        source: TSF_ACCOUNT_TYPE_COLUMN,
        target: "object_type__v.api_name__v",
      },
    });
    expect(
      tsfObjectType("Professional_vod", { Id: ROW_ID }, untyped),
    ).toBeUndefined();
  });

  it("is full scope (no predicate) with the account country rule", () => {
    const { mapping } = run(sampleRow());
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "full",
    });
    expect(mapping.countryOf).toEqual([{ kind: "account" }]);
    expect(mapping.objectTypes).toEqual(ACCOUNT_OBJECT_TYPES);
  });
});
