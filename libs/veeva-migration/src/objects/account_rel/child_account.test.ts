import { describe, expect, it } from "vitest";
import {
  CHILD_ACCOUNT_CHILD_FIELD,
  CHILD_ACCOUNT_PARENT_FIELD,
  CHILD_ACCOUNT_SKIPPED_SOURCES,
  child_account,
  childAccountExternalId,
} from "./child_account";
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
const PARENT_ID = IDS.account1;
const CHILD_ID = IDS.account2;
const ROW_ID = to18("a0H000000000001");

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
    objects: { child_account: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("child_account__v", [
      {
        name: "parent_account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      {
        name: "child_account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      { name: "external_id__v", type: "String", max_length: 40, unique: true },
      { name: "external_key__v", type: "String", max_length: 100 },
      {
        name: "hierarchy_type__v",
        type: "Picklist",
        picklist: "hierarchy_type__v",
      },
      { name: "network_primary__v", type: "Boolean" },
      { name: "copy_address__v", type: "Boolean" },
      {
        name: "customer_master_status__v",
        type: "Picklist",
        picklist: "customer_master_status__v",
      },
      { name: "location_identifier__v", type: "String", max_length: 100 },
      { name: "alternate_name__v", type: "String", max_length: 255 },
      { name: "best_times__v", type: "String", max_length: 255 },
      { name: "child_affiliation_count__v", type: "Number", scale: 0 },
      { name: "parent_affiliation_count__v", type: "Number", scale: 0 },
      { name: "mobile_id__v", type: "String", max_length: 100 },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        hierarchy_type__v: ["practice__v", "hospital_department__v"],
        customer_master_status__v: ["valid__v", "under_review__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ROW_ID,
    Name: "  Dr Smith @ Mercy Hospital ",
    [CHILD_ACCOUNT_PARENT_FIELD]: PARENT_ID,
    [CHILD_ACCOUNT_CHILD_FIELD]: CHILD_ID,
    External_ID_vod__c: `${PARENT_ID.slice(0, 15)}__${CHILD_ID.slice(0, 15)}`,
    External_Key_vod__c: "KEY-1",
    Mobile_ID_vod__c: "mob-1",
    Hierarchy_Type_vod__c: "Practice",
    Network_Primary_vod__c: "true",
    Copy_Address_vod__c: false,
    Customer_Master_Status_vod__c: "Valid_vod",
    Location_Identifier_vod__c: "LOC-9",
    Alternate_Name_vod__c: "Smith Clinic",
    Best_Times_vod__c: "Mon-Fri AM",
    Child_Affiliation_Count_vod__c: "3",
    Parent_Affiliation_Count_vod__c: 1,
    Child_Name_vod__c: "Dr Smith",
    Parent_Name_vod__c: "Mercy Hospital",
    Primary_vod__c: "true",
    zvod_Layout_vod__c: "x",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2021-02-03T04:05:06.000+0000",
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
    known?: Record<string, string>;
    countryPicklists?: Record<string, Record<string, string | null>>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    child_account,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    { account: opts.known ?? { [PARENT_ID]: "V0A1", [CHILD_ID]: "V0A2" } },
    { [SAMPLE_USER_ID]: 101 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext({ picklists: opts.countryPicklists }),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: child_account.custom,
    }),
  };
}

describe("child_account module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(child_account).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.9 / §3.3 / §4.4 catalogue facts", () => {
    expect(child_account.source).toBe("Child_Account_vod__c");
    expect(child_account.target).toBe("child_account__v");
    expect(child_account.targetEvidence).toBe("DOC");
    expect(child_account.enabledByDefault).toBe(true);
    expect(child_account.scope).toEqual({ kind: "full" });
    expect(child_account.countryOf).toEqual([
      { kind: "parent", key: "account", field: "Parent_Account_vod__c" },
    ]);
    expect(child_account.dependsOn).toEqual(["account"]);
    expect(child_account.selfRefs).toEqual([]);
    expect(child_account.deletePolicy).toBe("inactivate");
    expect(child_account.inactivate).toEqual([]);
    expect(child_account.createPolicy).toBe("create");
    expect(child_account.load.noTriggers).toBe(false);
    expect(child_account.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "natural_key",
      "external_id",
    ]);
    expect(child_account.match[1].keys?.map((k) => k.target)).toEqual([
      "parent_account__v",
      "child_account__v",
    ]);
    expect(child_account.optionDefaults?.rewriteCompositeExternalId).toBe(true);
    expect(child_account.notes).not.toContain("STUB");
  });

  it("carries every §6.3.9 row (Block S first, then the object rows)", () => {
    const byTarget = new Map(child_account.fields.map((f) => [f.target, f]));
    expect(child_account.fields[0]).toMatchObject({
      source: "Id",
      required: "K",
      transform: { kind: "legacyId" },
    });
    for (const target of [
      "parent_account__v",
      "child_account__v",
      "external_id__v",
      "external_key__v",
      "mobile_id__v",
      "hierarchy_type__v",
      "network_primary__v",
      "copy_address__v",
      "customer_master_status__v",
      "location_identifier__v",
      "alternate_name__v",
      "best_times__v",
      "child_affiliation_count__v",
      "parent_affiliation_count__v",
      "name__v",
      "ownerid__v",
      "created_by__v",
      "modified_date__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("parent_account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_ID_vod__c",
      transform: { kind: "custom", fnName: "childAccountExternalId" },
      required: "n",
      evidence: "UNV",
    });
    expect(byTarget.get("hierarchy_type__v")).toMatchObject({
      transform: { kind: "picklist", mapKey: "child_account.hierarchyType" },
      countryConfigurable: true,
    });
    expect(byTarget.get("name__v")).toMatchObject({
      required: "y?",
      disabledBy: "preserveName",
    });
    // every listed formula / roll-up is a skip row
    for (const source of CHILD_ACCOUNT_SKIPPED_SOURCES) {
      const row = child_account.fields.find((f) => f.source === source);
      expect(row?.transform, source).toEqual({ kind: "skip" });
      expect(row?.required).toBe("-");
    }
    // no Block S row was duplicated
    expect(new Set(child_account.fields.map((f) => f.target)).size).toBe(
      child_account.fields.length,
    );
    // no currency on this object
    expect(byTarget.has("local_currency__sys")).toBe(false);
  });

  it("transforms a realistic row", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ROW_ID,
      name__v: "Dr Smith @ Mercy Hospital",
      parent_account__v: { $fk: { object: "account", sfdcId: PARENT_ID } },
      child_account__v: { $fk: { object: "account", sfdcId: CHILD_ID } },
      external_id__v: {
        $composite: {
          template: "{p}__{c}",
          parts: {
            p: { $fk: { object: "account", sfdcId: PARENT_ID } },
            c: { $fk: { object: "account", sfdcId: CHILD_ID } },
          },
        },
      },
      external_key__v: "KEY-1",
      mobile_id__v: "mob-1",
      hierarchy_type__v: "practice__v",
      network_primary__v: true,
      copy_address__v: false,
      customer_master_status__v: "valid__v",
      location_identifier__v: "LOC-9",
      alternate_name__v: "Smith Clinic",
      best_times__v: "Mon-Fri AM",
      child_affiliation_count__v: 3,
      parent_affiliation_count__v: 1,
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-02-03T04:05:06.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_date__v: "2025-01-01T00:00:00.000Z",
      modified_by__v: { $user: SAMPLE_USER_ID },
      last_device__v: "data_load__v",
    });
    // formulas / zvod columns never reach the payload; no Vault id anywhere
    expect(result.payload.child_name__v).toBeUndefined();
    expect(result.payload.primary__v).toBeUndefined();
    expect(JSON.stringify(result.payload)).not.toContain("V0A");
    expect(result.secondPass).toEqual({});
    expect(result.fkEdges).toEqual(
      expect.arrayContaining([
        {
          field: "parent_account__v",
          targetObjectKey: "account",
          targetSfdcId: PARENT_ID,
        },
        {
          field: "child_account__v",
          targetObjectKey: "account",
          targetSfdcId: CHILD_ID,
        },
      ]),
    );
  });

  it("applies the layered picklist crosswalk before derivation", () => {
    const { result } = run(sampleRow(), {
      countryPicklists: {
        "child_account.hierarchyType": { Practice: "hospital_department__v" },
      },
    });
    expect(result.payload.hierarchy_type__v).toBe("hospital_department__v");
  });

  it("copies external_id__v verbatim when rewriteCompositeExternalId = false", () => {
    const { result } = run(sampleRow(), {
      overrides: { rewriteCompositeExternalId: false },
    });
    expect(result.status).toBe("ok");
    expect(result.payload.external_id__v).toBe(
      `${PARENT_ID.slice(0, 15)}__${CHILD_ID.slice(0, 15)}`,
    );
  });

  it("omits external_id__v when the source is empty (nothing to rewrite)", () => {
    const { result } = run(sampleRow({ External_ID_vod__c: "" }));
    expect(result.payload.external_id__v).toBeUndefined();
    const { result: verbatim } = run(sampleRow({ External_ID_vod__c: null }), {
      overrides: { rewriteCompositeExternalId: false },
    });
    expect(verbatim.payload.external_id__v).toBeUndefined();
  });

  it("reports an unresolved required parent as pending_fk with the deferred ref kept", () => {
    const { result } = run(sampleRow(), { known: { [PARENT_ID]: "V0A1" } });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "child_account__v", objectKey: "account", sfdcId: CHILD_ID },
    ]);
    expect(result.payload.child_account__v).toEqual({
      $fk: { object: "account", sfdcId: CHILD_ID },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ kind: "unresolved_fk", code: "UNRESOLVED_FK" }),
    );
  });

  it("drops name__v with objects.child_account.preserveName = false", () => {
    const { mapping, result } = run(sampleRow(), {
      overrides: { preserveName: false },
    });
    expect(mapping.fields.some((f) => f.target === "name__v")).toBe(false);
    expect(result.status).toBe("ok");
    expect(result.payload.name__v).toBeUndefined();
  });

  it("fails on an unmapped picklist value under the default error policy", () => {
    const { result } = run(sampleRow({ Hierarchy_Type_vod__c: "Nonsense" }));
    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("UNMAPPED_PICKLIST");
  });

  it("childAccountExternalId renders a literal when both parts are literal-free of refs", () => {
    // unit: the custom delegates to compositeExternalId — a missing part is a COMPOSITE_PART_MISSING omit
    const ctx = buildTransformContext({
      objectKey: "child_account",
      field: { source: "External_ID_vod__c", target: "external_id__v" },
    });
    const r = childAccountExternalId(
      "x__y",
      { Id: ROW_ID, [CHILD_ACCOUNT_PARENT_FIELD]: PARENT_ID },
      ctx,
    );
    expect(r).toMatchObject({
      omit: true,
      diagnostic: { code: "COMPOSITE_PART_MISSING", detail: "c" },
    });
  });

  it("is full scope (no predicate) and materialises the parent country rule", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope, { now: NOW })).toEqual({
      kind: "full",
    });
    expect(mapping.countryOf).toEqual(child_account.countryOf);
    expect(mapping.load.noTriggers).toBe(false);
    expect(mapping.options.deletePolicy).toBe("inactivate");
  });
});
