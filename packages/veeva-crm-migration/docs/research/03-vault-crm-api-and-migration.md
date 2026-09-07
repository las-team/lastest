# Vault CRM: programmatic configuration and the Veeva CRM → Vault CRM mapping

Research date: 2026-09-07. Vault CRM is Veeva's CRM rebuilt on the Vault Platform; the
Salesforce-hosted Veeva CRM reaches end of support on **31 Dec 2029** (Veeva moved the date
forward from Sept 2030 on 3 Mar 2026). More than 125 customers were live on Vault CRM by
March 2026.

**Sourcing caveat.** The network in this environment blocks `developer.veevavault.com`,
`*.veevavault.dev`, `platform.veevavault.help`, `vaultcrmhelp.veeva.com`, `crmhelp.veeva.com`,
`developer.veevacrm.com` and `support.veeva.com`. Endpoint paths below were therefore confirmed
against the **source code of VAPIL** (Veeva's official Java Vault API client,
`github.com/veeva/vault-api-library`, `main` branch, default API version `v26.2`) and against
search-engine excerpts of the official Veeva help pages. Anything taken from prior knowledge
or third-party write-ups is marked *(inferred)* or *(third-party)*, and repeated under
"Uncertainties".

---

## 1. Vault REST API basics

| Item | Value | Confidence |
|---|---|---|
| Base URL | `https://{vaultDNS}/api/{version}/…` | confirmed |
| Current API version | **`v26.2`** (VAPIL `VaultClient.VAULT_API_VERSION = "v26.2"` on `main`, Sept 2026). Versions are `v{YY}.{R}`, one per Vault general release (26R1 → `v26.1`, 26R2 → `v26.2`). | confirmed via VAPIL |
| List versions | `GET /api` → `{"responseStatus":"SUCCESS","values":{"v25.3":"https://…/api/v25.3", …}}` | confirmed (VAPIL `ApiVersionResponse`) |
| Session header | `Authorization: {sessionId}` (raw session id, **no** `Bearer` prefix) on every call | confirmed |
| Client id header | `X-VaultAPI-ClientID: {your-client-id}` — Veeva asks integrations to send a stable id; shows up in API usage logs | *(inferred; standard in docs, not re-verified here)* |
| Response envelope | JSON with `responseStatus` = `SUCCESS` \| `FAILURE` \| `WARNING` (VAPIL constants). Failures carry `errors:[{type, message}]`; docs also describe `EXCEPTION` for unexpected server errors *(inferred)*. `responseMessage` is present on some endpoints. | confirmed (VAPIL `VaultResponse`) |

### 1.1 Username / password authentication

```
POST https://{vaultDNS}/api/v26.2/auth
Content-Type: application/x-www-form-urlencoded

username=admin%40example.com&password=…&vaultDNS=myvault.veevavault.com   (vaultDNS optional)
```

Response (shape from VAPIL `AuthenticationResponse`):

```json
{
  "responseStatus": "SUCCESS",
  "sessionId": "3B4C…",
  "userId": 12345,
  "vaultIds": [
    { "id": 1001, "name": "My CRM Vault", "url": "https://myvault.veevavault.com/api" }
  ],
  "vaultId": 1001
}
```

The returned `sessionId` is valid for any vault in `vaultIds` the user can access; VAPIL
validates that the `vaultDNS` you asked for is in that list. Session housekeeping:
`POST /api/{v}/keep-alive`, `DELETE /api/{v}/session` (end session),
`GET /api/{v}/delegation/vaults` + `POST /api/{v}/delegation/login` (delegate access).

Auth-call rate limiting: since v20.1 every `/auth` response carries two dedicated headers with
the per-user/per-domain auth-call limit and how many remain *(names not re-verified here)*.

### 1.2 OAuth 2.0 / OpenID Connect

Vault does not issue OAuth tokens itself; you obtain an access token from your IdP and exchange it
for a Vault session:

```
POST https://{vaultDNS}/api/v26.2/auth/oauth/session/{oauth_oidc_profile_id}
Authorization: Bearer {idp_access_token}
Content-Type: application/x-www-form-urlencoded

client_id={optional}&vaultDNS={optional}
```

`{oauth_oidc_profile_id}` is the id of the *OAuth2/OpenID Connect Profile* configured under
Admin > Settings > Security Policies. `POST https://login.veevavault.com/auth/discovery`
(`username`, optional `client_id`) tells you which auth type / profile a user must use. VAPIL's
`AuthenticationType` enum lists `BASIC`, `OAUTH_ACCESS_TOKEN`, `SESSION_ID`,
`API_ACCESS_TOKEN` (newer, Vault-issued API access tokens) and `NO_AUTH`.

### 1.3 Limits and diagnostic headers (from VAPIL `VaultResponse`)

| Header | Meaning |
|---|---|
| `X-VaultAPI-BurstLimit` | calls allowed in the current 5-minute burst window |
| `X-VaultAPI-BurstLimitRemaining` | calls remaining in that window |
| `X-VaultAPI-DailyLimit`, `X-VaultAPI-DailyLimitRemaining` | **removed in v21.1**; v20.3 and lower still return `999999` for backwards compatibility |
| `X-VaultAPI-ExecutionId`, `X-VaultAPI-ReferenceId` | ids to quote in support tickets |
| `X-VaultAPI-ResponseDelay` | ms Vault deliberately delayed the response (throttling signal) |
| `X-VaultAPI-Status`, `X-VaultAPI-DowntimeExpectedDurationMinutes` | maintenance signalling |
| `X-VaultAPI-SdkCount`, `-SdkCpuTime`, `-SdkElapsedTime`, `-SdkGrossMemory` | Java SDK trigger cost incurred by the call |
| `X-VaultAPI-TruncatedSessionId`, `X-VaultAPI-UserId`, `X-VaultAPI-VaultId` | echo of the caller |

Sources: VAPIL `AuthenticationRequest.java`, `VaultClient.java`, `VaultResponse.java`
(https://github.com/veeva/vault-api-library); developer-cdms.veevavault.com API reference
excerpt (daily-limit removal in v21.1); https://platform.veevavault.help/en/gr/18666/ (About
Vault API).

---

## 2. Metadata APIs (read side)

All paths below are relative to `/api/{version}` unless stated and are `GET` unless stated.
Confirmed from VAPIL `MetaDataRequest.java` / `PicklistRequest.java`.

### 2.1 Objects, fields, page layouts

| Endpoint | Purpose |
|---|---|
| `/metadata/vobjects` | list all objects (`objects:[{name,label,url,status…}]`) |
| `/metadata/vobjects/{object_name}` | object definition incl. `fields[]`, `object_types[]`, `relationships[]`, lifecycle, `available_lifecycles`, `role_overrides`… |
| `/metadata/vobjects/{object_name}/fields/{field_name}` | one field (type, `max_length`, `picklist`, `required`, `unique`, `object` for `Object` lookups, `lookup_source_field`, `formula`…) |
| `/metadata/vobjects/{object_name}/page_layouts` | all page layouts for the object |
| `/metadata/vobjects/{object_name}/page_layouts/{layout_name}` | one layout — sections, fields, related-lists. **Evaluated for the calling user**: fields the caller cannot see are omitted |
| `POST /metadata/vobjects/{object_name}/actions/canceldeployment` | cancel an in-flight high-volume-object deployment |

Example field response (representative shape, *inferred* from docs):

```json
{
  "responseStatus": "SUCCESS",
  "field": {
    "name": "country_code__v", "label": "Country Code", "type": "String",
    "max_length": 2, "required": false, "unique": false, "editable": true,
    "status": ["active__v"], "modified_date": "2026-05-01T10:00:00.000Z"
  }
}
```

### 2.2 Generic component metadata (works for every component type)

| Endpoint | Purpose |
|---|---|
| `/metadata/components` | list all component **types** (`Object`, `Picklist`, `Pagelayout`, `Objecttype`, `Securityprofile`, `Permissionset`, `Objectlifecycle`, `Doctype`, `Tab`, `Workflow`, `Recordtrigger`, `Job`, `Layoutrule`, …) |
| `/metadata/components/{component_type}` | attributes/sub-components a type supports (e.g. `/metadata/components/Securityprofile`, `/metadata/components/Picklist`) |
| `/configuration/{component_type}` | all **records** of that type (e.g. `/configuration/Permissionset`) |
| `/configuration/{component_type}.{record_name}` | one record as JSON/XML (e.g. `/configuration/Securityprofile.sales_rep__c`) |
| `/mdl/components/{component_type}.{record_name}` | same record rendered as an MDL `RECREATE` statement (see §3). **No `{version}` segment** — `/api/mdl/components/…` |
| `POST /query/components` | VQL over component definitions (`SELECT name__v, label__v FROM Object …`) — form-encoded `q=` |

Security profiles and permission sets are therefore read with
`/configuration/Securityprofile[.name]` and `/configuration/Permissionset[.name]`.
Older docs also expose `/metadata/objects/securityprofiles` (v8–v15 era) and a user-centric
`/objects/securityprofiles`; treat those as legacy/unverified. Object types are sub-components
of `Object` (`object_types[]` in the object metadata) and are also `Objecttype` records
(`/configuration/Objecttype.{object}.{type}` *(name format inferred)*). Lifecycles:
`/configuration/Objectlifecycle[.name]`; document types: `/configuration/Doctype[.name]` and the
document-specific `/metadata/objects/documents/types` family *(inferred)*.

### 2.3 Picklists (value management, versioned path)

| Endpoint | Purpose |
|---|---|
| `GET /objects/picklists` | all picklists with `usedIn[]` (object/field references) |
| `GET /objects/picklists/{picklist_name}` | values `[{name, label, status}]` |
| `POST /objects/picklists/{picklist_name}` | add values (form params `value_1=Label`, …) |
| `PUT /objects/picklists/{picklist_name}` | relabel values (`{value_name}=New Label`) |
| `PUT /objects/picklists/{picklist_name}/{value_name}` | rename (`name=`) or set `status=inactive` |
| `DELETE /objects/picklists/{picklist_name}/{value_name}` | inactivate a value |

Picklists are **global** components in Vault (one `country__v` picklist reused by many
objects), unlike Salesforce field-scoped picklists; value names carry the `__v`/`__c` suffix
(`united_states__v`).

Sources: VAPIL `MetaDataRequest.java`, `PicklistRequest.java`; developer.veevavault.com API
reference excerpts (page-layout endpoint, `/metadata/components/Securityprofile`,
`/metadata/components/Picklist`).

---

## 3. MDL — Metadata Definition Language (write side)

MDL is a SQL-like DDL for Vault components. Commands: `CREATE`, `RECREATE` (create-or-update —
the one to use for idempotent tooling), `ALTER`, `DROP`, `RENAME`. Vault can *generate* a
`RECREATE` statement for most component types (see the "Generate RECREATE" column of the
component support matrix in the MDL docs; not every type supports it).

### 3.1 Endpoints (no `{version}` segment)

| Endpoint | Notes |
|---|---|
| `POST /api/mdl/execute` | body = raw MDL script (`Content-Type: application/json` or `text/plain` both accepted by VAPIL — send the script as the body). Synchronous. |
| `POST /api/mdl/execute_async` | same body, returns `job_id`; required for changes to **high-volume objects** and recommended for large scripts |
| `GET /api/mdl/execute_async/{job_id}/results` | results of an async execution |
| `GET /api/mdl/components/{type}.{name}` | retrieve a component as MDL (`Object.call2__v`, `Picklist.country__v`, `Securityprofile.sales_rep__c`, `Pagelayout.call2__v.call2_detail_page_layout__c` *(layout name format inferred)*) |
| `GET /api/mdl/components/{type}.{name}/files` | content files referenced by the component (e.g. a Formattedoutput template) |
| `POST /api/mdl/files` | upload a content file so an MDL script can reference it |

Execute response (per Veeva docs excerpt): `responseStatus`, plus per-statement
`statement_execution[]` entries with `vault`, `statement`, `response`, `message`,
`warnings[]`, `failures[]`, `exceptions[]`, `components_affected[]`, `execution_time`.
The whole script is one transaction per statement; a failing statement halts the script.

### 3.2 Syntax and real examples

Attributes are `name(value)`, sub-components are declared inline; boolean/enum values are
unquoted, strings single-quoted, lists in parentheses. Custom components end in `__c`,
Veeva-delivered ones in `__v` (you cannot create `__v`).

Retrieved picklist (from the Veeva MDL docs example, verbatim structure):

```
RECREATE Picklist color__c (
  label('Color'),
  active(true),
  Picklistentry red__c (
    value('Red'),
    order(1),
    active(true)
  ),
  Picklistentry blue__c (
    value('Blue'),
    order(2),
    active(true)
  )
);
```

Object with fields *(representative; attribute names follow the object metadata API and the
public MDL reference, not re-verified this run — treat as a template to diff against a
`GET /api/mdl/components/Object.<name>` from a real vault)*:

```
RECREATE Object speaker_engagement__c (
  label('Speaker Engagement'),
  label_plural('Speaker Engagements'),
  active(true),
  in_menu(true),
  Field name__v (
    label('Name'),
    type('String'),
    max_length(128),
    required(true),
    unique(false)
  ),
  Field account__c (
    label('Account'),
    type('Object'),
    object('account__v'),
    required(true)
  ),
  Field status__c (
    label('Status'),
    type('Picklist'),
    picklist('speaker_engagement_status__c'),
    multi_value(false)
  ),
  Objecttype base__v (
    label('Base'),
    active(true)
  )
);

ALTER Object account__v (
  ADD Field key_account_tier__c (
    label('Key Account Tier'),
    type('Picklist'),
    picklist('key_account_tier__c')
  )
);

ALTER Object account__v (
  MODIFY Field key_account_tier__c ( label('KA Tier') )
);
```

Other component types you will touch when migrating Veeva CRM config:

```
RECREATE Permissionset field_rep_ps__c (
  label('Field Rep'),
  active(true),
  Objectpermission account__v ( create(true), read(true), edit(true), delete(false) ),
  Fieldpermission account__v.key_account_tier__c ( read(true), edit(true) ),
  Tabpermission account_tab__c ( visible(true) )
);

RECREATE Securityprofile field_rep__c (
  label('Field Rep'),
  active(true),
  permission_sets('field_rep_ps__c')
);
```

*(The `Permissionset`/`Securityprofile` sub-component names above are inferred from the
component-type metadata; always start from `GET /api/mdl/components/Permissionset.<name>` on
a sandbox and edit that output rather than hand-writing from scratch.)* Page layouts are the
`Pagelayout` component (sections, `Layoutfield`/related-list sub-components) — Veeva's
recommended workflow is retrieve-MDL → edit → `RECREATE`, or use a VPK (§4).

Sources: https://developer.veevavault.com/mdl (search excerpts: RECREATE semantics,
picklist example, execute response fields); VAPIL `MetaDataRequest.java` (endpoint constants);
https://github.com/gorkaerana/meddle (third-party MDL parser, confirms grammar shape).

---

## 4. Configuration Migration Packages (VPK)

A **VPK** (`.vpk` = zip) is Vault's unit of configuration deployment between vaults
(sandbox → validation → production, or Veeva's own CRM feature packages). In the UI:
Admin > Deployment > **Outbound Packages** (author, add components, export) and
**Inbound Packages** (import, review, deploy). Package records are objects:
`outbound_package__v` and `vault_package__v` (inbound, with `package_steps__v` children
*(child object name inferred)*).

### 4.1 Structure *(inferred from prior knowledge of exported VPKs; not re-verified)*

```
PKG-0042.vpk
├── vaultpackage.xml            # manifest: name, source vault, summary, packagetype (migration__v|…),
│                               # component list in dependency order
└── components/
    ├── Object.speaker_engagement__c.mdl
    ├── Picklist.speaker_engagement_status__c.mdl
    ├── Pagelayout.speaker_engagement__c.speaker_engagement_detail__c.mdl
    ├── Permissionset.field_rep_ps__c.mdl
    └── …                       # each file is one MDL statement; data steps / content files also possible
```

### 4.2 API lifecycle (VAPIL `ConfigurationMigrationRequest.java`, all under `/api/{version}`)

| Step | Endpoint | Notes |
|---|---|---|
| Export from source | `POST /services/package` (form param `packageName` = outbound package name) → job | outbound package must already exist with its components |
| Validate a file before import | `POST /services/package/actions/validate` (multipart `file`) | returns per-component validation, dependency and "will change/create" summary |
| Import | `PUT /services/package` (multipart `file`) → job; results at `GET /vobject/vault_package__v/{package_id}/actions/import/results` | creates a `vault_package__v` record |
| Validate imported package | `POST /services/vobject/vault_package__v/{package_id}/actions/validate` | re-checks against the *target* vault's current config |
| Deploy | `POST /vobject/vault_package__v/{package_id}/actions/deploy` → job | validation runs again first; any error fails the whole deployment |
| Deploy results | `GET /vobject/vault_package__v/{package_id}/actions/deploy/results` | status + total/​deployed components |
| Dependencies | `GET /vobjects/outbound_package__v/{package_id}/dependencies` | what else must ship |
| Compare vaults | `POST /objects/vault/actions/compare` (`vault_id`, `results_type`, `details_type`, `component_types`…) | Excel diff of two vaults |
| Configuration report | `POST /objects/vault/actions/configreport` → `GET /objects/vault/actions/configReport/{job_id}/report` | full config inventory (xlsx/xlsm) |

Note the singular `vobject` in the deploy/import paths vs plural `vobjects` in the
dependencies path — this is how Veeva ships them.

### 4.3 When VPK beats raw MDL

- **Ordering and dependencies** are resolved by Vault (picklist before field, object before
  layout, permission set before profile).
- **Pre-deployment validation report** and an **audit trail** (`vault_package__v` records with
  step-level results) that GxP/validation teams require; MDL `execute` leaves only the
  config audit log.
- **Data steps**: packages can carry object-record data (e.g. Veeva Settings, VMOCs,
  Veeva Messages) alongside metadata — MDL cannot insert records.
- **Atomicity per package** plus Vault Compare/Config Report for pre/post diffing.
- MDL wins for ad-hoc, scriptable, idempotent changes (CI loops, generated field additions) and
  for retrieving a canonical textual definition of a component.

Sources: VAPIL `ConfigurationMigrationRequest.java`; https://platform.veevavault.help/en/lr/36919/
(Using Configuration Migration Packages); support.veeva.com "Vault Configuration Migration
Package Deployment Guide" (6611450164507) and "Importing & Deploying Vault Configuration
Migration Packages" (6611969844251) — titles/URLs from search only, bodies not fetchable here.

---

## 5. Vault CRM object model and the mapping from Veeva CRM

Veeva's stated rule: the data model is carried over "without changes … except for suffixes in
data models" — `Xxx_vod__c` → `xxx__v` (lower-snake-case), customer custom `Xxx__c` → `xxx__c`.
Vault CRM is configured in **Admin > Configuration** (Objects, Page Layouts, Picklists,
Tabs, Object Lifecycles) plus a **Vault CRM Configuration** section (Application Profiles,
Veeva Settings, VMOCs, Veeva Messages) and **Business Admin** for object records.

| Veeva CRM (Salesforce) | Vault CRM | Notes / confidence |
|---|---|---|
| `Account` (std) + `Child_Account_vod__c` | `account__v`, `child_account__v` *(child inferred)* | `account__v` confirmed; `country_code__v` field on `account__v` maps Network `primary_country__v` |
| `Address_vod__c` | `address__v` *(inferred)* | |
| `User` | `user__v` | confirmed; address section holds the user's primary country (ISO-2) |
| `Call2_vod__c` | **`call2__v`** | confirmed — "stores all information for planned, saved, submitted calls" |
| `Call2_Detail_vod__c` | `call2_detail__v` *(inferred)* | |
| `Call2_Discussion_vod__c` | `call2_discussion__v` | confirmed; has `product__v` field |
| `Call2_Key_Message_vod__c` | `call2_key_message__v` *(inferred)* | |
| `Product_vod__c` | **`product__v`** | confirmed as lookup target on `call2_discussion__v` |
| `Key_Message_vod__c` | `key_message__v` *(inferred)* | |
| `TSF_vod__c` (Territory Field) | **`tsf__v`** | confirmed |
| `Time_Off_Territory_vod__c` | `time_off_territory__v` | confirmed |
| `Approved_Document_vod__c` | `approved_document__v` | confirmed — PromoMats/MedComms metadata sync |
| `Sent_Email_vod__c`, `Email_Activity_vod__c` | `sent_email__v`, `email_activity__v` *(inferred)* | |
| `CLM_Presentation_vod__c`, `CLM_Presentation_Slide_vod__c` | `clm_presentation__v`, `clm_presentation_slide__v` | confirmed; content upload via FTPS |
| `Message_vod__c` (Veeva Messages) | **`message__v`** ("Veeva Message" object) **plus** the platform **Message Catalog** ("Vault Messages") | confirmed; see below |
| `Veeva_Settings_vod__c` (Custom Setting) | **`veeva_settings__v`** object records | confirmed — "similar to other custom objects … define behaviour for a Vault or profile" |
| Other `*_Settings_vod__c` custom settings (Multichannel, Approved Email, Network…) | corresponding `*_settings__v` objects; appendix "Custom Settings" in Vault CRM help | *(names inferred)* |
| `VMOC_vod__c` (VMobile Object Configuration) | **`vmobile_object_configuration__v`** | confirmed; still called VMOC; managed from Business Admin or a tab on the object |
| Salesforce **Profile** | **Security Profile** (exactly one per user) + **Permission Sets** (CRED per object *and object type*, field permissions, page access, tab visibility, page-layout assignment) + **Application Profile** | confirmed |
| Profile-specific custom setting (settings owned by a Profile) | Veeva Setting / VMOC record with `security_profile__v` or `application_profile__v` set | confirmed |
| Record Type | **Object Type** (`Objecttype` sub-component of `Object`) | confirmed |
| Page layout assignment by profile+record type | page-layout assignment lives in the **Permission Set** (by object type) | confirmed |
| Custom Labels / Translation Workbench | Vault **Message Catalog** + **Bulk Translations** tool | confirmed |
| Apex triggers / classes | none — Vault **Java SDK** record triggers/actions (Veeva-controlled on Vault CRM), Vault "record triggers"/workflow/ jobs, configuration | third-party + inferred; see §7 |
| Visualforce / Lightning pages, MyInsights | **X-Pages** (Vault CRM's HTML/JS page container) + MyInsights Studio | confirmed X-Pages page exists in Vault CRM help |
| Sharing rules / Territory management | Vault CRM Territory Management (`territory__v`) and Align; object sharing via Vault sharing settings / **Account Plan Sharing** with `account_plan_object_hierarchy__v` Veeva Setting | partially confirmed |

### 5.1 Veeva Messages / localisation

- **Vault Messages** live in the platform **Message Catalog** (Admin > Settings > Message
  Catalog, `Messagegroup`/`Message` components *(component names inferred)*) and are used by
  new (24R3+) Vault-CRM-only functionality; translations are edited with **Bulk Translations**.
- **Veeva Messages** (`message__v` records) are still what the **mobile app** reads. A daily
  **"Vault Message to Veeva Message Copy" job (02:00)** copies catalog messages into
  `message__v`. A Full-Sync VMOC for `message__v` must be active per platform.
- Consequence for tooling: custom label/message changes should target the Message Catalog
  (Bulk Translations import/export CSV) rather than `message__v` directly, except for legacy
  categories the app reads only from `message__v`.

### 5.2 Personas: Security Profile + Permission Set + Application Profile

- **Security Profile** — the user's single profile; standard ones (`Vault Owner`, `System
  Admin`, `Business Admin`, `Read Only User` …) cannot be edited; customers copy them.
- **Permission Set(s)** — attached to security profiles; carry object CRED (per object type),
  field permissions, tab visibility, page access, page-layout assignments. They **do not**
  carry VMOCs or custom settings.
- **Application Profile** (`application_profile__v`, e.g. "Primary Care Sales Rep") — groups
  users with the same **Veeva Settings + VMOCs** independently of security profile. Settings
  records resolve with: `application_profile__v = @@USER_APP_PROFILE_ID@@ OR
  (application_profile__v = null AND security_profile__v = null)`; a setting's
  Application Profile field **overrides** its Security Profile field.
- **Align Functional Profile** = 1 Vault CRM Security Profile + 0..n **Application Roles**
  (Align-assigned groups of permissions) — how Align automates persona provisioning.
- Mapping rule of thumb for a migration tool: one Veeva CRM Profile → one Security Profile
  (+ one or more Permission Sets carrying its object/field/tab/layout access) **and** one
  Application Profile carrying that profile's Veeva Settings / VMOC ownership.

Sources: vaultcrmhelp.veeva.com — "Transitioning to Vault CRM for Veeva CRM Users",
"Veeva Settings", "Application Profiles", "Managing Vault Messages and Veeva Messages",
"Using VMobile Object Configurations", "Configuring Call Reporting", "Working with Territory
Fields", "Integrating Vault CRM and PromoMats/MedComms for Approved Email", "Managing CLM
Content in Vault CRM", "Vault CRM Permission Sets", "Security in Vault CRM";
vaultcrmalign.veeva.com "Functional Profiles"; platform.veevavault.help/en/lr/23647 and /45887.

---

## 6. Country handling in Vault CRM

- **Users**: the user's *primary country* is the two-letter ISO code in the **address
  section of `user__v`** (Vault users are `user__v` records; there is no separate
  `Country_vod__c` custom field). Multi-country users are supported for Network DCRs via a
  Network mapping of countries to the integration user.
- **Accounts**: `account__v.country_code__v` (ISO-2) — the Network bridge maps
  `primary_country__v` → `country_code__v`. Addresses carry their own country
  *(field name inferred: `country__v` picklist on `address__v`)*.
- **Country as a picklist**: the country picklist is a **global Vault picklist** defined once
  and reused by every object; adding a country value is a picklist change (§2.3), not a
  per-field change.
- **Per-country configuration**: Vault CRM has no first-class "Country" config object; country
  variants are expressed through **object types**, **picklist dependencies**, page-layout
  rules (`Layoutrule` component), Veeva Settings scoped by Application Profile, and VMOC
  where-clauses (`@@USER_COUNTRY@@`-style tokens *(token names inferred from Veeva CRM
  VMOC syntax; Vault CRM equivalents not verified)*). Country-specific labels use the
  Message Catalog per language/locale, not per country.
- **Localisation of labels**: Vault distinguishes *language* (UI labels, from the user's
  `language__v`) and *locale* (date/number formats); Bulk Translations exports/imports
  component labels (objects, fields, picklist values, layouts, messages) per language.

Sources: vaultcrmhelp.veeva.com "Supporting Multi-Country Users", "Working with Territory
Fields"; docs-vdm.veevanetwork.com "Vault CRM integration" (24R2.1/24R3.0); platform
help "About Language & Region Settings" (13309), "Using the Message Catalog" (58076).

---

## 7. Veeva's official Veeva CRM → Vault CRM migration process

What Veeva itself has said publicly (veeva.com / press):

- Vault CRM GA April 2024 for new customers; migrations of existing customers started late
  2024 (small) and 2025 (large); **125+ customers live by March 2026**; **end of support for
  Veeva CRM: 31 Dec 2029** (previously Sept 2030). Most migrations expected 2026–2029.
- Veeva migrates **standard data structures automatically**: "All data that is standard will
  be migrated by Veeva, without changes or interruptions, except for suffixes in data models."
  Customers own anything custom.
- Veeva provides **migration tooling and services**; **Accenture** is contracted for migration
  strategy / business-process optimisation, and Veeva certifies **Vault CRM Migration
  Partners** (e.g. Conexus) with early access and training.
- **Veeva Network** ships a **"Vault CRM Pre-Migration Report"** listing every Network
  configuration (systems, subscriptions, DCR routing, field mappings) that references the
  Veeva CRM system so it can be repointed to the Vault CRM system; the Network bridge to
  Vault CRM is a connector re-configuration, data stays in Network.
- The Vault CRM help page **"Transitioning to Vault CRM for Veeva CRM Users"** is the
  terminology/concept crosswalk (objects → objects, profiles → security profiles /
  permission sets, custom settings → Veeva Settings objects, VMOCs and Veeva Messages stay as
  object records).

Typical phasing (as described by Veeva partners and third-party playbooks — *third-party*):

| Phase | Automated by Veeva | Customer / partner manual work |
|---|---|---|
| 1. Assessment | Vault Config Report on the target; Network Pre-Migration Report; Veeva-run inventory of the SFDC org (objects, fields, profiles, custom code) | catalogue custom objects, Apex/Flows/VF, integrations, MyInsights, reports/dashboards |
| 2. Configuration migration | Veeva provisions the Vault CRM vault with the standard `__v` model and its standard packages; standard-object custom fields (`__c`) and picklist values are carried by Veeva's migration utility | anything with no Vault equivalent: Apex, Flows/Process Builder, VF/LWC pages, validation rules with formulas Vault cannot express, sharing rules, reports/dashboards, Salesforce-side integrations (SOAP/REST/Bulk clients, Data Loader jobs) |
| 3. Data migration | standard-object records with suffix rewrite; Ids re-keyed (Vault ids ≠ SFDC 18-char ids — external-id fields recommended) | custom-object data, attachments/files, historical objects you choose not to carry, third-party integration remapping |
| 4. Validation | Vault Compare / deploy validation | IQ/OQ/PQ, UAT, GxP validation packages |
| 5. Cutover & hypercare | | user provisioning (Align/SSO), device re-enrolment, sync of VMOCs |

Documented gotchas:

- **No Apex / Flows / Visualforce / LWC.** Business logic must be re-expressed as Vault
  configuration (object lifecycles, workflow, layout rules, formula fields, jobs) or — on Vault
  CRM — within Veeva-supported extension points (X-Pages, MyInsights Studio, Vault Java SDK
  where Veeva permits it on CRM vaults). *(Whether customers may deploy their own Java SDK code
  to a Vault CRM vault is not confirmed.)*
- **MyInsights** (Visualforce-hosted) → **MyInsights Studio / X-Pages** re-build.
- **Ids and suffixes**: every reference to `_vod__c` in integrations, MyInsights, reports must
  become `__v`; record ids change.
- **Reports/dashboards** do not migrate (Vault reporting is a different engine).
- **Profiles → 3 concepts** (security profile, permission set, application profile) — a
  1:1 rebuild is impossible; expect consolidation.
- **Custom settings** become object records — and can be scoped by Application Profile rather
  than Salesforce Profile.
- **Field/picklist-level discrepancies** between the two models are the main data-integrity
  and audit-trail risk (third-party finding).

Sources: https://www.veeva.com/resources/more-than-125-customers-worldwide-live-on-vault-crm-as-veeva-accelerates-the-industrys-agentic-transformation/ ;
https://docs-vdm.veevanetwork.com/doc/vndocad/Content/Network_topics/CRM/Vault_CRM_premigration_report.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/TransitionToVault.htm ;
https://www.cnxsi.com/ecosystem-expertise/veeva-systems/ (partner) ;
third-party: https://intuitionlabs.ai/articles/veeva-vault-crm-migration-roadmap ,
https://intuitionlabs.ai/articles/veeva-crm-vault-migration-checklist ,
https://www.grax.com/blog/veeva-salesforce-migration-guide/ .

---

## Uncertainties

1. **Official docs unreachable** — developer.veevavault.com, veevavault.dev, the platform/CRM
   help sites and support.veeva.com are egress-blocked here; endpoint paths come from VAPIL
   source (authoritative for paths) and search excerpts (authoritative for wording only).
2. **API version**: VAPIL `main` says `v26.2`; the exact latest GA version on 2026-09-07
   (`v26.2` vs `v26.3`) is not confirmed.
3. **`EXCEPTION` responseStatus** and the exact names of the `/auth` rate-limit headers and
   `X-VaultAPI-ClientID` are from prior knowledge, not re-verified.
4. **MDL attribute names** in the `Object`/`Permissionset`/`Securityprofile` examples are
   representative; always generate from `GET /api/mdl/components/…` on a sandbox.
5. **VPK internal layout** (`vaultpackage.xml` + `components/*.mdl`) and the `package_steps__v`
   child object are from prior knowledge of exported packages.
6. **Security-profile endpoints**: `/configuration/Securityprofile` is confirmed as a component
   route; the legacy `/metadata/objects/securityprofiles` and `/objects/securityprofiles` are
   unverified.
7. **Object-name mappings** marked *(inferred)* (`call2_detail__v`, `call2_key_message__v`,
   `key_message__v`, `sent_email__v`, `email_activity__v`, `address__v`, `child_account__v`)
   follow the documented suffix rule but were not individually confirmed.
8. **Country tokens** in Vault CRM VMOC where-clauses and the exact address country field
   name are unverified.
9. **Customer-authored Java SDK code on Vault CRM vaults** — allowed or not is unconfirmed.
10. **Migration phasing table** is a synthesis of partner/third-party descriptions; Veeva's
    internal migration utility (name, scope, report format) is not publicly documented in
    the sources reachable here.
