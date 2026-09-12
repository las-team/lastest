import { describe, expect, it } from "vitest";
import {
  USER_EXTRA_COLUMNS,
  USER_LICENSE_FIELDS,
  USER_SYS_CREATE_REQUIRED,
  buildUsersApiRow,
  readFlag,
  renderUsername,
  securityProfile,
  user,
  userCountry,
  userStatus,
  usernameCreateOnly,
} from "./user";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { parseConfig } from "../../config/schema";
import { applyMapping } from "../../transform/apply";
import { buildScopePredicate } from "../../extract/scope";
import { isGlobalModule } from "../../run/plan";
import {
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

/** Flat source row for custom-transform unit tests (Id unused by the functions under test). */
function row(fields: Record<string, unknown> = {}): SourceRow {
  return { Id: "000000000000001", ...fields };
}

const NOW = new Date("2026-09-07T00:00:00Z");

function makeConfig(userOverrides: Record<string, unknown> = {}) {
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
    objects: {
      user: {
        securityProfile: { "Sales Rep": "sales_rep__v" },
        ...userOverrides,
      },
    },
    countries: { US: {} },
  });
}

function metadata() {
  return resolveMetadata(
    buildVaultMetadata("user__sys", [
      {
        name: "legacy_crm_id__v",
        type: "String",
        max_length: 18,
        unique: true,
      },
      { name: "salesforce_username__sys", type: "String", max_length: 255 },
      { name: "username__sys", type: "String", max_length: 255 },
      { name: "federated_id__sys", type: "String", max_length: 255 },
      { name: "email__sys", type: "String", max_length: 255, required: true },
      {
        name: "first_name__sys",
        type: "String",
        max_length: 80,
        required: true,
      },
      {
        name: "last_name__sys",
        type: "String",
        max_length: 80,
        required: true,
      },
      { name: "status__v", type: "Picklist", picklist: "status__v" },
      { name: "isactive__v", type: "Boolean" },
      {
        name: "security_profile__sys",
        type: "Object",
        object: { name: "security_profile__sys" },
      },
      { name: "profile_name__v", type: "String", max_length: 255 },
      { name: "manager__sys", type: "Object", object: { name: "user__sys" } },
      {
        name: "language__sys",
        type: "Object",
        object: { name: "language__sys" },
      },
      { name: "locale__sys", type: "Object", object: { name: "locale__sys" } },
      { name: "timezone__sys", type: "Picklist", picklist: "timezone__sys" },
      { name: "country__v", type: "String", max_length: 2 },
      { name: "country_code__v", type: "String", max_length: 2 },
      { name: "vcountry__v", type: "Object", object: { name: "country__v" } },
      { name: "state__v", type: "String", max_length: 80 },
      { name: "user_type__v", type: "Picklist", picklist: "user_type__v" },
      { name: "approved_email_admin__v", type: "Boolean" },
      { name: "created_date__v", type: "DateTime", editable: false },
      { name: "created_by__v", type: "Object", object: { name: "user__sys" } },
      { name: "mobile_id__v", type: "String", max_length: 100 },
    ]),
    {
      picklists: {
        status__v: ["active__v", "inactive__v"],
        timezone__sys: ["america_new_york__sys"],
        user_type__v: ["standard__v"],
      },
    },
  );
}

const MANAGER_ID = to18("005000000000009");

function sampleRow(extra: Partial<SourceRow> = {}): SourceRow {
  return {
    Id: "005000000000001",
    Username: "jdoe@acme.com",
    FederationIdentifier: "jdoe",
    Email: "jdoe@acme.com",
    FirstName: "Jane",
    LastName: "Doe",
    IsActive: "true",
    "Profile.Name": "Sales Rep",
    ManagerId: MANAGER_ID,
    LanguageLocaleKey: "en_US",
    LocaleSidKey: "en_US",
    TimeZoneSidKey: "America/New_York",
    Country_vod__c: "US",
    State: "NY",
    UserType: "Standard",
    Approved_Email_Admin_vod__c: "false",
    CreatedDate: "2020-05-06T07:08:09.000+0000",
    CreatedById: SAMPLE_USER_ID_2,
    LastModifiedDate: "2025-01-01T00:00:00.000Z",
    LastModifiedById: SAMPLE_USER_ID_2,
    ...extra,
  };
}

function run(row: SourceRow, userOverrides: Record<string, unknown> = {}) {
  const config = makeConfig(userOverrides);
  const mapping = materialise(user, resolveCountry(config, "US"), config, {
    now: NOW,
  });
  const ids = buildIdResolver(
    {},
    { [SAMPLE_USER_ID]: 101, [MANAGER_ID]: 109, [SAMPLE_USER_ID_2]: 102 },
  );
  return {
    mapping,
    result: applyMapping(row, mapping, {
      country: buildCountryContext(),
      metadata: metadata(),
      ids,
      migrationUserId: 1,
      runMode: "init",
      custom: user.custom,
    }),
  };
}

describe("user module", () => {
  it("is structurally valid", () => {
    expect(
      validateObjectModule(user).filter((i) => i.severity === "blocking"),
    ).toEqual([]);
  });

  it("encodes the §6.3.2 / §6.2 / §3.3 / §4.4 catalogue facts", () => {
    expect(user.source).toBe("User");
    expect(user.target).toBe("user__sys");
    expect(user.targetEvidence).toBe("OBS");
    expect(user.scope).toEqual({ kind: "full" });
    // §3.4 / §6.1 step 0: one GLOBAL unit — every user incl. country-less ones
    expect(user.countryOf).toEqual([{ kind: "global" }]);
    expect(isGlobalModule(user, resolveCountry(makeConfig(), "US"))).toBe(true);
    expect(user.dependsOn).toEqual(["country"]);
    expect(user.createPolicy).toBe("match-only");
    expect(user.deletePolicy).toBe("inactivate");
    expect(user.inactivate).toEqual([{ field: "isactive__v", value: false }]);
    expect(user.selfRefs).toEqual([
      { target: "manager__sys", source: "ManagerId" },
    ]);
    expect(user.optionDefaults).toMatchObject({
      mode: "match",
      usernameTemplate: "{Username}",
      licenseType: "full__v",
      // `User.Country` fallback of userCountry is a declared extra column
      extraColumns: [...USER_EXTRA_COLUMNS],
    });
    expect(USER_EXTRA_COLUMNS).toEqual(["Country"]);
    expect(user.match.map((m) => m.method)).toEqual([
      "legacy_id",
      "username",
      "username",
      "federated_id",
      "email",
    ]);
    expect(user.match[1].keys?.[0].target).toBe("salesforce_username__sys");
    expect(user.match[2].keys?.[0].target).toBe("username__sys");
    expect(user.match[4]).toMatchObject({ requireUnique: true });
  });

  it("maps every §6.3.2 row (no target dropped) and skips what the spec skips", () => {
    const byTarget = new Map(user.fields.map((f) => [f.target, f]));
    const expected: Array<[string, string, string]> = [
      ["Id", "legacy_crm_id__v", "legacyId"],
      ["Username", "salesforce_username__sys", "copy"],
      ["Username", "username__sys", "custom"],
      ["FederationIdentifier", "federated_id__sys", "copy"],
      ["Email", "email__sys", "text"],
      ["FirstName", "first_name__sys", "text"],
      ["LastName", "last_name__sys", "text"],
      ["Alias", "alias__sys", "text"],
      ["Title", "title__sys", "text"],
      ["CompanyName", "company__sys", "text"],
      ["Department", "department__v", "text"],
      ["Division", "division__v", "text"],
      ["EmployeeNumber", "employee_number__v", "text"],
      ["IsActive", "status__v", "custom"],
      ["IsActive", "isactive__v", "bool"],
      ["Profile.Name", "security_profile__sys", "custom"],
      ["Profile.Name", "profile_name__v", "text"],
      ["Profile.Name", "application_profile__v", "custom"],
      ["Profile.Name", "layout_profile__sys", "custom"],
      ["UserRoleId", "userroleid__v", "copy"],
      ["ManagerId", "manager__sys", "secondPass"],
      ["LanguageLocaleKey", "language__sys", "localeLookup"],
      ["LanguageLocaleKey", "language_code__v", "copy"],
      ["LocaleSidKey", "locale__sys", "localeLookup"],
      ["LocaleSidKey", "locale_code__v", "copy"],
      ["TimeZoneSidKey", "timezone__sys", "userTimezone"],
      ["Country_vod__c", "country__v", "custom"],
      ["Country_vod__c", "country_code__v", "custom"],
      ["Country_vod__c", "vcountry__v", "custom"],
      ["Street", "street__v", "text"],
      ["City", "city__v", "text"],
      ["State", "state__v", "text"],
      ["PostalCode", "postalcode__v", "text"],
      ["Phone", "office_phone__sys", "text"],
      ["MobilePhone", "mobile_phone__sys", "text"],
      ["Fax", "fax__sys", "text"],
      ["UserType", "user_type__v", "picklist"],
      ["DelegatedApproverId", "delegatedapproverid__v", "copy"],
      ["CommunityNickname", "communitynickname__v", "copy"],
      ["SmallPhotoUrl", "smallphotourl__v", "copy"],
      ["External_ID_vod__c", "user_identifier__v", "copy"],
      ["Master_Align_Id_vod__c", "master_align_id__v", "copy"],
      ["Approved_Email_Admin_vod__c", "approved_email_admin__v", "bool"],
      ["MCCP_Admin_vod__c", "mccp_admin__v", "bool"],
      ["Network_Admin_vod__c", "network_admin__v", "bool"],
      ["Consent_Admin_vod__c", "consent_admin__v", "bool"],
      ["Content_Admin_vod__c", "content_admin__v", "bool"],
      ["Analytics_Admin_vod__c", "analytics_admin__v", "bool"],
      ["Engage_Group_vod__c", "engage_group__v", "text"],
      ["Primary_Territory_vod__c", "primary_territory__v", "text"],
      ["Share_Team_vod__c", "share_team__v", "text"],
      ["Product_Expertise_vod__c", "product_expertise__v", "text"],
      [
        "Inventory_Order_Allocation_Group_vod__c",
        "inventory_order_allocation_group__v",
        "text",
      ],
      [
        "Network_Additional_Countries_vod__c",
        "network_additional_countries__v",
        "text",
      ],
      ["Territory_vod__c", "territory__v", "skip"],
      ["LastLoginDate", "last_login_date__v", "skip"],
      ["EmailEncodingKey", "email_encoding_key__v", "skip"],
      ["PhotoUrl", "photo_url__v", "skip"],
    ];
    for (const [source, target, kind] of expected) {
      const row = byTarget.get(target);
      expect(row, target).toBeDefined();
      expect(row!.source, target).toBe(source);
      expect(row!.transform.kind, target).toBe(kind);
    }
    // Block S rows that apply to user__sys (mobile_id__v is OBS on user)
    for (const t of [
      "created_date__v",
      "created_by__v",
      "modified_date__v",
      "modified_by__v",
      "mobile_id__v",
    ])
      expect(byTarget.has(t), t).toBe(true);
    // User has no OwnerId / locks / External_ID_vod__c → external_id__v
    for (const t of ["ownerid__v", "lock__v", "unlock__v", "external_id__v"])
      expect(byTarget.has(t), t).toBe(false);
    // per-country crosswalks flagged CC=Y
    for (const t of ["security_profile__sys", "street__v", "state__v"])
      expect(byTarget.get(t)!.countryConfigurable, t).toBe(true);
    // org-specific Veeva flags degrade at preflight (describe miss = info)
    expect(byTarget.get("mccp_admin__v")!.optionalSource).toBe(true);
    // licence flags are never mapped, only reported
    for (const f of USER_LICENSE_FIELDS) expect(byTarget.has(f)).toBe(false);
    expect(USER_SYS_CREATE_REQUIRED).toContain("security_profile__sys");
  });

  it("transforms a realistic user row in match mode", () => {
    const { result: r } = run(sampleRow());
    expect(r.status).toBe("ok");
    expect(r.failure).toBeUndefined();
    expect(r.payload).toMatchObject({
      legacy_crm_id__v: to18("005000000000001"),
      salesforce_username__sys: "jdoe@acme.com",
      federated_id__sys: "jdoe",
      email__sys: "jdoe@acme.com",
      first_name__sys: "Jane",
      last_name__sys: "Doe",
      status__v: "active__v",
      isactive__v: true,
      security_profile__sys: "sales_rep__v",
      profile_name__v: "Sales Rep",
      "language__sys.name__v": "English",
      language_code__v: "en_US",
      "locale__sys.name__v": "United States",
      locale_code__v: "en_US",
      timezone__sys: "america_new_york__sys",
      country__v: "US",
      country_code__v: "US",
      vcountry__v: "V0C000000000101",
      state__v: "NY",
      user_type__v: "standard__v",
      approved_email_admin__v: false,
      created_date__v: "2020-05-06T07:08:09.000Z",
      created_by__v: { $user: SAMPLE_USER_ID_2 },
      modified_date__v: "2025-01-01T00:00:00.000Z",
    });
    // match mode: username__sys is not written
    expect(r.payload.username__sys).toBeUndefined();
    // manager is a pass-2 self reference
    expect(r.payload.manager__sys).toBeUndefined();
    expect(r.secondPass).toEqual({ manager__sys: { $user: MANAGER_ID } });
    // skipped rows never reach the payload
    for (const t of ["territory__v", "last_login_date__v", "photo_url__v"])
      expect(r.payload[t]).toBeUndefined();
    // unmapped optional profile crosswalks are omitted without failing the row
    expect(r.payload.application_profile__v).toBeUndefined();
    expect(r.unresolvedRequiredFks).toEqual([]);
  });

  it("writes username__sys only in create mode (re-domained by usernameTemplate)", () => {
    const { result: r } = run(sampleRow(), {
      mode: "create",
      usernameTemplate: "{localPart}@vault.acme.com",
    });
    expect(r.status).toBe("ok");
    expect(r.payload.username__sys).toBe("jdoe@vault.acme.com");
    expect(r.payload.salesforce_username__sys).toBe("jdoe@acme.com");
  });

  it("derives status__v = inactive__v for inactive users and reports unresolved managers as optional", () => {
    const { result: r } = run(
      sampleRow({ IsActive: "false", ManagerId: to18("005000000000077") }),
    );
    expect(r.status).toBe("ok");
    expect(r.payload.status__v).toBe("inactive__v");
    expect(r.payload.isactive__v).toBe(false);
    // unmapped manager: deferred in pass 2, recorded as an optional unresolved user
    expect(r.unresolvedRequiredFks).toEqual([]);
    expect(r.unresolvedOptionalFks).toContainEqual(
      expect.objectContaining({
        field: "manager__sys",
        objectKey: "user",
        secondPass: true,
      }),
    );
  });

  it("fails the row when a required field is missing and flags an unresolved country", () => {
    const { result: r } = run(sampleRow({ Email: "", Country_vod__c: "ZZ" }));
    expect(r.status).toBe("failed");
    expect(r.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "email__sys",
    });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "country_unresolved",
        code: "USER_COUNTRY_UNRESOLVED",
        field: "country__v",
      }),
    );
  });

  it("fails a create-mode row whose Profile.Name is empty (security_profile__sys is Y on create)", () => {
    const { result: r } = run(sampleRow({ "Profile.Name": "" }), {
      mode: "create",
    });
    expect(r.status).toBe("failed");
    expect(r.failure).toMatchObject({
      code: "REQUIRED_MISSING",
      field: "security_profile__sys",
    });
    // match mode: an empty profile is simply omitted
    const match = run(sampleRow({ "Profile.Name": "" }));
    expect(match.result.status).toBe("ok");
    expect(match.result.payload.security_profile__sys).toBeUndefined();
  });

  it("is unscoped (full): the scope builder yields no predicate", () => {
    const config = makeConfig();
    const mapping = materialise(user, resolveCountry(config, "US"), config, {
      now: NOW,
    });
    expect(buildScopePredicate(mapping.scope)).toEqual({ kind: "full" });
  });
});

describe("user custom transforms", () => {
  it("readFlag accepts REST booleans and CSV strings", () => {
    expect(readFlag(true)).toBe(true);
    expect(readFlag("false")).toBe(false);
    expect(readFlag("1")).toBe(true);
    expect(readFlag("0")).toBe(false);
    expect(readFlag("")).toBeUndefined();
    expect(readFlag("maybe")).toBeUndefined();
  });

  it("userStatus maps IsActive to the platform status", () => {
    const ctx = buildTransformContext({ objectKey: "user" });
    expect(userStatus("true", row({}), ctx)).toBe("active__v");
    expect(userStatus(false, row({}), ctx)).toBe("inactive__v");
    expect(userStatus(null, row({}), ctx)).toBeUndefined();
  });

  it("userCountry writes ISO-2 text or a country reference depending on the target type", () => {
    const iso2Ctx = buildTransformContext({
      objectKey: "user",
      field: { target: "country__v" },
      targetField: { name: "country__v", type: "string" },
    });
    expect(userCountry("US", row({}), iso2Ctx)).toBe("US");
    // lookup-typed source (Country_vod__c id) → crosswalk by SFDC id
    const usId = buildCountryContext().countries.byIso2("US")!.sfdcId!;
    expect(userCountry(usId, row({}), iso2Ctx)).toBe("US");
    // fallback to User.Country when Country_vod__c is empty — ISO-2 codes only
    expect(userCountry("", row({ Country: "de" }), iso2Ctx)).toBe("DE");
    expect(
      userCountry("", row({ Country: "United States" }), iso2Ctx),
    ).toMatchObject({
      omit: true,
      diagnostic: {
        code: "USER_COUNTRY_UNRESOLVED",
        value: "United States",
        detail: expect.stringContaining("not an ISO-2 code"),
      },
    });
    const refCtx = buildTransformContext({
      objectKey: "user",
      field: { target: "vcountry__v" },
      targetField: { name: "vcountry__v", type: "object" },
    });
    expect(userCountry("DE", row({}), refCtx)).toBe("V0C000000000102");
    // unknown → non-fatal country_unresolved diagnostic
    const miss = userCountry("XX", row({}), iso2Ctx);
    expect(miss).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "country_unresolved",
        code: "USER_COUNTRY_UNRESOLVED",
      },
    });
  });

  it("usernameCreateOnly renders the template only in create mode", () => {
    const jane = row({ Username: "jdoe@acme.com" });
    const match = buildTransformContext({
      objectKey: "user",
      mapping: { options: { mode: "match" } as never },
    });
    expect(usernameCreateOnly("jdoe@acme.com", jane, match)).toBeUndefined();
    const create = buildTransformContext({
      objectKey: "user",
      field: { target: "username__sys" },
      mapping: {
        options: {
          mode: "create",
          usernameTemplate: "{localPart}@{domain}.migrated",
        } as never,
      },
    });
    expect(usernameCreateOnly("jdoe@acme.com", jane, create)).toBe(
      "jdoe@acme.com.migrated",
    );
    expect(renderUsername("{Alias}", row({ Alias: "jd" }))).toBe("jd");
    // empty username in create mode is a fatal required_missing
    expect(usernameCreateOnly("", row({ Username: "" }), create)).toMatchObject(
      { omit: true, diagnostic: { fatal: true } },
    );
  });

  it("securityProfile uses the explicit crosswalks and never derives", () => {
    const fromConfig = buildTransformContext({
      objectKey: "user",
      field: { target: "security_profile__sys" },
      mapping: {
        options: { securityProfile: { "Sales Rep": "sales_rep__v" } } as never,
      },
    });
    expect(securityProfile("Sales Rep", row({}), fromConfig)).toBe(
      "sales_rep__v",
    );
    const fromPicklist = buildTransformContext({
      objectKey: "user",
      field: { target: "security_profile__sys" },
      country: buildCountryContext({
        picklists: { "user.securityProfile": { Admin: "vault_owner__v" } },
      }),
      mapping: { options: {} as never },
    });
    expect(securityProfile("Admin", row({}), fromPicklist)).toBe(
      "vault_owner__v",
    );
    // unmapped: non-fatal in match mode, fatal in create mode
    expect(securityProfile("Other", row({}), fromPicklist)).toMatchObject({
      omit: true,
      diagnostic: { code: "USER_PROFILE_UNMAPPED", fatal: false },
    });
    const create = buildTransformContext({
      objectKey: "user",
      field: { target: "security_profile__sys" },
      mapping: { options: { mode: "create" } as never },
    });
    expect(securityProfile("Other", row({}), create)).toMatchObject({
      omit: true,
      diagnostic: { fatal: true },
    });
    // empty: omitted in match mode, fatal REQUIRED_MISSING in create mode
    expect(securityProfile("", row({}), fromPicklist)).toBeUndefined();
    expect(securityProfile(null, row({}), create)).toMatchObject({
      omit: true,
      diagnostic: {
        kind: "required_missing",
        code: "REQUIRED_MISSING",
        field: "security_profile__sys",
        fatal: true,
      },
    });
  });

  it("buildUsersApiRow composes the Users API body incl. vault_membership", () => {
    const body = buildUsersApiRow(sampleRow({ CompanyName: "Acme" }), {
      vaultId: 12345,
      securityPolicyId: 7,
      securityProfile: "sales_rep__v",
      usernameTemplate: "{localPart}@vault.acme.com",
    });
    expect(body).toMatchObject({
      user_name__v: "jdoe@vault.acme.com",
      user_first_name__v: "Jane",
      user_last_name__v: "Doe",
      user_email__v: "jdoe@acme.com",
      user_timezone__v: "america_new_york__sys",
      user_locale__v: "en_US",
      user_language__v: "en_US",
      security_profile__v: "sales_rep__v",
      security_policy_id__v: 7,
      license_type__v: "full__v",
      send_welcome_email__v: false,
      active__v: true,
      domain_active__v: true,
      federated_id__v: "jdoe",
      company__v: "Acme",
      vault_membership: "12345:true:sales_rep__v:full__v",
    });
  });
});
