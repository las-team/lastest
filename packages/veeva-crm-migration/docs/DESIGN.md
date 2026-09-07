# Design — `@lastest/veeva-crm-migration`

Status: design v1, 2026-09-07. Companion to `docs/research/01..05`. This document is
self-contained: an implementer should not need the research docs, except to check a
confidence tag (**[verified]** = confirmed from VAPIL / jsforce source or an official page
excerpt, **[unverified]** = practitioner knowledge, verify against a real org/vault first).

Package facts: pnpm workspace, ESM, Node 22, consumed as TypeScript source (no build step),
`vitest`, **zero runtime dependencies** — native `fetch`, `node:crypto`, `node:fs/promises`
only. No jsforce, no SOAP, no XML.

Public entry point (already stubbed in `src/index.ts`):

```ts
migrateVeevaCrmConfig({
  stages?: ("extract" | "document" | "plan" | "apply")[],   // default ["extract","document","plan"]
  outDir: string,
  sfdc?: SfdcAuth & { apiVersion?, objects?, includeManagedObjects?, maxRequests? },
  vault?: VaultAuth & { apiVersion? },
  countries?: string[], repCategories?: string[],
  classify?: ClassifyOptions, dryRun?: boolean /* default true */,
  log?, fetch?, now?,
}): Promise<MigrateResult>
```

`outDir` layout: `snapshot.json` (extract) → `docs/` (document) → `vault-plan/` (plan) →
`apply-report.json` + `apply-report.md` (apply). Every later stage reads the JSON written
by the earlier one, so extraction happens once.

---

## 1. Scope and non-goals

**In scope — "functional configuration" of a Veeva CRM org on Salesforce:**

| Area | What is extracted |
|---|---|
| Security | Profiles, their hidden permission set, custom permission sets, object CRUD, FLS, tab/app visibility, record-type visibility/defaults, layout assignments, user permissions (`PermissionsXxx` flags) |
| Data model | Objects (Veeva `_vod__c`, customer `__c`, and the standard objects Veeva uses), fields incl. picklist values and dependencies, record types, page layouts (sections, fields, behaviours, related lists, buttons), validation rules (name/active/formula, inventory only) |
| Veeva layer | Veeva Settings (every `*_Settings_vod__c` hierarchy custom setting, org + profile + user level), VMOCs (`VMobile_Object_Configuration_vod__c`), Veeva Messages (`Message_vod__c`) |
| Usage | Active-user counts per profile × country × `User_Type_vod__c` × language (aggregates only, no PII) |
| Automation inventory | Names/objects/active flags of Apex triggers, flows, workflow rules — **listed as unmapped**, never migrated |

**Non-goals (stated in the README):**

- Business data records (Accounts, Calls, TSF, Products, content). Only configuration.
- Apex classes/triggers, Flows, Process Builder, Workflow, Visualforce/LWC, MyInsights, reports/dashboards, sharing rules, territory models, Network/Align/Nitro integrations, connected apps. They are inventoried and emitted as a manual checklist; nothing is translated.
- Salesforce Metadata API (SOAP), Bulk API, `retrieve()` zips. Only REST + Tooling REST over `fetch`.
- Vault VPK packaging. The plan produces MDL scripts + JSON record change-sets; wrapping them into an outbound package is a documented manual step.
- Data migration, id re-keying, user provisioning, SSO.
- Multi-org merge. One org → one snapshot → one plan. Run it per org.

---

## 2. Rep category model

Categories (fixed enum, `model/types.ts` `RepCategory`): `sales_rep`, `specialty_rep`,
`kam`, `msl`, `manager`, `inside_sales`, `admin`, `other`.

Rep category is a property of a **Salesforce Profile** — the profile is the axis on which
Veeva Settings, VMOCs, layouts and record types vary. Users only confirm it.

### 2.1 Classification pipeline (`model/classify.ts`, pure)

Evaluated in this order; the first step that yields a category wins, and the winning step
is recorded in `ClassifiedProfile.rationale[]` so the docs can show *why*:

1. `classify.categoryOverrides[profileName]` (explicit user override).
2. **Regex table over the profile name** (`DEFAULT_CLASSIFICATION_RULES`, first match wins, case-insensitive; user rules are *prepended* via `classify.rules`):

| Order | Pattern (`i`) | Category |
|---|---|---|
| 1 | `system\s*admin\|sys\s*admin\|integration\|api\s*user` | `admin` |
| 2 | `business\s*admin\|content\s*admin\|\badmin\b\|administrator` | `admin` |
| 3 | `\bmsl\b\|medical\s*science\|medical\s*liaison\|\bmedical\b` | `msl` |
| 4 | `\bkam\b\|key\s*account\|account\s*manager\|\bkae\b` | `kam` |
| 5 | `inside\s*sales\|tele\s*sales\|remote\s*rep\|virtual\s*rep\|call\s*cent` | `inside_sales` |
| 6 | `manager\|\bflm\b\|\bslm\b\|\brbm\b\|\bdsm\b\|\bnsm\b\|director\|head\s*of\|leader` | `manager` |
| 7 | `special\|hospital\|oncolog\|\bspecialty\b\|\bhsr\b\|therapy\s*area` | `specialty_rep` |
| 8 | `sales\|\brep\b\|representative\|field\s*force\|\bpsr\b\|\bmr\b\|primary\s*care\|\bgp\b` | `sales_rep` |

3. **`User_Type_vod__c` majority** among the profile's active users: the same regex table is applied to the majority picklist value (e.g. `Primary Care Rep` → `sales_rep`, `MSL` → `msl`). Requires `UserSummary` aggregates (§4.4). Applied only when step 2 returned `other`.
4. **Permission-set / licence hints**: all users hold a permission set matching `medical|msl` → `msl`; profile `userLicense` ∈ {`Salesforce Platform`, `Salesforce Integration`, `Identity`} or `PermissionsModifyAllData` with 0 mobile users → `admin`.
5. Otherwise `other`.

Users override the whole table from the CLI with `--classification ./rules.json`
(`{ rules: ClassificationRule[], categoryOverrides, countryOverrides }`), merged into
`ClassifyOptions`. The docs index lists every profile with category + rationale so a wrong
guess is visible in one place.

### 2.2 Profiles with 0 active users

Kept in the snapshot, classified normally, rendered in the docs with disposition
**`drop (0 active users)`**, and **excluded from the Vault plan** unless
`classify.keepEmptyProfiles: true`.

---

## 3. Country model

`CountryCode` = ISO-3166-1 alpha-2, upper-case; `"GLOBAL"` = no country signal.

### 3.1 Country universe (`OrgSnapshot.countries`)

Built during extraction from these sources, in priority order (`CountryRef.sources[]`
records which ones fired):

| # | Source | Query / describe | Notes |
|---|---|---|---|
| 1 | `User.Country_Code_vod__c` | `SELECT Country_Code_vod__c, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY Country_Code_vod__c` | Mandatory in Veeva since 22R1 **[verified]**. Only if the field exists in `describe User`. |
| 2 | `User.CountryCode` / `User.Country` | `GROUP BY CountryCode` then `GROUP BY Country` | Standard fields. Free-text `Country` normalised with a built-in name→ISO2 map (`model/countries.ts`, ~250 rows); unknown names kept raw and warned. |
| 3 | `Country_vod__c` **object** | `SELECT Id, Name, Country_Code_vod__c FROM Country_vod__c` | Only if present in global describe (**[unverified]** — probably absent in SFDC Veeva CRM; likely a Vault-ism). Adds `CountryRef.id`/`name`. |
| 4 | `Account.Country_vod__c`, `Address_vod__c.Country_vod__c` picklist values | from `describe` | Extends the universe (countries with data but no users yet); `activeUsers = 0`. |
| 5 | Profile-name tokens | `countriesFromProfileName()` | Accepted only when the token is in the universe from 1–4 or in `options.countries`. |
| 6 | VMOC where clauses | `countriesFromWhereClause()` on `Where_Clause_vod__c` | Literal ISO codes next to a `country` field. |

`options.countries` (CLI `--countries DE,FR`) filters documentation and plan, not extraction.

### 3.2 Profile → countries (`classifyProfile`)

`countries = override ?? unique(fromName ∪ fromUsers ∪ fromVmoc)`; empty → `["GLOBAL"]`.
Additionally: a profile is marked `shared: true` when it has users in ≥ 2 countries and no
country holds ≥ 80 % of them and no name token exists. Shared profiles appear under every
country they serve, with a "shared with …" note.

### 3.3 Global core + local delta

Vault CRM separates *access* (security profile + permission sets) from *application
behaviour* (application profile → Veeva Settings + VMOCs). The documentation and the plan
therefore express each country × category as **the global baseline plus a delta**:

- **Baseline for a category** (`model/baseline.ts`): the `GLOBAL`-bucket profile of that
  category with the most active users; if none, a synthetic baseline built by majority vote
  per item (object permission, field permission, record-type visibility, layout per record
  type, setting field, VMOC per object×device) across all country profiles of that category.
- **Delta** = every item whose value in the country profile differs from the baseline.
  Kinds: `setting`, `vmoc`, `object_perm`, `field_perm`, `record_type`, `layout`, `tab`,
  `message`. Each delta gets an id `<CC>-<nn>`, a reason-code column (empty; to be filled
  by the country admin: `REG`/`LANG`/`INTEG`/`PROC`/`LEGACY`) and a status `proposed`.
- Absence means inheritance; "same as global" is never written.

---

## 4. Extraction plan (`sfdc/`)

### 4.1 Client (`sfdc/client.ts`)

- Auth (`SfdcAuth` union, matching `cli.ts`):
  - `token`: `{ instanceUrl, accessToken }`.
  - `client_credentials`: `POST {loginUrl}/services/oauth2/token` body `grant_type=client_credentials&client_id&client_secret` (**[verified]**; `loginUrl` must be the My Domain host). `instance_url` from the response overrides `instanceUrl`.
  - `jwt`: RS256 via `node:crypto` `sign("RSA-SHA256")`; claims `{ iss: clientId, sub: username, aud: loginUrl, exp: now+180s }`; `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…`.
  - On HTTP 401 `INVALID_SESSION_ID` re-authenticate once and retry (no refresh tokens in either flow).
- Version: `GET {instanceUrl}/services/data/` → highest `version` unless `apiVersion` given.
- Every response: parse `Sforce-Limit-Info: api-usage=used/max`; keep `requestsMade`, `apiUsage`. Abort with `ExtractionBudgetExceeded` when `requestsMade >= maxRequests` (default 20 000) or on 403 `REQUEST_LIMIT_EXCEEDED`.
- Retries: 5xx and network errors → 3 retries, exponential back-off (500 ms, 2 s, 8 s). 429/`REQUEST_LIMIT_EXCEEDED` → no retry (fail the stage; the snapshot is not written partially).
- Pagination: `query()` and `toolingQuery()` follow `nextRecordsUrl` while `done === false`; send `Sforce-Query-Options: batchSize=2000`. Never keep more than one open cursor: pages are drained before the next query starts.
- Tooling `Metadata` blobs: **one record per query**; use `POST /tooling/composite` with 25 `GET /tooling/sobjects/{Type}/{Id}` sub-requests per call (`compositeGet(type, ids)`), falling back to single GETs if the org rejects `/tooling/composite` (400) — recorded as a warning once.
- Describe caching: optional `describeCacheDir`; send `If-Modified-Since` and reuse on 304.

### 4.2 Call order (`sfdc/extract.ts`) — every query text lives in `sfdc/queries.ts`

| Step | Endpoint / SOQL | Persisted as |
|---|---|---|
| A1 | auth; `GET {id}` identity URL → `organization_id` | `orgId` |
| A2 | `GET /services/data/`, `GET /limits` | `apiVersion`, `limits.dailyApiRequests` |
| B1 | `GET /sobjects/` (global describe) | object universe: keep `layoutable` objects, `customSetting: true` objects, and skip `__Share/__History/__Feed/__ChangeEvent/__Tag/__mdt`. Default object set = Veeva core list (`queries.ts` `CORE_OBJECTS`: Account, Contact, User, Address_vod__c, Child_Account_vod__c, TSF_vod__c, Call2_vod__c, Call2_Detail_vod__c, Call2_Discussion_vod__c, Call2_Key_Message_vod__c, Call2_Sample_vod__c, Product_vod__c, Key_Message_vod__c, Product_Metrics_vod__c, Cycle_Plan_vod__c, Time_Off_Territory_vod__c, Medical_Inquiry_vod__c, Medical_Insight_vod__c, EM_Event_vod__c, EM_Attendee_vod__c, Sample_Transaction_vod__c, Sample_Lot_vod__c, Sample_Limit_vod__c, Approved_Document_vod__c, Sent_Email_vod__c, CLM_Presentation_vod__c, Order_vod__c, Order_Line_vod__c, Multichannel_Activity_vod__c, Message_vod__c, VMobile_Object_Configuration_vod__c) ∪ every non-`_vod` custom object; `includeManagedObjects` adds every `_vod__c`; `objects` overrides. |
| B2 | Tooling `SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject` | `01I…` id ↔ API name map (needed to decode `TableEnumOrId`) |
| B3 | per object: `GET /sobjects/{name}/describe` | `ObjectConfig.fields`, `recordTypes` (from `recordTypeInfos`), picklist values, `childRelationships`; keep `permissionable`, `nillable`, `calculated` |
| B4 | `SELECT Id, Name, DeveloperName, SobjectType, IsActive, NamespacePrefix, Description FROM RecordType` | `RecordTypeConfig` (joined to B3) |
| C1 | `SELECT Id, Name, UserLicenseId, UserLicense.Name, UserType, Description, <PermissionsXxx…> FROM Profile` — the `PermissionsXxx` column list is generated from `GET /sobjects/Profile/describe` | `ProfileConfig` base + `userPermissions[]` (names of true flags) |
| C2 | `SELECT Id, Name, Label, IsOwnedByProfile, ProfileId, NamespacePrefix, IsCustom, Type, Description FROM PermissionSet` | profile ↔ hidden permission set (`IsOwnedByProfile = true`), custom sets |
| C3 | `SELECT ParentId, Parent.ProfileId, SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions` | `objectPermissions[]` (absence = no access). Add `PermissionsViewAllFields` only if in the describe. |
| C4 | per object in the extract set: `SELECT ParentId, Parent.ProfileId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '{obj}'` (run `SELECT COUNT() …` first to log the size) | `fieldPermissions[]`; non-permissionable fields defaulted to read/edit from B3 |
| C5 | `SELECT ParentId, Parent.ProfileId, Name, Visibility FROM PermissionSetTabSetting` | `tabVisibilities[]` |
| C6 | `SELECT ParentId, Parent.ProfileId, SetupEntityId, SetupEntityType FROM SetupEntityAccess WHERE SetupEntityType IN ('TabSet','ApexClass','ApexPage','CustomPermission','FlowDefinition')` + `SELECT Id, ApplicationId, Name, Label, NamespacePrefix FROM AppMenuItem WHERE Type = 'TabSet'` | `applicationVisibilities[]` (visible; `default` only from C9) |
| C7 | `SELECT PermissionSetId, PermissionSet.Name, COUNT(Id) n FROM PermissionSetAssignment WHERE Assignee.IsActive = true AND PermissionSet.IsOwnedByProfile = false GROUP BY PermissionSetId, PermissionSet.Name` and `… GROUP BY Assignee.ProfileId, PermissionSetId` | `PermissionSetConfig.assignedUserCount`, `ProfileConfig.permissionSetNames` |
| C8 | `SELECT ProfileId, Country_Code_vod__c, User_Type_vod__c, LanguageLocaleKey, COUNT(Id) n FROM User WHERE IsActive = true AND UserType = 'Standard' GROUP BY ProfileId, Country_Code_vod__c, User_Type_vod__c, LanguageLocaleKey` (fields dropped when absent; fallback `CountryCode`) | `UserSummary[]`, `ProfileConfig.activeUsersByCountry`, `CountryRef.activeUsers` |
| C9 | Tooling composite `GET /tooling/sobjects/Profile/{Id}` → `Metadata.recordTypeVisibilities[]`, `applicationVisibilities[]`, `tabVisibilities[]`, `layoutAssignments[]` **[unverified whether the org exposes `Profile.Metadata`]** | `recordTypeVisibilities[]`, default app/record type. If 400/absent → warning `profile_metadata_unavailable`; record-type visibility then falls back to `describe.recordTypeInfos.available` (running user only) and is flagged per profile. |
| D1 | Tooling `SELECT Id, Name, TableEnumOrId, LayoutType, NamespacePrefix, ManageableState FROM Layout` | layout id list |
| D2 | Tooling `SELECT Id, ProfileId, LayoutId, RecordTypeId, TableEnumOrId FROM ProfileLayout` (`RecordTypeId = null` → master) | `layoutAssignments[]` (the authoritative source; C9 only cross-checks) |
| D3 | Tooling composite `GET /tooling/sobjects/Layout/{Id}` → `Metadata.layoutSections[].layoutColumns[].layoutItems[] { field, behavior }`, `relatedLists[]`, `customButtons[]`, `excludeButtons[]`, `quickActionList` | `LayoutConfig` — only layouts assigned to at least one profile in scope (D2) |
| D4 | Tooling composite `GET /tooling/sobjects/RecordType/{Id}` → `Metadata.picklistValues[]` | `RecordTypeConfig.picklistValues` (per-record-type subsets) |
| E1 | Tooling `SELECT Id, ValidationName, Active, EntityDefinition.QualifiedApiName, ErrorMessage, NamespacePrefix FROM ValidationRule` + composite for `Metadata.errorConditionFormula` (non-managed only) | `validationRules[]` |
| E2 | Tooling `SELECT Id, Name, TableEnumOrId, Status, NamespacePrefix FROM ApexTrigger`; `SELECT Id, DeveloperName, MasterLabel, ActiveVersionId, NamespacePrefix FROM FlowDefinition`; `SELECT Id, Name, TableEnumOrId, NamespacePrefix FROM WorkflowRule` | `automation` inventory (names only; bodies grepped for `country|Country_Code_vod|'[A-Z]{2}'` to flag `countryLogic: true`) |
| F1 | per custom-setting object (B1): Tooling composite `GET /tooling/sobjects/CustomObject/{Id}` → `Metadata.customSettingsType` | `settingObjects[]` (`Hierarchy` / `List`) |
| F2 | per hierarchy setting: `SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name, <all custom fields> FROM {Setting}` | `VeevaSettingRecord[]` (`level` by `SetupOwnerId` prefix `00D`/`00e`/`005`) |
| G1 | `SELECT Id, Name, Object_Name_vod__c, Profile_ID_vod__c, Profile_Name_vod__c, Device_vod__c, Active_vod__c, Where_Clause_vod__c, Type_vod__c, Enable_Enhanced_Sync_vod__c, Meta_Data_Only_vod__c, Field_List_vod__c, Exclude_Field_List_vod__c, Include_Related_Objects_vod__c, Parent_Object_Name_vod__c, Account_Lookup_Field_vod__c FROM VMobile_Object_Configuration_vod__c` (unknown columns dropped via describe) | `VmocConfig[]` (`profile` resolved from 18-char `Profile_ID_vod__c`, 15-char ids flagged) |
| G2 | `SELECT Id, Name, Category_vod__c, Language_vod__c, Text_vod__c, Active_vod__c, LastModifiedById, LastModifiedBy.Name FROM Message_vod__c` (paginated; can be 100k+ rows — `messageFilter` option: `all` / `referenced` (default: languages in use by active users + `en_US`)) | `VeevaMessage[]` |

Steps are independent enough to run **sequentially**; there is no parallelism (one open
cursor, simple budget accounting). Progress is logged per step with the running
`api-usage` figure. Budget estimate, mid-size org (600 objects, 60 profiles): B3 ≈ 600,
C4 ≈ 2 000 pages, C9/D3/D4/F1 ≈ 100 composite calls, rest < 100 → **≈ 3 000 calls**, far
below any daily limit; the `FieldPermissions` pages dominate.

### 4.3 Failure policy

A step that fails on a *missing field/object* (400 `INVALID_FIELD`/`INVALID_TYPE`) is
retried once with the offending column removed (the client parses the error message for
the field name), then skipped with a warning. Any other failure aborts the stage without
writing `snapshot.json`.

### 4.4 Snapshot schema (`model/types.ts`)

Already present: `OrgSnapshot`, `ProfileConfig`, `PermissionSetConfig`, `ObjectConfig`,
`FieldConfig`, `PicklistValue`, `RecordTypeConfig`, `LayoutConfig`, `LayoutSection`,
`ValidationRuleConfig`, `VmocConfig`, `VeevaSettingRecord`, `VeevaMessage`, `CountryRef`,
`ExtractionWarning`, plus the classification and Vault types. **Additions** (all optional
so existing tests keep passing):

```ts
export interface UserSummary {            // aggregate, PII-free
  profileId: string; profileName: string;
  country: CountryCode;                    // from Country_Code_vod__c, else CountryCode, else "GLOBAL"
  userType: string | null;                 // User_Type_vod__c
  language: string | null;                 // LanguageLocaleKey
  activeUsers: number;
}
export interface SettingObjectMeta { apiName: string; label: string; type: "Hierarchy" | "List"; fields: string[]; }
export interface AutomationItem { kind: "apex_trigger" | "flow" | "workflow_rule"; name: string; object: string | null; active: boolean; managed: boolean; countryLogic: boolean; }
export interface LayoutItem { field: string; behavior: "Edit" | "Required" | "Readonly"; }
// LayoutSection gains `items?: LayoutItem[]` (fields[] stays for compatibility)
// LayoutConfig gains `buttons?: string[]`, `managed: boolean`
// RecordTypeConfig gains `picklistValues?: Record<string, string[]>`, `object: string`
// ProfileConfig gains `userPermissions: string[]`, `permissionSetId: string`, `repTypeCounts: Record<string, number>`, `shared?: boolean`
// VmocConfig gains `profileId: string | null`, `enhancedSync: boolean`, `metaDataOnly: boolean`
// CountryRef gains `sources: ("user_country_code_vod" | "user_country" | "country_object" | "picklist" | "profile_name" | "vmoc")[]`
// OrgSnapshot gains `users: UserSummary[]`, `settingObjects: SettingObjectMeta[]`, `automation: AutomationItem[]`,
//   `limits?: { dailyApiRequestsMax: number; dailyApiRequestsRemaining: number; requestsUsed: number }`,
//   `extract: { objectsRequested: string[]; profileMetadataAvailable: boolean; compositeAvailable: boolean }`
```

`ClassifiedProfile` gains `shared: boolean`; `CountryRepConfig` gains
`deltas: DeltaItem[]` and `baselineProfile: string | null`:

```ts
export interface DeltaItem {
  id: string;                                  // "DE-04"
  kind: "setting" | "vmoc" | "object_perm" | "field_perm" | "record_type" | "layout" | "tab" | "message";
  item: string;                                // "Veeva_Settings_vod__c.ENABLE_SAMPLE_OPT_IN_vod__c"
  globalValue: string; localValue: string;
  evidence: string;                            // "snapshot 2026-09-07, profile DE Sales Rep"
  reasonCode: "" | "REG" | "LANG" | "INTEG" | "PROC" | "LEGACY";
  status: "proposed";
}
```

---

## 5. Documentation plan (`docs/render.ts`)

Output is Markdown (plus CSV twins for the tabular parts), deterministic (sorted keys,
injectable `now`), written under `outDir/docs/`:

```
docs/
  README.md                      index: org facts, persona matrix, countries, warnings, how to read
  global/README.md               global core: org-level settings, object catalogue summary, shared objects/record types
  global/<category>.md           baseline per rep category (what every country inherits)
  global/objects.md              every extracted object: fields (custom/non-vod highlighted), record types, layouts
  global/settings.md             every setting field: org default + per-profile matrix (wide table, also settings.csv)
  global/vmocs.md                VMOC matrix object × profile × device (+ vmocs.csv)
  global/messages.md             message counts per category × language; customer-modified list
  global/unmapped.md             automation inventory + everything with no Vault equivalent
  <CC>/README.md                 country overview: rep matrix, users, languages, delta matrix, checklist
  <CC>/<category>.md             one file per rep category present in the country
  <CC>/delta.csv                 all DeltaItems of the country (the "Local Delta Sheet")
  persona-matrix.csv             country × rep type × profile × active users × target Vault names
```

### 5.1 `README.md` (index)

1. **Org** — instance URL, org id, API version, extracted-at, objects/profiles/users counts, API calls used.
2. **Persona matrix** — `| Country | Rep category | Profile | Active users | User types | Disposition | Vault security profile | Vault application profile | Doc |` (disposition: `keep` / `drop (0 users)` / `shared`).
3. **Countries** — `| Code | Name | Active users | Sources | Profiles | Docs |`.
4. **Classification** — `| Profile | Category | Countries | Rationale |` (one row per profile; this is where a wrong guess is spotted).
5. **Warnings** — every `ExtractionWarning` (`| Stage | Message |`).

### 5.2 `<CC>/README.md`

1. Header: country, active users, languages in use, rep categories present, shared profiles.
2. **Rep types** — `| Category | Profile(s) | Active users | User_Type_vod values | Deltas |`.
3. **Delta matrix** — rows = delta items of any category in this country, columns = categories; glyph `=` inherits, `Δ` delta, `✗` feature off.
4. **Country-level data hooks** (informational, from the snapshot): sample limit templates / signature pages / Network additional countries — listed only when the objects were extracted.
5. **Manual checklist for this country** (from the plan's `manual` steps filtered by country).

### 5.3 `<CC>/<category>.md` and `global/<category>.md` (same template)

| § | Section | Table |
|---|---|---|
| 1 | Summary | profile(s), active users, category rationale, baseline profile used for deltas |
| 2 | Access — objects | `| Object | C | R | E | D | View all | Modify all | Δ |` (only objects in the extract set; Δ marks a delta vs baseline) |
| 3 | Access — fields | per object, **custom and non-inherited fields only**: `| Object | Field | Read | Edit | Δ |`; full FLS in `<category>.fls.csv` |
| 4 | Record types & layouts | `| Object | Record type | Visible | Default | Layout | Δ |` |
| 5 | Layout detail | per assigned layout: `| Section | Field | Behaviour |` + related lists + buttons (collapsed under `<details>`) |
| 6 | Veeva Settings | `| Setting object | Field | Org default | This profile | Δ |` — only fields that have a profile-level row *or* differ; user-level rows listed under "Anomalies" |
| 7 | VMOCs | `| Object | Device | Active | Enhanced sync | Where clause | Country filter | Δ |` |
| 8 | Messages | messages referenced by this profile's settings (`Name;;Category` pointers) + languages available: `| Name | Category | Languages | Missing |` |
| 9 | Tabs & apps | `| Tab | Visibility |`, `| App | Visible | Default |` |
| 10 | Delta vs global | `| Delta ID | Kind | Item | Global | Local | Reason | Evidence | Status |` — same rows as `delta.csv` filtered to this category; in `global/<category>.md` this section says "this is the baseline" |
| 11 | Vault CRM target | names this profile maps to (§6.2), the plan step ids, and the manual items |

Rendering rules: tables sorted by API name; booleans as `✓`/`·`; long formulas/where
clauses in code spans; every file starts with a generated-header (`snapshot`, `extractedAt`,
`tool version`) so the docs are their own "as-is evidence".

---

## 6. Vault CRM setup plan (`vault/`)

### 6.1 Name conversion (`vault/mdl.ts` `toVaultName`)

- `Xxx_vod__c` → `xxx__v` (lower snake). `Xxx__c` → `xxx__c`. Standard `Account`/`User` → `account__v`/`user__v`. `Call2_vod__c` → `call2__v`.
- Profile / permission set / application profile: `slug = lower(name).replace(/[^a-z0-9]+/g,"_")`, then `sp_<slug>__c`, `ps_<slug>__c`, `app_<slug>__c`; with `profileStrategy: "consolidate"` (opt-in) the category is used instead: `sp_<category>__c`, `ps_<category>__c`, `app_<category>[_<cc>]__c` (country suffix only when the country has a settings/VMOC delta).
- Record type `Xxx_vod` → object type `xxx__v` (exists on Veeva objects), customer `Xxx` → `xxx__c`. Picklist values `Submitted_vod` → `submitted__v`, customer → `<value_slug>__c`.
- Layout `Call2_vod__c-Call Layout DE` → `Pagelayout.call2__v.call_layout_de__c`.

### 6.2 Mapping table

| Veeva CRM (Salesforce) | Vault CRM | Automation | Plan step kind |
|---|---|---|---|
| Custom object `Xxx__c` (non-vod) | `Object xxx__c` | `RECREATE Object` MDL with fields, `Objecttype base__v` | `mdl` |
| Custom field on Veeva/standard object | `ALTER Object <obj> ( ADD Field <f>__c (…) )` | MDL; type map: Text→`String(max_length)`, Number→`Number(precision,scale)`, Checkbox→`Boolean`, Date/DateTime→`Date`/`DateTime`, Picklist→`Picklist(picklist('<name>__c'))`, Lookup→`Object(object('<target>'))`, Formula→`Formula` **only if** the formula is a plain field reference/arithmetic (else manual), LongText→`LongText`, Email/Phone/URL→`String` | `mdl` |
| Picklist values (custom or added to a Veeva picklist) | global `Picklist <name>` values | `POST /objects/picklists/{name}` (`value_1=Label`) for existing picklists; `RECREATE Picklist` for new ones | `api` / `mdl` |
| Record type (active, visible to ≥1 in-scope profile) | `Objecttype` on the object | `ALTER Object … ( ADD Objecttype <t>__c (label(…), active(true)) )` for customer record types; Veeva `_vod` record types assumed to exist as `__v` object types → `GET /metadata/vobjects/{obj}` pre-check, else manual | `mdl` |
| Page layout | `Pagelayout` component | Generated `RECREATE Pagelayout` with sections/`Layoutfield` sub-components **[unverified grammar]** — emitted as `mdl` step flagged `review: true`; apply refuses `review` steps unless `--allow-review` | `mdl` |
| Profile object/field/tab permissions + layout assignments | `Permissionset ps_*__c` | `RECREATE Permissionset` with `Objectpermission`, `Fieldpermission`, `Tabpermission`, page-layout assignment per object type **[sub-component names unverified]** | `mdl` |
| Profile | `Securityprofile sp_*__c` referencing the permission set | `RECREATE Securityprofile` | `mdl` |
| Profile as Veeva-settings/VMOC scope | `application_profile__v` record | `POST /vobjects/application_profile__v` JSON `[ { name__v } ]` | `api` |
| Veeva Settings org row | `veeva_settings__v` global record (exists) → `PUT /vobjects/veeva_settings__v/{id}` | field names `ENABLE_X_vod__c` → `enable_x__v`; unknown target fields (checked against `GET /metadata/vobjects/veeva_settings__v` when vault creds are given) → manual | `api` |
| Veeva Settings profile row | `veeva_settings__v` record with `application_profile__v = {{step:app_*.id}}` | `POST /vobjects/veeva_settings__v` | `api` |
| Other `*_Settings_vod__c` | `*_settings__v` objects | same pattern; object existence pre-checked | `api` / manual |
| VMOC | `vmobile_object_configuration__v` record | `POST /vobjects/vmobile_object_configuration__v` with `object_name__v` (converted), `device__v`, `active__v`, `where_clause__v` (field names converted, `@@VOD_*@@` tokens kept and flagged), `application_profile__v` | `api`, always `review: true` |
| Veeva Messages (customer-modified / referenced) | Message Catalog via Bulk Translations | `vault-plan/translations/<lang>.csv` + manual import step; `message__v` records are *not* written directly | `manual` |
| User-level setting rows | — | manual anomaly list | `manual` |
| Validation rule | none (lifecycle/layout rules) | manual with formula text | `manual` |
| Apex / Flow / Workflow / VF / LWC / MyInsights | none | `unmapped[]` + manual | `manual` |
| Sharing rules, territories, Network/Align config, reports | none | manual | `manual` |

### 6.3 Plan model (`vault/plan.ts`)

`buildVaultPlan(classified, opts): VaultPlan` is pure. Steps are created in dependency
order and carry `dependsOn`: picklists → objects/fields → object types → layouts →
permission sets → security profiles → application profiles → settings records → VMOCs →
manual. Step ids are stable and derived from the source (`ps:DE Sales Rep`,
`field:Account.DE_Pharmacy_Id__c`), so re-running `plan` yields the same ids and diffs are
meaningful. `PlanStep` gains `review?: boolean`, `captures?: { recordId: string }` and API
bodies may contain `"{{step:<id>.recordId}}"` placeholders.

`writePlan(plan, dir)` writes:

```
vault-plan/
  plan.json                 the VaultPlan
  mdl/NNN-<stepId>.mdl      one file per MDL step (NNN = topological order)
  all.mdl                   concatenation in order (for manual `POST /api/mdl/execute` or VPK authoring)
  api/NNN-<stepId>.json     { method, path, body, contentType }
  translations/<lang>.csv   Bulk Translations input
  manual-checklist.md       grouped by country → category; every manual step + unmapped[]
  summary.md                counts per kind/country, review-flagged steps, unmapped
```

### 6.4 Apply model (`vault/apply.ts`, `vault/client.ts`)

- Auth (`VaultAuth`): `session` `{ vaultDns, sessionId }` or `password` → `POST /api/{v}/auth` form `username,password` (**[verified]**). Header `Authorization: {sessionId}` (no `Bearer`) **[verified]**, plus `X-VaultAPI-ClientID: lastest-veeva-crm-migration`. Version default `v26.2`, or highest from `GET /api`.
- `responseStatus !== "SUCCESS"` → error with `errors[]`. Honour `X-VaultAPI-BurstLimitRemaining`: below 20, sleep until the 5-minute window resets.
- Order: topological by `dependsOn`; a step runs only when all dependencies are `applied` or `skipped`.
- **Idempotent**: MDL uses `RECREATE`/`ALTER … ADD` and each step has a `precheck` (`GET /configuration/{type}.{name}` or `GET /metadata/vobjects/{obj}/fields/{f}` or VQL `SELECT id FROM {obj} WHERE name__v = '…'`); if the target already matches the step is `skipped` with `message: "already present"`. Record steps use the precheck id for `PUT` instead of `POST`.
- MDL execution: `POST /api/mdl/execute` (`Content-Type: text/plain`); `execute_async` + polling `GET /api/mdl/execute_async/{job_id}/results` when the step touches an `Object` and the caller set `asyncMdl: true`.
- **Stop on first failure**: remaining steps are reported `skipped` with `message: "not run: <failedStepId> failed"`. `review` steps are `skipped` unless `allowReview`. Manual steps are reported `manual`.
- `dryRun` (default): no request except the optional version discovery; every step is reported as `applied` with `message: "dry-run"` and the request that *would* be sent.
- Output: `ApplyReport` JSON + `apply-report.md` (table `| # | Step | Kind | Country | Status | Message |`, then failures with the raw Vault response).

---

## 7. Module layout (`src/`)

Barrels required by `package.json` exports: `model/index.ts`, `sfdc/index.ts`,
`docs/index.ts`, `vault/index.ts` re-export their directory.

```ts
// model/types.ts — all interfaces of §4.4 / §6.3 (no code)
// model/classify.ts (exists)
export function classifyProfileName(name, rules?): { category; rule }
export function countriesFromProfileName(name, known?): CountryCode[]
export function countriesFromWhereClause(where): CountryCode[]
export function classifyProfile(profile, snapshot, options?): ClassifiedProfile
export function classifySnapshot(snapshot, options?): ClassifiedSnapshot   // also fills deltas via baseline.ts
// model/baseline.ts (new, pure)
export function computeBaseline(category: RepCategory, profiles: ClassifiedProfile[], snapshot: OrgSnapshot): BaselineConfig
export function computeDeltas(country: CountryCode, rep: CountryRepConfig, baseline: BaselineConfig): DeltaItem[]
// model/countries.ts (new) — COUNTRY_NAMES: Record<string, CountryCode>; export function normalizeCountry(raw: string): CountryCode | null

// sfdc/client.ts
export type SfdcAuth = { kind: "token"; instanceUrl; accessToken } | { kind: "client_credentials"; loginUrl; instanceUrl?; clientId; clientSecret } | { kind: "jwt"; loginUrl; instanceUrl?; clientId; username; privateKey }
export interface SfdcClient {
  readonly instanceUrl: string; readonly apiVersion: string; readonly orgId?: string;
  readonly stats: { requests: number; apiUsage?: { used: number; max: number } };
  get<T>(path: string, init?: { headers? }): Promise<T>;                      // path relative to /services/data/vXX.0
  query<T>(soql: string): Promise<T[]>;                                        // drains all pages
  toolingQuery<T>(soql: string): Promise<T[]>;
  describe(object: string): Promise<DescribeSObject>;
  describeGlobal(): Promise<DescribeGlobal>;
  compositeGet<T>(toolingType: string, ids: string[]): Promise<T[]>;          // 25 per call, fallback to single GET
}
export async function createSfdcClient(auth: SfdcAuth, opts?: { fetch?; log?; apiVersion?; maxRequests? }): Promise<SfdcClient>
export class SfdcApiError extends Error { status: number; errorCode?: string; body: unknown }
export function parseLimitInfo(header: string | null): { used: number; max: number } | undefined

// sfdc/queries.ts — pure builders, all SOQL text lives here
export const CORE_OBJECTS: readonly string[]
export function profileQuery(permissionFields: string[]): string
export function objectPermissionsQuery(hasViewAllFields: boolean): string
export function fieldPermissionsQuery(object: string): string
export function userSummaryQuery(available: { countryCodeVod: boolean; userType: boolean }): string
export function settingRecordsQuery(setting: string, fields: string[]): string
export function vmocQuery(fields: string[]): string
export function messageQuery(languages?: string[]): string
export function chunkIds(ids: string[], size?: number): string[][]

// sfdc/extract.ts
export interface ExtractOptions { apiVersion?; objects?: string[]; includeManagedObjects?: boolean; maxRequests?: number; messageFilter?: "all" | "referenced"; describeCacheDir?: string; log?; now? }
export async function extractOrgSnapshot(client: SfdcClient, opts?: ExtractOptions): Promise<OrgSnapshot>
// internal, exported for tests: buildObjectConfig(describe, tooling), assembleProfiles(rows…), settingLevel(setupOwnerId), decodeLayoutMetadata(meta, idMap)

// docs/render.ts
export interface RenderedDoc { path: string; content: string }               // path relative to docs/
export function renderDocs(classified: ClassifiedSnapshot, opts?: { now?; toolVersion? }): RenderedDoc[]
export function renderIndex(c), renderGlobal(c), renderCountry(country: CountryConfig, c), renderRepCategory(rep: CountryRepConfig, c, baseline): RenderedDoc[]
export function markdownTable(headers: string[], rows: string[][]): string; export function csv(rows: string[][]): string
export async function writeDocs(docs: RenderedDoc[], dir: string): Promise<string[]>

// vault/client.ts
export type VaultAuth = { kind: "session"; vaultDns; sessionId } | { kind: "password"; vaultDns; username; password }
export interface VaultClient {
  readonly vaultDns: string; readonly apiVersion: string;
  request<T = VaultResponse>(call: VaultApiCall): Promise<T>;                 // path relative to /api/{version}; "/mdl/…" and "/api" are unversioned
  executeMdl(script: string, opts?: { async?: boolean }): Promise<MdlExecuteResponse>;
  vql<T>(q: string): Promise<T[]>;                                            // POST /query, follows responseDetails.next_page
  componentExists(type: string, name: string): Promise<boolean>;             // GET /configuration/{type}.{name}
}
export async function createVaultClient(auth: VaultAuth, opts?: { fetch?; log?; apiVersion? }): Promise<VaultClient>
export class VaultApiError extends Error { errors: { type: string; message: string }[] }

// vault/mdl.ts — pure string generation
export function toVaultName(sfdcApiName: string): string
export function toVaultProfileNames(profile: ClassifiedProfile, strategy: "one_to_one" | "consolidate", country?: CountryCode): { securityProfile; permissionSet; applicationProfile }
export function mdlObject(object: ObjectConfig): string
export function mdlAddField(object: string, field: FieldConfig): string | null   // null when not expressible
export function mdlPicklist(name: string, values: PicklistValue[]): string
export function mdlObjectType(object: string, rt: RecordTypeConfig): string
export function mdlPageLayout(layout: LayoutConfig): string
export function mdlPermissionSet(name: string, profile: ProfileConfig, objects: ObjectConfig[]): string
export function mdlSecurityProfile(name: string, label: string, permissionSets: string[]): string
export function convertWhereClause(where: string): { text: string; unresolvedTokens: string[] }
export function mdlEscape(s: string): string                                  // single quotes doubled

// vault/plan.ts
export interface VaultPlanOptions { apiVersion?; vaultDns?; profileStrategy?: "one_to_one" | "consolidate"; keepEmptyProfiles?: boolean; now? }
export function buildVaultPlan(classified: ClassifiedSnapshot, opts?: VaultPlanOptions): VaultPlan
export function orderSteps(steps: PlanStep[]): PlanStep[]                      // topological, throws on cycle
export async function writePlan(plan: VaultPlan, dir: string): Promise<string[]>
export function renderManualChecklist(plan: VaultPlan): string; export function renderPlanSummary(plan: VaultPlan): string

// vault/apply.ts
export interface ApplyOptions { dryRun: boolean; allowReview?: boolean; asyncMdl?: boolean; log?; now? }
export async function applyVaultPlan(client: VaultClient, plan: VaultPlan, opts: ApplyOptions): Promise<ApplyReport>
export async function precheckStep(client, step): Promise<{ exists: boolean; recordId?: string }>
export function resolvePlaceholders(body: unknown, captures: Record<string, { recordId: string }>): unknown
export function renderApplyReport(report: ApplyReport, plan: VaultPlan): string

// index.ts (exists): migrateVeevaCrmConfig, MigrateOptions, MigrateResult, re-exports
// cli.ts (exists): commands extract|document|plan|apply|all; add --classification <file>, --profile-strategy, --allow-review, --message-filter
```

Only `sfdc/client.ts`, `vault/client.ts`, `docs/render.ts#writeDocs`, `vault/plan.ts#writePlan`
and `index.ts` perform I/O. Everything else is a pure function of the snapshot.

---

## 8. Test strategy (vitest, no network)

- **Fake fetch**: `src/test/fake-fetch.ts` exports `fakeFetch(routes: Route[])` where a
  `Route = { method?, match: RegExp | string, reply: (req) => { status?, json?, text?, headers? } }`;
  it records every call (`calls[]`) so tests assert *which* requests were made and how many.
- **Fixtures**: `src/test/fixtures/sfdc/*.json` (global describe, `Call2_vod__c` describe, Profile/PermissionSet/ObjectPermissions/FieldPermissions pages incl. a two-page `nextRecordsUrl` case, Tooling composite responses, settings/VMOC/message rows) forming a tiny synthetic org: 3 countries (DE, FR, GLOBAL), 5 profiles (`DE Sales Rep`, `FR Sales Rep`, `Global MSL`, `DE Field Manager`, `System Administrator`), 3 objects.
- `sfdc/client.test.ts`: client-credentials + JWT token exchange (JWT verified with `crypto.verify` against a test key pair), 401 re-auth once, pagination, `Sforce-Limit-Info` parsing, budget abort, composite chunking of 25 and the single-GET fallback, `INVALID_FIELD` column-drop retry.
- `sfdc/extract.test.ts`: fixtures → `OrgSnapshot` golden file (`snapshot.expected.json`); assert `SetupOwnerId` level decoding, `TableEnumOrId` id mapping, non-permissionable FLS defaulting, warnings when `Profile.Metadata` is absent.
- `model/classify.test.ts` (exists) + `baseline.test.ts`: every regex row, override precedence, `User_Type_vod__c` fallback, country inference from each source, `shared` flag, delta computation (identical → no deltas; one setting flipped → exactly one `setting` delta).
- `docs/render.test.ts`: render the golden snapshot → compare against `src/test/fixtures/docs/**` golden Markdown (update with `UPDATE_GOLDEN=1`); determinism (two renders identical); every profile appears exactly once in the persona matrix; delta rows in `<CC>/delta.csv` equal the union of category sections.
- `vault/mdl.test.ts`: name conversion table (`Call2_vod__c`→`call2__v`, `DE_Pharmacy_Id__c`→`de_pharmacy_id__c`, `Submitted_vod`→`submitted__v`), escaping of quotes, field-type map incl. `null` for inexpressible formulas, where-clause conversion keeps `@@` tokens and reports them.
- `vault/plan.test.ts`: dependency order (picklist before field before permission set before profile), stable ids across two builds, empty profiles excluded, `review` flags on layouts/VMOCs, manual steps for every `unmapped` item, `writePlan` file list.
- `vault/apply.test.ts`: dry-run performs zero non-GET calls; precheck-skip; a failing MDL step marks all dependants `skipped` and `ok=false`; placeholder resolution from a captured record id; report rendering.
- `cli.test.ts`: env → auth object, unknown command → exit 2, `--execute` flips `dryRun`.

---

## 9. Open questions and assumptions (to state in the README)

1. **`Profile.Metadata` via Tooling REST** is unverified. Without it, record-type visibility/defaults and default app per profile have no fetch-only source; the tool falls back to the running user's `describe` view and flags it. Layout assignments do not depend on it (`ProfileLayout`).
2. **Sample-profile names, settings object API names** (`Events_Management_Settings_vod__c`, `Engage_Settings_vod__c`, …) and **VMOC columns** are discovered from describe, never hard-coded; the core object list is a default only.
3. **`Country_vod__c` as an object** probably does not exist in Salesforce Veeva CRM; supported opportunistically.
4. **User-level Veeva Settings** are documented by Veeva as unsupported; extracted and reported as anomalies, never migrated.
5. **Vault MDL grammar** for `Permissionset`, `Securityprofile`, `Pagelayout` sub-components is representative, not verified; generated MDL is flagged `review` and the recommended workflow is: apply one step to a sandbox, `GET /api/mdl/components/{type}.{name}`, diff, adjust `vault/mdl.ts`.
6. **Vault object record field names** for `veeva_settings__v`, `vmobile_object_configuration__v`, `application_profile__v` follow the suffix rule (`_vod__c` → `__v`); the plan verifies them against `GET /metadata/vobjects/{name}` when Vault credentials are supplied and downgrades unknown fields to manual steps.
7. **Vault CRM VMOC tokens** (`@@USER_APP_PROFILE_ID@@` vs Veeva CRM `@@VOD_*@@`) are not mapped; where clauses are converted field-by-field and always reviewed.
8. **Message Catalog** is the source of truth in Vault CRM; only Bulk Translations CSVs are produced. Which `Message_vod__c` rows are "customer-modified" is a heuristic (referenced by settings pointers, or `LastModifiedBy.Name` not matching `/veeva/i`).
9. **API versions**: Salesforce discovered at runtime (docs current at v68.0); Vault default `v26.2` (VAPIL). Both overridable.
10. **API budgets**: Salesforce daily limit shared org-wide — run against a sandbox (5 M/day); Vault burst limit honoured via headers.
11. **Composite call accounting** (`/tooling/composite` = 1 call) is assumed; if the org counts sub-requests the estimate rises ~25× for blob fetches but stays under typical limits.
12. **`one_to_one` profile strategy is the default** because it needs no judgment; `consolidate` (one security profile per rep category + country application profiles only where deltas exist) is the recommended end state and is opt-in.
13. Docs are Markdown/CSV; the xlsx "Configuration Workbook" is out of scope (CSV imports into it).
14. Everything in the snapshot is configuration or aggregate counts; no user names, e-mails or record data are stored, except `LastModifiedBy.Name` on messages (used for the heuristic in 8 and dropped from the docs).
