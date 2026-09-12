import { describe, expect, it } from "vitest";
import { runPreflight, DefaultPreflight } from "./index";
import type { PreflightInput } from "./types";
import { parseConfig } from "../config/schema";
import { OBJECT_OPTION_DEFAULTS } from "../config/resolve";
import {
  FakeSfdcClient,
  FakeVaultClient,
  IDS,
  MemoryStateStore,
  buildDescribe,
  buildMaterialisedMapping,
  buildVaultMetadata,
  sampleAccountDescribe,
  sampleCall2Describe,
  sampleCall2Rows,
  sampleCall2VaultMetadata,
} from "../testkit";
import { VaultApiError } from "../vault/types";
import { to18 } from "../transform/ids";
import {
  unitId,
  type Finding,
  type FieldMapping,
  type MaterialisedMapping,
  type SfdcObjectDescribe,
  type VaultObjectMetadata,
} from "../types";

const VAULT_DNS = "acme-crm.veevavault.com";

function makeConfig(extra: Record<string, unknown> = {}) {
  return parseConfig({
    version: 1,
    source: {
      loginUrl: "https://x.my.salesforce.com",
      auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" },
    },
    target: {
      vaultDns: VAULT_DNS,
      auth: { kind: "password", username: "u", password: "p" },
      migrationUserId: 12345,
    },
    countries: { US: {} },
    ...extra,
  });
}

const F = (
  f: Partial<FieldMapping> &
    Pick<FieldMapping, "source" | "target" | "transform">,
): FieldMapping => ({
  required: "n",
  ...f,
});

/** A call2 mapping covering Block S rows, references, picklists, object type, state, blob and two [UNV] rows. */
function call2Mapping(
  overrides: Partial<MaterialisedMapping> = {},
  fieldFilter: (f: FieldMapping) => boolean = () => true,
): MaterialisedMapping {
  const fields: FieldMapping[] = [
    F({
      source: "Id",
      target: "legacy_crm_id__v",
      transform: { kind: "legacyId" },
      required: "K",
      evidence: "UNV",
    }),
    F({
      source: "Name",
      target: "name__v",
      transform: { kind: "text", max: 128 },
      required: "Y",
    }),
    F({
      source: "CreatedDate",
      target: "created_date__v",
      transform: { kind: "datetime" },
    }),
    F({
      source: "CreatedById",
      target: "created_by__v",
      transform: { kind: "refUser" },
    }),
    F({
      source: "OwnerId",
      target: "ownerid__v",
      transform: { kind: "refUser" },
    }),
    F({
      source: "RecordType.DeveloperName",
      target: "object_type__v.api_name__v",
      transform: { kind: "objectType", mapKey: "call2.objectType" },
      required: "Y",
      optionalSource: true,
    }),
    F({
      source: "Status_vod__c",
      target: "call2_status__v",
      transform: { kind: "picklist", mapKey: "call2.status" },
    }),
    F({
      source: "Status_vod__c",
      target: "state__v",
      transform: { kind: "state", mapKey: "call2.state" },
    }),
    F({
      source: "Call_Date_vod__c",
      target: "call_date__v",
      transform: { kind: "date" },
      required: "Y",
    }),
    F({
      source: "Call_Datetime_vod__c",
      target: "call_datetime__v",
      transform: { kind: "datetime" },
    }),
    F({
      source: "Account_vod__c",
      target: "account__v",
      transform: { kind: "ref", objectKey: "account" },
      required: "Y",
      sourceType: "reference",
    }),
    F({
      source: "User_vod__c",
      target: "user__v",
      transform: { kind: "refUser" },
    }),
    F({
      source: "Parent_Call_vod__c",
      target: "parent_call__v",
      transform: {
        kind: "secondPass",
        inner: { kind: "ref", objectKey: "call2" },
      },
    }),
    F({
      source: "Territory_vod__c",
      target: "territory__v",
      transform: { kind: "text" },
    }),
    F({
      source: "Call_Type_vod__c",
      target: "call_type__v",
      transform: { kind: "picklist", mapKey: "call2.callType" },
    }),
    F({
      source: "Next_Call_Notes_vod__c",
      target: "next_call_notes__v",
      transform: { kind: "longtext" },
    }),
    F({
      source: "Signature_vod__c",
      target: "signature__v",
      transform: {
        kind: "deferredBlob",
        inner: { kind: "longtext" },
        blobName: "signature",
      },
      blobName: "signature",
    }),
    F({
      source: "Is_Parent_Call_vod__c",
      target: "is_parent_call__v",
      transform: { kind: "skip" },
      required: "-",
    }),
    F({
      source: "Mobile_ID_vod__c",
      target: "mobile_id__v",
      transform: { kind: "copy" },
    }),
    F({
      source: "Guessed_Source_vod__c",
      target: "guessed_source__v",
      transform: { kind: "text" },
      evidence: "UNV",
      unverifiedSource: true,
    }),
    F({
      source: "Call_Channel_vod__c",
      target: "channel_guess__v",
      transform: { kind: "picklist", mapKey: "call2.channel" },
      evidence: "UNV",
    }),
  ].filter(fieldFilter);
  return buildMaterialisedMapping({
    objectKey: "call2",
    country: "US",
    sourceObject: "Call2_vod__c",
    targetObject: "call2__v",
    fields,
    objectTypes: { CallReport_vod: "call_report__v" },
    states: {
      Submitted_vod: "submitted_state__v",
      Planned_vod: "planned_state__v",
      Saved_vod: "saved_state__v",
    },
    picklists: {
      "call2.status": {
        Submitted_vod: "submitted__v",
        Planned_vod: "planned__v",
        Saved_vod: "saved__v",
      },
      "call2.callType": { "Detail Only": "detail_only__v" },
    },
    scope: {
      spec: {
        kind: "dated",
        predicates: [{ field: "Call_Date_vod__c", type: "date" }],
      },
      historyMonths: 24,
      cutoffDate: "2024-09-07",
    },
    countryOf: [{ kind: "account" }, { kind: "user", field: "User_vod__c" }],
    dependsOn: ["account", "user"],
    selfRefs: [{ target: "parent_call__v", source: "Parent_Call_vod__c" }],
    load: { noTriggers: true, migrationMode: true, batchSize: 500 },
    options: { ...OBJECT_OPTION_DEFAULTS, blobs: { signature: "optional" } },
    mappingHash: "before-preflight",
    ...overrides,
  });
}

function countryDescribe(): SfdcObjectDescribe {
  return buildDescribe("Country_vod__c", [
    { name: "Alpha_2_Code_vod__c", type: "string", length: 2 },
    { name: "Country_Code_vod__c", type: "string", length: 3 },
  ]);
}

interface FixtureOptions {
  call2Describe?: SfdcObjectDescribe;
  call2Meta?: VaultObjectMetadata;
  configInput?: Record<string, unknown>;
  rows?: ReturnType<typeof sampleCall2Rows>;
  vaultSetup?: (v: FakeVaultClient) => void;
  sfdcSetup?: (s: FakeSfdcClient) => void;
}

function fixture(o: FixtureOptions = {}) {
  const sfdc = new FakeSfdcClient()
    .addDescribe(o.call2Describe ?? sampleCall2Describe())
    .addDescribe(sampleAccountDescribe())
    .addDescribe(countryDescribe())
    .addRows("Call2_vod__c", o.rows ?? sampleCall2Rows())
    .addRows("Country_vod__c", [
      { Id: IDS.countryUS, Name: "United States", Alpha_2_Code_vod__c: "US" },
      { Id: IDS.countryDE, Name: "Germany", Alpha_2_Code_vod__c: "DE" },
    ]);
  o.sfdcSetup?.(sfdc);
  const vault = new FakeVaultClient({ vaultDns: VAULT_DNS })
    .addObject(o.call2Meta ?? sampleCall2VaultMetadata())
    .addObject(
      buildVaultMetadata(
        "country__v",
        [
          {
            name: "abbreviation__v",
            type: "String",
            max_length: 2,
            unique: true,
          },
        ],
        { legacyIdField: null },
      ),
      [
        {
          id: "V0C000000000101",
          name__v: "United States",
          abbreviation__v: "US",
        },
        { id: "V0C000000000102", name__v: "Germany", abbreviation__v: "DE" },
      ],
    )
    .addPicklist("call2_status__v", ["submitted__v", "planned__v", "saved__v"])
    .addPicklist("call_type__v", ["detail_only__v"])
    .addPicklist("call_channel__v", ["face_to_face__v"])
    .addPicklist("attendee_type__v", ["person_account__v"])
    .addPicklist("status__v", ["active__v", "inactive__v"])
    .addLifecycle({
      name: "call2_lifecycle__v",
      states: [
        { name: "planned_state__v", initial: true },
        { name: "saved_state__v" },
        { name: "submitted_state__v" },
      ],
    });
  o.vaultSetup?.(vault);
  const store = new MemoryStateStore(VAULT_DNS);
  const config = makeConfig(o.configInput);
  return { sfdc, vault, store, config };
}

function inputFor(
  fx: ReturnType<typeof fixture>,
  mappings: MaterialisedMapping[],
  extra: Partial<PreflightInput> = {},
): PreflightInput {
  return {
    runId: "run-1",
    mode: "preflight",
    config: fx.config,
    units: mappings.map((m) => ({
      objectKey: m.objectKey,
      country: m.country,
    })),
    mappings: new Map(
      mappings.map(
        (m) =>
          [unitId({ objectKey: m.objectKey, country: m.country }), m] as const,
      ),
    ),
    sfdc: fx.sfdc,
    vaults: new Map([[VAULT_DNS, fx.vault]]),
    store: fx.store,
    flags: {},
    ...extra,
  };
}

const codes = (findings: Finding[], severity?: Finding["severity"]) =>
  findings
    .filter((f) => !severity || f.severity === severity)
    .map((f) => f.code);
const find = (
  findings: Finding[],
  code: string,
  pred: (f: Finding) => boolean = () => true,
) => findings.filter((f) => f.code === code && pred(f));

describe("runPreflight — happy path", () => {
  it("passes a well-formed unit, prunes [UNV] rows and resolves the target", async () => {
    const fx = fixture();
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 100,
    });

    expect(codes(r.findings, "blocking")).toEqual([]);
    expect(r.blocking).toBe(false);
    expect(r.blockedUnits).toEqual([]);
    expect(r.report.exitCode).toBe(0);

    // §3.2 legacy id
    const sel = find(r.findings, "LEGACY_ID_FIELD_SELECTED")[0];
    expect(sel).toMatchObject({
      severity: "info",
      objectKey: "call2",
      field: "legacy_crm_id__v",
    });
    expect((sel.detail as { step: number }).step).toBe(2);

    // [UNVERIFIED-SOURCE] describe miss → info, dropped; [UNV] target miss → warning, dropped
    expect(
      find(
        r.findings,
        "SF_FIELD_MISSING",
        (f) => f.field === "guessed_source__v",
      )[0]?.severity,
    ).toBe("info");
    expect(
      find(
        r.findings,
        "VT_FIELD_MISSING",
        (f) => f.field === "channel_guess__v",
      )[0]?.severity,
    ).toBe("warning");
    const pruned = r.mappings.get("call2:US")!;
    const targets = pruned.fields.map((f) => f.target);
    expect(targets).not.toContain("guessed_source__v");
    expect(targets).not.toContain("channel_guess__v");
    expect(targets).toContain("call_date__v");
    expect(pruned.legacyIdField).toBe("legacy_crm_id__v");
    expect(pruned.mappingHash).not.toBe("before-preflight");
    expect(pruned.mappingHash).toMatch(/^[0-9a-f]{64}$/);

    // resolved target for transform/load
    const rt = r.resolvedTargets.get("call2")!;
    expect(rt.targetObject).toBe("call2__v");
    expect(rt.legacyIdField).toBe("legacy_crm_id__v");
    expect(rt.metadata.legacyIdFormat).toBe("{id18}");
    expect(rt.metadata.allowTypes).toBe(true);
    expect(rt.metadata.objectTypes.call_report__v).toEqual({
      active: true,
      requiredFields: [],
    });
    expect(rt.metadata.lifecycle).toEqual({
      name: "call2_lifecycle__v",
      states: ["planned_state__v", "saved_state__v", "submitted_state__v"],
    });
    expect(rt.metadata.fields.call2_status__v.picklistValues).toEqual([
      "submitted__v",
      "planned__v",
      "saved__v",
    ]);
    expect(rt.picklists.call_type__v).toEqual(["detail_only__v"]);
    expect(rt.replicateable).toBe(true);
    expect(rt.describe?.name).toBe("Call2_vod__c");
    // effective column list = mapped ∩ describe + routing/scope/country columns
    expect(rt.columns).toEqual(
      expect.arrayContaining([
        "Id",
        "IsDeleted",
        "SystemModstamp",
        "Name",
        "Status_vod__c",
        "Call_Date_vod__c",
        "Account_vod__c",
        "Parent_Call_vod__c",
        "RecordType.DeveloperName",
        "Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c",
      ]),
    );
    expect(rt.columns).not.toContain("Guessed_Source_vod__c");
    expect(rt.columns).not.toContain("Is_Parent_Call_vod__c");

    // facts + crosswalk
    expect(r.source).toMatchObject({
      orgId: fx.sfdc.orgId,
      apiVersion: "67.0",
      multiCurrency: true,
      personAccounts: true,
      territory2: false,
    });
    expect(r.countries.get(VAULT_DNS)).toEqual([
      {
        iso2: "DE",
        sfdcId: IDS.countryDE,
        vaultId: "V0C000000000102",
        name: "Germany",
      },
      {
        iso2: "US",
        sfdcId: IDS.countryUS,
        vaultId: "V0C000000000101",
        name: "United States",
      },
    ]);
    expect(
      find(r.findings, "COUNTRY_KEY_FIELD_SELECTED")[0].detail,
    ).toMatchObject({ field: "abbreviation__v" });
    expect(codes(r.findings)).toContain("PROBE_SKIPPED");
    expect(codes(r.findings)).toContain("SF_MULTICURRENCY");

    // persisted + report
    expect((await fx.store.findings.list("run-1")).length).toBe(
      r.findings.length,
    );
    expect(r.report.markdown).toContain(
      "| call2 | call2__v | legacy_crm_id__v | `{id18}` |",
    );
    expect(r.report.json.blockedUnits).toEqual([]);
  });

  it("works through the Preflight interface", async () => {
    const fx = fixture();
    const r = await new DefaultPreflight({ sampleSize: 10 }).run(
      inputFor(fx, [call2Mapping()]),
    );
    expect(r.blocking).toBe(false);
    expect(r.resolvedTargets.has("call2")).toBe(true);
  });
});

describe("runPreflight — source checks", () => {
  it("blocks a missing required source field, drops an optional one", async () => {
    const d = sampleCall2Describe();
    d.fields = d.fields.filter(
      (f) => f.name !== "Call_Date_vod__c" && f.name !== "Territory_vod__c",
    );
    const fx = fixture({ call2Describe: d });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 10,
    });
    const missing = find(r.findings, "SF_FIELD_MISSING");
    expect(
      missing.some(
        (f) => f.severity === "blocking" && f.field === "call_date__v",
      ),
    ).toBe(true);
    expect(
      missing.some(
        (f) => f.severity === "warning" && f.field === "territory__v",
      ),
    ).toBe(true);
    expect(r.blockedUnits).toEqual([{ objectKey: "call2", country: "US" }]);
    expect(r.blocking).toBe(false);
    expect(r.report.exitCode).toBe(2);
    expect(
      r.mappings.get("call2:US")!.fields.map((f) => f.target),
    ).not.toContain("territory__v");
  });

  it("SF_OBJECT_MISSING blocks (warning when optional)", async () => {
    const fx = fixture();
    const m = call2Mapping({ sourceObject: "Nope_vod__c" });
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 0 });
    expect(find(r.findings, "SF_OBJECT_MISSING")[0].severity).toBe("blocking");
    const m2 = call2Mapping({
      sourceObject: "Nope_vod__c",
      options: { ...OBJECT_OPTION_DEFAULTS, optional: true },
    });
    const r2 = await runPreflight(inputFor(fixture(), [m2]), { sampleSize: 0 });
    expect(find(r2.findings, "SF_OBJECT_MISSING")[0].severity).toBe("warning");
  });

  it("SF_FIELD_TYPE_MISMATCH: blocking without a switch, info with an auto-switch; calculated fields are skipped", async () => {
    const fx = fixture();
    const m = call2Mapping({}, (f) => f.target !== "is_parent_call__v");
    m.fields.push(
      F({
        source: "Account_vod__c",
        target: "acct_text__v",
        transform: { kind: "text" },
        sourceType: "string",
      }),
      F({
        source: "Call_Datetime_vod__c",
        target: "call_date_2__v",
        transform: { kind: "date" },
        sourceType: "date",
      }),
      F({
        source: "Is_Parent_Call_vod__c",
        target: "unlock__v",
        transform: { kind: "bool" },
      }),
    );
    fx.vault.addObject(
      buildVaultMetadata(
        "call2__v",
        [
          ...sampleCall2VaultMetadata().fields.filter(
            (f) =>
              !/^(id|name__v|status__v|created_|modified_|legacy_crm_id__v|object_type__v|state__v)/.test(
                f.name,
              ),
          ),
          { name: "acct_text__v", type: "String" },
          { name: "call_date_2__v", type: "Date" },
        ],
        { objectTypes: ["call_report__v"], lifecycles: ["call2_lifecycle__v"] },
      ),
    );
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    const mm = find(r.findings, "SF_FIELD_TYPE_MISMATCH");
    expect(mm.find((f) => f.field === "acct_text__v")?.severity).toBe(
      "blocking",
    );
    expect(mm.find((f) => f.field === "call_date_2__v")?.severity).toBe("info");
    expect(
      r.mappings
        .get("call2:US")!
        .fields.find((f) => f.target === "call_date_2__v")?.transform,
    ).toEqual({ kind: "datetimeToDate" });
    expect(find(r.findings, "SF_FIELD_CALCULATED")[0]).toMatchObject({
      severity: "warning",
      field: "unlock__v",
    });
  });

  it("reports SF_AUTH_FAILED / SF_API_VERSION_MISSING / SF_QUOTA_LOW / SF_ORG_MISMATCH as global blocking", async () => {
    const fx = fixture();
    fx.sfdc.failNext = {
      method: "availableVersions",
      error: new Error("invalid_grant"),
      remaining: 1,
    };
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(r.blocking).toBe(true);
    expect(find(r.findings, "SF_AUTH_FAILED")[0].severity).toBe("blocking");
    expect(r.report.exitCode).toBe(2);

    const fx2 = fixture({
      configInput: {
        source: {
          loginUrl: "https://x.my.salesforce.com",
          apiVersion: "99.0",
          auth: {
            kind: "jwt",
            clientId: "c",
            username: "u",
            privateKeyPath: "k",
          },
        },
      },
    });
    const r2 = await runPreflight(inputFor(fx2, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r2.findings, "SF_API_VERSION_MISSING")[0].severity).toBe(
      "blocking",
    );

    const fx3 = fixture();
    (fx3.sfdc as unknown as { opts: { limits: unknown } }).opts.limits = {
      DailyApiRequests: { Max: 1000, Remaining: 10 },
    };
    await fx3.store.runs.create({
      runId: "old",
      mode: "init",
      countries: ["US"],
      startedAt: "2026-01-01T00:00:00Z",
      status: "succeeded",
      toolVersion: "0",
      configHash: "x",
      sourceOrgId: to18("00D000000000999"),
    });
    const r3 = await runPreflight(inputFor(fx3, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r3.findings, "SF_QUOTA_LOW")[0].severity).toBe("blocking");
    expect(find(r3.findings, "SF_ORG_MISMATCH")[0].severity).toBe("blocking");
    expect(r3.blocking).toBe(true);
  });

  it("SF_RECORD_TYPE_MISSING warns on unused crosswalk entries; SF_DATETIME_RANGE warns on sampled values", async () => {
    const rows = sampleCall2Rows();
    rows[0].Call_Datetime_vod__c = "1699-12-31T00:00:00.000Z";
    const fx = fixture({ rows });
    const m = call2Mapping({
      objectTypes: { CallReport_vod: "call_report__v", Ghost_vod: "ghost__v" },
    });
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    expect(find(r.findings, "SF_RECORD_TYPE_MISSING")[0]).toMatchObject({
      severity: "warning",
      field: "Ghost_vod",
    });
    expect(find(r.findings, "SF_DATETIME_RANGE")[0]).toMatchObject({
      severity: "warning",
      field: "call_datetime__v",
      count: 1,
    });
    // ghost__v is not a vault object type either
    expect(find(r.findings, "VT_OBJECT_TYPE_MISSING")[0]).toMatchObject({
      severity: "blocking",
      field: "ghost__v",
    });
  });
});

describe("runPreflight — target checks", () => {
  it("blocks a missing required target field and a wrong type", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields = meta.fields.filter((f) => f.name !== "call_date__v");
    meta.fields.find((f) => f.name === "call_datetime__v")!.type = "String";
    const fx = fixture({ call2Meta: meta });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 10,
    });
    expect(
      find(r.findings, "VT_FIELD_MISSING", (f) => f.field === "call_date__v")[0]
        .severity,
    ).toBe("blocking");
    expect(
      find(
        r.findings,
        "VT_TYPE_INCOMPATIBLE",
        (f) => f.field === "call_datetime__v",
      )[0],
    ).toMatchObject({
      severity: "blocking",
      objectKey: "call2",
      country: "US",
    });
    expect(r.blockedUnits).toEqual([{ objectKey: "call2", country: "US" }]);
  });

  it("VT_OBJECT_MISSING blocks; optional object only warns", async () => {
    const fx = fixture();
    const r = await runPreflight(
      inputFor(fx, [call2Mapping({ targetObject: "nope__v" })]),
      { sampleSize: 0 },
    );
    expect(find(r.findings, "VT_OBJECT_MISSING")[0].severity).toBe("blocking");
    const r2 = await runPreflight(
      inputFor(fixture(), [
        call2Mapping({
          targetObject: "nope__v",
          options: { ...OBJECT_OPTION_DEFAULTS, optional: true },
        }),
      ]),
      { sampleSize: 0 },
    );
    expect(find(r2.findings, "VT_OBJECT_MISSING")[0].severity).toBe("warning");
  });

  it("unique-less legacy_crm_id__v and integration-owned external_id__v → VT_LEGACY_ID_FIELD_MISSING; --allow-mdl creates legacy_crm_id__c", async () => {
    const build = () =>
      buildVaultMetadata(
        "call2__v",
        [
          ...sampleCall2VaultMetadata().fields.filter(
            (f) =>
              !/^(id|name__v|status__v|created_|modified_|legacy_crm_id__v|object_type__v|state__v)/.test(
                f.name,
              ),
          ),
          {
            name: "legacy_crm_id__v",
            type: "String",
            max_length: 18,
            unique: false,
          },
          {
            name: "external_id__v",
            type: "String",
            max_length: 120,
            unique: true,
          },
        ],
        {
          legacyIdField: null,
          objectTypes: ["call_report__v"],
          lifecycles: ["call2_lifecycle__v"],
        },
      );
    const m = call2Mapping({
      options: {
        ...OBJECT_OPTION_DEFAULTS,
        externalIdOwnedBy: "integration",
        blobs: {},
      },
    });
    const fx = fixture({ call2Meta: build() });
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 0 });
    const b = find(r.findings, "VT_LEGACY_ID_FIELD_MISSING")[0];
    expect(b).toMatchObject({ severity: "blocking", objectKey: "call2" });
    expect(
      (b.detail as { rejected: Array<{ field: string }> }).rejected.map(
        (x) => x.field,
      ),
    ).toEqual(["legacy_crm_id__v", "external_id__v", "legacy_crm_id__c"]);
    expect(r.resolvedTargets.get("call2")!.legacyIdField).toBeUndefined();
    expect(r.blockedUnits.length).toBe(1);

    const fx2 = fixture({ call2Meta: build() });
    const r2 = await runPreflight(
      inputFor(fx2, [m], { flags: { allowMdl: true } }),
      { sampleSize: 0 },
    );
    expect(codes(r2.findings, "blocking")).toEqual([]);
    expect(fx2.vault.calls.some((c) => c.method === "executeMdl")).toBe(true);
    expect(r2.resolvedTargets.get("call2")!.legacyIdField).toBe(
      "legacy_crm_id__c",
    );
    const pruned = r2.mappings.get("call2:US")!;
    expect(pruned.legacyIdField).toBe("legacy_crm_id__c");
    expect(pruned.fields.find((f) => f.required === "K")?.target).toBe(
      "legacy_crm_id__c",
    );
    // step-3 traceability row added for the non-unique legacy_crm_id__v
    expect(
      pruned.fields.find((f) => f.target === "legacy_crm_id__v"),
    ).toMatchObject({ source: "Id", transform: { kind: "copy" } });
  });

  it("external_id__v as legacy id (step 4) drops the copy row and uses the SF: prefix", async () => {
    const meta = buildVaultMetadata(
      "call2__v",
      [
        ...sampleCall2VaultMetadata().fields.filter(
          (f) =>
            !/^(id|name__v|status__v|created_|modified_|legacy_crm_id__v|object_type__v|state__v)/.test(
              f.name,
            ),
        ),
        {
          name: "external_id__v",
          type: "String",
          max_length: 120,
          unique: true,
        },
      ],
      {
        legacyIdField: null,
        objectTypes: ["call_report__v"],
        lifecycles: ["call2_lifecycle__v"],
      },
    );
    const fx = fixture({
      call2Meta: meta,
      call2Describe: (() => {
        const d = sampleCall2Describe();
        d.fields.push({
          ...d.fields.find((f) => f.name === "Mobile_ID_vod__c")!,
          name: "External_ID_vod__c",
        });
        return d;
      })(),
    });
    const m = call2Mapping();
    m.fields.push(
      F({
        source: "External_ID_vod__c",
        target: "external_id__v",
        transform: { kind: "copy" },
      }),
    );
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 0 });
    expect(codes(r.findings, "blocking")).toEqual([]);
    const rt = r.resolvedTargets.get("call2")!;
    expect(rt.legacyIdField).toBe("external_id__v");
    expect(rt.metadata.legacyIdFormat).toBe("SF:{orgId15}:{id18}");
    const rows = r.mappings
      .get("call2:US")!
      .fields.filter((f) => f.target === "external_id__v");
    expect(rows.length).toBe(1);
    expect(rows[0].transform.kind).toBe("legacyId");
  });

  it("VT_LEGACY_ID_FORMAT blocks when migrated values are 15-char", async () => {
    const fx = fixture({
      vaultSetup: (v) =>
        v.putRecord("call2__v", {
          legacy_crm_id__v: "a0K000000000009",
          name__v: "old",
        }),
    });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    const f = find(r.findings, "VT_LEGACY_ID_FORMAT")[0];
    expect(f.severity).toBe("blocking");
    expect((f.detail as { hint: string }).hint).toMatch(/\{id15\}/);
  });

  it("VT_FK_TARGET_MISMATCH blocks when the Object field points elsewhere; refUser must reference user__sys", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields.find((f) => f.name === "account__v")!.object = {
      name: "child_account__v",
    };
    meta.fields.find((f) => f.name === "user__v")!.object = {
      name: "account__v",
    };
    const fx = fixture({ call2Meta: meta });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 10,
    });
    const mm = find(r.findings, "VT_FK_TARGET_MISMATCH");
    expect(mm.find((f) => f.field === "account__v")).toMatchObject({
      severity: "blocking",
      objectKey: "call2",
      country: "US",
    });
    expect(mm.find((f) => f.field === "user__v")?.severity).toBe("blocking");
    expect(r.blockedUnits.length).toBe(1);
  });

  it("VT_FK_LOOKUP_NOT_UNIQUE switches refLookup to ref (info)", async () => {
    const fx = fixture({
      vaultSetup: (v) =>
        v.addObject(
          buildVaultMetadata("account__v", [
            { name: "external_id__v", type: "String", unique: false },
          ]),
        ),
    });
    const m = call2Mapping({}, (f) => f.target !== "account__v");
    m.fields.push(
      F({
        source: "Account_vod__c",
        target: "account__v",
        transform: {
          kind: "refLookup",
          objectKey: "account",
          lookupField: "external_id__v",
        },
        required: "Y",
      }),
    );
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    expect(find(r.findings, "VT_FK_LOOKUP_NOT_UNIQUE")[0].severity).toBe(
      "info",
    );
    expect(
      r.mappings.get("call2:US")!.fields.find((f) => f.target === "account__v")
        ?.transform,
    ).toEqual({ kind: "ref", objectKey: "account" });
  });

  it("VT_REQUIRED_UNMAPPED per object type and for base required fields (with country required overrides)", async () => {
    const fx = fixture({
      vaultSetup: (v) =>
        v.addObjectTypes("call2__v", [
          {
            name: "call_report__v",
            object: "call2__v",
            active: true,
            type_fields: [
              { name: "call_datetime__v", required: true },
              { name: "territory__v", required: true },
            ],
          },
        ]),
    });
    const m = call2Mapping(
      { required: { territory__v: false } },
      (f) => f.target !== "call_datetime__v" && f.target !== "territory__v",
    );
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    const req = find(r.findings, "VT_REQUIRED_UNMAPPED");
    expect(req.length).toBe(1);
    expect(req[0]).toMatchObject({
      severity: "blocking",
      field: "call_datetime__v",
      detail: { objectType: "call_report__v" },
    });
    expect(
      r.resolvedTargets.get("call2")!.metadata.objectTypes.call_report__v
        .requiredFields,
    ).toEqual(["call_datetime__v", "territory__v"]);

    // base required field without a row → blocking; required: true override on an unmapped optional field too
    const meta = sampleCall2VaultMetadata();
    meta.fields.find((f) => f.name === "territory__v")!.required = true;
    const fx2 = fixture({ call2Meta: meta });
    const m2 = call2Mapping(
      { required: { next_call_notes__v: true } },
      (f) => f.target !== "territory__v" && f.target !== "next_call_notes__v",
    );
    const r2 = await runPreflight(inputFor(fx2, [m2]), { sampleSize: 0 });
    expect(
      find(r2.findings, "VT_REQUIRED_UNMAPPED")
        .map((f) => f.field)
        .sort(),
    ).toEqual(["next_call_notes__v", "territory__v"]);
    // match-only objects skip required coverage
    const r3 = await runPreflight(
      inputFor(fixture({ call2Meta: sampleCall2VaultMetadata() }), [
        call2Mapping(
          {
            options: { ...OBJECT_OPTION_DEFAULTS, createPolicy: "match-only" },
          },
          (f) => f.target !== "name__v",
        ),
      ]),
      { sampleSize: 0 },
    );
    expect(find(r3.findings, "VT_REQUIRED_UNMAPPED")).toEqual([]);
  });

  it("VT_LIFECYCLE_STATE_MISSING and SF_RECORD_TYPE_UNMAPPED / VT_OBJECT_TYPE_MISSING", async () => {
    const d = sampleCall2Describe();
    d.recordTypeInfos.push({
      recordTypeId: "012000000000002AAA",
      developerName: "Sample_Only_vod",
      name: "Sample Only",
      active: true,
      available: true,
      master: false,
    });
    d.recordTypeInfos.push({
      recordTypeId: "012000000000003AAA",
      developerName: "Mechanical_vod",
      name: "Mechanical",
      active: true,
      available: true,
      master: false,
    });
    const rows = sampleCall2Rows();
    rows[0].Status_vod__c = "Cancelled_vod";
    const fx = fixture({
      call2Describe: d,
      rows,
      vaultSetup: (v) =>
        v.addObject({
          ...sampleCall2VaultMetadata(),
          object_types: [
            { name: "call_report__v", status: ["active__v"] },
            { name: "mechanical__v", status: ["active__v"] },
          ],
        }),
    });
    const m = call2Mapping({
      states: {
        Submitted_vod: "submitted_state__v",
        Planned_vod: "nope_state__v",
      },
    });
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    const st = find(r.findings, "VT_LIFECYCLE_STATE_MISSING");
    expect(
      st.some((f) => f.field === "nope_state__v" && f.severity === "blocking"),
    ).toBe(true);
    expect(
      st.some(
        (f) =>
          f.field === "Cancelled_vod" &&
          f.severity === "blocking" &&
          f.count === 1,
      ),
    ).toBe(true);
    const rt = find(r.findings, "SF_RECORD_TYPE_UNMAPPED");
    expect(rt.find((f) => f.field === "Sample_Only_vod")?.severity).toBe(
      "blocking",
    );
    expect(rt.find((f) => f.field === "Mechanical_vod")?.severity).toBe("info");
  });

  it("VT_PICKLIST_VALUE_MISSING follows the onUnmapped policy and occurrence in data", async () => {
    const d = sampleCall2Describe();
    d.fields
      .find((f) => f.name === "Call_Type_vod__c")!
      .picklistValues.push(
        { value: "Group Detail", active: true },
        { value: "Retired Type", active: false },
      );
    const rows = sampleCall2Rows();
    rows[0].Call_Type_vod__c = "Group Detail";
    const m = call2Mapping({
      picklists: {
        "call2.status": {
          Submitted_vod: "submitted__v",
          Planned_vod: "planned__v",
          Saved_vod: "saved__v",
        },
        "call2.callType": {
          "Detail Only": "detail_only__v",
          "Retired Type": "typo__v",
        },
      },
    });

    // policy error (default): observed derived value → blocking, unobserved explicit-but-wrong → warning
    const r1 = await runPreflight(
      inputFor(fixture({ call2Describe: d, rows }), [m]),
      { sampleSize: 10 },
    );
    const p1 = find(r1.findings, "VT_PICKLIST_VALUE_MISSING");
    const group = p1.find(
      (f) => (f.detail as { target: string }).target === "group_detail__v",
    );
    expect(group).toMatchObject({
      severity: "blocking",
      field: "call_type__v",
      count: 1,
    });
    expect((group!.detail as { sources: string[] }).sources).toEqual([
      "Group Detail",
    ]);
    expect(
      p1.find((f) => (f.detail as { target: string }).target === "typo__v"),
    ).toMatchObject({ severity: "warning", count: 0 });

    // policy skip → info
    const r2 = await runPreflight(
      inputFor(
        fixture({
          call2Describe: d,
          rows,
          configInput: { picklists: { onUnmapped: "skip" } },
        }),
        [m],
      ),
      { sampleSize: 10 },
    );
    expect(
      find(r2.findings, "VT_PICKLIST_VALUE_MISSING").find(
        (f) => (f.detail as { target: string }).target === "group_detail__v",
      )?.severity,
    ).toBe("info");

    // policy createValue → warning
    const r3 = await runPreflight(
      inputFor(
        fixture({
          call2Describe: d,
          rows,
          configInput: { picklists: { onUnmapped: "createValue" } },
        }),
        [m],
      ),
      { sampleSize: 10 },
    );
    expect(
      find(r3.findings, "VT_PICKLIST_VALUE_MISSING").find(
        (f) => (f.detail as { target: string }).target === "group_detail__v",
      )?.severity,
    ).toBe("warning");

    // --allow-picklist-create creates the value and carries the created name in the crosswalk
    const fx4 = fixture({ call2Describe: d, rows });
    const r4 = await runPreflight(
      inputFor(fx4, [m], { flags: { allowPicklistCreate: true } }),
      { sampleSize: 10 },
    );
    expect(find(r4.findings, "VT_PICKLIST_VALUE_MISSING")).toEqual([]);
    expect(find(r4.findings, "VT_PICKLIST_VALUE_CREATED").length).toBe(2);
    expect(
      r4.mappings.get("call2:US")!.picklists["call2.callType"]["Group Detail"],
    ).toBe("group_detail__c");
    expect(
      (await fx4.vault.picklistValues("call_type__v")).map((v) => v.name),
    ).toContain("group_detail__c");

    // derive = none → unmappable values
    const r5 = await runPreflight(
      inputFor(
        fixture({
          call2Describe: d,
          rows,
          configInput: { picklists: { derive: "none" } },
        }),
        [m],
      ),
      { sampleSize: 10 },
    );
    const none = find(r5.findings, "VT_PICKLIST_VALUE_MISSING").find(
      (f) => typeof f.detail === "object" && "note" in f.detail,
    );
    expect(none?.severity).toBe("blocking");
  });

  it("VT_PICKLIST_MULTIVALUE blocks arity mismatches", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields.find((f) => f.name === "call_type__v")!.multi_value = true;
    const r = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [call2Mapping()]),
      { sampleSize: 0 },
    );
    expect(find(r.findings, "VT_PICKLIST_MULTIVALUE")[0]).toMatchObject({
      severity: "blocking",
      field: "call_type__v",
    });
  });

  it("VT_LENGTH follows the truncation policy; VT_FIELD_READONLY / VT_FIELD_INACTIVE degrade", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields.find((f) => f.name === "territory__v")!.max_length = 4;
    meta.fields.find((f) => f.name === "next_call_notes__v")!.editable = false;
    meta.fields.find((f) => f.name === "call_datetime__v")!.status = [
      "inactive__v",
    ];
    const fx = fixture({ call2Meta: meta });
    const m = call2Mapping();
    m.fields.find((f) => f.target === "territory__v")!.truncation = "fail";
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    expect(find(r.findings, "VT_LENGTH")[0]).toMatchObject({
      severity: "blocking",
      field: "territory__v",
      count: 1,
    });
    expect(find(r.findings, "VT_FIELD_READONLY")[0]).toMatchObject({
      severity: "warning",
      field: "next_call_notes__v",
    });
    expect(find(r.findings, "VT_FIELD_INACTIVE")[0]).toMatchObject({
      severity: "warning",
      field: "call_datetime__v",
    });
    const targets = r.mappings.get("call2:US")!.fields.map((f) => f.target);
    expect(targets).not.toContain("next_call_notes__v");
    expect(targets).not.toContain("call_datetime__v");
    const r2 = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [call2Mapping()]),
      { sampleSize: 10 },
    );
    expect(find(r2.findings, "VT_LENGTH")[0].severity).toBe("warning");
  });

  it("VT_USER_UNMAPPED: info while the user map is empty, warning/blocking per unmappedUserPolicy", async () => {
    const fx = fixture();
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 10,
    });
    expect(find(r.findings, "VT_USER_UNMAPPED")[0].severity).toBe("info");

    fx.store.seedIdMap("user", "user__sys", { "005000000000002AAA": "222" });
    const r2 = await runPreflight(
      inputFor(fx, [call2Mapping()], { runId: "run-2" }),
      { sampleSize: 10 },
    );
    expect(find(r2.findings, "VT_USER_UNMAPPED")[0]).toMatchObject({
      severity: "warning",
      count: 1,
    });
    const r3 = await runPreflight(
      inputFor(
        fx,
        [
          call2Mapping({
            options: { ...OBJECT_OPTION_DEFAULTS, unmappedUserPolicy: "fail" },
          }),
        ],
        { runId: "run-3" },
      ),
      { sampleSize: 10 },
    );
    expect(find(r3.findings, "VT_USER_UNMAPPED")[0].severity).toBe("blocking");
  });

  it("VT_COUNTRY_UNMATCHED blocks every unit of the country; VT_TRIGGER_RISK warns; VT_ATTACHMENTS_DISABLED downgrades", async () => {
    const fx = fixture();
    const m = call2Mapping({
      country: "FR",
      load: { noTriggers: false, migrationMode: true },
      options: {
        ...OBJECT_OPTION_DEFAULTS,
        blobs: { signature: "attachment" },
      },
    });
    fx.config.countries.FR = fx.config.countries.US;
    const r = await runPreflight(inputFor(fx, [m]), { sampleSize: 10 });
    const cu = find(r.findings, "VT_COUNTRY_UNMATCHED");
    expect(cu.length).toBe(2);
    expect(cu[0]).toMatchObject({ severity: "blocking", country: "FR" });
    expect(cu[0].objectKey).toBeUndefined();
    expect(r.blockedUnits).toEqual([{ objectKey: "call2", country: "FR" }]);
    expect(r.blocking).toBe(false);
    expect(find(r.findings, "VT_TRIGGER_RISK")[0].severity).toBe("warning");
    expect(find(r.findings, "VT_ATTACHMENTS_DISABLED")[0].severity).toBe(
      "warning",
    );
    expect(r.mappings.get("call2:FR")!.options.blobs.signature).toBe("skip");
  });

  it("MAP_HASH_CHANGED is info, blocking in final-delta unless accepted", async () => {
    const fx = fixture();
    await fx.store.mappingSnapshots.put({
      mappingHash: "old-hash",
      objectKey: "call2",
      country: "US",
      materialised: call2Mapping(),
      createdAt: "2026-01-01T00:00:00Z",
    });
    const r = await runPreflight(
      inputFor(fx, [call2Mapping()], { mode: "delta" }),
      { sampleSize: 0 },
    );
    expect(find(r.findings, "MAP_HASH_CHANGED")[0].severity).toBe("info");
    const r2 = await runPreflight(
      inputFor(fx, [call2Mapping()], { mode: "final-delta", runId: "run-2" }),
      { sampleSize: 0 },
    );
    expect(find(r2.findings, "MAP_HASH_CHANGED")[0].severity).toBe("blocking");
    const r3 = await runPreflight(
      inputFor(fx, [call2Mapping()], {
        mode: "final-delta",
        runId: "run-3",
        flags: { acceptMappingChange: true },
      }),
      { sampleSize: 0 },
    );
    expect(find(r3.findings, "MAP_HASH_CHANGED")[0].severity).toBe("info");
  });

  it("VT_AUTH_FAILED / VT_WRONG_VAULT / VT_API_VERSION_MISSING / VT_MIGRATION_USER_MISMATCH", async () => {
    const fx = fixture();
    fx.vault.failNext = {
      method: "authenticate",
      error: new VaultApiError("AUTH_FAILED", "bad password", "FAILURE"),
      remaining: 1,
    };
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(r.blocking).toBe(true);
    expect(find(r.findings, "VT_AUTH_FAILED")[0].severity).toBe("blocking");
    expect(r.resolvedTargets.get("call2")!.metadata.fields).toEqual({});

    const fx2 = fixture({
      configInput: {
        target: {
          vaultDns: "other.veevavault.com",
          apiVersion: "v99.1",
          auth: { kind: "password", username: "u", password: "p" },
          migrationUserId: 1,
        },
      },
    });
    const r2 = await runPreflight(
      inputFor(fx2, [call2Mapping()], {
        vaults: new Map([["other.veevavault.com", fx2.vault]]),
      }),
      { sampleSize: 0 },
    );
    expect(codes(r2.findings, "blocking")).toEqual(
      expect.arrayContaining(["VT_WRONG_VAULT", "VT_API_VERSION_MISSING"]),
    );
    expect(find(r2.findings, "VT_MIGRATION_USER_MISMATCH")[0].severity).toBe(
      "warning",
    );
    expect(r2.blocking).toBe(true);
  });

  it("MAP_FK_PARENT_NOT_IN_PLAN omits the field from the pruned mapping", async () => {
    const fx = fixture({
      configInput: {
        objects: { account: { enabled: false } },
        countries: { US: {} },
      },
    });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r.findings, "MAP_FK_PARENT_NOT_IN_PLAN")[0]).toMatchObject({
      severity: "warning",
      field: "account__v",
    });
    expect(
      r.mappings.get("call2:US")!.fields.map((f) => f.target),
    ).not.toContain("account__v");
  });
});

describe("runPreflight — probes (§5.3)", () => {
  const probeMeta = () =>
    buildVaultMetadata(
      "migration_probe__c",
      [
        {
          name: "legacy_crm_id__c",
          type: "String",
          max_length: 40,
          unique: true,
        },
        { name: "amount__c", type: "Currency" },
        { name: "note__c", type: "String" },
      ],
      { legacyIdField: null },
    );

  it("runs, records and cleans up probes on the probe object", async () => {
    const fx = fixture({
      configInput: {
        preflight: { probeWrites: true, probeObject: "migration_probe__c" },
      },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(codes(r.findings, "blocking")).toEqual([]);
    const probes = find(r.findings, "PROBE_RESULT").map(
      (f) => f.detail as Record<string, unknown>,
    );
    expect(probes.find((p) => p.probe === "migrationMode")).toMatchObject({
      result: "accepted",
    });
    expect(probes.find((p) => p.probe === "createdByForm")).toMatchObject({
      result: "numeric",
    });
    expect(probes.find((p) => p.probe === "deleteByIdParam")).toMatchObject({
      result: "unsupported_by_client",
    });
    expect(probes.find((p) => p.probe === "nullClearsField")).toMatchObject({
      result: "clears",
    });
    expect(probes.find((p) => p.probe === "rollupRecalc")).toMatchObject({
      object: "call2__v",
      result: "absent",
    });
    expect(codes(r.findings)).toContain("PROBE_SKIPPED"); // probe 15 has no currency value
    expect(fx.vault.records("migration_probe__c")).toEqual([]);
    expect(
      (await fx.store.probeResults.get("migrationMode"))?.result,
    ).toMatchObject({ result: "accepted", apiVersion: "v26.2" });

    // second run reuses the cache
    const r2 = await runPreflight(
      inputFor(fx, [call2Mapping()], { runId: "run-2" }),
      { sampleSize: 0 },
    );
    expect(
      find(r2.findings, "PROBE_RESULT").some(
        (f) => (f.detail as { cached?: boolean }).cached,
      ),
    ).toBe(true);
    expect(
      fx.vault.calls.filter(
        (c) => c.method === "upsert" && c.args[0] === "migration_probe__c",
      ).length,
    ).toBe(3);
  });

  it("VT_PROBE_OBJECT_MISSING blocks the probe step with the MDL snippet; VT_MIGRATION_PERMISSION on a rejected create; dry-run skips", async () => {
    const fx = fixture({ configInput: { preflight: { probeWrites: true } } });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    const f = find(r.findings, "VT_PROBE_OBJECT_MISSING")[0];
    expect(f.severity).toBe("blocking");
    expect((f.detail as { mdl: string }).mdl).toContain(
      "CREATE Object migration_probe__c",
    );
    expect(r.report.markdown).toContain("CREATE Object migration_probe__c");

    const fx2 = fixture({
      configInput: {
        preflight: { probeWrites: true, probeObject: "migration_probe__c" },
      },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    fx2.vault.rowFailures.push({
      object: "migration_probe__c",
      field: "legacy_crm_id__c",
      value: "PROBE:run-1:1",
      type: "INSUFFICIENT_ACCESS",
      message: "Record Migration permission missing",
    });
    const r2 = await runPreflight(inputFor(fx2, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r2.findings, "VT_MIGRATION_PERMISSION")[0].severity).toBe(
      "blocking",
    );
    expect(r2.blocking).toBe(true);

    const fx3 = fixture({
      configInput: {
        preflight: { probeWrites: true, probeObject: "migration_probe__c" },
      },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    const r3 = await runPreflight(
      inputFor(fx3, [call2Mapping()], { flags: { dryRun: true } }),
      { sampleSize: 0 },
    );
    expect(find(r3.findings, "PROBE_SKIPPED")[0].detail).toMatch(/dry-run/);
    expect(fx3.vault.calls.some((c) => c.method === "upsert")).toBe(false);
  });
});

describe("runPreflight — review fixes", () => {
  const probeMeta = () =>
    buildVaultMetadata(
      "migration_probe__c",
      [
        {
          name: "legacy_crm_id__c",
          type: "String",
          max_length: 40,
          unique: true,
        },
        { name: "amount__c", type: "Currency" },
        { name: "note__c", type: "String" },
      ],
      { legacyIdField: null },
    );

  it("unions the SELECT list across the countries of one object", async () => {
    const fx = fixture();
    fx.config.countries.DE = fx.config.countries.US;
    const us = call2Mapping();
    const de = call2Mapping({ country: "DE" });
    // a per-country fieldLayers add that only DE maps
    de.fields.push(
      F({
        source: "Unlock_vod__c",
        target: "unlock__v",
        transform: { kind: "bool" },
      }),
    );
    const r = await runPreflight(inputFor(fx, [us, de]), { sampleSize: 0 });
    const rt = r.resolvedTargets.get("call2")!;
    expect(rt.columns).toContain("Unlock_vod__c");
    expect(rt.columns.filter((c) => c === "Id").length).toBe(1);
    expect(
      r.mappings.get("call2:US")!.fields.map((f) => f.target),
    ).not.toContain("unlock__v");
  });

  it("blob rows: attachment keeps the row without a target field; required blocks; attachments disabled + required row blocks", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields = meta.fields.filter((f) => f.name !== "signature__v");
    meta.allow_attachments = true;
    const attach = call2Mapping({
      options: {
        ...OBJECT_OPTION_DEFAULTS,
        blobs: { signature: "attachment" },
      },
    });
    const r = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [attach]),
      {
        sampleSize: 10,
      },
    );
    expect(
      find(r.findings, "VT_FIELD_MISSING", (f) => f.field === "signature__v"),
    ).toEqual([]);
    expect(codes(r.findings, "blocking")).toEqual([]);
    expect(r.mappings.get("call2:US")!.fields.map((f) => f.target)).toContain(
      "signature__v",
    );
    expect(r.mappings.get("call2:US")!.options.blobs.signature).toBe(
      "attachment",
    );

    const required = call2Mapping({
      options: { ...OBJECT_OPTION_DEFAULTS, blobs: { signature: "required" } },
    });
    const r2 = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [required]),
      { sampleSize: 10 },
    );
    expect(
      find(
        r2.findings,
        "VT_FIELD_MISSING",
        (f) => f.field === "signature__v",
      )[0].severity,
    ).toBe("blocking");
    expect(r2.blockedUnits).toEqual([{ objectKey: "call2", country: "US" }]);

    // optional stays warning + drop
    const optional = call2Mapping();
    const r3 = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [optional]),
      { sampleSize: 10 },
    );
    expect(
      find(
        r3.findings,
        "VT_FIELD_MISSING",
        (f) => f.field === "signature__v",
      )[0].severity,
    ).toBe("warning");
    expect(
      r3.mappings.get("call2:US")!.fields.map((f) => f.target),
    ).not.toContain("signature__v");

    // attachment policy on a required row with allow_attachments = false → blocking
    const meta4 = sampleCall2VaultMetadata();
    meta4.fields = meta4.fields.filter((f) => f.name !== "signature__v");
    meta4.allow_attachments = false;
    const attachRequired = call2Mapping({
      options: {
        ...OBJECT_OPTION_DEFAULTS,
        blobs: { signature: "attachment" },
      },
    });
    attachRequired.fields.find((f) => f.target === "signature__v")!.required =
      "Y";
    const r4 = await runPreflight(
      inputFor(fixture({ call2Meta: meta4 }), [attachRequired]),
      { sampleSize: 10 },
    );
    expect(find(r4.findings, "VT_ATTACHMENTS_DISABLED")[0]).toMatchObject({
      severity: "blocking",
      field: "signature",
    });
  });

  it("an optional [UNV] ref whose target is absent warns and is dropped; a verified one still blocks", async () => {
    const unv = call2Mapping();
    unv.fields.push(
      F({
        source: "Account_vod__c",
        target: "guessed_account_ref__v",
        transform: { kind: "ref", objectKey: "account" },
        evidence: "UNV",
        sourceType: "reference",
      }),
    );
    const r = await runPreflight(inputFor(fixture(), [unv]), {
      sampleSize: 0,
    });
    expect(
      find(
        r.findings,
        "VT_FIELD_MISSING",
        (f) => f.field === "guessed_account_ref__v",
      )[0].severity,
    ).toBe("warning");
    expect(codes(r.findings, "blocking")).toEqual([]);
    expect(
      r.mappings.get("call2:US")!.fields.map((f) => f.target),
    ).not.toContain("guessed_account_ref__v");

    const obs = call2Mapping();
    obs.fields.push(
      F({
        source: "Account_vod__c",
        target: "verified_account_ref__v",
        transform: { kind: "ref", objectKey: "account" },
        evidence: "OBS",
        sourceType: "reference",
      }),
    );
    const r2 = await runPreflight(inputFor(fixture(), [obs]), {
      sampleSize: 0,
    });
    expect(
      find(
        r2.findings,
        "VT_FIELD_MISSING",
        (f) => f.field === "verified_account_ref__v",
      )[0].severity,
    ).toBe("blocking");
  });

  it("columns include transform inputs, extraColumns and User_vod__c for the queue-owner fallback", async () => {
    // User_vod__c is no longer a mapping row of its own
    const m = call2Mapping({}, (f) => f.target !== "user__v");
    m.options = {
      ...m.options,
      extraColumns: ["Detailed_Products_vod__c", "Nope__c"],
    };
    m.fields.push(
      F({
        source: "Id",
        target: "composite_key__v",
        transform: {
          kind: "compositeExternalId",
          template: "{a}__{u}__{d}",
          parts: {
            a: { ref: "account", source: "Account_vod__c" },
            u: { user: "CreatedById" },
            d: { field: "Signature_Date_vod__c" },
          },
        },
      }),
    );
    const r = await runPreflight(inputFor(fixture(), [m]), { sampleSize: 0 });
    const cols = r.resolvedTargets.get("call2")!.columns;
    expect(cols).toEqual(
      expect.arrayContaining([
        "OwnerId",
        "User_vod__c",
        "Detailed_Products_vod__c",
        "Signature_Date_vod__c",
        "Account_vod__c",
        "CreatedById",
      ]),
    );
    expect(cols).not.toContain("Nope__c");
    expect(
      find(r.findings, "SF_FIELD_MISSING", (f) => f.field === "Nope__c")[0],
    ).toMatchObject({ severity: "warning" });
  });

  it("VT_MIGRATION_PERMISSION warns while Record Migration is unverified (migrationMode on, no --probe-writes)", async () => {
    const r = await runPreflight(inputFor(fixture(), [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r.findings, "VT_MIGRATION_PERMISSION")[0]).toMatchObject({
      severity: "warning",
    });
    expect(r.blocking).toBe(false);

    const off = fixture({
      configInput: {
        target: {
          vaultDns: VAULT_DNS,
          auth: { kind: "password", username: "u", password: "p" },
          migrationUserId: 12345,
          migrationMode: false,
        },
      },
    });
    const r2 = await runPreflight(inputFor(off, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r2.findings, "VT_MIGRATION_PERMISSION")).toEqual([]);

    const probed = fixture({
      configInput: {
        preflight: { probeWrites: true, probeObject: "migration_probe__c" },
      },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    const r3 = await runPreflight(inputFor(probed, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r3.findings, "VT_MIGRATION_PERMISSION")).toEqual([]);
  });

  it("VT_MIGRATION_PERMISSION blocks when the permissions read-back denies create/edit on the probe object (§5.2)", async () => {
    const fx = fixture({
      configInput: { preflight: { probeObject: "migration_probe__c" } },
      vaultSetup: (v) =>
        v
          .addObject(probeMeta())
          .setObjectPermissions("migration_probe__c", { create: false }),
    });
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    const f = find(r.findings, "VT_MIGRATION_PERMISSION");
    expect(f.some((x) => x.severity === "blocking")).toBe(true);
    expect(f.some((x) => x.severity === "warning")).toBe(false);
    expect(r.blocking).toBe(true);
    const call = fx.vault.calls.find((c) => c.method === "userPermissions");
    expect(call?.args[1]).toBe("object.migration_probe__c.actions");

    // granted → the read-back is silent; only the unverified Record Migration warning remains
    const ok = fixture({
      configInput: { preflight: { probeObject: "migration_probe__c" } },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    const r2 = await runPreflight(inputFor(ok, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(
      find(r2.findings, "VT_MIGRATION_PERMISSION").map((x) => x.severity),
    ).toEqual(["warning"]);
  });

  it("VT_WRONG_VAULT comes from the auth layer's VAULT_DNS_MISMATCH and from target.vaultId", async () => {
    const fx = fixture();
    fx.vault.failNext = {
      method: "authenticate",
      error: new VaultApiError(
        "VAULT_DNS_MISMATCH",
        "no membership in acme-crm.veevavault.com",
        "FAILURE",
      ),
      remaining: 1,
    };
    const r = await runPreflight(inputFor(fx, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r.findings, "VT_WRONG_VAULT")[0].severity).toBe("blocking");
    expect(find(r.findings, "VT_AUTH_FAILED")).toEqual([]);
    expect(r.blocking).toBe(true);

    const fx2 = fixture({
      configInput: {
        target: {
          vaultDns: VAULT_DNS,
          auth: { kind: "password", username: "u", password: "p" },
          migrationUserId: 12345,
          vaultId: 424242,
        },
      },
    });
    const r2 = await runPreflight(inputFor(fx2, [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r2.findings, "VT_WRONG_VAULT")[0].detail).toMatch(
      /target.vaultId 424242/,
    );

    // same DNS in vaultIds[].url → no finding
    const r3 = await runPreflight(inputFor(fixture(), [call2Mapping()]), {
      sampleSize: 0,
    });
    expect(find(r3.findings, "VT_WRONG_VAULT")).toEqual([]);
  });

  it("probe results are cached per vault", async () => {
    const CN_DNS = "cn.veevavault.com";
    const fx = fixture({
      configInput: {
        preflight: { probeWrites: true, probeObject: "migration_probe__c" },
        countries: { US: {}, CN: { target: { vaultDns: CN_DNS } } },
      },
      vaultSetup: (v) => v.addObject(probeMeta()),
    });
    const cn = new FakeVaultClient({ vaultDns: CN_DNS, vaultId: 2002 })
      .addObject(sampleCall2VaultMetadata())
      .addObject(probeMeta());
    const vaults = new Map([
      [VAULT_DNS, fx.vault],
      [CN_DNS, cn],
    ]);
    const r = await runPreflight(
      inputFor(fx, [call2Mapping(), call2Mapping({ country: "CN" })], {
        vaults,
      }),
      { sampleSize: 0 },
    );
    const probeUpserts = (v: FakeVaultClient) =>
      v.calls.filter(
        (c) => c.method === "upsert" && c.args[0] === "migration_probe__c",
      ).length;
    expect(probeUpserts(fx.vault)).toBe(3);
    expect(probeUpserts(cn)).toBe(3);
    expect(await fx.store.probeResults.get("migrationMode")).toBeDefined();
    expect(
      await fx.store.probeResults.get(`migrationMode@${CN_DNS}`),
    ).toBeDefined();
    expect(
      find(r.findings, "PROBE_RESULT").filter(
        (f) => (f.detail as { cached?: boolean }).cached,
      ),
    ).toEqual([]);

    // second run: both vaults hit their own cache
    await runPreflight(
      inputFor(fx, [call2Mapping(), call2Mapping({ country: "CN" })], {
        vaults,
        runId: "run-2",
      }),
      { sampleSize: 0 },
    );
    expect(probeUpserts(fx.vault)).toBe(3);
    expect(probeUpserts(cn)).toBe(3);
  });

  it("VT_LENGTH without a sample: warning under truncation = fail, info otherwise", async () => {
    const meta = sampleCall2VaultMetadata();
    meta.fields.find((f) => f.name === "territory__v")!.max_length = 4;
    const m = call2Mapping();
    m.fields.find((f) => f.target === "territory__v")!.truncation = "fail";
    const r = await runPreflight(inputFor(fixture({ call2Meta: meta }), [m]), {
      sampleSize: 0,
    });
    expect(
      find(r.findings, "VT_LENGTH", (f) => f.field === "territory__v")[0],
    ).toMatchObject({ severity: "warning" });
    expect(codes(r.findings, "blocking")).toEqual([]);

    const r2 = await runPreflight(
      inputFor(fixture({ call2Meta: meta }), [call2Mapping()]),
      { sampleSize: 0 },
    );
    expect(
      find(r2.findings, "VT_LENGTH", (f) => f.field === "territory__v")[0],
    ).toMatchObject({ severity: "info" });
  });

  it("--allow-mdl repairs an existing non-unique legacy_crm_id__c with MODIFY Field", async () => {
    const build = () =>
      buildVaultMetadata(
        "call2__v",
        [
          ...sampleCall2VaultMetadata().fields.filter(
            (f) =>
              !/^(id|name__v|status__v|created_|modified_|legacy_crm_id__v|object_type__v|state__v)/.test(
                f.name,
              ),
          ),
          {
            name: "legacy_crm_id__c",
            type: "String",
            max_length: 18,
            unique: false,
          },
        ],
        {
          legacyIdField: null,
          objectTypes: ["call_report__v"],
          lifecycles: ["call2_lifecycle__v"],
        },
      );
    const m = call2Mapping({
      options: {
        ...OBJECT_OPTION_DEFAULTS,
        externalIdOwnedBy: "integration",
        blobs: {},
      },
    });
    const r = await runPreflight(
      inputFor(fixture({ call2Meta: build() }), [m]),
      {
        sampleSize: 0,
      },
    );
    const b = find(r.findings, "VT_LEGACY_ID_FIELD_MISSING")[0];
    expect(b.severity).toBe("blocking");
    const mdl = (b.detail as { mdl: string }).mdl;
    expect(mdl).toContain("MODIFY Field legacy_crm_id__c(unique(true))");
    expect(mdl).not.toContain("ADD Field");

    const fx2 = fixture({ call2Meta: build() });
    const r2 = await runPreflight(
      inputFor(fx2, [m], { flags: { allowMdl: true } }),
      { sampleSize: 0 },
    );
    const exec = fx2.vault.calls.find((c) => c.method === "executeMdl");
    expect(exec?.args[0]).toContain("MODIFY Field legacy_crm_id__c");
    // the fake only applies ADD Field, so the field is still not unique after
    // the MDL: the post-MDL check must verify the attributes, not existence
    expect(find(r2.findings, "VT_LEGACY_ID_FIELD_MISSING")[0]).toMatchObject({
      severity: "blocking",
      detail: expect.stringMatching(/not a unique active String field/),
    });
    expect(r2.resolvedTargets.get("call2")!.legacyIdField).toBeUndefined();
  });
});
