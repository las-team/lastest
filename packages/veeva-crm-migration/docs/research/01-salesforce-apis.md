# Salesforce platform APIs for extracting Veeva CRM *configuration* over plain HTTPS/JSON

Research date: 2026-09-07. Scope: what a Node `fetch`-only client (no SOAP Metadata API, no jsforce) can use to reconstruct the configuration of a Veeva CRM org (Veeva CRM = managed package, namespace `vod`, on a normal Salesforce org). "Configuration" here means profiles, permission sets, object/field security, page layouts and their assignments, record types, tabs, apps, validation rules, flows, triggers and custom-setting overrides — not business data.

Confidence legend used throughout:

- **[doc]** — wording confirmed from an official Salesforce/Veeva page (via search-engine excerpt; the docs hosts `help.salesforce.com`, `developer.salesforce.com`, `crmhelp.veeva.com`, `developer.veevacrm.com` were unreachable from this environment, so full pages could not be read).
- **[code]** — confirmed from open-source Salesforce client code (`jsforce`, `@salesforce/core`) read from raw.githubusercontent.com.
- **[exp]** — from prior working knowledge of the platform; not re-verified today. Treat as "verify against a real org".

## 0. API versions (as of 2026-09)

- The current REST API Developer Guide PDF is titled "Version 68.0, Winter '27, last updated August 28, 2026" **[doc]** (https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf). That implies Summer '26 = v67.0 is GA and Winter '27 = v68.0 is in preview at the time of writing; the "~v64.0" in the brief is Summer '25 and is one year old. **[exp]** for the season↔version mapping.
- Discover at runtime rather than hard-code: `GET {instance_url}/services/data/` (no auth needed) returns `[{ "label": "Winter '27", "url": "/services/data/v68.0", "version": "68.0" }, ...]`; pick the highest. Everything below works unchanged from at least v50.0 (jsforce's default version is still `'50.0'` **[code]**).

Sources: search result for `resources.docs.salesforce.com/.../api_rest.pdf`; https://raw.githubusercontent.com/jsforce/jsforce/main/src/connection.ts

---

## 1. Authentication for a server-side integration

All flows POST `application/x-www-form-urlencoded` to `/services/oauth2/token` and return the same JSON envelope. Shape (jsforce `TokenResponse`, **[code]**):

```json
{
  "access_token": "00Dxx0000001gPz!AQ...",
  "instance_url": "https://acme.my.salesforce.com",
  "id": "https://login.salesforce.com/id/00Dxx0000001gPzEAI/005xx000001SvogAAC",
  "token_type": "Bearer",
  "issued_at": "1725700000000",
  "signature": "base64(hmac-sha256(id + issued_at, client_secret))",
  "scope": "api id",
  "refresh_token": "…only for flows that issue one…"
}
```

- `instance_url` is **always taken from the token response** and is the base for every subsequent call (`{instance_url}/services/data/vXX.0/...`) **[doc][code]**. Do not derive it from the login host; with My Domain the login host and the instance host differ.
- `id` is the *identity URL*. `GET {id}` with `Authorization: Bearer …` (or `?format=json&oauth_token=…` as jsforce does **[code]**) returns `{ user_id, organization_id, username, display_name, email, user_type, language, locale, active, urls: { rest, sobjects, query, tooling_rest, metadata, profile, ... } }`. `urls.rest` contains a literal `{version}` placeholder. Useful to learn the org id and the running user without a SOQL call. **[exp]** for the exact key list.
- Error envelope: `{"error":"invalid_grant","error_description":"..."}` with HTTP 400. **[exp]**

### 1.1 OAuth 2.0 Client Credentials flow (recommended)

**[doc]** (https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_client_credentials_flow.htm):

- Token endpoint is the org's **My Domain** URL: `https://{mydomain}.my.salesforce.com/services/oauth2/token` (sandbox: `https://{mydomain}--{sbx}.sandbox.my.salesforce.com/services/oauth2/token`). `login.salesforce.com` is not usable for this flow. **[doc]** for My Domain requirement; sandbox host pattern **[exp]**.
- Body: `grant_type=client_credentials&client_id={consumer key}&client_secret={consumer secret}`. Client id/secret may alternatively be sent as HTTP Basic auth. **[doc]**
- Connected app setup: OAuth settings → *Enable Client Credentials Flow*; then *Manage → Edit Policies → Client Credentials Flow → Run As* = the integration user. "Salesforce Client Credentials Flow has no interactive user, so Salesforce needs to know which user's context and permissions to apply to the access token, or it returns `invalid_grant`." **[doc]**
- The access token is issued on behalf of the Run-As user; that user needs the *API Enabled* permission and, for this project, *View Setup and Configuration* plus broad object/field access (see §5.6 on why describe is FLS-filtered). **[doc]** for run-as; **[exp]** for the permission list.
- **No refresh token is issued** — when a call returns 401 `INVALID_SESSION_ID`, POST again for a new token. **[doc]** (this flow "does not support refresh tokens").
- Access-token lifetime follows the connected app / org session timeout policy. **[exp]**

Minimal Node:

```ts
const res = await fetch(`${loginHost}/services/oauth2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id, client_secret }),
});
const { access_token, instance_url } = await res.json();
```

### 1.2 OAuth 2.0 JWT Bearer flow

**[doc]** (https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm) + **[code]** (`@salesforce/core` `src/org/authInfo.ts`):

- JWT header `{"alg":"RS256"}`; Salesforce requires RSA-SHA256 signed with a private key whose certificate is uploaded to the connected app (*Use digital signatures*). `jti` is not required. **[doc]**
- Claims **[code]**: `iss` = consumer key, `sub` = username of the user to impersonate, `aud` = authorization server, `exp` = expiry. `@salesforce/core` builds `{ iss: clientId, sub: username, aud: audienceUrl, exp: now + 300 }` and tries several `(loginUrl, aud)` combinations until one succeeds.
- `aud` values **[exp]**: `https://login.salesforce.com` (production/Developer Edition), `https://test.salesforce.com` (sandbox), or the My Domain login URL; the official page states the assertion must expire "within 3 minutes" (not re-verified today).
- POST to `https://login.salesforce.com/services/oauth2/token` (or `test.salesforce.com` / My Domain) with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={signed JWT}` **[doc][code]**.
- Prerequisite: the user must have pre-authorised the app — connected app policy *Permitted Users = Admin approved users are pre-authorized* and the user's profile or a permission set assigned to the app; otherwise `invalid_grant: user hasn't approved this consumer`. **[doc]** (prior approval), **[exp]** (error text).
- Response: `access_token`, `scope`, `instance_url`, `id`, `token_type` — **no refresh_token**; just mint a new assertion. **[doc]**
- Node: sign with `crypto.sign("RSA-SHA256", data, privateKeyPem)` and base64url; no library needed.

### 1.3 Username-password OAuth flow and SOAP `login()` — avoid

- OAuth username-password: `POST /services/oauth2/token` with `grant_type=password&client_id&client_secret&username&password={password}{securityToken}`. **[doc]**
- **Blocked by default for orgs created in Summer '23 or later** — admins must enable *Allow OAuth Username-Password Flows* under *OAuth and OpenID Connect Settings*. **[doc]** (https://help.salesforce.com/s/articleView?id=release-notes.rn_security_username-password_flow_blocked_by_default.htm)
- Retirement: reported as a **Winter '27 release update** after which connected apps can no longer obtain tokens with this grant (community source citing Salesforce; not read from the release note itself). Salesforce explicitly recommends JWT Bearer or Client Credentials for server-to-server. **[doc]** for the recommendation; retirement date **[inferred from community]**.
- SOAP `login()` (`POST https://login.salesforce.com/services/Soap/u/XX.0`, XML envelope, returns `sessionId` + `serverUrl`) still exists and the returned `sessionId` is usable as a Bearer token for REST/Tooling. It is XML, not JSON, so it is out of scope by the brief; whether the Summer '23 OAuth block also covers SOAP `login()` was not confirmed. **[exp]**

### 1.4 Veeva CRM specifics

- A Veeva CRM org is an ordinary Salesforce org; Veeva's own OAuth documentation only concerns *end-user* login to the Veeva CRM apps (access tokens "are the same as Salesforce session IDs"). Server-side extraction uses the standard flows above with a connected app created in the customer org. **[doc]** (https://crmhelp.veeva.com/doc/Content/CRM_topics/General/Authentication/OAuth2Support.htm)
- `developer.veevacrm.com/api/` is the **Vault CRM** API (Vault platform), not the Salesforce-platform product; it is the migration *target*, not a source for Salesforce-platform configuration. **[doc]** for the URL's existence; scope **[exp]**.

Sources: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_client_credentials_flow.htm · https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_jwt_flow.htm · https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_username_password_flow.htm · https://help.salesforce.com/s/articleView?id=release-notes.rn_security_username-password_flow_blocked_by_default.htm · https://raw.githubusercontent.com/jsforce/jsforce/main/src/oauth2.ts · https://raw.githubusercontent.com/forcedotcom/sfdx-core/main/src/org/authInfo.ts · https://blog.enree.co/2025/09/oauth-username-password-flow-disabled-in-salesforce-what-it-means-what-to-do

---

## 2. REST API (`/services/data/vXX.0/…`)

Common headers: `Authorization: Bearer {access_token}`, `Accept: application/json`. Every response carries `Sforce-Limit-Info: api-usage=1234/100000` (used/max daily calls) **[exp]**. Errors are a JSON *array*: `[{"message":"...","errorCode":"INVALID_SESSION_ID"}]` (401), `REQUEST_LIMIT_EXCEEDED` (403), `MALFORMED_QUERY`/`INVALID_FIELD`/`INVALID_TYPE` (400) **[exp]**.

| Resource | Method/Path | Notes |
|---|---|---|
| Versions | `GET /services/data/` | unauthenticated; list of `{label,url,version}` |
| Global describe | `GET /services/data/vXX.0/sobjects/` | `sobjects[]` with `name, label, custom, customSetting, queryable, layoutable, keyPrefix, urls`; supports `If-Modified-Since` **[doc]** |
| sObject describe | `GET /sobjects/{name}/describe` | full field/picklist/record-type metadata *as seen by the running user*; `If-Modified-Since` → `304` **[doc]** |
| Layouts | `GET /sobjects/{name}/describe/layouts` and `/describe/layouts/{recordTypeId}` | layouts of the running user's profile **[doc]** |
| Global publisher layout | `GET /sobjects/Global/describe/layouts` | **[exp]** |
| Query | `GET /query?q={urlencoded SOQL}` | `Sforce-Query-Options: batchSize=N` (200–2000) **[exp]** |
| Query more | `GET {nextRecordsUrl}` e.g. `/query/01gXX…-2000` | **[doc]** |
| Query incl. deleted/archived | `GET /queryAll?q=` | not needed for config |
| Limits | `GET /limits` | daily API usage etc. |
| Composite | `POST /composite`, `POST /composite/batch` | bundle up to 25 sub-requests **[exp]** |

### 2.1 `sobjects/{name}/describe`

**[doc]**: "The If-Modified-Since header is a time-based request header. The request is processed only if the data has changed since the date and time specified in the header. Otherwise, a 304 Not Modified status code is returned, and the request isn't processed. This header supports sObject Rows, sObject Describe, Describe Global, and Invocable Actions resources." For describe: "if no available object's metadata has changed since the provided date, a 304 Not Modified status code is returned with no response body." Header format is an HTTP-date, e.g. `If-Modified-Since: Mon, 01 Sep 2026 00:00:00 GMT` **[exp]**.

Response keys that matter for configuration (**[exp]** — standard, stable since API ~v30):

```jsonc
{
  "name": "Call2_vod__c", "label": "Call", "custom": true, "customSetting": false,
  "layoutable": true, "queryable": true, "keyPrefix": "a0P",
  "recordTypeInfos": [
    { "recordTypeId": "012…", "name": "Call", "developerName": "Call_vod",
      "active": true, "available": true, "master": false, "defaultRecordTypeMapping": true,
      "urls": { "layout": "/services/data/v68.0/sobjects/Call2_vod__c/describe/layouts/012…" } }
  ],
  "fields": [
    { "name": "Status_vod__c", "label": "Status", "type": "picklist", "custom": true,
      "length": 255, "nillable": true, "createable": true, "updateable": true,
      "permissionable": true, "restrictedPicklist": false, "dependentPicklist": false,
      "controllerName": null, "inlineHelpText": "…", "calculated": false, "calculatedFormula": null,
      "referenceTo": [], "relationshipName": null, "externalId": false, "unique": false,
      "picklistValues": [ { "value": "Submitted_vod", "label": "Submitted", "active": true, "defaultValue": false, "validFor": "base64 bitmap when dependent" } ] }
  ],
  "childRelationships": [ { "childSObject": "Call2_Detail_vod__c", "field": "Call2_vod__c", "relationshipName": "Call2_Detail_vod__r" } ],
  "urls": { "describe": "…", "layouts": "…/describe/layouts", "sobject": "…" }
}
```

Caveats **[exp]**:

- Describe is **filtered by the running user's FLS**: fields the user cannot read are simply absent; `recordTypeInfos[].available` reflects *that user's* profile. Use a user with admin-level access, and use Tooling `FieldDefinition`/`CustomField` (§3) to enumerate fields independently of FLS.
- Picklist values are org-wide here; per-record-type value subsets are only in `describe/layouts/{recordTypeId}.recordTypeMappings[].picklistsForRecordType` or in Tooling `RecordType.Metadata.picklistValues`.
- Veeva managed-package fields carry `namespacePrefix: "…"`? — no: REST describe does not expose the prefix as a separate key; the `_vod__c` suffix is in `name`. Tooling `CustomField.NamespacePrefix` gives it explicitly.

### 2.2 `sobjects/{name}/describe/layouts[/{recordTypeId}]`

**[doc]**: "Retrieves lists of page layouts and their descriptions. You can request information for all of a specific object's layouts or for layouts associated with a specified record type on a specific object." A dedicated page covers objects with multiple record types (`resources_sobject_layouts_multiple_rts_get.htm`).

Response shape **[exp]**:

```jsonc
{
  "layouts": [ {
    "id": "00h…",
    "detailLayoutSections": [ { "heading": "Information", "columns": 2, "useHeading": true, "useCollapsibleSection": false,
      "layoutRows": [ { "layoutItems": [ { "label": "Account", "required": true, "editableForNew": true, "editableForUpdate": false,
        "layoutComponents": [ { "type": "Field", "value": "Account_vod__c", "details": { /* field describe */ } } ] } ] } ] } ],
    "editLayoutSections": [ /* same shape */ ],
    "highlightsPanelLayoutSection": { "…": "…" },
    "relatedLists": [ { "name": "Call2_Detail_vod__r", "sobject": "Call2_Detail_vod__c", "label": "Call Details",
       "columns": [ { "name": "Product_vod__c", "label": "Product" } ], "sort": [], "limitRows": 5, "buttons": [] } ],
    "buttonLayoutSection": { "detailButtons": [ { "name": "Submit_vod", "label": "Submit", "custom": true } ] },
    "quickActionList": { "quickActionListItems": [] },
    "feedView": null, "saveOptions": [], "mode": "Full"
  } ],
  "recordTypeMappings": [ { "recordTypeId": "012…", "name": "Call", "developerName": "Call_vod", "available": true, "master": false,
      "defaultRecordTypeMapping": true, "layoutId": "00h…", "picklistsForRecordType": [ { "picklistName": "Status_vod__c", "picklistValues": [ … ] } ],
      "urls": { "layout": "…" } } ],
  "recordTypeSelectorRequired": true
}
```

Practical rules **[exp]**:

- This resource answers "what does *this user* see" — it returns the layout(s) assigned to the **running user's profile**. It cannot enumerate other profiles' assignments; use Tooling `ProfileLayout` (§3) for that. Its unique value is `picklistsForRecordType` (record-type-scoped picklist values) and `layoutComponents[].details` (inline field describe).
- Iterate `recordTypeMappings[]` and call `/describe/layouts/{recordTypeId}` per record type; the response for a multi-record-type object without `{recordTypeId}` may only include the master/default mapping depending on API version (not re-verified — see Uncertainties).
- `layoutComponents[].type` values: `Field`, `Separator`, `SControl`, `EmptySpace`, `CustomLink`, `Canvas`, `ReportChart`, `AnalyticsCloud`, `VisualforcePage`. Compound/address fields appear as one component with `components[]` nested.
- Responses are large (hundreds of KB for Account in a Veeva org). Prefer Tooling `Layout.Metadata`, which is the canonical layout definition and is profile-independent.

### 2.3 `query` and pagination

- `GET /services/data/vXX.0/query?q=SELECT+Id,Name+FROM+Profile` → `{ "totalSize": 57, "done": true, "records": [ { "attributes": { "type": "Profile", "url": "/services/data/v68.0/sobjects/Profile/00e…" }, "Id": "00e…", "Name": "Veeva Sales Rep" } ] }` **[exp]**.
- When `done` is `false`, follow `nextRecordsUrl` (`/services/data/vXX.0/query/01gRO0000016PIAYA2-2000`) with the same headers until `done` is `true` **[doc][code]** (jsforce `queryMore(locator)`).
- `Sforce-Query-Options: batchSize=2000` — min 200, max 2000, default 2000 for REST (SOAP default is 500). Rows containing many/long text fields or aggregate/parent lookups may be returned in smaller batches than requested. **[exp]**
- Query locators are per-user cursors; they expire after ~15 minutes of inactivity and only ~10 are kept open per user (oldest closed first). Page each result set to completion before starting the next large one. **[exp]**
- SOQL text goes in the URL: very long `IN (…)` lists hit URL length limits (~16 KB) and the 4,000-character WHERE-clause limit; chunk id lists to ≈200–300 ids per query. **[exp]**
- Relationship-traversal fields come back as nested objects (`"Parent": { "attributes": …, "Profile": { "Name": "…" } }`).

### 2.4 `limits`

`GET /services/data/vXX.0/limits` → a flat object keyed by limit name, each `{ "Max": n, "Remaining": n }`; `DailyApiRequests` additionally contains one nested entry per connected app that has consumed calls **[exp]**:

```jsonc
{
  "DailyApiRequests": { "Max": 115000, "Remaining": 114211, "Veeva CRM Config Extractor": { "Max": 0, "Remaining": 0 } },
  "DailyBulkApiBatches": { "Max": 15000, "Remaining": 15000 },
  "DailyBulkV2QueryJobs": { "Max": 10000, "Remaining": 10000 },
  "DailyAsyncApexExecutions": { "Max": 250000, "Remaining": 250000 },
  "DataStorageMB": { "Max": 10240, "Remaining": 6100 },
  "FileStorageMB": { "Max": 20480, "Remaining": 12000 },
  "PermissionSets": { "Max": 1500, "Remaining": 1300, "CreateCustom": { "Max": 1000, "Remaining": 900 } },
  "HourlyODataCallout": { "Max": 20000, "Remaining": 20000 }
}
```

Sources: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_describe.htm · https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_layouts.htm · https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_layouts_multiple_rts_get.htm · https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm · https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_limits.htm · https://raw.githubusercontent.com/jsforce/jsforce/main/src/connection.ts

---

## 3. Tooling API (`/services/data/vXX.0/tooling/…`)

Same auth, same JSON conventions, same daily-call budget. Endpoints **[exp]**:

| Path | Purpose |
|---|---|
| `GET /tooling/query?q=` | SOQL over Tooling objects; paginated exactly like §2.3 (`nextRecordsUrl` → `/tooling/query/{locator}`) |
| `GET /tooling/sobjects/{Type}/{Id}` | full record incl. `Metadata` and `FullName` — the safe way to get the blob |
| `GET /tooling/sobjects/{Type}/describe` | field list of a Tooling object (use to discover what your org's version exposes) |
| `POST /tooling/composite` | up to 25 sub-requests in one HTTP call (also `/tooling/composite/batch`) |

### 3.1 The `Metadata` / `FullName` restriction

Tooling objects that mirror Metadata API types expose two virtual fields: `FullName` (Metadata API full name, e.g. `Account-Account Layout`, `Call2_vod__c.Status_vod__c`) and `Metadata` (the complete Metadata API type as JSON). The Tooling API guide restricts them: **a query that selects `Metadata` or `FullName` must return exactly one record** — in practice `WHERE Id = '…'` or `LIMIT 1`; selecting them in a multi-row query fails with a `MALFORMED_QUERY`-class error. They can be combined with other fields, but only one row at a time. **[exp]** — the official page (`intro_soql_sosl.htm`) could not be read today; the rule is well known and jsforce/sfdx tooling behave accordingly. Consequences:

1. Enumerate ids with a normal bulk query (`SELECT Id, Name, TableEnumOrId FROM Layout`), then fetch `GET /tooling/sobjects/Layout/{Id}` per record (or `SELECT Id, FullName, Metadata FROM Layout WHERE Id = '…'`).
2. Batch those single fetches through `POST /tooling/composite` (25 per call) to cut API-call consumption ~25×.
3. `Metadata` blobs are the JSON rendering of the Metadata API XML (same element names, camelCase, arrays for repeated elements). Enumerations (e.g. `behavior: "Edit" | "Required" | "Readonly"`) match the Metadata API guide.

### 3.2 Tooling objects relevant to a configuration extract

| Tooling object | Bulk-queryable fields (no Metadata) | `Metadata` blob? | Notes |
|---|---|---|---|
| `Profile` | `Id, Name, UserLicenseId, UserType, Description, PermissionsXxx…` | Yes — `ProfileMetadata` (`recordTypeVisibilities[]`, `applicationVisibilities[]`, `tabVisibilities[]`, `layoutAssignments[]`, `objectPermissions[]`, `fieldPermissions[]`, `userPermissions[]`, `classAccesses[]`, `pageAccesses[]`, `customPermissions[]`, `customSettingAccesses[]`, `loginIpRanges[]`, `loginHours`) **[exp, unverified]** | If this works in the target org it is the single best source for record-type visibility and default app/record type per profile — the only place those live outside the SOAP Metadata API. Verify with `GET /tooling/sobjects/Profile/describe`. |
| `PermissionSet` | standard-API object; Tooling exposure not relied on | — | Use standard SOQL (§4). |
| `PermissionSetAssignment` | standard-API object | — | Use standard SOQL. |
| `ObjectPermissions`, `FieldPermissions` | standard-API objects | — | Use standard SOQL (§4). |
| `Layout` | `Id, Name, TableEnumOrId, EntityDefinitionId, LayoutType, NamespacePrefix, ManageableState, ShowSubmitAndAttachButton` | Yes — `layoutSections[] { label, style, columns[] { layoutItems[] { field, behavior, page, customLink, emptySpace, height, showLabel, showScrollbars, width } } }, relatedLists[] { relatedList, fields[], sortField, sortOrder, customButtons[], excludeButtons[] }, excludeButtons[], customButtons[], quickActionList, platformActionList, feedLayout, summaryLayout, headers[], emailDefault, showRunAssignmentRulesCheckbox` | `TableEnumOrId` is the **object API name for standard objects but the `CustomObject` Id (`01I…`) for custom objects** — map ids with `SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject`. `FullName` = `{Object}-{Layout Name}`; managed Veeva layouts are `…-{Name}_vod` with `NamespacePrefix='vod'`? (Veeva ships layouts unnamespaced with a `_vod` suffix; check `ManageableState='installed'`.) **[exp]** |
| `ProfileLayout` | `Id, ProfileId, LayoutId, RecordTypeId, TableEnumOrId, ManageableState` (+ relationships `Profile.Name`, `Layout.Name`, `Layout.TableEnumOrId`) | No | **The** page-layout-assignment table: one row per profile × record type. `RecordTypeId = null` means the Master record type. **[doc]** for the field list shown in community query `SELECT Layout.Name, Layout.TableEnumOrId, ProfileId, Profile.Name, RecordTypeId FROM ProfileLayout`; null-Master semantics **[exp]**. |
| `RecordType` | `Id, Name, DeveloperName, SobjectType/EntityDefinitionId, IsActive, NamespacePrefix, BusinessProcessId` | Yes — `RecordTypeMetadata { active, label, description, businessProcess, compactLayoutAssignment, picklistValues[] { picklist, values[] { fullName, default } } }` | Standard SOQL `RecordType` is enough for the list; the Tooling blob is the only bulk-friendly source of **per-record-type picklist values** other than REST `describe/layouts/{rt}`. |
| `EntityDefinition` | `DurableId, QualifiedApiName, DeveloperName, NamespacePrefix, Label, PluralLabel, KeyPrefix, IsCustomizable, IsCustomSetting, IsLayoutable, IsQueryable, IsApexTriggerable, IsWorkflowEnabled, InternalSharingModel, ExternalSharingModel, IsFeedEnabled, RecordTypesSupported, PublisherId` | No | Covers standard **and** custom objects. Also queryable through the standard `/query` endpoint. |
| `FieldDefinition` | `DurableId, QualifiedApiName, EntityDefinitionId, EntityDefinition.QualifiedApiName, Label, DataType, ValueTypeId, ExtraTypeInfo, Length, Precision, Scale, IsCalculated, IsNillable, IsIndexed, IsNameField, IsPolymorphicForeignKey, ReferenceTo, RelationshipName, ControllingFieldDefinitionId, Description, InlineHelpText, IsFieldHistoryTracked, IsCompound, LastModifiedDate, PublisherId, SecurityClassification, ComplianceGroup, BusinessStatus, BusinessOwnerId` | No | **Must be filtered by one entity** (`WHERE EntityDefinition.QualifiedApiName = 'Account'` or `EntityDefinitionId`); one query per object. Standard + custom fields, not FLS-filtered. **[exp]** |
| `CustomObject` | `Id, DeveloperName, NamespacePrefix, ManageableState, SharingModel, ExternalSharingModel, Description` | Yes — `CustomObjectMetadata` (label, pluralLabel, nameField, sharingModel, enableFeeds, enableHistory, customSettingsType, visibility, …) | Custom objects only. The blob does **not** include fields. |
| `CustomField` | `Id, DeveloperName, TableEnumOrId, EntityDefinitionId, NamespacePrefix, ManageableState, Description, InlineHelpText, Length, Precision, Scale` (varies by version) | Yes — `CustomFieldMetadata { type, label, length, precision, scale, required, unique, externalId, formula, referenceTo, relationshipName, relationshipLabel, deleteConstraint, inlineHelpText, description, trackHistory, trackTrending, valueSet { restricted, controllingField, valueSetDefinition { sorted, value[] { fullName, label, default, color, isActive } }, valueSettings[] { valueName, controllingFieldValue[] } } }` | Custom fields only (`__c`); managed Veeva fields are included with `NamespacePrefix='vod'`, `ManageableState='installed'`. Same `TableEnumOrId` quirk as `Layout`. Formula text is in `Metadata.formula`. Only the blob carries dependent-picklist matrices in a readable form. |
| `ValidationRule` | `Id, ValidationName, Active, EntityDefinitionId, ErrorDisplayField, ErrorMessage, Description, NamespacePrefix, ManageableState` | Yes — `{ active, description, errorConditionFormula, errorDisplayField, errorMessage }` | `errorConditionFormula` **only** in the blob. |
| `FlowDefinition` | `Id, DeveloperName, MasterLabel, Description, NamespacePrefix, ActiveVersionId, ActiveVersion.VersionNumber, LatestVersionId, ManageableState` | Yes (small) | One row per flow; join to `Flow`. |
| `Flow` | `Id, DefinitionId, MasterLabel, VersionNumber, Status (Active/Obsolete/Draft/InvalidDraft), ProcessType (Flow, AutoLaunchedFlow, Workflow = Process Builder, InvocableProcess, CustomEvent, …), ApiVersion, ManageableState` | Yes — the complete flow (start element with `triggerType`/`object`, elements, variables) | Blobs are large; fetch only `Status='Active'` versions unless a full history is wanted. |
| `WorkflowRule` | `Id, Name, TableEnumOrId, NamespacePrefix, ManageableState` | Yes — `{ active, triggerType, formula/criteriaItems, actions[] }` | Legacy but still common in Veeva orgs. |
| `ApexTrigger` | `Id, Name, TableEnumOrId, Body, Status (Active/Inactive/Deleted), ApiVersion, NamespacePrefix, IsValid, LengthWithoutComments, UsageBeforeInsert/AfterInsert/BeforeUpdate/AfterUpdate/BeforeDelete/AfterDelete/AfterUndelete` | Yes (`apiVersion, status, packageVersions`) — not needed | `Body` is a normal field and **can** be bulk-queried; managed (`vod`) trigger bodies come back as `(hidden)`. |
| `ApexClass` | `Id, Name, Body, Status, ApiVersion, NamespacePrefix, IsValid` | same | Same hiding rule for managed code. |
| `CustomApplication` | `Id, DeveloperName, Label, NamespacePrefix, ManageableState, Description, UiType?` | Yes — `CustomApplicationMetadata { label, navType, uiType, formFactors[], tabs[], brand, isNavAutoTempTabsDisabled, isNavPersonalizationDisabled, setupExperience, utilityBar, workspaceConfig, defaultLandingTab, logo, actionOverrides[] }` | Tab order/composition of Lightning and Classic apps. |
| `CustomTab` | `Id, DeveloperName, Label?, NamespacePrefix, ManageableState, Type?` | Yes — `CustomTabMetadata { customObject, label, motif, description, page, url, lwcComponent, hasSidebar, frameHeight, urlEncodingKey, mobileReady }` | Custom tabs only; standard tabs come from `TabDefinition` (§4). |
| `PermissionSetTabSetting` | `Id, ParentId, Name, Visibility` | No | Tab visibility per profile/permission set (v37+, also a standard object) **[doc]**. |
| `CompactLayout`, `CompactLayoutInfo`/`CompactLayoutItemInfo`, `QuickActionDefinition`, `PathAssistant`, `HomePageLayout`, `FlexiPage` (Lightning pages, has `Metadata`), `GlobalValueSet` (has `Metadata`), `StandardValueSet` (has `Metadata`; standard picklists such as `Industry`), `CustomMetadata` (custom-metadata records, `Metadata` blob), `EmailTemplate`, `WebLink` (custom buttons, `Metadata`) | — | — | Secondary; include as needed. `StandardValueSet` and `GlobalValueSet` are required to resolve `valueSet.valueSetName` references from `CustomField.Metadata`. |

All Tooling reads require the running user to have **View Setup and Configuration** (`PermissionsViewSetup`) **[doc]** (PermissionSetTabSetting page states "requires the View Setup permission"); Author Apex is required for some Apex-related objects **[exp]**.

Sources: https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/intro_soql_sosl.htm · https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_layout.htm · https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_profilelayout.htm · https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_permissionsettabsetting.htm · https://www.salesforcecodecrack.com/2018/07/how-to-check-page-layout-assignment.html · https://sfdclesson.com/2019/06/14/retrieve-customfield-metadata-information-using-tooling-api/ · https://help.salesforce.com/s/articleView?id=000387899 (Tooling API cannot retrieve some custom fields — see Uncertainties)

---

## 4. Standard SOQL on setup objects (`/query`)

Field names below are API names **[exp]** unless marked; the query patterns for `ObjectPermissions`/`FieldPermissions` are **[doc]**-confirmed by community pages quoting Salesforce.

### 4.1 Profile and its hidden PermissionSet

```sql
SELECT Id, Name, UserLicenseId, UserLicense.Name, UserType, Description,
       PermissionsApiEnabled, PermissionsModifyAllData, PermissionsViewAllData, PermissionsViewSetup,
       PermissionsManageUsers, PermissionsCustomizeApplication, PermissionsAuthorApex,
       PermissionsRunReports, PermissionsExportReport, PermissionsEditTask, PermissionsEditEvent
       /* …every PermissionsXxx column from GET /sobjects/Profile/describe… */
FROM Profile
```

Every profile owns exactly one `PermissionSet` row with `IsOwnedByProfile = true` and `ProfileId` set; **all object/field/tab/setup-entity permission rows key on that PermissionSet id (`ParentId`), never on the Profile id**:

```sql
SELECT Id, Name, Label, IsOwnedByProfile, ProfileId, Profile.Name, NamespacePrefix, IsCustom,
       Type, PermissionSetGroupId, LicenseId, License.Name, HasActivationRequired,
       PermissionsApiEnabled, PermissionsModifyAllData /* …same PermissionsXxx columns… */
FROM PermissionSet
```

`Type` values: `Regular`, `Standard`, `Session`, `Group` (permission-set-group aggregate) … **[exp]**. Generate the `PermissionsXxx` column list from `GET /sobjects/PermissionSet/describe` (it grows every release; ~250 columns).

### 4.2 Object CRUD

```sql
SELECT Id, ParentId, Parent.IsOwnedByProfile, Parent.ProfileId, Parent.Profile.Name, Parent.Name,
       SobjectType, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete,
       PermissionsViewAllRecords, PermissionsModifyAllRecords, PermissionsViewAllFields
FROM ObjectPermissions
WHERE Parent.IsOwnedByProfile = true
```

**[doc]** pattern (`SELECT Parent.Profile.Name FROM ObjectPermissions WHERE Parent.IsOwnedByProfile = TRUE AND SObjectType = 'CustomObject__c'`). Rows exist only where at least one flag is true — **absence = no access**. `PermissionsViewAllFields` exists on newer versions only (Spring '24+) **[exp]**; drop it if the org rejects it.

### 4.3 Field-level security

```sql
SELECT Id, ParentId, Parent.ProfileId, SobjectType, Field, PermissionsRead, PermissionsEdit
FROM FieldPermissions
WHERE SobjectType = 'Account' AND Parent.IsOwnedByProfile = true
```

**[doc]** pattern. `Field` is `Object.FieldApiName`. Rows are absent for fields with neither flag and for **non-permissionable fields** (`Id`, `Name`, system fields, required/master-detail fields, formula fields are read-only) — cross-check with `describe.fields[].permissionable`. Query **one `SobjectType` per request**; Account in a Veeva org easily has 1,000+ fields × 50 profiles = 50k rows = 25 pages. Run `SELECT COUNT() FROM FieldPermissions WHERE SobjectType = 'Account'` first to size the job.

### 4.4 Assignments, users, roles, groups

```sql
SELECT Id, AssigneeId, PermissionSetId, PermissionSetGroupId, IsActive, ExpirationDate FROM PermissionSetAssignment
-- note: each active user also has a row for their profile's IsOwnedByProfile permission set

SELECT Id, Username, Name, IsActive, ProfileId, Profile.Name, UserRoleId, UserRole.Name, UserType,
       Country, CountryCode, State, LanguageLocaleKey, LocaleSidKey, TimeZoneSidKey, Email,
       FederationIdentifier, ManagerId, Department, Division, Title, LastLoginDate
FROM User WHERE UserType = 'Standard'

SELECT Id, Name, DeveloperName, ParentRoleId, RollupDescription, PortalType FROM UserRole

SELECT Id, Name, DeveloperName, Type, RelatedId, OwnerId, DoesIncludeBosses, Email FROM Group
-- Type: Regular | Queue | Role | RoleAndSubordinates | RoleAndSubordinatesInternal | Territory | TerritoryAndSubordinates | Organization | Manager | ManagerAndSubordinatesInternal | AllCustomerPortal | …
SELECT Id, GroupId, UserOrGroupId FROM GroupMember
SELECT Id, QueueId, SobjectType FROM QueueSobject
```

Veeva users are commonly filtered by `Profile.Name LIKE 'Veeva%'`/custom profile names and by `Country`; Veeva CRM does not add its own country field to `User` in the base package **[exp]**.

### 4.5 Territories (Enterprise Territory Management — what Veeva CRM uses)

```sql
SELECT Id, Name, DeveloperName, State, ActivatedDate FROM Territory2Model          -- State: Planning | Active | Archived
SELECT Id, DeveloperName, MasterLabel, Priority FROM Territory2Type
SELECT Id, Name, DeveloperName, Description, ParentTerritory2Id, Territory2ModelId, Territory2TypeId,
       AccountAccessLevel, ContactAccessLevel, OpportunityAccessLevel, CaseAccessLevel
FROM Territory2 WHERE Territory2Model.State = 'Active'
SELECT Id, Territory2Id, UserId, RoleInTerritory2, IsActive FROM UserTerritory2Association
SELECT Id, ObjectId, Territory2Id, AssociationCause, SobjectType FROM ObjectTerritory2Association  -- account↔territory; data, not config
```

Veeva-specific territory configuration (e.g. `TSF_vod__c` territory-specific fields, `Territory_Field_vod__c`, `Territory_vod__c` text columns) is ordinary sObject data reached through `/query`. **[exp]**

### 4.6 Record types, tabs, apps, setup-entity access

```sql
SELECT Id, Name, DeveloperName, SobjectType, IsActive, NamespacePrefix, Description, BusinessProcessId FROM RecordType

SELECT Id, ParentId, Parent.ProfileId, Name, Visibility FROM PermissionSetTabSetting          -- Name e.g. 'standard-Account', 'Call2_vod__c'
-- Visibility: DefaultOn | DefaultOff | Hidden for profile-owned parents (Metadata API tabVisibilities vocabulary);
--             Available | Visible | None for permission sets — exact API values to verify **[exp]**

SELECT Id, ParentId, Parent.ProfileId, SetupEntityId, SetupEntityType FROM SetupEntityAccess
-- SetupEntityType: TabSet (= CustomApplication → app visibility) | ApexClass | ApexPage | ConnectedApplication |
--                  CustomPermission | FlowDefinition | ExternalDataSource | NamedCredential | ServicePresenceStatus | …
```

**[doc]** (SetupEntityAccess: `SELECT Id, SetupEntityId, ParentId, Parent.Label, Parent.IsCustom, Parent.IsOwnedByProfile, Parent.ProfileId FROM SetupEntityAccess WHERE SetupEntityType = 'TabSet' ORDER BY SetupEntityId`; AppMenuItem: `SELECT Id, ApplicationId, Name, Label, NamespacePrefix, IsAccessible, IsVisible FROM AppMenuItem WHERE Type = 'TabSet' ORDER BY ApplicationId`). `AppMenuItem` enumerates apps without Tooling; its `IsAccessible/IsVisible` are for the running user only. `TabDefinition` (`SELECT DurableId, Name, Label, SobjectName, IsCustom, Url FROM TabDefinition`) enumerates standard + custom tabs **[exp]**.

**Default app** and **default record type** per profile are *not* in any standard object; they live only in Profile metadata (`applicationVisibilities[].default`, `recordTypeVisibilities[].default`) — see §3.2 `Profile.Metadata` and Uncertainties.

### 4.7 Custom settings (Veeva's primary configuration mechanism)

Custom settings are ordinary sObjects. Identify them with global describe (`customSetting: true`) or `EntityDefinition.IsCustomSetting = true`; hierarchy vs list via Tooling `CustomObject.Metadata.customSettingsType` (`Hierarchy` | `List`). For **hierarchy** settings each row is one override level, identified by `SetupOwnerId`:

| `SetupOwnerId` prefix | Level |
|---|---|
| `00D` (Organization) | org default |
| `00e` (Profile) | profile override |
| `005` (User) | user override |

```sql
SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name, /* every custom column */ 
FROM Veeva_Settings_vod__c
```

`SetupOwner` is polymorphic (`Organization` | `Profile` | `User`); `SetupOwner.Type` is queryable, `SetupOwner.Name` resolves for Profile/User. Effective value for a user = user row ?? profile row ?? org row, field by field (null in a lower row falls through). Typical Veeva hierarchy settings: `Veeva_Settings_vod__c`, `Veeva_Common_vod__c`, `Network_Settings_vod__c`, `Approved_Email_Settings_vod__c`, `CLM_Settings_vod__c`, `Multichannel_Settings_vod__c`, `Events_Management_Settings_vod__c` (names **[exp]**; enumerate via describe rather than hard-coding). Veeva also keeps configuration in regular custom objects that should be extracted as data-shaped config: `Message_vod__c` (Veeva Messages / translations), `VMobile_Object_Configuration_vod__c` (offline sync scope per profile), `Veeva_Settings`-driven feature flags. **[exp]**

Sources: https://www.simplysfdc.com/2019/03/salesforce-query-field-permission.html · https://salesforcekings.blogspot.com/2018/05/how-to-fetch-object-permission-for-all.html · https://www.simplysfdc.com/2018/04/salesforce-app-visibility-and-query.html · https://wiki.sfxd.org/books/useful-queries/page/who-has-what-permission · https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_setupentityaccess.htm · https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_permissionsettabsetting.htm

---

## 5. Limits and quirks that matter for a full-org extract

| Limit | Value | Source |
|---|---|---|
| Daily API requests (rolling 24 h, org-wide, REST + Tooling + SOAP + Bulk-query jobs share it) | Enterprise: 100,000 + 1,000 × user licence; Unlimited/Performance: 100,000 + 5,000 × licence; Developer Edition: 15,000; **sandboxes: 5,000,000** | **[doc]** for Enterprise formula (Salesforce dev blog excerpt); others **[exp]** |
| Concurrent long-running (> 20 s) requests | 25 per org (5 in Developer/trial) | **[doc]** (blog excerpt) |
| Single request timeout | 10 min | **[doc]** (blog excerpt) |
| Query batch | 200–2,000 rows per page (`Sforce-Query-Options: batchSize`) | **[exp]** |
| SOQL length | statement ≤ 100,000 chars; `WHERE` ≤ 4,000 chars; GET URL practical cap ~16 KB | **[exp]** |
| Composite | 25 sub-requests per `/composite` or `/tooling/composite`; whole request counts as **one** API call; `/composite/batch` sub-requests are counted individually (to verify) | **[exp]** |
| Describe responses | not counted differently — every describe = 1 call; cache with `If-Modified-Since` (304 is still a call, but cheap) | **[doc]** for 304 semantics |
| Header telemetry | `Sforce-Limit-Info: api-usage=used/max` on every response; `GET /limits` for the breakdown | **[exp]** |
| 403 `REQUEST_LIMIT_EXCEEDED` | returned once the daily budget is exhausted; back off until the rolling window frees calls | **[exp]** |

Budget estimate for a mid-size Veeva org (≈600 objects incl. `vod`, 60 profiles, 40 record-typed objects): describes ≈ 600, `FieldPermissions` pages ≈ 2,000, `ObjectPermissions` ≈ 50, Tooling id lists ≈ 30, Layout blobs ≈ 1,500 (≈ 60 composite calls), CustomField blobs ≈ 15,000 (≈ 600 composite calls), Flow/ValidationRule/Trigger ≈ 300 → **well under 10k calls**; the `FieldPermissions` pages dominate. Run against a sandbox where possible (5M/day).

Tooling quirks to code for **[exp]**:

- `Metadata`/`FullName` → one record per query (§3.1). Use `/tooling/sobjects/{Type}/{Id}` inside `/tooling/composite`.
- `TableEnumOrId` = object name (standard) or `01I…` id (custom) on `Layout`, `ProfileLayout`, `CustomField`, `WorkflowRule`, `ApexTrigger`.
- `FieldDefinition` needs an entity filter; `EntityParticle` (field-level view of compound fields) likewise.
- Some Tooling objects reject `ORDER BY`/`OFFSET` on certain fields and none support `GROUP BY`/aggregates broadly; keep queries flat.
- `ManageableState` distinguishes `installed` (Veeva managed, immutable), `unmanaged`, `released`, `deprecated…`; `NamespacePrefix = 'vod'` (plus `Veeva_*` prefixes for add-on packages) marks Veeva-shipped components.
- Managed Apex `Body` is `(hidden)`; managed layout/field/validation `Metadata` is readable.
- A Salesforce KB article reports cases where the Tooling API cannot retrieve some custom fields (https://help.salesforce.com/s/articleView?id=000387899) — the page could not be read; fall back to `FieldDefinition` + REST describe when `CustomField` misses a field.

Describe caching: send `If-Modified-Since` with the timestamp of the previous extract; on `304` reuse the cached describe. Note a `304` from *global* describe means no object's metadata changed; per-object describes can still be conditional individually. **[doc]**

Sources: https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage · https://coefficient.io/salesforce-api/salesforce-api-rate-limits · https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm (unreachable today)

---

## 6. Minimal call plan to reconstruct configuration per Profile

Run once per org, then join in memory. Everything is `GET` unless noted; `vXX.0` = highest version from `/services/data/`.

**A. Bootstrap (≈4 calls)**

1. `POST {mydomain}/services/oauth2/token` (client credentials) → `access_token`, `instance_url`, `id`.
2. `GET {id}` → org id, running user, `urls.tooling_rest`.
3. `GET /services/data/` → pick version. `GET /limits` → confirm budget.

**B. Inventory (≈10 calls + describes)**

4. `GET /sobjects/` (global describe) → objects, `customSetting`, `layoutable`, `keyPrefix`.
5. `/query`: `SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject` via `/tooling/query` → id↔name map for `TableEnumOrId`.
6. `/tooling/query`: `EntityDefinition` (all objects, sharing models); per object `FieldDefinition` (1 call/object) **or** REST `describe` (1 call/object; also gives picklist values and `recordTypeInfos`). For Veeva orgs do both only for `layoutable` objects; skip system/`__Share`/`__History`/`__Feed`/`ChangeEvent` objects.
7. `/query`: `SELECT … FROM RecordType`.

**C. Security matrix (≈50–2,500 calls, mostly FieldPermissions pages)**

8. `/query`: `Profile` (all `PermissionsXxx`), `PermissionSet` (incl. `IsOwnedByProfile`, `ProfileId`), `PermissionSetGroup`/`PermissionSetGroupComponent`, `PermissionSetAssignment`.
9. `/query`: `ObjectPermissions` (all rows; ~1 page per 2,000).
10. `/query`: `FieldPermissions` per `SobjectType`, paginated.
11. `/query`: `SetupEntityAccess` (`TabSet` → app visibility; `ApexClass`/`ApexPage`/`CustomPermission`/`FlowDefinition` → code access).
12. `/query`: `PermissionSetTabSetting` → tab visibility.
13. `/query`: `User` (Country, ProfileId, UserRoleId), `UserRole`, `Group`, `GroupMember`, `Territory2*`, `UserTerritory2Association`.

**D. Layouts and record types (≈2 + N composite calls)**

14. `/tooling/query`: `SELECT Id, Name, TableEnumOrId, LayoutType, NamespacePrefix, ManageableState FROM Layout`.
15. `/tooling/query`: `SELECT Id, ProfileId, LayoutId, RecordTypeId, TableEnumOrId FROM ProfileLayout` → **profile × record type → layout** (null `RecordTypeId` = Master).
16. `POST /tooling/composite` batches of 25 × `GET /tooling/sobjects/Layout/{Id}` → `Metadata` (sections, fields, behaviors, related lists, buttons).
17. Record-type **visibility/default per profile**: `GET /tooling/sobjects/Profile/{Id}` → `Metadata.recordTypeVisibilities[] { recordType, visible, default, personAccountDefault }`, `applicationVisibilities[] { application, visible, default }`, `tabVisibilities[]`, `layoutAssignments[]` (cross-check with 15). If `Profile.Metadata` is unavailable in the org, the only REST-side approximation is `describe.recordTypeInfos` as each profile's user — impractical; flag as a SOAP-Metadata-API gap.
18. Per-record-type picklist values: `POST /tooling/composite` × `GET /tooling/sobjects/RecordType/{Id}` → `Metadata.picklistValues`, or REST `describe/layouts/{recordTypeId}` for the running user's view.

**E. Field/validation/automation definitions (≈N composite calls)**

19. `/tooling/query` id lists for `CustomField`, `ValidationRule`, `WorkflowRule`, `FlowDefinition` + `Flow` (`Status='Active'`), `ApexTrigger` (with `Body`), `CustomApplication`, `CustomTab`, `GlobalValueSet`, `StandardValueSet`, `FlexiPage`, `CompactLayout`, `QuickActionDefinition`, `WebLink`.
20. `/tooling/composite` batches to pull `Metadata` for each (skip `ApexTrigger`, whose `Body` came in bulk).

**F. Custom-setting overrides (1 call per setting object)**

21. For every object with `customSetting: true`: `/query` `SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name, <all fields> FROM {Setting}` → org / profile / user rows; resolve `00e…` owners against the Profile list; list settings (no `SetupOwnerId`) are exported whole.

**G. Per-profile assembly (in memory)**

`Profile` → its `PermissionSet` (`IsOwnedByProfile`) → `ObjectPermissions` (CRUD/VAR/MAR), `FieldPermissions` (FLS, defaulting non-permissionable fields to read/edit), `ProfileLayout` (+ `Layout.Metadata`) per record type, `Profile.Metadata.recordTypeVisibilities` (visible/default), `PermissionSetTabSetting` (tabs), `SetupEntityAccess[TabSet]` + `Profile.Metadata.applicationVisibilities.default` (apps), custom-setting rows with `SetupOwnerId = Profile.Id` (overrides; fall back to org row), plus `PermissionSetAssignment` to add permission-set-granted deltas per user if a user-level view is needed.

---

## Uncertainties

1. **Docs unreachable.** `help.salesforce.com`, `developer.salesforce.com` (and its CloudFront mirror), `trailhead.salesforce.com`, `crmhelp.veeva.com`, `developer.veevacrm.com` and several community blogs were blocked by the egress proxy; all **[doc]** items rest on search-engine excerpts of those pages and everything **[exp]** is unverified today. Re-check against a real org with `GET /tooling/sobjects/{Type}/describe` before relying on any field name in §3–§4.
2. **Tooling `Profile.Metadata`.** Whether the Tooling `Profile` object exposes a full `Metadata` blob (record-type visibilities, application visibilities incl. default app, layout assignments) could not be confirmed. If absent, record-type visibility and default app/record type per profile have **no plain-REST source** and require the SOAP Metadata API (`readMetadata`/`retrieve` of `Profile`) — the one hard gap for a fetch-only design.
3. **Exact `Metadata`/`FullName` rule text and error code** from `intro_soql_sosl.htm` not read; behaviour described from experience (single-record queries only).
4. **JWT `exp` window** ("within 3 minutes") and accepted `aud` values (My Domain vs. `login`/`test`) are from memory; `@salesforce/core` tries multiple login/audience combinations, suggesting My Domain audiences are accepted but not guaranteed.
5. **Username-password flow retirement in Winter '27** comes from a community post citing a Salesforce release update, not from the release note itself. Whether the Summer '23 default block also affects SOAP `login()` was not confirmed.
6. **`describe/layouts` behaviour for multi-record-type objects** across API versions (whether the un-suffixed call returns all layouts or only the master) — the dedicated doc page exists but was unreadable.
7. **`PermissionSetTabSetting.Visibility` API values** (`DefaultOn/DefaultOff/Hidden` vs `Available/Visible/None`) and whether `ObjectPermissions.PermissionsViewAllFields` exists in the org's API version.
8. **Composite call accounting** (`/composite` = 1 call vs `/composite/batch` per sub-request) and the existence/limits of `/tooling/composite` in the target version.
9. **Limits table** beyond the Enterprise formula (Unlimited multiplier, sandbox 5M, 2,000-row batch, SOQL length caps, cursor expiry) is from memory.
10. **Veeva object/setting names** (`Veeva_Settings_vod__c`, `VMobile_Object_Configuration_vod__c`, `Message_vod__c`, `TSF_vod__c`, …) are from experience; enumerate from global describe rather than hard-coding. The Salesforce KB "Tooling API cannot retrieve custom fields" (000387899) may describe a scenario relevant to managed `vod` fields — unread.
11. **Current API version**: v68.0 (Winter '27) docs are published as of 2026-08-28; whether production orgs already serve v68.0 depends on the release rollout — always discover via `/services/data/`.
