import { describe, expect, it } from "vitest";
import {
  SPEAKER_NAME_FROM_ACCOUNT_CODE,
  SPEAKER_NAME_SOURCES,
  baseNameTarget,
  em_speaker,
  isBlank,
  speakerNameFallback,
  speakerNamesFromAccount,
} from "./em_speaker";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { buildColumnList } from "../../extract/columns";
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
const SPEAKER_1 = to18("a0S000000000001");

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

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("em_speaker__v", [
      {
        name: "account__v",
        type: "Object",
        object: { name: "account__v" },
        required: true,
        relationship_type: "reference",
      },
      { name: "external_id__v", type: "String", max_length: 100, unique: true },
      { name: "first_name__v", type: "String", max_length: 80 },
      { name: "last_name__v", type: "String", max_length: 80 },
      { name: "address__v", type: "String", max_length: 255 },
      {
        name: "em_speaker_status__v",
        type: "Picklist",
        picklist: "em_speaker_status__v",
      },
      {
        name: "next_year_status__v",
        type: "Picklist",
        picklist: "next_year_status__v",
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
        em_speaker_status__v: ["nominated__v", "approved__v", "inactive__v"],
        next_year_status__v: ["nominated__v", "approved__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  { account: { [IDS.account1]: "V0A000000000001" } },
  { [SAMPLE_USER_ID]: 11 },
);

function row(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: SPEAKER_1,
    IsDeleted: false,
    Name: "Doe, Jane",
    Account_vod__c: IDS.account1,
    "Account_vod__r.FirstName": "Jane",
    "Account_vod__r.LastName": "Doe",
    External_ID_vod__c: "SPK-001",
    First_Name_vod__c: "Janet",
    Last_Name_vod__c: "Doe-Smith",
    Address_vod__c: "1 Main Street, Springfield",
    Status_vod__c: "Approved_vod",
    Next_Year_Status_vod__c: "Nominated_vod",
    Year_To_Date_Utilization_vod__c: "3",
    Mobile_ID_vod__c: "7d2c5f4e-s001",
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
  return materialise(em_speaker, resolveCountry(config, "US"), config, {
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
    custom: em_speaker.custom,
    ...overrides,
  };
}

describe("em_speaker module", () => {
  it("is structurally valid and encodes the §6.2 / §3.3 / §4.4 catalogue rows", () => {
    expect(
      validateObjectModule(em_speaker).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(em_speaker.source).toBe("EM_Speaker_vod__c");
    expect(em_speaker.target).toBe("em_speaker__v");
    expect(em_speaker.targetEvidence).toBe("OBS");
    expect(em_speaker.scope).toEqual({ kind: "full" });
    expect(em_speaker.countryOf).toEqual([{ kind: "account" }]);
    expect(em_speaker.dependsOn).toEqual(["account"]);
    expect(em_speaker.selfRefs).toEqual([]);
    expect(em_speaker.deletePolicy).toBe("inactivate");
    expect(em_speaker.inactivate).toEqual([]); // status__v = inactive__v implied
    expect(em_speaker.createPolicy).toBe("create");
    expect(em_speaker.load.noTriggers).toBe(false);
    expect(em_speaker.blockS.statusFromFlag).toBeUndefined();
    expect(em_speaker.match.map((m) => m.method)).toEqual([
      "external_id",
      "legacy_id",
      "natural_key",
    ]);
    expect(em_speaker.match[0].keys).toEqual([
      { target: "external_id__v", source: "External_ID_vod__c" },
    ]);
    expect(em_speaker.match[2].keys).toEqual([
      { target: "account__v", source: "Account_vod__c" },
    ]);
    expect(em_speaker.notes).not.toContain("STUB");
  });

  it("carries every §6.3.21 row with evidence, unverified sources and the account fallbacks", () => {
    const byTarget = new Map(em_speaker.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "account__v",
      "name__v",
      "external_id__v",
      "first_name__v",
      "last_name__v",
      "address__v",
      "first_name__v.account",
      "last_name__v.account",
      "em_speaker_status__v",
      "next_year_status__v",
      "year_to_date_utilization__v",
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "ownerid__v",
      "mobile_id__v",
    ])
      expect(byTarget.has(target), target).toBe(true);
    expect(byTarget.get("account__v")).toMatchObject({
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      evidence: "OBS",
    });
    expect(byTarget.get("name__v")).toMatchObject({
      required: "Y",
      evidence: "OBS",
      countryConfigurable: true,
      transform: { kind: "text", max: 128 },
    });
    expect(
      em_speaker.fields.filter((f) => f.target === "name__v"),
    ).toHaveLength(1);
    for (const target of [
      "first_name__v",
      "last_name__v",
      "address__v",
      "em_speaker_status__v",
      "next_year_status__v",
    ]) {
      expect(byTarget.get(target)?.unverifiedSource, target).toBe(true);
      expect(byTarget.get(target)?.required, target).toBe("n");
    }
    expect(byTarget.get("first_name__v")?.evidence).toBe("OBS");
    expect(byTarget.get("next_year_status__v")?.evidence).toBe("UNV");
    expect(byTarget.get("em_speaker_status__v")?.transform).toEqual({
      kind: "picklist",
      mapKey: "em_speaker.status",
    });
    expect(byTarget.get("first_name__v.account")).toMatchObject({
      source: "Account_vod__r.FirstName",
      transform: { kind: "custom", fnName: "speakerNamesFromAccount" },
      optionalSource: true,
    });
    expect(byTarget.get("last_name__v.account")?.source).toBe(
      "Account_vod__r.LastName",
    );
    expect(byTarget.get("year_to_date_utilization__v")).toMatchObject({
      transform: { kind: "skip" },
      required: "-",
    });
    expect(Object.keys(em_speaker.picklists)).toEqual([
      "em_speaker.status",
      "em_speaker.nextYearStatus",
    ]);
    for (const f of em_speaker.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
  });

  it("defaults externalIdOwnedBy to integration so external_id__v stays the match key (§3.2 step 4), overridable per object", () => {
    expect(mapping().options.externalIdOwnedBy).toBe("integration");
    const overridden = parseConfig({
      ...config,
      objects: { em_speaker: { externalIdOwnedBy: "migration" } },
    });
    expect(
      materialise(em_speaker, resolveCountry(overridden, "US"), overridden, {
        now: NOW,
      }).options.externalIdOwnedBy,
    ).toBe("migration");
  });

  it("is full scope and selects the account name columns through the verified relationship", () => {
    const m = mapping();
    expect(m.scope.spec).toEqual({ kind: "full" });
    expect(buildScopePredicate(m.scope).predicate).toBeUndefined();
    const describe = buildDescribe("EM_Speaker_vod__c", [
      { name: "Name", type: "string" },
      {
        name: "Account_vod__c",
        type: "reference",
        referenceTo: ["Account"],
        relationshipName: "Account_vod__r",
      },
      { name: "External_ID_vod__c", type: "string" },
      { name: "Status_vod__c", type: "picklist" },
    ]);
    const cols = buildColumnList(m, { describe, columns: [] });
    expect(cols.columns).toContain("Account_vod__r.FirstName");
    expect(cols.columns).toContain("Account_vod__r.LastName");
    expect(cols.columns).not.toContain("Year_To_Date_Utilization_vod__c");
    expect(cols.fkColumns).toContainEqual(
      expect.objectContaining({
        column: "Account_vod__c",
        targetObjectKey: "account",
      }),
    );
  });

  it("transforms a row: parent ref, own names win over the account, picklists, audit users, roll-up skipped", () => {
    const r = applyMapping(row(), mapping(), applyCtx());
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: SPEAKER_1,
      account__v: { $fk: { object: "account", sfdcId: IDS.account1 } },
      name__v: "Doe, Jane",
      external_id__v: "SPK-001",
      first_name__v: "Janet",
      last_name__v: "Doe-Smith",
      address__v: "1 Main Street, Springfield",
      em_speaker_status__v: "approved__v",
      next_year_status__v: "nominated__v",
      mobile_id__v: "7d2c5f4e-s001",
      ownerid__v: { $user: SAMPLE_USER_ID },
      created_date__v: "2021-05-04T10:11:12.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID },
    });
    expect(r.payload.year_to_date_utilization__v).toBeUndefined();
    expect(r.payload["first_name__v.account"]).toBeUndefined();
    expect(r.payload["last_name__v.account"]).toBeUndefined();
    expect(r.payload.status__v).toBeUndefined();
    expect(r.secondPass).toEqual({});
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.fkEdges).toContainEqual({
      field: "account__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account1,
    });
    expect(
      r.diagnostics.some((d) => d.code === SPEAKER_NAME_FROM_ACCOUNT_CODE),
    ).toBe(false);
  });

  it("falls back to the linked account's names when the speaker fields are empty or absent", () => {
    const empty = applyMapping(
      row({ First_Name_vod__c: "", Last_Name_vod__c: null }),
      mapping(),
      applyCtx(),
    );
    expect(empty.status).toBe("ok");
    expect(empty.payload.first_name__v).toBe("Jane");
    expect(empty.payload.last_name__v).toBe("Doe");
    expect(
      empty.diagnostics.filter(
        (d) => d.code === SPEAKER_NAME_FROM_ACCOUNT_CODE,
      ),
    ).toHaveLength(2);
    // whitespace-only own names (blank-padded CSV/bulk exports) count as empty:
    // the primary text row omits them, so the account still supplies the name
    const blank = applyMapping(
      row({ First_Name_vod__c: "   ", Last_Name_vod__c: "\t " }),
      mapping(),
      applyCtx(),
    );
    expect(blank.status).toBe("ok");
    expect(blank.payload.first_name__v).toBe("Jane");
    expect(blank.payload.last_name__v).toBe("Doe");
    expect(
      blank.diagnostics.filter(
        (d) => d.code === SPEAKER_NAME_FROM_ACCOUNT_CODE,
      ),
    ).toHaveLength(2);
    // columns absent from the org (preflight dropped the primary rows): same outcome
    const absent = row();
    delete absent.First_Name_vod__c;
    delete absent.Last_Name_vod__c;
    const fromAccount = applyMapping(absent, mapping(), applyCtx());
    expect(fromAccount.payload.first_name__v).toBe("Jane");
    expect(fromAccount.payload.last_name__v).toBe("Doe");
    // nothing on either side: omitted
    const none = applyMapping(
      row({
        First_Name_vod__c: "",
        Last_Name_vod__c: "",
        "Account_vod__r.FirstName": "",
        "Account_vod__r.LastName": null,
      }),
      mapping(),
      applyCtx(),
    );
    expect(none.status).toBe("ok");
    expect(none.payload.first_name__v).toBeUndefined();
    expect(none.payload.last_name__v).toBeUndefined();
  });

  it("reports an unresolved required account as pending_fk and keeps the deferred ref", () => {
    const r = applyMapping(
      row({ Account_vod__c: IDS.account4 }),
      mapping(),
      applyCtx(),
    );
    expect(r.status).toBe("pending_fk");
    expect(r.payload.account__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account4 },
    });
    expect(r.unresolvedRequiredFks).toEqual([
      { field: "account__v", objectKey: "account", sfdcId: IDS.account4 },
    ]);
    const missing = applyMapping(
      row({ Account_vod__c: "" }),
      mapping(),
      applyCtx(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "account__v",
    });
  });

  it("applies country/module picklist crosswalks and fails unmapped values under the error policy", () => {
    const overlay = applyMapping(
      row({ Status_vod__c: "Retired_vod" }),
      mapping(),
      applyCtx({
        country: buildCountryContext({
          picklists: { "em_speaker.status": { Retired_vod: "inactive__v" } },
        }),
      }),
    );
    expect(overlay.status).toBe("ok");
    expect(overlay.payload.em_speaker_status__v).toBe("inactive__v");
    const bad = applyMapping(
      row({ Status_vod__c: "Retired_vod" }),
      mapping(),
      applyCtx(),
    );
    expect(bad.status).toBe("failed");
    expect(bad.failure?.field).toBe("em_speaker_status__v");
    const erased = applyMapping(
      row(),
      mapping(),
      applyCtx({ country: buildCountryContext({ erased: [SPEAKER_1] }) }),
    );
    expect(erased.status).toBe("skipped");
  });
});

describe("em_speaker custom transforms", () => {
  const base = (): SourceRow => ({ Id: SPEAKER_1 });

  it("baseNameTarget / speakerNameFallback are pure readers", () => {
    expect(baseNameTarget("first_name__v.account")).toBe("first_name__v");
    expect(baseNameTarget("last_name__v")).toBe("last_name__v");
    expect(baseNameTarget("address__v")).toBeUndefined();
    expect(SPEAKER_NAME_SOURCES.first_name__v.own).toBe("First_Name_vod__c");
    expect(
      speakerNameFallback(
        { ...base(), "Account_vod__r.FirstName": "  Jane " },
        "first_name__v",
      ),
    ).toBe("Jane");
    expect(
      speakerNameFallback(
        {
          ...base(),
          First_Name_vod__c: "Janet",
          "Account_vod__r.FirstName": "Jane",
        },
        "first_name__v",
      ),
    ).toBeUndefined();
    expect(
      speakerNameFallback(
        { ...base(), "Account_vod__r.LastName": "   " },
        "last_name__v",
      ),
    ).toBeUndefined();
    // a whitespace-only own name does not suppress the fallback
    expect(
      speakerNameFallback(
        {
          ...base(),
          First_Name_vod__c: "   ",
          "Account_vod__r.FirstName": "Jane",
        },
        "first_name__v",
      ),
    ).toBe("Jane");
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank(" \t ")).toBe(true);
    expect(isBlank("x")).toBe(false);
    expect(isBlank(0)).toBe(false);
  });

  it("speakerNamesFromAccount emits into the base field with a non-fatal diagnostic, honouring the target length", () => {
    const ctx = buildTransformContext({
      field: {
        source: "Account_vod__r.LastName",
        target: "last_name__v.account",
      },
      metadata: {
        fields: {
          last_name__v: {
            name: "last_name__v",
            type: "string",
            rawType: "String",
            maxLength: 5,
            multiValue: false,
            required: false,
            unique: false,
            editable: true,
            active: true,
          },
        },
      },
    });
    const r = speakerNamesFromAccount(
      "Doe",
      { ...base(), "Account_vod__r.LastName": "Doe" },
      ctx,
    );
    expect(r).toMatchObject({
      value: "Doe",
      targetField: "last_name__v",
      diagnostic: { kind: "custom", code: SPEAKER_NAME_FROM_ACCOUNT_CODE },
    });
    const truncated = speakerNamesFromAccount(
      "Featherstonehaugh",
      { ...base(), "Account_vod__r.LastName": "Featherstonehaugh" },
      ctx,
    );
    expect(truncated).toMatchObject({
      value: "Feath",
      targetField: "last_name__v",
      diagnostic: { kind: "truncated" },
    });
    // primary present → the fallback row stays silent
    expect(
      speakerNamesFromAccount(
        "Doe",
        {
          ...base(),
          Last_Name_vod__c: "Smith",
          "Account_vod__r.LastName": "Doe",
        },
        ctx,
      ),
    ).toBeUndefined();
    // not a name row → no-op
    expect(
      speakerNamesFromAccount(
        "x",
        base(),
        buildTransformContext({
          field: { source: "Address_vod__c", target: "address__v" },
        }),
      ),
    ).toBeUndefined();
  });
});
