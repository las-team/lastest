import { describe, expect, it } from "vitest";
import {
  AFFILIATION_FROM_FIELD,
  AFFILIATION_MIRROR_FIELD,
  AFFILIATION_SKIPPED_FORMULAS,
  AFFILIATION_SKIPPED_TRANSIENT,
  AFFILIATION_TO_FIELD,
  affiliation,
  contactTwinOf,
} from "./affiliation";
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
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");
const FROM_ID = IDS.account1;
const TO_ID = IDS.account2;
const ROW_ID = to18("a0A000000000001");
const MIRROR_ID = to18("a0A000000000002");
const CONTACT_ID = "003000000000001AAA";

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
    objects: { affiliation: overrides },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("affiliation__v", [
      {
        name: "from_account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      {
        name: "to_account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
      },
      {
        name: "child_affiliation__v",
        type: "Object",
        object: { name: "affiliation__v" },
      },
      { name: "external_id__v", type: "String", max_length: 255, unique: true },
      { name: "role__v", type: "Picklist", picklist: "role__v" },
      { name: "influence__v", type: "Picklist", picklist: "influence__v" },
      {
        name: "relationship_strength__v",
        type: "Picklist",
        picklist: "relationship_strength__v",
      },
      {
        name: "therapeutic_area__v",
        type: "Picklist",
        picklist: "therapeutic_area__v",
        multi_value: true,
      },
      { name: "parent__v", type: "Boolean" },
      { name: "comments__v", type: "LongText" },
      { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
    ]),
    {
      picklists: {
        role__v: ["colleague__v", "referral__v"],
        influence__v: ["high__v", "medium__v", "low__v"],
        relationship_strength__v: ["strong__v", "weak__v"],
        therapeutic_area__v: ["oncology__v", "cardiology__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: ROW_ID,
    Name: "AFF-0001",
    [AFFILIATION_FROM_FIELD]: FROM_ID,
    [AFFILIATION_TO_FIELD]: TO_ID,
    From_Contact_vod__c: "",
    To_Contact_vod__c: null,
    [AFFILIATION_MIRROR_FIELD]: MIRROR_ID,
    External_Id_vod__c: "EXT-AFF-1",
    Role_vod__c: "Colleague",
    Influence_vod__c: "High",
    Relationship_Strength_vod__c: "Strong",
    Therapeutic_Area_vod__c: "Oncology;Cardiology",
    Parent_vod__c: "true",
    Comments_vod__c: "  Works together on trials ",
    Disable_Trigger_vod__c: "true",
    destroy_vod__c: false,
    To_Account_Name_vod__c: "Dr Jones",
    OwnerId: SAMPLE_USER_ID,
    CreatedDate: "2020-05-06T07:08:09.000Z",
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
    accounts?: Record<string, string>;
    affiliations?: Record<string, string>;
  } = {},
) {
  const config = makeConfig(opts.overrides);
  const mapping = materialise(
    affiliation,
    resolveCountry(config, "US"),
    config,
    { now: NOW },
  );
  const ids = buildIdResolver(
    {
      account: opts.accounts ?? { [FROM_ID]: "V0A1", [TO_ID]: "V0A2" },
      affiliation: opts.affiliations ?? {},
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
      custom: affiliation.custom,
    }),
  };
}

describe("affiliation module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(affiliation).filter(
        (i) => i.severity === "blocking",
      ),
    ).toEqual([]);
  });

  it("encodes the §6.2 / §6.3.10 / §6.1 / §3.3 / §4.4 catalogue facts", () => {
    expect(affiliation.source).toBe("Affiliation_vod__c");
    expect(affiliation.target).toBe("affiliation__v");
    expect(affiliation.targetEvidence).toBe("DOC");
    expect(affiliation.scope).toEqual({ kind: "full" });
    expect(affiliation.countryOf).toEqual([
      { kind: "parent", key: "account", field: "From_Account_vod__c" },
    ]);
    expect(affiliation.dependsOn).toEqual(["account"]);
    // mirror rows: pass-2 patch (§6.1 step 6)
    expect(affiliation.selfRefs).toEqual([
      { target: "child_affiliation__v", source: "Child_affiliation_vod__c" },
    ]);
    expect(affiliation.deletePolicy).toBe("inactivate");
    expect(affiliation.inactivate).toEqual([]);
    expect(affiliation.createPolicy).toBe("create");
    expect(affiliation.load.noTriggers).toBe(false);
    expect(affiliation.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "external_id",
      "natural_key",
    ]);
    expect(affiliation.match[2].keys?.map((k) => k.target)).toEqual([
      "from_account__v",
      "to_account__v",
      "role__v",
    ]);
    expect(affiliation.notes).not.toContain("STUB");
  });

  it("carries every §6.3.10 row", () => {
    const byTarget = new Map(affiliation.fields.map((f) => [f.target, f]));
    expect(byTarget.get("from_account__v")).toMatchObject({
      source: "From_Account_vod__c",
      transform: { kind: "custom", fnName: "affiliationAccountRef" },
      required: "Y",
      evidence: "UNV",
    });
    expect(byTarget.get("to_account__v")).toMatchObject({
      source: "To_Account_vod__c",
      required: "Y",
    });
    expect(byTarget.get("child_affiliation__v")).toMatchObject({
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "affiliation" },
      },
      required: "n",
    });
    expect(byTarget.get("external_id__v")).toMatchObject({
      source: "External_Id_vod__c",
      transform: { kind: "copy" },
    });
    for (const [target, mapKey] of [
      ["role__v", "affiliation.role"],
      ["influence__v", "affiliation.influence"],
      ["relationship_strength__v", "affiliation.relationshipStrength"],
    ])
      expect(byTarget.get(target), target).toMatchObject({
        transform: { kind: "picklist", mapKey },
        countryConfigurable: true,
      });
    expect(byTarget.get("therapeutic_area__v")).toMatchObject({
      transform: {
        kind: "multipicklist",
        mapKey: "affiliation.therapeuticArea",
      },
    });
    expect(byTarget.get("parent__v")?.transform).toEqual({ kind: "bool" });
    expect(byTarget.get("comments__v")?.transform).toEqual({
      kind: "longtext",
    });
    for (const source of [
      "From_Contact_vod__c",
      "To_Contact_vod__c",
      ...AFFILIATION_SKIPPED_TRANSIENT,
      ...AFFILIATION_SKIPPED_FORMULAS,
    ]) {
      const row = affiliation.fields.find((f) => f.source === source);
      expect(row?.transform, source).toEqual({ kind: "skip" });
      expect(row?.required).toBe("-");
    }
    expect(Object.keys(affiliation.picklists)).toEqual([
      "affiliation.role",
      "affiliation.influence",
      "affiliation.relationshipStrength",
      "affiliation.therapeuticArea",
    ]);
    expect(new Set(affiliation.fields.map((f) => f.target)).size).toBe(
      affiliation.fields.length,
    );
  });

  it("transforms a realistic row, deferring the mirror link to pass 2", () => {
    const { result } = run(sampleRow());
    expect(result.status).toBe("ok");
    expect(result.payload).toMatchObject({
      legacy_crm_id__v: ROW_ID,
      name__v: "AFF-0001",
      from_account__v: { $fk: { object: "account", sfdcId: FROM_ID } },
      to_account__v: { $fk: { object: "account", sfdcId: TO_ID } },
      external_id__v: "EXT-AFF-1",
      role__v: "colleague__v",
      influence__v: "high__v",
      relationship_strength__v: "strong__v",
      therapeutic_area__v: "oncology__v,cardiology__v",
      parent__v: true,
      comments__v: "Works together on trials",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2020-05-06T07:08:09.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    // pass 2: mirror reference omitted now, patched later; unresolved optional → not blocking
    expect(result.payload.child_affiliation__v).toBeUndefined();
    expect(result.secondPass).toEqual({
      child_affiliation__v: {
        $fk: { object: "affiliation", sfdcId: MIRROR_ID },
      },
    });
    expect(result.unresolvedOptionalFks).toEqual([
      {
        field: "child_affiliation__v",
        objectKey: "affiliation",
        sfdcId: MIRROR_ID,
        secondPass: true,
      },
    ]);
    // transient / formula columns never loaded
    expect(result.payload.disable_trigger__v).toBeUndefined();
    expect(result.payload.destroy__v).toBeUndefined();
    expect(result.payload.to_account_name__v).toBeUndefined();
    expect(JSON.stringify(result.payload)).not.toContain("V0A");
  });

  it("skips (and counts) contact-only affiliations with CONTACT_REF_DROPPED", () => {
    const { result } = run(
      sampleRow({ [AFFILIATION_TO_FIELD]: "", To_Contact_vod__c: CONTACT_ID }),
    );
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("CONTACT_REF_DROPPED");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "skipped",
        field: "to_account__v",
        code: "CONTACT_REF_DROPPED",
        value: CONTACT_ID,
        fatal: true,
      }),
    );
    const { result: fromContact } = run(
      sampleRow({
        [AFFILIATION_FROM_FIELD]: null,
        From_Contact_vod__c: CONTACT_ID,
      }),
    );
    expect(fromContact.status).toBe("skipped");
    expect(fromContact.skipReason).toBe("CONTACT_REF_DROPPED");
  });

  it("fails a row with neither account nor contact on the to-side (REQUIRED_MISSING)", () => {
    const { result } = run(sampleRow({ [AFFILIATION_TO_FIELD]: "" }));
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "to_account__v",
    });
  });

  it("reports an unresolved required from-account as pending_fk", () => {
    const { result } = run(sampleRow(), { accounts: { [TO_ID]: "V0A2" } });
    expect(result.status).toBe("pending_fk");
    expect(result.unresolvedRequiredFks).toEqual([
      { field: "from_account__v", objectKey: "account", sfdcId: FROM_ID },
    ]);
    expect(result.payload.from_account__v).toEqual({
      $fk: { object: "account", sfdcId: FROM_ID },
    });
  });

  it("skips a row whose account lookup itself carries a Contact id (CONTACT_REF_DROPPED)", () => {
    const { result } = run(sampleRow({ [AFFILIATION_TO_FIELD]: CONTACT_ID }));
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("CONTACT_REF_DROPPED");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "skipped",
        field: "to_account__v",
        code: "CONTACT_REF_DROPPED",
        value: CONTACT_ID,
      }),
    );
  });

  it("contactTwinOf maps an account lookup to its contact twin", () => {
    expect(contactTwinOf("From_Account_vod__c")).toBe("From_Contact_vod__c");
    expect(contactTwinOf("To_Account_vod__c")).toBe("To_Contact_vod__c");
  });

  it("is full scope and keeps the self-ref out of the FK requirements", () => {
    const { mapping } = run(sampleRow());
    expect(mapping.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(mapping.scope, { now: NOW }).predicate).toBe(
      undefined,
    );
    expect(mapping.selfRefs).toEqual(affiliation.selfRefs);
    expect(mapping.dependsOn).toEqual(["account"]);
  });
});
