import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXTRA_COLUMNS,
  ACCOUNT_OBJECT_TYPES,
  ACCOUNT_TYPE_DEFAULTS,
  account,
  accountName,
  accountType,
  countryAuto,
  countryModeFor,
  doNotCall,
  formattedName,
  isPersonAccount,
  networkVid,
  normalisePhone,
  parentIdFallback,
  phoneText,
  readFlag,
} from "./account";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { buildColumnList } from "../../extract/columns";
import {
  IDS,
  buildDescribe,
  sampleAccountDescribe,
  SAMPLE_QUEUE_ID,
  SAMPLE_USER_ID,
  SAMPLE_USER_ID_2,
  buildCountryContext,
  buildIdResolver,
  buildTransformContext,
  buildVaultMetadata,
  resolveMetadata,
} from "../../testkit";
import { to18 } from "../../transform/ids";
import type { SourceRow } from "../../types";

const NOW = new Date("2026-09-07T00:00:00Z");

function makeConfig(accountOverrides: Record<string, unknown> = {}) {
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
    objects: { account: { ...accountOverrides } },
    countries: { US: {}, DE: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata(
      "account__v",
      [
        { name: "type__v", type: "Picklist", picklist: "account_type__v" },
        { name: "first_name_cda__v", type: "String", max_length: 40 },
        { name: "last_name_cda__v", type: "String", max_length: 80 },
        { name: "salutation__v", type: "Picklist", picklist: "salutation__v" },
        {
          name: "primary_country__v",
          type: "Object",
          object: { name: "country__v" },
          required: true,
        },
        { name: "spec_1_cda__v", type: "Picklist", picklist: "specialty__v" },
        { name: "spec_2_cda__v", type: "Picklist", picklist: "specialty__v" },
        {
          name: "credentials__v",
          type: "Picklist",
          picklist: "credentials__v",
        },
        { name: "gender__v", type: "Picklist", picklist: "gender__v" },
        { name: "do_not_call__v", type: "Boolean" },
        { name: "kol__v", type: "Boolean" },
        { name: "pdrp_opt_out_date__v", type: "Date" },
        { name: "npi__v", type: "String", max_length: 25 },
        { name: "veeva_network_id__v", type: "String", max_length: 100 },
        {
          name: "primary_parent__v",
          type: "Object",
          object: { name: "account__v" },
        },
        {
          name: "business_professional_person__v",
          type: "Object",
          object: { name: "account__v" },
        },
        { name: "office_phone_cda__v", type: "String", max_length: 40 },
        { name: "email_cda__v", type: "String", max_length: 255 },
        { name: "formatted_name__v", type: "String", editable: false },
        {
          name: "external_id__v",
          type: "String",
          max_length: 120,
          unique: true,
        },
        { name: "mobile_id__v", type: "String", max_length: 100 },
        { name: "ownerid__v", type: "Object", object: { name: "user__sys" } },
      ],
      { objectTypes: ["professional__v", "hospital__v", "practice__v"] },
    ),
    {
      picklists: {
        account_type__v: ["hospital__v", "practice__v"],
        salutation__v: ["dr__v", "mr__v"],
        specialty__v: ["cardiology__v", "oncology__v"],
        credentials__v: ["md__v"],
        gender__v: ["f__v", "m__v"],
        status__v: ["active__v", "inactive__v"],
      },
    },
  );
}

const ids = buildIdResolver(
  { account: { [IDS.account2]: "V0A000000000002" } },
  { [SAMPLE_USER_ID]: 11, [SAMPLE_USER_ID_2]: 12 },
);

const usCountry = buildCountryContext({
  picklists: { "account.specialty": { CD: "cardiology__v" } },
});

function personRow(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: IDS.account1,
    IsDeleted: false,
    Name: "Jane Doe",
    FirstName: "Jane",
    LastName: "Doe",
    Salutation: "Dr.",
    IsPersonAccount: "true",
    "RecordType.DeveloperName": "Professional_vod",
    Country_vod__c: IDS.countryUS,
    "Country_vod__r.Alpha_2_Code_vod__c": "US",
    Specialty_1_vod__c: "CD",
    Credentials_vod__c: "MD",
    Gender_vod__c: "F",
    KOL_vod__c: "true",
    Do_Not_Call_vod__c: "Yes_vod",
    PDRP_Opt_Out_Date_vod__c: "2024-01-15",
    NPI_vod__c: "1234567893",
    VeevaID_vod__c: "VN-123",
    Phone: "+1 415 555 0100",
    PersonEmail: "jane@example.org",
    Primary_Parent_vod__c: IDS.account2,
    Business_Professional_Person_vod__c: IDS.account3,
    Formatted_Name_vod__c: "Dr. Jane Doe",
    OwnerId: SAMPLE_USER_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID_2,
    CreatedDate: "2021-05-04T10:11:12.000Z",
    LastModifiedDate: "2025-01-02T03:04:05.000Z",
    SystemModstamp: "2025-01-02T03:04:05.000Z",
    External_ID_vod__c: "NET-001",
    Mobile_ID_vod__c: "7d2c5f4e-0001",
    ...extra,
  };
}

function businessRow(extra: Record<string, unknown> = {}): SourceRow {
  return {
    Id: IDS.account2,
    IsDeleted: false,
    Name: "General Hospital",
    IsPersonAccount: "false",
    "RecordType.DeveloperName": "Hospital_vod",
    Country_vod__c: IDS.countryUS,
    "Country_vod__r.Alpha_2_Code_vod__c": "US",
    OwnerId: SAMPLE_QUEUE_ID,
    CreatedById: SAMPLE_USER_ID,
    LastModifiedById: SAMPLE_USER_ID,
    CreatedDate: "2019-02-03T00:00:00.000Z",
    LastModifiedDate: "2024-12-31T23:59:59.000Z",
    SystemModstamp: "2024-12-31T23:59:59.000Z",
    ...extra,
  };
}

function mappingFor(
  iso2: "US" | "DE" = "US",
  overrides: Record<string, unknown> = {},
) {
  const config = makeConfig(overrides);
  return materialise(account, resolveCountry(config, iso2), config, {
    now: NOW,
  });
}

describe("account module", () => {
  it("is structurally valid and encodes the §6.2 catalogue row", () => {
    expect(
      validateObjectModule(account).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
    expect(account.source).toBe("Account");
    expect(account.target).toBe("account__v");
    expect(account.dependsOn).toEqual(["country", "user"]);
    expect(account.countryOf).toEqual([
      { kind: "field", path: "Country_vod__r.Alpha_2_Code_vod__c" },
    ]);
    expect(account.deletePolicy).toBe("inactivate");
    expect(account.inactivate).toEqual([]); // status__v = inactive__v implied (§4.4)
    expect(account.load.noTriggers).toBe(false);
    expect(account.createPolicy).toBe("create");
    expect(account.notes).not.toContain("STUB");
    expect(account.selfRefs.map((s) => s.target)).toEqual([
      "primary_parent__v",
      "business_professional_person__v",
    ]);
    expect(account.blobs).toEqual({ photo: "optional" });
    expect(account.optionDefaults).toMatchObject({
      vidField: "VeevaID_vod__c",
      useParentIdFallback: false,
      loadFormattedName: false,
      contactToPersonAccount: false,
      depthOrder: false,
      extraColumns: ["IsPersonAccount", "PersonContactId"],
    });
    // §2.2 step 9: the depth pass has a field to key on once depthOrder = true
    expect(account.load.depthOrderBy).toBe("Primary_Parent_vod__c");
    expect(account.depthOrderBy).toBe("Primary_Parent_vod__c");
  });

  it("selects IsPersonAccount / PersonContactId through extraColumns when the describe has them", () => {
    const mapping = mappingFor("US");
    const extra = mapping.options.extraColumns as string[];
    expect(extra).toEqual([...ACCOUNT_EXTRA_COLUMNS]);
    const withBridge = buildDescribe(
      "Account",
      [
        ...sampleAccountDescribe()
          .fields.filter(
            (f) =>
              !/^(Id|IsDeleted|SystemModstamp|Created|LastModified|OwnerId|RecordTypeId|CurrencyIsoCode)/.test(
                f.name,
              ),
          )
          .map((f) => ({ ...f })),
        {
          name: "PersonContactId",
          type: "reference" as const,
          referenceTo: ["Contact"],
        },
      ],
      { keyPrefix: "001", systemFields: { recordType: true } },
    );
    const { columns } = buildColumnList(
      mapping,
      { describe: withBridge, columns: [] },
      { extra },
    );
    expect(columns).toContain("IsPersonAccount");
    expect(columns).toContain("PersonContactId");
    expect(columns).toContain("LastName");
    expect(columns).toContain("Primary_Parent_vod__c");
    // a skip row on its own selects nothing — the extra list is what carries the flag
    const bare = buildColumnList(
      mapping,
      { describe: withBridge, columns: [] },
      {},
    ).columns;
    expect(bare).not.toContain("IsPersonAccount");
    expect(bare).not.toContain("PersonContactId");
    // absent from the describe (no person accounts) → simply not selected
    const business = buildDescribe(
      "Account",
      [{ name: "Name", type: "string" }],
      {
        keyPrefix: "001",
      },
    );
    const without = buildColumnList(
      mapping,
      { describe: business, columns: [] },
      { extra },
    ).columns;
    expect(without).not.toContain("IsPersonAccount");
  });

  it("carries every §6.3.7 row (including skips, fallbacks and UNV targets) with evidence tags", () => {
    const byTarget = new Map(account.fields.map((f) => [f.target, f]));
    for (const target of [
      "legacy_crm_id__v",
      "name__v",
      "object_type__v.api_name__v",
      "type__v",
      "first_name_cda__v",
      "last_name_cda__v",
      "middle__v",
      "suffix__v",
      "salutation__v",
      "formatted_name__v",
      "furigana__v",
      "preferred_name__v",
      "alternate_name__v",
      "primary_country__v",
      "country__v",
      "spec_1_cda__v",
      "spec_2_cda__v",
      "specialty_1__v",
      "specialty_2__v",
      "group_specialty_1__v",
      "group_specialty_2__v",
      "credentials__v",
      "gender__v",
      "language__v",
      "career_status__v",
      "do_not_call__v",
      "pdrp_opt_out__v",
      "pdrp_opt_out_date__v",
      "kol__v",
      "investigator__v",
      "npi__v",
      "id__v",
      "id2__v",
      "account_identifier__v",
      "payer_id__v",
      "veeva_network_id__v",
      "veeva_network__id__v",
      "master_align_id__v",
      "primary_parent__v",
      "business_professional_person__v",
      "office_phone_cda__v",
      "fax_cda__v",
      "email_cda__v",
      "website_cda__v",
      "mobile_phone_cda__v",
      "home_phone_cda__v",
      "account_class__v",
      "account_group__v",
      "hospital_type__v",
      "territory__v",
      "segmentations__v",
      "restricted_products__v",
      "sample_default__v",
      "order_type__v",
      "inventory_monitoring_type__v",
      "approved_email_opt_type__v",
      "clm_opt_type__v",
      "customer_master_status__v",
      "exclude_from_zip_to_terr_processing__v",
      "do_not_create_child_account__v",
      "do_not_sync_sales_data__v",
      "enable_restricted_products__v",
      "practice_at_hospital__v",
      "practice_near_hospital__v",
      "call_reminder__v",
      "description__v",
      "photo__v",
      "birthdate__v",
      "title__v",
      "ownerid__v",
      "created_by__v",
      "modified_date__v",
      "external_id__v",
      "mobile_id__v",
    ]) {
      expect(byTarget.has(target), target).toBe(true);
    }
    for (const f of account.fields)
      if (f.transform.kind !== "skip")
        expect(f.evidence, `${f.target} has an evidence tag`).toBeDefined();
    // skipped standard / internal fields are present as skip rows
    for (const source of [
      "Industry",
      "ParentId",
      "IsPersonAccount",
      "Territory_vod__c",
      "Color_vod__c",
    ]) {
      const row = account.fields.find(
        (f) => f.source === source && f.transform.kind === "skip",
      );
      expect(row, source).toBeDefined();
    }
    expect(byTarget.get("primary_parent__v")?.transform).toEqual({
      kind: "secondPass",
      inner: { kind: "ref", objectKey: "account" },
    });
    expect(byTarget.get("photo__v")?.transform).toEqual({
      kind: "deferredBlob",
      blobName: "photo",
    });
    expect(byTarget.get("spec_1_cda__v")?.evidence).toBe("OBS");
    expect(byTarget.get("specialty_1__v")?.evidence).toBe("UNV");
    expect(byTarget.get("veeva_network__id__v")?.evidence).toBe("UNV");
    // Block S rows are present exactly once and the module Name row replaced the default
    expect(account.fields.filter((f) => f.target === "name__v")).toHaveLength(
      1,
    );
    expect(byTarget.get("name__v")?.transform).toEqual({
      kind: "custom",
      fnName: "accountName",
    });
  });

  it("declares the object-type crosswalk, default picklists and §3.3 match precedence", () => {
    expect(account.objectTypes).toEqual(ACCOUNT_OBJECT_TYPES);
    expect(account.objectTypes.Professional_vod).toBe("professional__v");
    expect(account.objectTypes.Distributor_Branch_vod).toBe(
      "distributor_branch__v",
    );
    expect(Object.keys(ACCOUNT_OBJECT_TYPES)).toHaveLength(19);
    expect(account.picklists["account.type"]).toEqual(ACCOUNT_TYPE_DEFAULTS);
    expect(ACCOUNT_TYPE_DEFAULTS.Professional_vod).toBeUndefined();
    expect(ACCOUNT_TYPE_DEFAULTS.Hospital_vod).toBe("hospital__v");
    expect(account.picklists["account.optType"].Explicit_Opt_In_vod).toBe(
      "explicit_opt_in__v",
    );
    expect(account.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "network_vid",
      "network_vid",
      "external_id",
      "mobile_id",
    ]);
    expect(account.match[1].keys?.[0]).toEqual({
      target: "veeva_network_id__v",
      source: "VeevaID_vod__c",
    });
  });

  it("is full scope (no predicate) and materialises for US and DE", () => {
    expect(account.scope).toEqual({ kind: "full" });
    const mapping = mappingFor("US");
    expect(buildScopePredicate(mapping.scope).predicate).toBeUndefined();
    expect(mapping.scope.cutoffDate).toBeUndefined();
    expect(mapping.options.externalIdOwnedBy).toBe("integration");
    expect(mapping.options.vidField).toBe("VeevaID_vod__c");
    expect(mapping.load.noTriggers).toBe(false);
    // objects.account.depthOrder switches the declared depth field on
    expect(mapping.options.depthOrder).toBe(false);
    expect(mapping.load.depthOrderBy).toBe("Primary_Parent_vod__c");
    const depth = mappingFor("US", { depthOrder: true });
    expect(depth.options.depthOrder).toBe(true);
    expect(depth.load.depthOrderBy).toBe("Primary_Parent_vod__c");
    // ParentId fallback row is dropped unless the flag is on
    expect(
      mapping.fields.some(
        (f) => f.source === "ParentId" && f.transform.kind !== "skip",
      ),
    ).toBe(false);
    expect(mappingFor("DE").country).toBe("DE");
  });

  it("transforms a person account: template name, object type, crosswalks, dates, refs deferred to pass 2", () => {
    const mapping = mappingFor("US");
    const r = applyMapping(personRow(), mapping, {
      country: usCountry,
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account.custom,
    });
    expect(r.failure).toBeUndefined();
    expect(r.status).toBe("ok");
    expect(r.objectType).toBe("professional__v");
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: to18(IDS.account1),
      name__v: "Jane Doe",
      "object_type__v.api_name__v": "professional__v",
      first_name_cda__v: "Jane",
      last_name_cda__v: "Doe",
      salutation__v: "dr__v",
      primary_country__v: "V0C000000000101",
      spec_1_cda__v: "cardiology__v",
      credentials__v: "md__v",
      gender__v: "f__v",
      kol__v: true,
      do_not_call__v: true,
      pdrp_opt_out_date__v: "2024-01-15",
      npi__v: "1234567893",
      veeva_network_id__v: "VN-123",
      office_phone_cda__v: "+1 415 555 0100",
      email_cda__v: "jane@example.org",
      external_id__v: "NET-001",
      mobile_id__v: "7d2c5f4e-0001",
      created_date__v: "2021-05-04T10:11:12.000Z",
      modified_date__v: "2025-01-02T03:04:05.000Z",
      created_by__v: { $user: SAMPLE_USER_ID },
      modified_by__v: { $user: SAMPLE_USER_ID_2 },
      ownerid__v: { $user: SAMPLE_USER_ID },
      last_device__v: "data_load__v",
    });
    // person accounts never send type__v; formula name stays skipped by default
    expect(r.payload.type__v).toBeUndefined();
    expect(r.payload.formatted_name__v).toBeUndefined();
    // self references are omitted in pass 1 and deferred
    expect(r.payload.primary_parent__v).toBeUndefined();
    expect(r.payload.business_professional_person__v).toBeUndefined();
    expect(r.secondPass.primary_parent__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account2 },
    });
    expect(r.unresolvedOptionalFks).toContainEqual({
      field: "business_professional_person__v",
      objectKey: "account",
      sfdcId: IDS.account3,
      secondPass: true,
    });
    expect(r.unresolvedRequiredFks).toEqual([]);
    // no Vault id ever lands in the payload except the country crosswalk (§2.3)
    expect(r.payload.country__v).toBe("V0C000000000101");
    for (const [k, v] of Object.entries(r.payload))
      if (
        typeof v === "string" &&
        k !== "primary_country__v" &&
        k !== "country__v"
      )
        expect(v.startsWith("V0"), k).toBe(false);
    expect(r.fkEdges).toContainEqual({
      field: "primary_parent__v",
      targetObjectKey: "account",
      targetSfdcId: IDS.account2,
    });
  });

  it("transforms a business account: Name verbatim, type__v from the record type, queue owner replaced", () => {
    const mapping = mappingFor("US");
    const r = applyMapping(businessRow(), mapping, {
      country: usCountry,
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account.custom,
    });
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({
      name__v: "General Hospital",
      "object_type__v.api_name__v": "hospital__v",
      type__v: "hospital__v",
      ownerid__v: 1,
    });
    expect(r.payload.first_name_cda__v).toBeUndefined();
    expect(r.diagnostics.map((d) => d.code)).toContain("QUEUE_OWNER_REPLACED");
  });

  it("fails the row when the required primary country cannot be crosswalked", () => {
    const mapping = mappingFor("US");
    const r = applyMapping(
      personRow({ Country_vod__c: to18("a0C00000000FR01") }),
      mapping,
      {
        country: usCountry,
        metadata: metadata(),
        ids,
        migrationUserId: 1,
        runMode: "init",
        custom: account.custom,
      },
    );
    expect(r.status).toBe("failed");
    expect(r.failure?.field).toBe("primary_country__v");
    expect(r.diagnostics.map((d) => d.code)).toContain("VT_COUNTRY_UNMATCHED");
  });

  it("applies the country name template (JP-style) and the layered specialty crosswalk", () => {
    const mapping = mappingFor("DE");
    const jp = buildCountryContext({
      iso2: "JP",
      nameTemplates: {
        person: "{LastName}{separator}{FirstName}",
        separator: "　",
      },
      picklists: { "account.specialty": { CD: "oncology__v" } },
    });
    const r = applyMapping(personRow(), mapping, {
      country: jp,
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account.custom,
    });
    expect(r.status).toBe("ok");
    expect(r.payload.name__v).toBe("Doe　Jane");
    expect(r.payload.spec_1_cda__v).toBe("oncology__v");
  });

  it("uses ParentId for primary_parent__v only behind useParentIdFallback and only when Primary_Parent_vod__c is empty", () => {
    const mapping = mappingFor("US", { useParentIdFallback: true });
    const fallbackRow = mapping.fields.find(
      (f) => f.source === "ParentId" && f.transform.kind === "secondPass",
    );
    expect(fallbackRow?.target).toBe("primary_parent__v.legacy_crm_id__v");
    const ctx = {
      country: usCountry,
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init" as const,
      custom: account.custom,
    };
    const viaFallback = applyMapping(
      personRow({ Primary_Parent_vod__c: null, ParentId: IDS.account2 }),
      mapping,
      ctx,
    );
    expect(viaFallback.status).toBe("ok");
    expect(viaFallback.secondPass.primary_parent__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account2 },
    });
    // explicit Primary_Parent_vod__c wins
    const explicit = applyMapping(
      personRow({
        Primary_Parent_vod__c: IDS.account2,
        ParentId: IDS.account3,
      }),
      mapping,
      ctx,
    );
    expect(explicit.secondPass.primary_parent__v).toEqual({
      $fk: { object: "account", sfdcId: IDS.account2 },
    });
    // unresolved fallback parent is reported for the pass-2 retry
    const unresolved = applyMapping(
      personRow({ Primary_Parent_vod__c: null, ParentId: IDS.account4 }),
      mapping,
      ctx,
    );
    expect(unresolved.status).toBe("ok");
    expect(unresolved.unresolvedOptionalFks).toContainEqual({
      field: "primary_parent__v",
      objectKey: "account",
      sfdcId: IDS.account4,
      secondPass: true,
    });
  });

  it("loads Formatted_Name_vod__c only when editable and the flag is on", () => {
    const flagOn = mappingFor("US", { loadFormattedName: true });
    const editable = metadata();
    editable.fields.formatted_name__v.editable = true;
    const r = applyMapping(personRow(), flagOn, {
      country: usCountry,
      metadata: editable,
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account.custom,
    });
    expect(r.payload.formatted_name__v).toBe("Dr. Jane Doe");
    const notEditable = applyMapping(personRow(), flagOn, {
      country: usCountry,
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: account.custom,
    });
    expect(notEditable.payload.formatted_name__v).toBeUndefined();
  });
});

describe("account custom transforms", () => {
  const base = (): SourceRow => ({ Id: IDS.account1 });

  it("readFlag / isPersonAccount fall back from IsPersonAccount to LastName presence to the record type", () => {
    expect(readFlag("true")).toBe(true);
    expect(readFlag(0)).toBe(false);
    expect(readFlag("maybe")).toBeUndefined();
    const ctx = buildTransformContext();
    // 1. the flag wins over everything
    expect(
      isPersonAccount(
        { ...base(), IsPersonAccount: false, LastName: "X" },
        ctx,
      ),
    ).toBe(false);
    expect(
      isPersonAccount(
        {
          ...base(),
          IsPersonAccount: "true",
          "RecordType.DeveloperName": "Hospital_vod",
        },
        ctx,
      ),
    ).toBe(true);
    // 2. LastName selected (key present): non-null ⇒ person, null ⇒ business,
    //    regardless of the record type list
    expect(
      isPersonAccount(
        {
          ...base(),
          "RecordType.DeveloperName": "HCP_Custom__c",
          LastName: "X",
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      isPersonAccount(
        {
          ...base(),
          "RecordType.DeveloperName": "Professional_vod",
          LastName: null,
        },
        ctx,
      ),
    ).toBe(false);
    expect(isPersonAccount({ ...base(), LastName: "Doe" }, ctx)).toBe(true);
    // 3. record type only when neither column was selected
    expect(
      isPersonAccount(
        { ...base(), "RecordType.DeveloperName": "Business_Professional_vod" },
        ctx,
      ),
    ).toBe(true);
    expect(
      isPersonAccount(
        { ...base(), "RecordType.DeveloperName": "Hospital_vod" },
        ctx,
      ),
    ).toBe(false);
    expect(isPersonAccount(base(), ctx)).toBe(false);
    const configured = buildTransformContext({
      mapping: {
        options: { ...ctx.mapping.options, personRecordTypes: ["HCP__c"] },
      },
    });
    expect(
      isPersonAccount(
        { ...base(), "RecordType.DeveloperName": "HCP__c" },
        configured,
      ),
    ).toBe(true);
    expect(
      isPersonAccount(
        { ...base(), "RecordType.DeveloperName": "Professional_vod" },
        configured,
      ),
    ).toBe(false);
  });

  it("accountName falls back to Name when the template renders empty", () => {
    const ctx = buildTransformContext({
      field: { source: "Name", target: "name__v" },
      targetField: { name: "name__v", maxLength: 128 },
    });
    const r = accountName(
      "Practice Name",
      { ...base(), IsPersonAccount: true, Name: "Practice Name" },
      ctx,
    );
    expect(r).toEqual({ value: "Practice Name" });
  });

  it("accountType crosswalks business record types through account.type and sends verbatim to a String target", () => {
    const picklistCtx = buildTransformContext({
      field: { source: "RecordType.DeveloperName", target: "type__v" },
      targetField: {
        name: "type__v",
        type: "picklist",
        picklistValues: ["hospital__v"],
      },
      mapping: { picklists: { "account.type": ACCOUNT_TYPE_DEFAULTS } },
    });
    expect(
      accountType(
        "Hospital_vod",
        { ...base(), "RecordType.DeveloperName": "Hospital_vod" },
        picklistCtx,
      ),
    ).toEqual({ value: "hospital__v" });
    expect(
      accountType(
        "Professional_vod",
        { ...base(), "RecordType.DeveloperName": "Professional_vod" },
        picklistCtx,
      ),
    ).toBeUndefined();
    const stringCtx = buildTransformContext({
      field: { source: "RecordType.DeveloperName", target: "type__v" },
      targetField: { name: "type__v", type: "string" },
      mapping: { picklists: { "account.type": ACCOUNT_TYPE_DEFAULTS } },
    });
    expect(
      accountType(
        undefined,
        {
          ...base(),
          "RecordType.DeveloperName": "Custom_HCO",
          IsPersonAccount: false,
        },
        stringCtx,
      ),
    ).toEqual({ value: "custom_hco__v" });
  });

  it("countryAuto picks the mode from the target type", () => {
    expect(
      countryModeFor(
        buildTransformContext({ targetField: { type: "object" } }),
      ),
    ).toBe("ref");
    expect(
      countryModeFor(
        buildTransformContext({ targetField: { type: "picklist" } }),
      ),
    ).toBe("picklist");
    expect(
      countryModeFor(
        buildTransformContext({ targetField: { type: "string" } }),
      ),
    ).toBe("iso2");
    expect(countryModeFor(buildTransformContext())).toBe("ref");
    const picklist = buildTransformContext({
      field: { source: "Country_vod__c", target: "country__v" },
      targetField: { name: "country__v", type: "picklist" },
    });
    expect(countryAuto("US", base(), picklist)).toEqual({
      value: "united_states__v",
    });
    const text = buildTransformContext({
      field: { source: "Country_vod__c", target: "country__v" },
      targetField: { name: "country__v", type: "string" },
    });
    expect(countryAuto(IDS.countryDE, base(), text)).toEqual({ value: "DE" });
    expect(countryAuto("", base(), text)).toBeUndefined();
  });

  it("doNotCall maps to a boolean or a picklist by target type", () => {
    const boolCtx = buildTransformContext({
      field: { source: "Do_Not_Call_vod__c", target: "do_not_call__v" },
      targetField: { name: "do_not_call__v", type: "boolean" },
    });
    expect(doNotCall("Yes_vod", base(), boolCtx)).toBe(true);
    expect(doNotCall("No_vod", base(), boolCtx)).toBe(false);
    expect(doNotCall("Maybe", base(), boolCtx)).toMatchObject({
      omit: true,
      diagnostic: { code: "INVALID_BOOLEAN" },
    });
    const pickCtx = buildTransformContext({
      field: { source: "Do_Not_Call_vod__c", target: "do_not_call__v" },
      targetField: {
        name: "do_not_call__v",
        type: "picklist",
        picklistValues: ["yes__v", "no__v"],
      },
      mapping: {
        picklists: {
          "account.doNotCall": { Yes_vod: "yes__v", No_vod: "no__v" },
        },
      },
    });
    expect(doNotCall("Yes_vod", base(), pickCtx)).toEqual({ value: "yes__v" });
  });

  it("networkVid reads the configured vidField column first", () => {
    const ctx = buildTransformContext({
      mapping: {
        options: {
          ...buildTransformContext().mapping.options,
          vidField: "NET_External_Id__c",
        },
      },
    });
    expect(
      networkVid("VN-1", { ...base(), NET_External_Id__c: " NET-9 " }, ctx),
    ).toBe("NET-9");
    expect(networkVid("VN-1", base(), ctx)).toBe("VN-1");
    expect(networkVid("", base(), ctx)).toBeUndefined();
  });

  it("parentIdFallback is inert without the flag, ignores Contact ids and emits a deferred account $fk", () => {
    const off = buildTransformContext();
    expect(parentIdFallback(IDS.account2, base(), off)).toBeUndefined();
    const on = buildTransformContext({
      mapping: {
        options: { ...off.mapping.options, useParentIdFallback: true },
      },
      ids: buildIdResolver({ account: { [IDS.account2]: "V0A2" } }),
    });
    expect(parentIdFallback("003000000000001AAA", base(), on)).toBeUndefined();
    expect(
      parentIdFallback(
        IDS.account2,
        { ...base(), Primary_Parent_vod__c: IDS.account3 },
        on,
      ),
    ).toBeUndefined();
    expect(parentIdFallback(IDS.account2, base(), on)).toEqual({
      value: { $fk: { object: "account", sfdcId: IDS.account2 } },
      targetField: "primary_parent__v",
    });
    expect(parentIdFallback(IDS.account3, base(), on)).toMatchObject({
      value: { $fk: { object: "account", sfdcId: IDS.account3 } },
      unresolved: { objectKey: "account", sfdcId: IDS.account3 },
    });
  });

  it("formattedName needs both the flag and an editable target", () => {
    const off = buildTransformContext({
      targetField: { name: "formatted_name__v", editable: true },
    });
    expect(formattedName("X", base(), off)).toBeUndefined();
    const on = buildTransformContext({
      targetField: { name: "formatted_name__v", editable: true },
      mapping: { options: { ...off.mapping.options, loadFormattedName: true } },
    });
    expect(formattedName(" Dr. X ", base(), on)).toEqual({ value: "Dr. X" });
  });

  it("normalisePhone / phoneText produce E.164 only when unambiguous", () => {
    expect(normalisePhone("+49 (30) 1234-567")).toBe("+49301234567");
    expect(normalisePhone("0049 30 1234567")).toBe("+49301234567");
    expect(normalisePhone("030 1234567", "DE")).toBe("+49301234567");
    expect(normalisePhone("(415) 555-0100", "US")).toBe("+14155550100");
    expect(normalisePhone("030 1234567")).toBe("030 1234567"); // no region → pass-through
    expect(normalisePhone("415-555-0100 ext 12", "US")).toBe(
      "415-555-0100 ext 12",
    );
    expect(normalisePhone("1-800-FLOWERS", "US")).toBe("1-800-FLOWERS");
    // NANP: a leading country code without '+' is unambiguous (area codes never start with 0/1)
    expect(normalisePhone("1-415-555-0100", "US")).toBe("+14155550100");
    expect(normalisePhone("1 (415) 555-0100", "CA")).toBe("+14155550100");
    expect(normalisePhone("+1 (415) 555-0100", "US")).toBe("+14155550100");
    expect(normalisePhone("555-0100", "US")).toBe("555-0100"); // 7 digits: no area code → as typed
    expect(normalisePhone("0415 555 0100", "US")).toBe("0415 555 0100");
    // other regions: a number already starting with the calling code but no '+'/'00' is ambiguous
    expect(normalisePhone("49 30 1234567", "DE")).toBe("49 30 1234567");
    expect(normalisePhone("30 1234567", "DE")).toBe("+49301234567");
    expect(normalisePhone("020 7946 0000", "GB")).toBe("+442079460000");
    expect(normalisePhone("06 1234 5678", "IT")).toBe("+390612345678"); // IT keeps the trunk 0
    expect(normalisePhone("912 345 678", "ES")).toBe("+34912345678");
    expect(normalisePhone("1234", "DE")).toBe("1234"); // outside the E.164 envelope
    const off = buildTransformContext({
      targetField: { name: "phone__v", maxLength: 40 },
    });
    expect(phoneText(" 030 1234567 ", base(), off)).toEqual({
      value: "030 1234567",
    });
    const on = buildTransformContext({
      targetField: { name: "phone__v", maxLength: 40 },
      country: {
        ...buildCountryContext(),
        phone: { normalise: true, defaultRegion: "DE" },
      },
    });
    expect(phoneText("030 1234567", base(), on)).toEqual({
      value: "+49301234567",
    });
    expect(phoneText("", base(), on)).toBeUndefined();
  });
});
