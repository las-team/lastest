# Veeva CRM (Salesforce) → Vault CRM Migration Tool — Implementation Specification

Package: `packages/veeva-migration` (TypeScript, pnpm workspace member of this monorepo).
Status: **v1 — contract for implementation agents.** Spec date 2026-09-07.
Source research (scratchpad, not shipped): `sfdc-extract.md`, `vault-api.md`, `vault-crm-model.md`, `best-practices.md`, `field-mapping.md`.

---

## 0. How to read this document

### 0.1 Evidence tags

Every vendor API name, header, limit or field name in this document carries one of these tags. **Implementation agents must not hard-code an `[UNVERIFIED]` name as truth** — it is a *default* that preflight (§5) resolves against live metadata and fails loudly on a miss.

| Tag | Meaning |
|---|---|
| `[SRC]` | Verified in production SDK source (jsforce 3.10.25, simple-salesforce 1.12.10, Veeva VAPIL 26.2.1, official Postman v22.2 collection). Highest confidence for endpoint paths, header names, parameter names, job states. |
| `[META]` | Exact Salesforce field API name/type parsed from real Veeva CRM Metadata API `.object` files (2017 org, Veeva CRM 17Rx). Exact for that release; fields added later are absent. |
| `[OBS]` | Vault CRM API name observed in code that runs against a live production Vault CRM (VQL text, REST paths, DTOs). Highest confidence for target names. |
| `[DOC]` | Stated on an official Veeva/Salesforce page as returned by web search (page not read in full). Reliable for existence, not verbatim. |
| `[SEC]` | Secondary/community source. |
| `[UNVERIFIED]` | Produced by the mechanical rename rule (§6.0.2) or inferred; never seen. Preflight must confirm. |
| `[UNVERIFIED-SOURCE]` | A **source** (SFDC) field or object name that appears in no research file — guessed from Veeva naming conventions. Preflight treats a miss as `info SF_FIELD_MISSING` (field silently dropped from the materialised mapping, counted), never as blocking, and never as a reason to fail the unit. Every such field is listed in §9.3 #32b. |
| `[GEN]` | General engineering/regulatory practice, not vendor-documented. |

### 0.2 Terminology

- **SFDC** = the Veeva CRM org on Salesforce (source). **Vault** = the target Vault CRM vault.
- **Object key** = the short `snake_case` identifier used in config, code, the id map and the structured object list (e.g. `account`, `call2_detail`). One key = one (SFDC object, Vault object) pair.
- **Run** = one execution of the pipeline for one *wave* (set of countries) in one *mode* (§2.7). **Unit of work** = (object key, country).
- **Country** = ISO-3166 alpha-2 code (`US`, `DE`, `JP`, `CN`, `BR`, …) plus the pseudo-country `GLOBAL` for objects with no country dimension.
- **Legacy id** = the 18-character, case-safe Salesforce record Id of the source row. **Legacy-id field** = the Vault field that stores it (§3).
- **Id map / crosswalk** = the persistent SFDC Id → Vault id table (§2.4, §3).
- **Watermark** = the per-(object, country) `SystemModstamp` high-water mark used by delta runs (§4).

---

## 1. Scope & assumptions

### 1.1 Data scope

1. **Master / reference data is migrated in full** (all non-deleted rows, regardless of age): accounts, addresses, child accounts, affiliations, TSF, product metrics, products, product groups, key messages, CLM presentations and slides, approved documents, sample lots, users (match-only by default), territories and user–territory assignments, EM speakers/venues/catalog, account plans, **and all consent** (`Multichannel_Consent_vod__c` — regulatory evidence; the latest opt-in/out per account × channel value × consent type must survive, and for GDPR markets the whole history is required).
2. **Activity / transactional data is scoped to the last 2 years** by **business date** (never by `CreatedDate`/`SystemModstamp`): calls and call children, sample transactions, sample inventories, EM events and their children, medical events and attendees, medical inquiries, orders and lines, sent emails and email activities, multichannel activities and lines. The per-object scope date field is listed in §6.2. "2 years" is `scope.historyMonths` (default `24`), computed as an **explicit literal** at run start (`cutoffDate = today − historyMonths` in UTC, persisted with the run), never as a relative SOQL literal (`LAST_N_YEARS:2` has calendar-year semantics and relative literals evaluate in the running user's timezone).
3. **Country-specific retention overrides** may widen (never narrow below) the scope for regulated objects: e.g. US `sampleRetentionMonths: 36` applied to `sample_transaction`, `call2_sample`, `sample_inventory*` (PDMA / 21 CFR 203 [GEN]); EU transfer-of-value objects (`em_event`, `em_attendee`, `em_event_speaker`, `expense_header`, `expense_line` — §6.2) commonly ≥60 months [GEN] via `scope.tovRetentionMonths`. Modelled in §7. The regulated object families that a retention knob may only widen are enumerated once, in §7.2 (`scope.regulatedFamilies`).
4. **Open / active items are always in scope regardless of date**: planned calls (`Status_vod__c = 'Planned_vod'`), medical inquiries not closed, active account plans, unexpired sample lots, EM events with end time in the future or status not closed/cancelled. Expressed as an `OR` term appended to the scope predicate (§6.2 per object).
5. **FK-closure rule ("older parents")**: any row *referenced* by an in-scope row is extracted and loaded **regardless of its own date or scope filter**, recursively to a fixpoint (§2.2.5). This guarantees a submitted 2024 call can point to the 2019 parent call it was an attendee of, the 2015 address it was signed at, the product/key message/presentation it detailed, the sample lot it disbursed, the EM event it belonged to, etc. Closure never *adds* children (a closed-over parent call does not pull its other children).
6. **Not migrated** (leave behind, §6.0.4): formula and roll-up fields, auto-numbers, `zvod_*` layout-marker fields, Salesforce `*Share`/`*History`/`*Feed`/Chatter/login history, custom settings and `Message_vod__c`, `Contact` rows (Vault CRM has no confirmed contact object), SFDC standard B2B account fields, Salesforce standard address compounds, `IsDeleted = true` rows (used only for delete propagation), Territory2 models (territories are loaded as `territory__v` records or left to Align — config), profiles/permission sets.
7. **Blobs** (signatures as base64 PNG, email HTML bodies, photos, product thumbnails) are loaded in a **second pass by id** (§8.6) so that first-pass payloads stay small; for the US the signature pass is mandatory (PDMA evidence).

### 1.2 Countries as migration units

- Every extract/transform/load/reconcile step is executed per **(object key, country)**. Watermarks, id-map rows, reconciliation counts, preflight findings and configuration overlays are all keyed by country.
- Each object declares how its country is derived (`countryOf`, §7.2): `field:<path>` (e.g. accounts: `Country_vod__r.Alpha_2_Code_vod__c`), `account` (via `Account_vod__r…`), `user` (via `User_vod__r.Country_vod__c` / owner), `parent:<objectKey>` (inherit from the parent row already in the id map), or `global`.
- A **wave** is an ordered set of countries with a shared cutover date; `GLOBAL` objects are loaded once in wave 0 and are refreshed by delta in every later wave.
- A country can target a **different vault** (`countries.CN.target.vaultDns`) and a different staging database location (`dataResidency`), so the tool never stages personal data of one region in another (§7.5).

### 1.3 Assumptions

| # | Assumption | If false |
|---|---|---|
| A1 | The source org is a Veeva CRM org (`*_vod__c` objects present, person accounts enabled, usually multi-currency and Territory2). Detected at preflight (`describeGlobal`, `IsPersonAccount`, `CurrencyIsoCode`, `Territory2`). | Column sets change; preflight reports `info` findings and the mapping drops absent columns. |
| A2 | The target vault is a Vault CRM vault (objects `account__v`, `call2__v`, `product__v`, `user__sys` exist) whose configuration (object types, picklists, lifecycles, custom `__c` fields, `country__v` rows, consent types/lines, EM event configurations, security profiles) has **already been provisioned** by the customer's configuration-migration workstream. The tool loads *data*; it creates configuration only when `--allow-mdl` is set and only for its own legacy-id field. | Preflight blocks (§5). |
| A3 | Users exist in Vault (provisioned via Vault admin / Align / SSO) before data is loaded. The tool **matches** users; it creates them only when `objects.user.mode = 'create'` is explicitly configured. | Rows referencing unmapped users use the fallback policy (§3.5). |
| A4 | Reference data owned by integrations (Network-bridged accounts/addresses, PromoMats/MedComms-synced key messages, presentations, approved documents, Align-owned territories) may already exist in Vault. The tool **matches before creating** (§3.3) and can be told to never create for such objects (`createPolicy: match-only`). | Duplicates → detected by reconciliation, resolved by account merge API (§8.7). |
| A5 | The migration user has Vault permissions *API: Access API*, *Vault Owner Actions: Record Migration* (for `X-VaultAPI-MigrationMode`) and object create/edit; and SFDC permissions *API Enabled* + *View All Data* (or per-object View All + read on all Veeva fields). | Preflight blocks. |
| A6 | Salesforce timestamps are UTC; Vault expects UTC. No timezone conversion is ever applied to datetimes; date-only fields are copied verbatim. The SFDC integration user's timezone is set to UTC. | Only affects relative literals, which the tool does not use. |
| A7 | Veeva's own standard-object migration service may or may not have run for the target vault. The tool is built to work in both cases: as the *only* loader, or as the delta/custom-object/reconciliation loader after Veeva's initial load. It detects Veeva-populated legacy ids at preflight (§3.2). | — |
| A8 | Postgres is available for the tool's own state (id map, watermarks, results); large CSV extracts are streamed to local disk under a run directory. | — |

---

## 2. Architecture

```
                 ┌────────────────────────────────────────────────────────────────────────┐
                 │                      veeva-migration CLI / library                      │
                 │                                                                        │
  SFDC org ──►   │ 1 Preflight ─► 2 Extract ─► 3 Closure ─► 4 Transform ─► 5 Load ─► 6 Reconcile │  ──► Vault
 (REST+Bulk 2.0) │      ▲             │            │            │            │           │      │  (REST vobjects,
                 │      │             ▼            ▼            ▼            ▼           ▼      │   VQL, metadata)
                 │   config +    run dir CSVs   FK id-sets   payload CSV/JSON  row results  counts │
                 │   overlays          └──────────── Postgres state: runs, watermarks, id_map, row_results, findings ───────────┘
                 └────────────────────────────────────────────────────────────────────────┘
```

Module layout (proposal; implementation agents own the exact file names):

```
packages/veeva-migration/
  src/config/        schema (zod), loader, per-country overlay resolution, mapping hash
  src/sfdc/          auth (JWT / client-credentials), rest client, bulk2 client, describe cache, soql builder
  src/vault/         auth, client (burst-aware), vql, metadata, picklists, objecttypes, records (bulk upsert), mdl, loader-api (optional)
  src/store/         drizzle schema + queries: runs, watermarks, id_map, row_results, findings, pending_fk, checkpoints
  src/preflight/     source checks, target checks, mapping lints, report
  src/extract/       scope predicates, closure, streaming CSV, checkpointing
  src/transform/     transforms registry, per-object modules (one file per object key), picklist crosswalk, name templates
  src/load/          batcher, upsert, second-pass patches, deletes, retry
  src/reconcile/     counts, hashes, orphan FK, sampling
  src/cli/           commands: preflight | init | delta | final-delta | verify | retry-failed | dry-run flags
  docs/MIGRATION_SPEC.md  (this file)
```

Conventions inherited from the monorepo: `pnpm`, `@/`-free (package-local imports), `getLogger("VeevaMig")` from a package-local pino wrapper mirroring `src/lib/logger` (server-only), Postgres via `postgres` + `drizzle-orm` in the package's own schema namespace `veeva_migration`, tests with vitest.

### 2.1 SFDC extract

#### 2.1.1 Authentication `[SRC]`
- Token endpoint: `POST {loginUrl}/services/oauth2/token`, `Content-Type: application/x-www-form-urlencoded`.
- **JWT Bearer (default)**: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<RS256 JWT>`; claims `iss` = connected-app consumer key, `sub` = integration username, `aud` = `https://login.salesforce.com` | `https://test.salesforce.com` | the org's My Domain login URL (**configurable** — Spring '26 sandboxes may reject `test.salesforce.com` [SEC]), `exp` = now + ≤ 3 min. No refresh token; re-run the exchange on `401` with body `[{"errorCode":"INVALID_SESSION_ID"}]`. The user must be pre-authorized on the connected app (`invalid_grant: user hasn't approved this consumer` otherwise).
- **Client credentials (alternative)**: `grant_type=client_credentials`, `client_id`/`client_secret` as form fields or HTTP Basic; must be called on the **My Domain** token URL; "Run As" integration user.
- **Username-password flow is forbidden** (retired 20 Feb 2027; blocked on new orgs).
- Response: `access_token`, `instance_url`, `id`, `token_type`. **All later calls use `{instance_url}` as base**. `id` is the identity URL `https://login.salesforce.com/id/{orgId}/{userId}` `[DOC]`: the tool parses `orgId` (18-char) from it, truncates to the 15-char case-sensitive form for `SF:{orgId15}:{id18}` (§3.2 step 4), stores it in `runs.source_org_id`, and blocks (`SF_ORG_MISMATCH`) if a later run against the same id map sees a different org. Cross-check: `SELECT Id FROM Organization`.
- Scopes required: `api` (+ `refresh_token offline_access` harmless).

#### 2.1.2 Versioning
- Pin `source.apiVersion` (default `"67.0"`, Summer '26). Preflight checks `GET {instance_url}/services/data/` contains it `[DOC]`.
- All paths below are relative to `{instance_url}/services/data/v{apiVersion}`.

#### 2.1.3 Describe `[SRC][DOC]`
- `GET /sobjects` — global list (`sobjects[].name, keyPrefix, queryable, custom, replicateable`). An object absent here = no Read permission.
- `GET /sobjects/{Object}/describe` — `fields[]{name,label,type,length,precision,scale,nillable,calculated,autoNumber,externalId,unique,idLookup,nameField,custom,createable,updateable,filterable,referenceTo[],relationshipName,picklistValues[]{value,label,active,defaultValue,validFor},compoundFieldName,extraTypeInfo,cascadeDelete?}`, `childRelationships[]{childSObject,field,relationshipName,cascadeDelete}`, `recordTypeInfos[]{recordTypeId,developerName,name,active,available,master}`, `keyPrefix`, `queryable`, `retrieveable`, `replicateable`. Send `If-Modified-Since` to cache. `replicateable` is the gate for `/deleted/` and `/updated/` (§2.1.6): both feeds are called **only** when it is `true`. Master-detail vs lookup is not flagged directly; the tool uses the practical tell `cascadeDelete = true ∧ nillable = false` on the reference field `[SEC]` (`describe.childRelationships[].cascadeDelete` from the parent side is the cross-check) — this classification drives the §3.5 policy and the §4.4 cascade source. Field types: `id|string|textarea|picklist|multipicklist|reference|boolean|int|double|currency|percent|date|datetime|email|phone|url|encryptedstring|base64|location|address|anyType`.
- `SELECT Id, SobjectType, DeveloperName, Name, IsActive, IsPersonType FROM RecordType` — fetched once per run and cached.

#### 2.1.4 REST SOQL `[SRC][DOC]`
- `GET /query?q=<url-encoded SOQL>` → `{totalSize, done, nextRecordsUrl, records[]}`; loop `GET {instance_url}{nextRecordsUrl}` while `done === false`. Header `Sforce-Query-Options: batchSize=2000` (200–2000). Cursors expire after **15 min idle** — stream pages to disk immediately.
- `GET /queryAll?q=` — same, includes `IsDeleted = true` rows still in the Recycle Bin (~15 days) and archived Task/Event.
- `GET /query/?explain=<SOQL>` — query plan (`cost`, `leadingOperationType`, `sobjectCardinality`); used at preflight to flag non-selective filters.
- `SELECT COUNT() FROM X WHERE <scope predicate>` — REST only (Bulk cannot aggregate) — used for reconciliation.
- `Id IN (…)` closure lookups: ≤ **400** 18-char ids per GET (URL ≤ 16 KB); `POST /query` with a JSON body `{ "q": … }` is `[UNVERIFIED]` — implement GET first, feature-flag POST. Second alternative `[DOC]`: `GET /composite/sobjects/{Object}?ids=<≤ 2,000 ids>&fields=<list>` returns full records by id (no `WHERE`, so it cannot apply `queryAll` semantics — deleted parents come back as `null` entries, which the closure treats as *dangling*); selectable via `extract.closureStrategy = 'soqlIn' | 'composite'` (default `soqlIn`).
- Use REST when the expected result set is < ~50k rows, for closure lookups, record types, `COUNT()`, and for small catalogs (products, key messages, presentations, approved documents, sample lots, countries, users, territories).
- Every response carries `Sforce-Limit-Info: api-usage=used/max` — parse it into the token bucket (§8.3).
- `QUERY_TIMEOUT` after ~120 s; non-selective = predicate matches > ~200k rows / >10% of table. Standard indexes: `Id`, `Name`, `OwnerId`, `CreatedDate`, `SystemModstamp`, `LastModifiedDate`, `RecordTypeId`, all lookups, external-id/unique custom fields.

#### 2.1.5 Bulk API 2.0 query jobs `[SRC][DOC]`
Base: `/jobs/query`.

| Step | Call | Notes |
|---|---|---|
| Create | `POST /jobs/query` body `{"operation":"query"\|"queryAll","query":"SELECT … FROM …","contentType":"CSV","columnDelimiter":"COMMA","lineEnding":"LF"}` | Optional header `Sforce-Enable-PKChunking: chunkSize=100000` (1,000–250,000; default 100,000; optional `; startRow=<Id>`; `; parent=<Object>` for share/history tables). Response = job info `{id, operation, object, state, createdDate, systemModstamp, contentType, apiVersion, lineEnding, columnDelimiter, …, numberRecordsProcessed}`. |
| Poll | `GET /jobs/query/{jobId}` | `state` ∈ `UploadComplete → InProgress → JobComplete \| Failed \| Aborted`. Failed query jobs carry no error message. Poll with backoff (1 s → 30 s cap); no client-side timeout below 6 h for large objects. |
| Results | `GET /jobs/query/{jobId}/results?maxRecords=<n>[&locator=<token>]`, header `Accept: text/csv` | Response headers **`Sforce-Locator`** (literal string `"null"` when done) and **`Sforce-NumberOfRecords`**. Each page is a full CSV with header row. Loop until locator == `"null"`. Persist `(jobId, locator)` as the checkpoint. Results retained **7 days**. |
| Abort / delete | `PATCH /jobs/query/{jobId}` `{"state":"Aborted"}`; `DELETE /jobs/query/{jobId}` | |
| List | `GET /jobs/query?jobType=V2Query` | for resume/cleanup |

CSV contract: header = field API names, relationship columns as `Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c`; datetimes ISO-8601 UTC (`2025-03-04T10:11:12.000Z`), dates `YYYY-MM-DD`, booleans `true/false`, empty = null, multipicklist `A;B;C`, RFC-4180 quoting, UTF-8.

Restrictions: no aggregates/`GROUP BY`/`LIMIT`/`ORDER BY`/`OFFSET`/`TYPEOF`, **no parent→child subqueries**, child→parent dot notation allowed (≤5 levels), **compound fields unsupported — select components** (`BillingStreet`, … ; `Name` on Contact).

Allocations: **150,000,000 records / rolling 24 h** (shared with Bulk 1.0), **15,000 batches / 24 h** (10k-row internal batches), **25 concurrent jobs** (run ≤ `performance.sfdcBulkConcurrency`, default 4, because Align/Network/Vault bridges share the org), 100k jobs total, ≤ 15 GB results per job. Job control calls count as API requests; result rows count against the 150M.

Selection rule: Bulk 2.0 for any unit expected > 2,000 rows (all transactional objects, `Account`, `Address_vod__c`, `TSF_vod__c`, `Product_Metrics_vod__c`, `Multichannel_Consent_vod__c`, `EM_Attendee_vod__c`, `User`); REST otherwise. `operation: "queryAll"` is used for **all** extracts so soft-deleted rows are captured in the same pass (routed to the delete path by `IsDeleted`). PK chunking whenever the unfiltered object > 1M rows or `explain` reports a non-selective plan (always on `init` for `Call2_vod__c` and children, `Sample_Transaction_vod__c`, `Sent_Email_vod__c`, `Multichannel_Activity_vod__c`, `Account`, `Address_vod__c`). PK chunking is supported for custom objects and `Account, Campaign, CampaignMember, Case, Contact, Event, Lead, Opportunity, Task, User` (+ share/history via `parent=`). A community report of missing rows on very large tables without PK chunking makes the `COUNT()` cross-check mandatory (§2.8).

#### 2.1.6 Delete/update feeds `[SRC][DOC]`
- `GET /sobjects/{Object}/deleted/?start=<ISO>&end=<ISO>` → `{deletedRecords[{id,deletedDate}], earliestDateAvailable, latestDateCovered}`; ≤ 30 days back; `start ≥ earliestDateAvailable`; persist `latestDateCovered` as next `start` (watermark kind `deleted`).
- `GET /sobjects/{Object}/updated/?start=&end=` → `{ids[], latestDateCovered}`; used as a cheap cross-check of the modstamp window (`|ids|` vs rows fetched).
- **Guard**: both feeds require `describe.replicateable = true` `[SRC/DOC]`. For a unit whose object is not replicateable (expected for `UserTerritory2Association`, `ObjectTerritory2Association`, possibly other standard association objects — confirmed only at preflight) the tool emits `info SF_NOT_REPLICATEABLE`, skips the two feeds, and relies on (a) `queryAll` `IsDeleted = true` rows (Recycle Bin window only) and (b) a **key-set reconciliation** at every delta (`verify --keys`: full `SELECT Id` of the object — small for association objects — diffed against the id map; ids gone from the source are routed to the delete queue with `deletedDate = wm_hi`). The `getUpdated` cross-check (§4.1) is simply not performed for such units.
- Change Data Capture is **not** used (5-entity / 25k-50k events per day allocations are insufficient for a Veeva org). Polling on `SystemModstamp` + `queryAll` + `getDeleted` is the delta mechanism (§4).

#### 2.1.7 Limits and throttling `[SRC][DOC]`
- `GET /limits` → `DailyApiRequests{Max,Remaining}`, `DailyBulkV2QueryJobs`, `DailyBulkV2QueryFileStorageMB`, `DailyBulkApiBatches`. Preflight blocks below `performance.sfdcApiFloor` (default 20% of `Max`).
- Concurrency: ≤ 25 synchronous requests > 20 s per org (`REQUEST_LIMIT_EXCEEDED: ConcurrentRequests`); per-request timeout 10 min.
- Retry classes: HTTP 429, `REQUEST_LIMIT_EXCEEDED`, `SERVER_UNAVAILABLE`, `UNABLE_TO_LOCK_ROW`, 5xx → exponential backoff with jitter (base 2 s, cap 5 min, 8 attempts); `401 INVALID_SESSION_ID` → re-auth once and replay; `INVALID_FIELD`, `MALFORMED_QUERY`, `INVALID_TYPE` → fatal for the unit (mapping bug).
- Salesforce "anomalous data export" transaction security policies (enforced July 2026) may flag large extractions by non-admin users — preflight `info` finding pointing the admin to exempt the integration user [SEC].

### 2.2 Extract pipeline (per unit)

1. **Scope predicate** built from §6.2 (`scopeDateField >= cutoff` ∨ open-item predicate) ∧ country predicate (§7.2). **No `IsDeleted` term** is added: the main pass runs as `queryAll`, so both live and Recycle-Bin rows come back in one job and the streaming router splits them on the `IsDeleted` column — `false` → transform, `true` → delete queue (§4.4). The REST `COUNT()` cross-check (step 8, §2.8) uses `query` (not `queryAll`) with the identical predicate and is compared with the number of `IsDeleted = false` rows streamed; the deleted-row count is reported separately (`extracted_deleted`).
2. **Column list** = mapped source fields (§6) ∩ `describe.fields[].name` (preflight already produced the diff) ∪ always-selected system columns `Id, IsDeleted, SystemModstamp, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById, RecordTypeId (if present), CurrencyIsoCode (if present), OwnerId (if present)` ∪ relationship columns needed for country and record-type resolution (`RecordType.DeveloperName`, `Country_vod__r.Alpha_2_Code_vod__c`, …).
3. **Stream** CSV pages to `{runDir}/{country}/{objectKey}/extract/{jobId}-{pageN}.csv`; append `(jobId, locator, rows)` to `extract_checkpoints`; never hold cursors across transforms.
4. **FK id-set collection** while streaming: for every source column with `describe.type == "reference"` that is in the mapping, add distinct values to `fk_sets[targetObjectKey]` (polymorphic `OwnerId → User|Group` keeps only `005` prefix ids; `Group` owners are recorded as `queue_owner` and resolved by fallback §3.5).
5. **Closure** (§1.1.5): after all time-scoped units of a country finished streaming, for each `fk_sets[objectKey]` subtract ids already present in the id map or in this run's extract, then fetch the remainder by `Id IN (…)` via REST `queryAll` (≤ 400 ids per call) selecting the same column list; recurse over the fetched rows' own FKs until no new ids appear. Self-referencing chains (`Primary_Parent_vod__c`, `Controlling_Address_vod__c`, `Parent_Product_vod__c`, `Parent_Call_vod__c`, `Parent_Event_vod__c`, `Parent_Order_vod__c`, `Parent_Email_vod__c`, `Ref_Transaction_Id_vod__c`, `Shared_Resource_vod__c`, `Sub_Presentation_vod__c`, `Child_affiliation_vod__c`, `Multichannel_Activity_vod__c`) converge in a handful of rounds; cap at 20 rounds with a `blocking` finding beyond. For very large remainders (> 50k ids) run one Bulk `queryAll` of the whole parent object and filter client-side.
6. Closure rows are tagged `closure = true` in the extract manifest (they bypass the scope filter but are otherwise transformed/loaded identically) and are attributed to the *referencing* row's country.
7. **Hub children of in-scope accounts** that are not time-scoped (addresses, TSF, child accounts both directions, affiliations both directions, product metrics, consent) are extracted by the master-data units themselves (they are full-scope); no special closure needed.
8. **Reconcile extract count** against `SELECT COUNT() … WHERE <identical predicate>` (REST) and `Σ Sforce-NumberOfRecords`; mismatch > 0 → `warning` and automatic re-run with PK chunking; second mismatch → `blocking`.
9. **Client-side ordering** — Bulk 2.0 cannot `ORDER BY` `[DOC]`, so any ordering the load requires is produced by the tool after extraction, never assumed from the CSV:
   - *Partition by predicate* (two Bulk jobs per unit, run sequentially): `call2` is extracted as `… AND Parent_Call_vod__c = null` (parents) then `… AND Parent_Call_vod__c != null` (attendee rows); `em_event` likewise on `Parent_Event_vod__c`. Declared per object as `load.partitionBy: { field, order: ['null', 'notNull'] }`; the second partition is loaded only after the first partition's id-map rows are committed.
   - *External sort*: `multichannel_consent` (and any object with `load.orderBy`) is sorted by `(Capture_Datetime_vod__c, Id)` before batching using a streaming external merge-sort over the extract CSV pages (`{runDir}/{country}/{objectKey}/sorted/*.csv`, chunk size `performance.sortChunkRows`, default 500k rows) — the pages are never loaded into memory at once. Batches are cut from the sorted stream, so batch *n* is fully acknowledged before batch *n+1* is sent (`vaultConcurrency` = 1 for ordered objects).
   - *Depth ordering* (`product` by `Parent_Product_vod__c`, `territory` by `ParentTerritory2Id`/`ParentTerritoryId`, `account` by `Primary_Parent_vod__c` only when `objects.account.depthOrder = true`): these catalogs are small enough to hold `(Id, ParentId)` in memory; depth = iterative BFS from roots (`ParentId = null` or parent not in the extract → depth 0), cycles/unknown parents after `maxDepth` (default 20) rounds → `warning MAP_DEPTH_UNRESOLVED` and the parent field is deferred to `secondPass`. Rows are batched depth by depth; a depth is loaded only after the previous depth's id-map rows are committed.
   - For REST extracts (`< 2,000` rows) `ORDER BY` is used directly and the same batching rules apply.

### 2.3 Transform

- One module per object key in `src/transform/objects/{objectKey}.ts` exporting `{ key, source, target, scope, countryOf, dependsOn, selfRefs, fields: FieldMapping[], objectTypes, states, deletePolicy, createPolicy }` matching the tables in §6. Country overlays (§7) are merged at plan time into a **materialised mapping** per (object, country) which is hashed (`mapping_hash`) and stored with the run.
- Transform functions (registry, §6.0.3) are pure, deterministic and unit-tested; they receive the source row, the resolved metadata (target field type/max_length/picklist values), the id map resolver, and the country context.
- Output = payload rows (JSON objects keyed by target API names) + `source_hash = sha256(canonical JSON, sorted keys, nulls removed)` + per-row diagnostics (`skipped(reason)`, `truncated(field)`, `unresolved_fk(field)`, `unmapped_picklist(field,value)`), written to `{runDir}/{country}/{objectKey}/payload/batch-{n}.json` (500 rows per file; each file becomes exactly one Vault call after FK resolution) and to `row_results` with state `transformed`.
- **Payload files never contain Vault ids.** Every reference produced by `ref(...)`/`refUser`/`territoryRef` is written as a *deferred reference* `{"$fk": {"object": "account", "sfdcId": "001…"}}` (users: `{"$user": "005…"}`); `refLookup` fields are already final (`{field}.{lookupField}` strings). The loader resolves `$fk`/`$user` through the id map **at send time**, immediately before the HTTP call, and the resolved request body is kept only in memory (and in `debug` payload dumps, §8.5). This is what makes payload files re-sendable after a parent re-key/merge (§4.2) and keeps §3.1 #2 true. A file whose `$fk` cannot all be resolved at send time is split: resolvable rows are sent, the rest go to `pending_fk` (§8.4). `source_hash` is computed over the *unresolved* form (SFDC ids), so it is stable across Vault re-keys.
- Rows whose required FK cannot be resolved are written to `pending_fk` (§8.4) instead of a batch.

### 2.4 ID crosswalk store

Postgres tables (drizzle schema `veeva_migration`; names are normative, columns may be extended):

```sql
id_map (
  object_key        text not null,        -- 'account'
  sfdc_id           char(18) not null,    -- always 18-char case-safe
  vault_dns         text not null,        -- one map per target vault
  vault_object      text not null,        -- 'account__v'
  vault_id          text not null,        -- 'V4U000000001001' / numeric string for user__sys
  country           text not null,
  match_method      text not null,        -- created | legacy_id | external_id | network_vid | mobile_id | username | federated_id | email | name_type | natural_key | manual | merged
  merged_into       char(18) null,        -- survivor SFDC id for many→one
  first_seen_run    text not null, last_seen_run text not null,
  source_hash       text null,            -- hash of last successfully loaded payload
  verified_hash     text null, verified_at timestamptz null,
  deleted_at        timestamptz null,     -- soft: undelete can re-link
  primary key (vault_dns, object_key, sfdc_id)
);
create unique index id_map_vault_uidx on id_map (vault_dns, vault_object, vault_id) where merged_into is null and deleted_at is null;

watermarks (object_key, country, kind /* modstamp | deleted */, value timestamptz, cutoff_date date, run_id, updated_at, primary key (object_key, country, kind));
runs (run_id, mode, wave, countries[], started_at, finished_at, status, tool_version, config_hash, mapping_hash, source_org_id, source_api_version, target_vault_id, target_vault_dns, target_api_version, sfdc_now_at_start, freeze_at);
row_results (run_id, object_key, country, sfdc_id, batch_no, state /* extracted|transformed|skipped|pending_fk|loaded_created|loaded_updated|loaded_unchanged|failed|deleted|inactivated */, error_type, error_message, attempt, payload_hash, vault_id, updated_at, primary key (run_id, object_key, sfdc_id));
pending_fk (run_id, object_key, country, sfdc_id, field, target_object_key, target_sfdc_id, attempts, resolved_at);
extract_checkpoints (run_id, object_key, country, job_id, locator, page_no, rows, file, completed_at);
preflight_findings (run_id, severity, code, object_key, country, field, detail jsonb, count, created_at);
reconciliation (run_id, object_key, country, sfdc_scope_count, extracted, transformed, skipped, pending_fk, created, updated, unchanged, failed, deleted, vault_count, agg_hash_src, agg_hash_tgt, status);
mapping_snapshots (mapping_hash, object_key, country, materialised jsonb, created_at);
fk_index (object_key, sfdc_id, field, target_object_key, target_sfdc_id, run_id, primary key (object_key, sfdc_id, field));  -- written during transform (§4.2); index on (target_object_key, target_sfdc_id)
audit_log (id bigserial, run_id, at, actor, event, detail jsonb);
probe_results (vault_dns, probe, result jsonb, checked_at, primary key (vault_dns, probe));  -- §5.3 runtime probes, cached per vault
```

- FK resolution **always** goes through the id map at send time (payload files hold deferred `$fk` references, §2.3 — never Vault ids), so that parent re-keys/merges propagate on the next child update.
- 15-char ids from CSV/user input are normalised to 18 (standard checksum) before keying.
- The map is per target vault (`vault_dns`); a sandbox map is never reused for production.

### 2.5 Vault load

#### 2.5.1 Authentication & session `[SRC][DOC]`
- `POST https://{vaultDNS}/api/{version}/auth`, `Content-Type: application/x-www-form-urlencoded`, body `username`, `password`, optional `vaultDNS` → `{responseStatus, sessionId, userId, vaultId, vaultIds[]{id,name,url}}`. **Verify `vaultId`/`vaultIds[].url` match the configured DNS** (a user's default vault may differ). Auth burst limit **20 calls / min per user+domain** → `API_LIMIT_EXCEEDED`; cache the session.
- Alternative (26R2+): API access token `Authorization: Bearer {token}` (`POST /api/{version}/objects/users/me/api_access_token__sys`, ≤ 25 per user) `[SRC VAPIL 26.2.1]`. OAuth/OIDC via `POST https://login.veevavault.com/auth/oauth/session/{oath_oidc_profile_id}` (path spelling verbatim).
- Session header: **`Authorization: {sessionId}`** (raw, no `Bearer`). Always send `X-VaultAPI-ClientID: {company}-{org}-veeva-migration-client-{program}` (≤ 100 chars, `[A-Za-z0-9_-]`) and `X-VaultAPI-ReferenceId: {run_id}:{object}:{batch}`.
- Session idle timeout = domain setting (10 min–8 h) and absolute 48 h max; `POST /api/{version}/keep-alive` every 10 min while idle; re-auth on `INVALID_SESSION_ID` (any endpoint) and replay once; `DELETE /api/{version}/session` at run end.
- `target.apiVersion` default `"v26.2"`; `GET https://{vaultDNS}/api` (no version segment) lists available versions `[SRC]` — it **requires the `Authorization` header**, so the version check runs *after* the first `POST /api/{version}/auth` (which is itself versioned: a wrong `target.apiVersion` fails auth with a `MALFORMED_URL`-style error; an unauthenticated version probe is not possible, so the tool retries auth once on the previous release `v26.1`, then calls `GET /api` and reports `VT_API_VERSION_MISSING` naming the versions actually offered).
- `GET /api/{version}/objects/users/me` ("Validate Session User") `[SRC]` is called right after auth: it confirms the session, returns the migration user's id (`target.migrationUserId` is validated against it — mismatch → `warning VT_MIGRATION_USER_MISMATCH`) and its vault membership; it is also the cheap health check used before each unit starts.
- **`X-VaultAPI-DowntimeExpectedDurationMinutes`** `[SRC header name]` on any response announces a scheduled downtime: the loader finishes the in-flight batch, checkpoints, and pauses for the announced duration + 1 min (finding `info VT_DOWNTIME_PAUSE`), then re-authenticates and resumes.

#### 2.5.2 Throttling `[SRC][DOC]`
- Every response: `X-VaultAPI-BurstLimit`, `X-VaultAPI-BurstLimitRemaining`, `X-VaultAPI-ResponseDelay` (ms of throttle applied), `X-VaultAPI-ExecutionId`, `X-VaultAPI-Status`. Burst = **2,000 calls / 5-min fixed window per vault**; beyond it each call is **delayed 500 ms**, not rejected. Daily limits are not enforced since v21.1.
- Policy: when `BurstLimitRemaining < performance.burstFloor` (default 200) pause until the window rolls; treat HTTP 429/503, `responseStatus: EXCEPTION`, `API_LIMIT_EXCEEDED`, `SERVICE_UNAVAILABLE` `[UNVERIFIED name]` as retryable (backoff + jitter); `INVALID_SESSION_ID` → re-auth + replay once. Throughput ceiling ≈ 2,000 × 500 = 1M rows / 5 min.
- Job status endpoint (`GET /api/{version}/services/jobs/{job_id}`) may be polled at most **once per 10 s** (`API_LIMIT_EXCEEDED`).

#### 2.5.3 Response envelope `[SRC]`
- `{responseStatus: SUCCESS|FAILURE|WARNING|EXCEPTION, responseMessage?, errors[]{type,message}, warnings[]}`. **HTTP is 200 even on FAILURE** — branch on `responseStatus`.
- Known error `type`s: `INVALID_SESSION_ID`, `API_LIMIT_EXCEEDED`, `INSUFFICIENT_ACCESS`, `INVALID_DATA`, `PARAMETER_REQUIRED` (multiply confirmed); `OPERATION_NOT_ALLOWED`, `MALFORMED_URL`, `METHOD_NOT_SUPPORTED`, `INACTIVE_USER`, `UNEXPECTED_ERROR`, `ATTRIBUTE_NOT_SUPPORTED`, `INVALID_FILTER`, `RACE_CONDITION` (single source). Match with `startsWith`, log unknown types.

#### 2.5.4 Bulk upsert `[SRC][DOC]`
- **`POST /api/{version}/vobjects/{object_name}?idParam={legacyIdField}`** — `Content-Type: application/json` (array of flat objects; CSV `text/csv` supported and used by the Loader path), `Accept: application/json`. **≤ 500 rows per call**, ≤ 1 GB, UTF-8. `idParam` must be a `unique: true` field on the object (`name__v` is not unique). Rows matching an existing value are updated, others created; each response row carries `data.id`, `data.url`, `data.id_param_value`, `data.event` (create/update).
- Headers:
  - `X-VaultAPI-MigrationMode: true` — required to set `state__v`, `created_by__v`, `created_date__v`, `modified_by__v`, `modified_date__v`, inactive `status__v`, `object_type__v` on update, system-managed `name__v`; bypasses validation rules, reference constraints (v22.1+), picklist dependencies, Create-Record lifecycle event actions (v23.3+), sends no notifications, stamps audit "in migration mode". Needs *Vault Owner Actions: Record Migration*. **Default `true`** for `init`/`delta`/`final-delta`; must be `true` when any mapping sets audit fields or `state__v`.
  - `X-VaultAPI-NoTriggers: true` — bypasses all system/standard/custom triggers (only effective with MigrationMode). **Default `true` for historical transactional objects** (calls, call children, sample transactions, EM children, sent emails, consent) because Vault CRM triggers would otherwise regenerate sample transactions from call sample rows, fire EM automated emails, recompute call roll-ups; **default `false` for master data** (`account__v`, `address__v`, `child_account__v`, `tsf__v`) so address→account stamping, TSF creation and formatted-name logic run. Per-object override `load.noTriggers`. Whether Veeva "system" CRM triggers are also skipped is `[UNVERIFIED]` (§9).
  - `X-VaultAPI-UnchangedFieldBehavior: AlwaysIgnore` — default for all upserts (unchanged fields skipped; re-runs do not fail on set-on-create/read-only fields and do not bump `modified_date__v`). Other values: `IgnoreSetOnCreateOnly` (Vault default since v21.1), `NeverIgnore`.
- Per-row status: iterate `data[]`; `responseStatus != SUCCESS` → row failure with `errors[]`. Row order == input order. Structural errors (unknown column, > 500 rows, bad content type) fail the whole call with outer `FAILURE`. **Duplicate `idParam` values inside one batch fail the entire batch** `[DOC-MIRROR]` → dedupe client-side, last-wins by `SystemModstamp`.
- Update by id: `PUT /api/{version}/vobjects/{object_name}` rows with `id` (or `?idParam`), only listed columns change; `WARNING` = no change. Used for second-pass self-reference patches (§6.1) with `id` from the id map.
- Delete: `DELETE /api/{version}/vobjects/{object_name}` body `id` list (≤ 500); `?idParam=` on DELETE is `[UNVERIFIED]` — use ids from the id map. `user__sys` cannot be deleted (set `status__v = inactive__v` via PUT). Cascade: `POST /vobjects/{object}/{id}/actions/cascadedelete` (async). Vault-side deleted ids: `GET /api/{version}/objects/deletions/vobjects/{object_name}?start_date&end_date&limit&offset` (30 days).
- Value formats `[DOC]`: Date `YYYY-MM-DD`; DateTime `YYYY-MM-DDTHH:MM:SS.SSSZ` (UTC, milliseconds, `Z`); Boolean `true`/`false`; Number decimal with `.`, validated against `scale`/`min_value`/`max_value`; Text ≤ `max_length` (Text type max 1,500; `name__v` 128); LongText ≤ 32,000; RichText limited markup (bold/italic/lists/links); Picklist = value **name** (`active__v`); multi-value picklist = comma-separated names without spaces (`a__v,b__v`; literal comma escaped by doubling `,,` — Loader-documented, medium confidence for REST); object reference = Vault record id **or** lookup key column `{field}.{unique_field}` (e.g. `object_type__v.api_name__v`, `product__v.external_id__v`) — never both for the same field; multi-value object reference = comma-separated ids; JSON `null`/empty string clears a field on update (`[UNVERIFIED]`; the tool omits keys for null unless `clearOnNull: true`).
- Object type on create: `object_type__v.api_name__v = "<type>__v"` `[OBS][SRC]`; changing type on upsert requires MigrationMode. Lifecycle state: `state__v = <state api name>` (MigrationMode).
- Users: `created_by__v`/`modified_by__v`/`ownerid__v`/`user__v` take the **numeric Vault user id** (`user__sys.id`) `[OBS: created_by__v: number]`; exact accepted form for `created_by__v` in MigrationMode is `[UNVERIFIED]` → preflight probe (§5.3.14).
- Currency: send the number; set `local_currency__sys` (reference → `currency__sys`) `[OBS field name]`; `*_corpv__sys` twins are Vault-computed. Accepted value form for `local_currency__sys` `[UNVERIFIED]` → resolve via VQL `SELECT id, name__v FROM currency__sys` `[UNVERIFIED object]` at preflight.
- Vault Loader API is an **optional alternative** for very large files: stage `POST /api/{version}/services/file_staging/items` (multipart `file`, `kind=file`, `path`, `overwrite=true`, ≤ 50 MB simple upload; resumable `POST /services/file_staging/upload` up to 500 GB), then `POST /api/{version}/services/loader/load[?sendNotification=true]` with ≤ 10 tasks `[{"object_type":"vobjects__v","object":"account__v","action":"upsert","file":"/u123/accounts.csv","order":1,"idparam":"external_id__v","recordmigrationmode":true,"notriggers":true}]` → `job_id`, then `GET /api/{version}/services/jobs/{job_id}` (≤ 1/10 s) and `GET /api/{version}/services/loader/{job_id}/tasks/{task_id}/successlog|failurelog`. Not used in v1 (direct `/vobjects` is synchronous and gives per-row status); keep the client stub behind `load.strategy: 'loader'`.

#### 2.5.5 VQL `[SRC][DOC]`
- `POST /api/{version}/query`, `Content-Type: application/x-www-form-urlencoded`, body `q=<VQL>`. Optional `X-VaultAPI-DescribeQuery: true`, `X-VaultAPI-RecordProperties: …`.
- Response `responseDetails{pagesize,pageoffset,size,total,next_page,previous_page}`, `data[]`. Page size default/max **1000** for objects (200 for documents); `PAGESIZE n` (synonym of `LIMIT`), `PAGESIZE 0` returns only `total`; paginate by following `responseDetails.next_page` (`/api/{version}/query/{uuid}?pagesize=1000&pageoffset=1000`, call with **POST**), which expires after ~15 min; `MAXROWS n`/`SKIP n` for chunked extracts.
- Syntax: `SELECT … FROM <object> [WHERE …] [ORDER BY …]`; strings single-quoted, escape `'` and `\` with backslash; dates `'YYYY-MM-DD'`, datetimes `'YYYY-MM-DDTHH:MM:SS.sssZ'`; booleans `true/false`; `= null`; relationship dot-notation `{field}__vr.name__v` / `__cr` / `__sysr` (names from metadata `relationship_outbound_name`, not derived); `IN (…)` lists ≤ 500 values (no documented cap); `CONTAINS('a','b')` for multi-value.
- Picklist fields come back as **arrays** even when single-valued `[OBS]` — normalise on read.
- Used for: pre-existing record matching (§3), reconciliation counts (`PAGESIZE 0`), hash read-back, orphan FK checks, currency/country/object-type id resolution.

#### 2.5.6 Metadata, picklists, object types, lifecycles, MDL `[SRC][DOC]`
- `GET /api/{version}/metadata/vobjects` → `objects[]{name,label,label_plural,prefix,url,status}`.
- `GET /api/{version}/metadata/vobjects/{object_name}[?loc=true]` → `object{name,label,prefix,status[],object_class,system_managed,allow_types,default_obj_type,object_types[]{name,label,status,url},available_lifecycles[],auditable,relationships[]{relationship_name,relationship_type,field,object{name}},fields[]}`; field keys: `name,label,type,required,unique,editable,status[],max_length,max_value,min_value,scale,multi_value,picklist,object{name,…},relationship_type (reference|parent|child),relationship_outbound_name,relationship_inbound_name,lookup_relationship_name,lookup_source_field,system_managed_name,sequential_naming,value_format,format_mask,subtype,no_copy,encrypted,checkbox,created_by,created_date,modified_by,modified_date`. Field `type` values confirmed: `ID, String, Number, Boolean, Date, DateTime, Picklist, Object`; `LongText`, `RichText`, `Currency`, `Formula`, `Lookup` casing `[UNVERIFIED]` — match case-insensitively.
- `GET /api/{version}/metadata/vobjects/{object_name}/fields/{field_name}` — single field.
- `GET /api/{version}/objects/picklists` → `picklists[]{name,label,kind,system,usedIn[]{objectName,propertyName}}`; `GET /api/{version}/objects/picklists/{picklist_name}` → `picklistValues[]{name,label,status}` (**active values only**); `POST /api/{version}/objects/picklists/{picklist_name}` form `value_1=Label…` (≤ 1024 values; only with `--allow-picklist-create`); `PUT /api/{version}/objects/picklists/{picklist_name}/{value_name}` body `status=active|inactive` (and `name=`) `[SRC]` **re-activates an inactive target value** — historical rows routinely carry values that were retired in the target; because `GET …/picklists/{name}` returns active values only, preflight cannot see inactive ones, so a `VT_PICKLIST_VALUE_MISSING` finding first tries `GET /metadata/vobjects/{object}/fields/{field}` + a VQL probe (`SELECT id FROM {object} WHERE {field} = '{value}' PAGESIZE 0` succeeds for inactive-but-existing values, `INVALID_FILTER`/`INVALID_DATA` otherwise) and, when the value exists but is inactive, offers `--allow-picklist-reactivate` (PUT `status=active`, load, then PUT `status=inactive` again at run end unless `picklists.leaveReactivated = true`); migration mode alone does not accept inactive picklist values `[SEC]`. The field-metadata `picklist` property form (`country__v` vs `Picklist.country__v`) is `[UNVERIFIED]` — strip an optional `Picklist.` prefix.
- `GET /api/{version}/configuration/Objecttype` (all) and `GET /api/{version}/configuration/Objecttype.{object}.{type}` → `name, object, active, type_fields[]{name,required,source}` — **required-ness is per object type**; validate per type.
- `GET /api/{version}/configuration/Objectlifecycle.{lifecycle}` — state API names for `state__v` mapping.
- `POST /api/{version}/vobjects/{object_name}/actions/changetype` (CSV: `id`, `object_type__v.api_name__v`, optional new-type field values) `[SRC Postman]` changes a record's object type. **Side effects** `[SRC verbatim]`: field values that do not exist on the new type are removed, and *if the object has a lifecycle, changing type resets its state to the initial state type*. The tool therefore never changes type through a plain upsert: a delta whose `RecordType.DeveloperName` differs from the id-map's stored type (`id_map.object_type` column) is routed through `changetype`, followed by a full PUT of the row (all mapped fields, `state__v` re-sent in migration mode) — finding `info OBJECT_TYPE_CHANGED` with counts; when `objects.<key>.allowTypeChange = false` (default for lifecycled objects `em_event`, `call2`, `sample_transaction`, `order`, `medical_inquiry`) the row is `failed(TYPE_CHANGE_BLOCKED)` for manual review instead.
- `GET /api/{version}/metadata/objects/users` — Users API field metadata; `GET /api/{version}/objects/users/{id}/permissions?filter=object.{name}.{actions}` — permission probe.
- `GET /api/{version}/limits` → `records_per_object{…}` (standard objects ≤ 100M, raw objects ≤ 1B).
- MDL (`--allow-mdl` only): `POST /api/mdl/execute` (**no version segment**), raw body starting `CREATE|RECREATE|RENAME|ALTER|DROP`; `POST /api/mdl/execute_async` + `GET /api/mdl/execute_async/{job_id}/results` mandatory for objects with ≥ 10,000 records when adding fields. Verified syntax:
  ```
  ALTER Object call2__v (
    ADD Field legacy_crm_id__c(
      label('Legacy CRM ID'), type('String'), max_length(18), active(true), required(false),
      list_column(false), unique(true), order(0))
  );
  ```
  Read back: `GET /api/mdl/components/Object.{object_name}` / `GET /api/{version}/configuration/Object.{name}`.
- Users API (only when `objects.user.mode = 'create'`): `POST /api/{version}/objects/users` (bulk JSON/CSV ≤ 500, `?operation=upsert&idParam=…`), fields `user_name__v, user_first_name__v, user_last_name__v, user_email__v, user_timezone__v, user_locale__v, user_language__v, security_policy_id__v, security_profile__v, license_type__v, company__v, federated_id__v, send_welcome_email__v, domain_active__v, active__v, vault_membership`; `PUT /api/{version}/objects/users/{id}`; `PUT /api/{version}/objects/users/{user_id}/vault_membership/{vault_id}` (`active__v`, `security_profile__v`, `license_type__v`) `[SRC Postman]`; `GET /api/{version}/objects/users[?vaults=all&limit&start]`. **`security_policy_id__v` is part of the Postman *Create Single User* body** `[SRC]` and is treated as required on create (`objects.user.securityPolicyId`, resolved at preflight from the Vault admin — no API to list policies is documented → blocking `VT_USER_SECURITY_POLICY_MISSING` in create mode); `vault_membership` is a string `{vault_id}:{active__v}:{security_profile}:{license_type}` `[SRC]`, composed from `target.vaultId` (from auth), `IsActive`, the profile crosswalk and `objects.user.licenseType` (default `full__v`). `user__sys` required on create via `/vobjects/user__sys`: `email__sys, first_name__sys, last_name__sys, username__sys, language__sys, locale__sys, timezone__sys, security_profile__sys` `[DOC-MIRROR]`.
- Account merge (post-load dedup, manual approval): `POST /api/{version}/vobjects/account__v/actions/merge` (`main_record_id`, `duplicate_record_id`, ≤ 10 sets) `[API]`.
- Roll-up recalculation after migration-mode loads: migration mode **bypasses roll-up recalculation** `[DOC-MIRROR roll-up-fields.md]` and Vault exposes a per-object recalculation action (`/vobjects/{object}/actions/recalculaterollups`-style — **path `[UNVERIFIED]`**). Governed by `postLoad.recalculateRollups` = `auto` (default: preflight probes the path — `OPTIONS`/`GET` on the candidate path and a scan of `GET /metadata/vobjects/{object}` `urls{}` for an action named `*rollup*` — and records `PROBE_RESULT rollupRecalc = available | absent`), `required` (absent path → **blocking** `VT_ROLLUP_RECALC_UNAVAILABLE`), `off`. The objects whose roll-ups the tool depends on are `sample_lot__v` (`calculated_quantity__v`), `em_event__v` attendance counters, `sent_email__v` open/click counts, `order__v` amounts, `account_plan__v` progress; the US sample overlay makes it `required` (§7.4.1) unless the sample fallback strategy is chosen there.
- Corporate-currency recalculation: `POST /api/{version}/vobjects/{object_name}/actions/updatecorporatecurrency` `[DOC snippet, body/idempotency UNVERIFIED]` recomputes `*_corpv__sys` twins; run once per object with currency fields after every migration-mode load when `postLoad.updateCorporateCurrency = true` (default `true`; absent endpoint → `warning VT_CORP_CURRENCY_UNAVAILABLE`, reported, not blocking).

### 2.6 Config preflight

Runs before **every** mode (including dry-run), produces the findings report (§5), and materialises the resolved mapping. It consists of: SFDC checks (describe-driven), Vault checks (metadata-driven), offline mapping lints, and probes (1-row create/delete round-trips in migration mode against the **probe object** `preflight.probeObject` when `preflight.probeWrites = true`, §5.3). Details in §5.

### 2.7 Run modes

| Mode | Source filter | Target operation | Watermark |
|---|---|---|---|
| `preflight` | — | — (read-only) | — |
| `init` | scope predicate (§6.2) + country + closure; PK chunking on large objects | upsert by legacy id (idempotent) | sets `modstamp` = run's `wm_hi` and `deleted` = `latestDateCovered` per unit **after** all pages loaded |
| `delta` | `SystemModstamp >= wm_lo − overlap AND SystemModstamp < wm_hi` + country (scope predicate still applied; closure for new parents) + `getDeleted` + `IsDeleted=true` rows | upsert; delete/inactivate/ignore per `deletePolicy` | advances only when the whole unit succeeded |
| `final-delta` | as `delta` with `wm_hi = freezeAt` (frozen SFDC timestamp) | as delta, followed by the reconciliation gate; a failed gate blocks the wave sign-off | as delta |
| `verify` | — | read-only counts / hashes / orphan FK | — |
| `retry-failed --run <id>` | rows in `row_results` with `state = failed` and retryable error types | re-transform from the stored extract, re-upsert | — |
| any mode `--dry-run` | as the mode | **no writes**: preflight + extract (optionally `--limit N`) + transform + validation + payload files + simulated counts | not advanced |

`init` is re-runnable: a second `init` for the same unit is equivalent to a full delta (upsert semantics; unchanged rows skipped by hash).

### 2.8 Reconciliation

Per unit and per run (§8.8 for the gate):
- `sfdc_scope_count` = REST `SELECT COUNT()` with the identical predicate; `extracted` = rows streamed (+ closure rows separately); `transformed`, `skipped(reason)`, `pending_fk`, `created`, `updated`, `unchanged`, `failed(error_type)`, `deleted`; `vault_count` = VQL `SELECT id FROM {object} WHERE {legacyIdField} != null [AND country predicate] PAGESIZE 0` → `responseDetails.total`.
- Invariants (the same two identities are the §8.8 gate; nothing else is counted):
  - **Extract completeness**: `sfdc_scope_count == extracted_live` (REST `COUNT()` with `query` vs `IsDeleted = false` rows streamed) — `warning EXTRACT_COUNT_MISMATCH`, re-run with PK chunking, second mismatch `blocking`.
  - **Load accounting**: `extracted_live + closure == created + updated + unchanged + skipped + failed + pending_fk` per unit, where `skipped` is broken down by reason (`erased`, `rule`, `contact_ref`, …) and `deleted` (from `extracted_deleted` + feeds) is accounted separately as `deleted_routed == deleted_applied + deleted_ignored + deleted_pending`.
  - Gate (§8.8) additionally requires `failed = 0`, `pending_fk = 0` and `skipped` fully documented.
- Aggregate hashes both sides: `count`, `sum(hash32(source_hash))`, `min/max(scopeDate)`, distinct FK target counts. Row-level hash read-back for a stratified sample (§8.8).
- Orphan FK: pre-load unresolved counts per field; post-load VQL `SELECT id FROM child WHERE parent__v = null AND legacy_crm_id__v != null` compared with expected nulls; periodic FK-consistency pass (parent changes are invisible to the child's watermark).
- Every number is persisted in `reconciliation` and printed as a table; `final-delta` requires tolerance 0 (or documented exclusions) to pass.

---

## 3. ID matching strategy

### 3.1 Principles

1. Every loaded row stores its **legacy id** (18-char SFDC Id) on the target in the object's **legacy-id field**, and that field is the `idParam` of every upsert. This is what makes loads idempotent and re-runnable and lets reconciliation join both sides.
2. The **id map** (§2.4) is the only FK resolver. Payload files carry deferred `$fk` references (SFDC ids, §2.3); Vault ids are substituted only in the in-memory request body at send time.
3. **Match before create**: for every object a precedence list of match keys is tried against pre-existing Vault records (Veeva-migrated, Network-bridged, Align-created, PromoMats-synced, or loaded by a previous run) before a create is allowed; `match_method` records which key matched.
4. Lookups are batched (VQL `WHERE {key} IN (…)` ≤ 500 values, ≤ 1000 rows per page) and cached in the id map; never one record at a time.

### 3.2 Legacy-id field resolution (per object, at preflight)

Order of precedence; the first that passes is chosen and logged as finding `LEGACY_ID_FIELD_SELECTED`:

| Step | Candidate | Condition | Stored value format |
|---|---|---|---|
| 1 | `objects.<key>.legacyIdField` (explicit config) | field exists, `unique: true`, `editable: true` | as configured (`legacyId.format`) |
| 2 | **`legacy_crm_id__v`** `[OBS on em_event__v, user__sys; UNVERIFIED elsewhere]` | exists, `unique: true` | `{id18}` (plain 18-char id — matches the observed convention; if a sample of Veeva-migrated rows (`SELECT legacy_crm_id__v … PAGESIZE 20`) shows 15-char values, set `legacyId.format = '{id15}'` for that object and normalise on read) |
| 3 | `legacy_crm_id__v` exists but **not** unique | — | still written (for traceability) but **not** used as `idParam`; fall through |
| 4 | `external_id__v` `[OBS on account__v, address__v, em_*, user_territory__v, product__v, country__v]` | exists, `unique: true`, and `objects.<key>.externalIdOwnedBy != 'integration'` (for `account`, `address`, `product`, `key_message`, `clm_presentation*`, `approved_document`, `territory` the default is `integration` — Network/PromoMats/Align write there) | `SF:{orgId15}:{id18}` (prefixed so it can never collide with integration keys; the prefix is configurable `legacyId.externalIdFormat`) |
| 5 | custom `legacy_crm_id__c` | exists (created by an earlier `--allow-mdl` run or by the customer), `unique: true` | `{id18}` |
| 6 | create `legacy_crm_id__c` via MDL (§2.5.6) | only if `--allow-mdl`; async MDL when the object has ≥ 10k records | `{id18}` |
| 7 | none | — | **blocking** finding `LEGACY_ID_FIELD_MISSING` — the object cannot be loaded idempotently |

Special cases:
- **`user__sys`**: no `external_id__v` `[OBS]`; `legacy_crm_id__v` exists `[OBS]` but users are match-only by default, so it is a *match key*, not an `idParam` (users are updated by `id` when at all).
- **Objects whose source external id is itself a stable Veeva GUID** (`Mobile_ID_vod__c`, unique) also carry it into `mobile_id__v` where the target has it; `mobile_id__v` is a secondary match key, never the idParam (not guaranteed unique in target metadata).
- `child_account`, `tsf`: Veeva populated `External_ID_vod__c` with embedded SFDC ids (`{ParentId}__{ChildId}`, `{AccountId}__{TerritoryName}`). The tool writes `external_id__v` **recomputed with Vault ids** (`{vaultParentId}__{vaultChildId}`, `{vaultAccountId}__{territoryName}`) when `objects.<key>.rewriteCompositeExternalId = true` (default), otherwise verbatim; the legacy-id field still holds the row's own SFDC Id.

### 3.3 Pre-existing record matching — per object

Precedence stops at the first hit. `natural_key` matches are reported as `warning` findings with counts so a human can review them before `init` (`preflight.naturalKeyReview = true` blocks until acknowledged).

| Object key | 1st | 2nd | 3rd | 4th | Create when unmatched? |
|---|---|---|---|---|---|
| `country` | `country__v` by ISO alpha-2 (`Country_vod__c.Alpha_2_Code_vod__c` ↔ target key field: `abbreviation__v`/`country_code__v`/`external_id__v` `[UNVERIFIED — resolve at preflight by scanning fields for a 2-char unique String]`) | `name__v` case-insensitive | — | — | **never** (blocking `COUNTRY_UNMATCHED`) |
| `user` | id map | `user__sys.legacy_crm_id__v = {id18}` | `salesforce_username__sys = User.Username` `[OBS]`, then `username__sys = User.Username`, then `federated_id__sys = User.FederationIdentifier` | `email__sys = User.Email` (only if exactly one active hit; else `warning UNMAPPED_USER_AMBIGUOUS`) | **never by default** (`objects.user.mode = 'match'`); `create` mode uses Users API upsert on `user_name__v` |
| `territory` | id map | `territory__v.external_id__v = Territory2.DeveloperName` `[UNVERIFIED field]` | `territory__v.name__v = Territory2.Name` (unique in practice) | — | only if `objects.territory.createPolicy = 'create'` (default `match-only`; Align owns territories) |
| `user_territory` | id map | `(user__v, territory__v)` pair via VQL | — | — | yes |
| `product` | id map | `product__v.external_id__v = External_ID_vod__c` (when populated) | `product__v.vexternal_id__v = VExternal_Id_vod__c` `[UNVERIFIED]` (PromoMats-synced products) | `(name__v, product_type__v)` + same country/market, parent matched first | yes (unless `createPolicy = match-only`) |
| `product_group` | id map | legacy-id field | `(product__v, detail_group__v)` pair | — | yes |
| `account` | id map | legacy-id field | **Network VID**: `Account.VeevaID_vod__c` (or configured customer field, e.g. `NET_External_Id__c`) → `account__v.veeva_network_id__v` `[OBS Reltio]` (fallback spelling `veeva_network__id__v` `[DOC snippet]` — preflight picks whichever exists) | `account__v.external_id__v = External_ID_vod__c` (Network bridge convention); then `mobile_id__v` | yes; merged SFDC losers (`MasterRecordId`) map to the survivor with `merged_into` |
| `address` | id map | legacy-id field | `address__v.external_id__v = External_ID_vod__c`; `mobile_id__v` | natural key `(account__v, upper(name__v), upper(city), postal_code, country)` | yes |
| `child_account` | id map | legacy-id field | `(parent_account__v, child_account__v)` pair | `external_id__v` | yes |
| `affiliation` | id map | legacy-id field | `external_id__v`; `(from_account__v, to_account__v, role__v)` | — | yes |
| `tsf` | id map | legacy-id field | `(account__v, territory__v)` pair | `external_id__v` | yes |
| `product_metrics` | id map | legacy-id field | `(account__v, products__v \| product__v)` pair | `external_id__v` | yes |
| `key_message` | id map | `vexternal_id__v = VExternal_Id_vod__c`, `vault_doc_id__v = Vault_Doc_Id_vod__c`, **`vault_external_id__v = Vault_External_Id_vod__c`** `[DOC — the key Vault CRM uses to match legacy call key messages, vault-crm-model.md §4.13]` | `media_file_name__v = Media_File_Name_vod__c` (unique) | legacy-id field | only when `createPolicy = 'create'` (default `match-only` when the vault has the PromoMats/MedComms CLM integration; else `create`) |
| `clm_presentation` | id map | `vexternal_id__v`, `vault_doc_id__v`, `presentation_id__v = Presentation_Id_vod__c` | legacy-id field | — | as key_message |
| `clm_presentation_slide` | id map | **`vault_external_id__v`** `[DOC slide identity used by gotoSlide]` = `Vault_External_Id_vod__c` `[UNVERIFIED-SOURCE]` (fallback: the matched key message's `Vault_External_Id_vod__c`), `external_id__v = External_ID_vod__c`, `vexternal_id__v` | `(clm_presentation__v, key_message__v)` | — | as key_message |
| `approved_document` | id map | `vault_document_id__v = Vault_Document_ID_vod__c`, `document_id__v = Document_ID_vod__c` | legacy-id field | — | as key_message |
| `sample_lot` | id map | `sample_lot_id__v = Sample_Lot_Id_vod__c` (unique) `[UNVERIFIED]` | legacy-id field | `(name__v, product__v, ownerid__v)` | yes |
| `em_speaker`, `em_venue`, `em_catalog` | id map | `external_id__v = External_ID_vod__c` `[OBS upsert idParam]` | legacy-id field | `em_speaker`: `account__v` pair | yes |
| `em_event` | id map | `legacy_crm_id__v` `[OBS]` | `external_id__v`, `mobile_id__v` | `stub_sfdc_id__v` | yes |
| `em_attendee`, `em_event_speaker`, `em_event_team_member` | id map | legacy-id field | `external_id__v` `[OBS]`; `mobile_id__v` | `(event__v, account__v \| user__v \| speaker__v)` | yes |
| `expense_header`, `expense_line` | id map | legacy-id field | `external_id__v` (if present) | `(event__v, payee, payment_date__v)` header natural key (warning-level) | yes |
| `medical_event`, `event_attendee` | id map | legacy-id field | `mobile_id__v` | — | yes (closure only) |
| `account_plan` | id map | legacy-id field | `mobile_id__v` | — | yes |
| `medical_inquiry` | id map | legacy-id field | `mobile_id__v`; `group_identifier__v` | — | yes |
| `call2`, `call2_*` | id map | legacy-id field | `mobile_id__v = Mobile_ID_vod__c` | — | yes |
| `sample_transaction`, `sample_inventory*` | id map | legacy-id field | `mobile_id__v` | — | yes |
| `order`, `order_line` | id map | legacy-id field | `mobile_id__v` | — | yes |
| `sent_email`, `email_activity` | id map | legacy-id field | `mobile_id__v` | — | yes |
| `multichannel_consent` | id map | legacy-id field | `external_id__v = External_ID_vod__c`; `mobile_id__v` | natural `(account__v, consent_type__v, channel_value__v, capture_datetime__v)` | yes |
| `multichannel_activity`, `multichannel_activity_line` | id map | legacy-id field | `vexternal_id__v`; `mobile_id__v` | — | yes |

### 3.4 Special cases

- **Users**: the user map is built **first** (wave 0, `GLOBAL`) and is required by every other object (`ownerid__v`, `created_by__v`, `modified_by__v`, `user__v`, `team_member__v`, `inventory_for__v`, `transfer_to__v`, `assign_to_user__v`, `organizer__v`, `manager__sys`). Extract **all** SFDC users incl. inactive (historical references). Never auto-create users from data migration; emit `UNMAPPED_USER` findings (count of referencing rows per unmapped user). Fallback policy §3.5.
- **Products**: hierarchy loaded by depth (Detail Group ← Detail ← Sample/Order/BRC/Kit Item); a child is matched/created only after its parent resolved. Product names repeat across types, so `(name__v, product_type__v)` is the natural key, scoped by country/market when `Product_vod__c` carries a country/market field in the org.
- **Accounts**: (a) SFDC merges — deleted loser rows carry `MasterRecordId` (via `queryAll`); record `loser → winner` (`merged_into`) and re-issue child updates for children whose parent was the loser; `Account_Merge_History_vod__c` is a second source when present. (b) Many→one from Network dedup: N id-map rows share one `vault_id`; children from all losers land on the survivor and are deduped by their own natural keys. (c) Person vs business is an object type on `account__v` (no Contact rows): SFDC `Contact` lookups (`Contact_vod__c` on calls, affiliations, attendees) are **dropped** with a `CONTACT_REF_DROPPED` count unless the customer maps contacts to person accounts by `PersonContactId` (`objects.account.contactToPersonAccount = true` resolves `Contact.Id` → owning person account's SFDC Id via `Account.PersonContactId`).
- **Countries**: never created; `country__v` rows must exist. The crosswalk (SFDC `Country_vod__c.Id` ↔ ISO-2 ↔ `country__v.id` ↔ address picklist value name) is built once per run and used by every `country(...)` transform.
- **Queue owners** (`OwnerId` with `00G` prefix): no Vault equivalent → `ownerid__v` = the rep from `User_vod__c` if present, else the migration user; finding `QUEUE_OWNER_REPLACED` with count.

### 3.5 Unresolved reference policy

| Field class | Policy when the referenced row is not in the id map |
|---|---|
| Master-detail / target `required` reference | row → `pending_fk` (§8.4); retried at end of run after closure; still unresolved → `failed(UNRESOLVED_FK)` |
| Optional lookup | load with the field **omitted**, record `unresolved_fk` diagnostic; a later FK-consistency pass re-points when the parent arrives |
| `created_by__v` / `modified_by__v` | fallback to `target.migrationUserId` (finding `AUDIT_USER_FALLBACK`, count) |
| `ownerid__v` / business owner fields (`user__v`, `assign_to_user__v`, …) | never silently fall back: `objects.<key>.unmappedUserPolicy = fail \| migrationUser \| skipRow \| omit` (default `fail` for `ownerid__v` on objects that require it, `omit` for optional user lookups); `migrationUser` substitutes `target.migrationUserId` — there is **no separate `users.fallbackUserId`** key (§7.2.1) |

---

## 4. Delta strategy

### 4.1 Watermark

- Column: **`SystemModstamp`** (UTC datetime, indexed; moves on user *and* system-side writes; `LastModifiedDate ≤ SystemModstamp`). `getUpdated` uses it too.
- Granularity: one watermark per **(object key, country, kind)**, `kind ∈ {modstamp, deleted}`, stored with the `cutoff_date` in force so a retention-policy change is detectable (`SCOPE_CUTOFF_CHANGED` finding → forces a wider re-extract).
- Clock: `sfdc_now` is taken from Salesforce (the `Date` response header of the first REST call of the run, or `SELECT MAX(SystemModstamp)`), never from the host.
- Window: `wm_lo = watermark.modstamp − overlap` (`delta.overlapMinutes`, default **10**, range 5–15), `wm_hi = min(sfdc_now − 5 min, freezeAt if final-delta)`. `wm_hi` is fixed for the whole run so PK chunks/pages are consistent.
- Predicate: `SystemModstamp >= {wm_lo} AND SystemModstamp < {wm_hi}` with literals `YYYY-MM-DDThh:mm:ssZ` (unquoted, no fractional seconds; format `toISOString().replace(/\.\d{3}Z$/, 'Z')`). The scope predicate (§6.2) and country predicate are still ANDed (a row that aged into scope or changed country is picked up on its next modification; a row that aged *out* is left in place).
- Advance: the watermark is set to `wm_hi` **only after** every page of the unit has been extracted, transformed, loaded (or recorded as failed/pending) and the row results persisted. Overlap + upsert semantics make re-delivered rows harmless (skipped by hash when unchanged).
- `getUpdated` cross-check (only when `describe.replicateable = true`, §2.1.6): `|ids|` from `/updated/?start=wm_lo&end=wm_hi` vs rows fetched; a shortfall > 0 → `warning DELTA_COUNT_MISMATCH` and automatic re-query without PK chunking / with REST.

### 4.2 Parent changes invisible to the child

A child's `SystemModstamp` does not change when its parent is merged/re-keyed/deleted. Handled by: (1) FK resolution always via the id map; (2) on a parent delta that changes `merged_into`/`deleted_at`, fan-out: select children from `row_results`/`id_map` whose stored FK pointed at the loser (the tool stores `fk_index(object_key, sfdc_id, field, target_sfdc_id)` during transform) and re-issue PUT updates; (3) a periodic **FK-consistency pass** (`verify --fk`) comparing the child's current source parent with the target parent.

### 4.3 Order within a delta run

1. `getDeleted` per unit (start = `watermark.deleted`, end = `wm_hi`) → delete queue.
2. Extract modstamp window per unit in **load order** (§6.1) — but only rows in the window; closure fetch for FK targets not in the id map (new parents that themselves were not modified, e.g. an old address newly referenced).
3. Transform + load parents before children; children whose parent arrived in the same window are loaded after it; children whose parent is neither in the map nor in the window → closure (step 2) or `pending_fk`.
4. Self-reference patch pass (§6.1).
5. Apply deletes **last-wins**: for each deleted id compare `deletedDate` with the row's `SystemModstamp` seen in this window; the later event wins (an update after undelete keeps the row).
6. Reconcile; advance watermarks.

### 4.4 Deletes

Sources (all three used): (1) `queryAll` rows with `IsDeleted = true` inside the window; (2) `GET /sobjects/{Object}/deleted/` — **only for objects with `describe.replicateable = true`** (§2.1.6; non-replicateable objects use the key-set reconciliation instead) — 30-day window; if the last run was > 30 days ago a `verify` full reconciliation is required — finding `DELETE_WINDOW_EXCEEDED`, blocking for `delta`; (3) master-detail cascades (deleting `Call2_vod__c` deletes its `Call2_*` children, which appear in their own feeds; the master-detail classification comes from the `cascadeDelete ∧ !nillable` heuristic, §2.1.3).

Target policy per object (`deletePolicy`), defaults:

| Policy | Action | Default for |
|---|---|---|
| `delete` | `DELETE /vobjects/{obj}` by Vault id (≤ 500/call) | pure child rows: `call2_detail`, `call2_discussion`, `call2_key_message`, `call2_sample`, `order_line`, `email_activity`, `multichannel_activity_line`, `sample_inventory_item`, `clm_presentation_slide`, `user_territory`, `product_group`, `em_event_team_member` |
| `inactivate` | `PUT` of the object's **inactivation field set** (table below) by Vault id, in migration mode | master data: `account`, `address`, `child_account`, `affiliation`, `tsf`, `product_metrics`, `product`, `key_message`, `clm_presentation`, `approved_document`, `sample_lot`, `territory`, `em_speaker`, `em_venue`, `em_catalog`, `account_plan`, `user` (only option) |
| `ignore` | no target change; row listed in the run report for review | regulated transactional rows: `call2`, `sample_transaction`, `sample_inventory`, `multichannel_consent`, `em_event`, `em_attendee`, `em_event_speaker`, `medical_event`, `event_attendee`, `medical_inquiry`, `order`, `sent_email`, `multichannel_activity` |

**Inactivation field set** (`objects.<key>.inactivateBy`, defaults below; the same rule set is used by Block S `status__v` derivation, §6.0.4). The platform `status__v = inactive__v` is **always** part of the set (it exists and is required on every object, vault-api.md §11, and hides the row from pickers); the object's business flag is set *in addition* when the object has one, so that Vault CRM logic that reads the business flag (address primary selection, lot pickers, key-message availability) agrees with the platform status.

| Object keys | Fields written on inactivate | Notes |
|---|---|---|
| `account`, `child_account`, `affiliation`, `tsf`, `product_metrics`, `territory`, `em_speaker`, `em_venue`, `em_catalog`, `user_territory`, `product_group` | `status__v = inactive__v` | no business flag on the target |
| `address` | `status__v = inactive__v` **and** `inactive__v = true` `[DOC]` | `Inactive_vod__c` is also the source of `inactive__v` on a normal load |
| `product`, `key_message`, `clm_presentation`, `account_plan`, `medical_event`, `sample_lot` | `status__v = inactive__v` **and** `active__v = false` | source `Active_vod__c` |
| `approved_document` | `status__v = inactive__v` **and** `approved_document_status__v = withdrawn__v` (or `status__v` business field, whichever preflight picked) | status picklist value `[UNV]` |
| `user` | `status__v = inactive__v` (+ `isactive__v = false`) via `PUT /vobjects/user__sys` | users cannot be deleted `[SRC]` |
| `em_event` (when `deletePolicy` is overridden to `inactivate`) | `status__v = inactive__v` only | never touch `em_event_status__v`/`state__v` on inactivate |

Undelete (row reappears with `IsDeleted = false`) reverses exactly the same set (`status__v = active__v`, flag restored from the source row).

Every applied delete sets `id_map.deleted_at` (row kept) so an `UNDELETE` (row reappears with `IsDeleted = false` in a later window) re-links to the same Vault id and clears `deleted_at`.

### 4.5 Final delta at cutover

1. Customer freezes SFDC (read-only profiles, scheduled Apex/batch paused, Network Bridge/Align/DW feeds paused). The **freeze timestamp** is read from Salesforce and stored as `runs.freeze_at`; it is `wm_hi` for every unit of the wave.
2. `final-delta` runs: `getDeleted` → delta extract → closure → transform → load in FK order → self-FK patch → deletes → **reconciliation gate** (§8.8) with tolerance 0 per unit (documented exclusions: merges, `ignore` deletes, `skipped` by rule). Gate failure = wave not signed off; rows in triage are loaded during hypercare with an audit note.
3. After sign-off the wave's countries are marked `frozen` in the store: later runs skip them (watermark frozen) unless `--unfreeze`.
4. Countries not yet migrated keep receiving `delta` runs so their eventual `init` is small; `GLOBAL` objects continue delta in every wave.
5. Back-out: SFDC stays read-only and intact; rows loaded by the tool are identifiable by the legacy-id field (and optionally `migration_run__c` if the customer adds it), so a wave can be removed with cascade deletes and re-run.

---

## 5. Preflight configuration checks

Preflight produces `preflight_findings` with stable codes. **Any `blocking` finding aborts the unit (object, country)** — and the whole run when the finding is global (auth, version, permissions). `warning` proceeds with the finding attached; `info` is informational. Findings from the previous run are diffed ("new since last run").

### 5.1 Source (SFDC) checks

| Code | Check | Severity |
|---|---|---|
| `SF_API_VERSION_MISSING` | `GET /services/data/` lacks `source.apiVersion` | blocking |
| `SF_AUTH_FAILED` | token exchange failed / `invalid_grant` | blocking |
| `SF_OBJECT_MISSING` | mapped object absent from `GET /sobjects` or `describe.queryable = false` | blocking (object disabled if `objects.<key>.optional = true` → warning) |
| `SF_FIELD_MISSING` | mapped source field absent from `describe.fields[]` (FLS or not in org) | blocking for legacy id, FKs, scope date, required target fields; warning otherwise (field dropped from the materialised mapping) |
| `SF_FIELD_TYPE_MISMATCH` | `describe.type` differs from the mapping's declared source type (e.g. `Country_vod__c` picklist vs reference on `User`) | blocking unless a transform for the actual type exists (auto-switch `country(...)` mode → info) |
| `SF_FIELD_CALCULATED` | a mapped source field is `calculated: true` / `autoNumber: true` | warning (field skipped) |
| `SF_RECORD_TYPE_MISSING` | a record-type developer name referenced by the object-type crosswalk is absent from `recordTypeInfos[]` | warning (unused crosswalk entry) |
| `SF_RECORD_TYPE_UNMAPPED` | a record type present in `recordTypeInfos[]` (or observed in data) has no object-type crosswalk entry | blocking when `allow_types` on the target |
| `SF_PICKLIST_VALUE_UNKNOWN` | crosswalk source value not in `describe.picklistValues[]` (inactive values are legal on old rows) | info |
| `SF_MULTICURRENCY` / `SF_PERSON_ACCOUNTS` / `SF_TERRITORY2` | presence of `CurrencyIsoCode`, `IsPersonAccount`, `Territory2` | info (changes column set) |
| `SF_QUERY_NON_SELECTIVE` | `GET /query/?explain=` leading operation is `TableScan` on a unit expected > 200k rows | warning (PK chunking forced) |
| `SF_QUOTA_LOW` | `GET /limits` `DailyApiRequests.Remaining < floor` or `DailyBulkV2QueryJobs.Remaining < planned jobs` | blocking |
| `SF_BULK_RESULT_SIZE` | estimated result > 15 GB per job (row count × avg row) | warning (split by PK range) |
| `SF_EXPORT_POLICY` | reminder about anomalous-export policies for large extractions | info |
| `SF_NOT_REPLICATEABLE` | `describe.replicateable = false` on a mapped object → `/deleted/`,`/updated/` skipped, key-set reconciliation used (§2.1.6) | info |
| `SF_ORG_MISMATCH` | `orgId` from the token identity URL differs from `runs.source_org_id` of the id map's earlier runs | blocking |
| `SF_FIELD_MISSING` (source tagged `[UNVERIFIED-SOURCE]`) | guessed source field absent from describe | info (dropped, counted) |
| `SF_DATETIME_RANGE` | sampled datetime/date values `< 1700-01-01` or `> 4000-12-31` (Salesforce-legal, may fail Vault validation `[GEN]`) | warning; rows are loaded with the value **omitted** and `truncated(field)`-style diagnostic `out_of_range(field)` unless `objects.<key>.dateRange = 'fail'` |

### 5.2 Target (Vault) checks

| Code | Check | Severity |
|---|---|---|
| `VT_AUTH_FAILED` / `VT_WRONG_VAULT` | auth failed / `vaultId` or `vaultIds[].url` does not match `target.vaultDns` | blocking |
| `VT_API_VERSION_MISSING` | `GET /api` lacks `target.apiVersion` | blocking |
| `VT_MIGRATION_PERMISSION` | migration mode requested but the user lacks *Record Migration* (checked first via `GET /objects/users/{id}/permissions?filter=object.{probeObject}.{create,edit}` and the security-profile read-back; then, when `preflight.probeWrites = true`, via probe 13 — a 1-row create with `X-VaultAPI-MigrationMode: true` and `created_date__v` on `preflight.probeObject`, §5.3) | blocking |
| `VT_PROBE_OBJECT_MISSING` | `preflight.probeWrites = true` but `preflight.probeObject` is unset or absent from the vault (MDL snippet for `migration_probe__c` printed in the report) | blocking (for the probe step only; `--probe-writes` off → probes skipped with `info PROBE_SKIPPED`) |
| `VT_ROLLUP_RECALC_UNAVAILABLE` | `postLoad.recalculateRollups = required` (US sample overlay) and no recalculation action found (§2.5.6) | blocking |
| `VT_CORP_CURRENCY_UNAVAILABLE` | `updatecorporatecurrency` action absent | warning |
| `VT_CONSENT_CONFIG_UNMATCHED` | a `Consent_Type_vod__c`/`Consent_Line_vod__c`/`Content_Type_vod__c`/`Consent_Template_vod__c` row referenced by in-scope consent has no target match under `objects.multichannel_consent.configMaps` (§6.3.42) | blocking |
| `VT_ATTACHMENTS_DISABLED` | a `blobs.<name> = attachment` policy targets an object whose metadata has `allow_attachments = false` | blocking if the blob is `required`, else warning (policy downgraded to `skip`) |
| `VT_MIGRATION_USER_MISMATCH` | `objects/users/me` id ≠ `target.migrationUserId` | warning |
| `VT_USER_SECURITY_POLICY_MISSING` | `objects.user.mode = create` without `objects.user.securityPolicyId` | blocking |
| `VT_OBJECT_MISSING` | `GET /metadata/vobjects/{obj}` fails / `status` lacks `active__v` | blocking (warning if `optional`) |
| `VT_FIELD_MISSING` | mapped target field not in `fields[]` | blocking for legacy id, required fields, FKs, object type/state; **warning** otherwise (field dropped, counted) — this is how every `[UNVERIFIED]` field name degrades safely |
| `VT_FIELD_INACTIVE` / `VT_FIELD_READONLY` | `status` lacks `active__v` / `editable = false` (formula, system-managed name outside migration mode) | blocking for required; warning otherwise |
| `VT_TYPE_INCOMPATIBLE` | target `type` not compatible with the transform output per matrix §5.4 | blocking |
| `VT_LENGTH` | `max_length` < longest transformed value (dry-run computes from the extract; otherwise from a 2,000-row sample) | warning + truncation policy; blocking if `truncation = fail` |
| `VT_NUMBER_RANGE` | `scale`/`min_value`/`max_value` violated by sample values | warning/blocking as above |
| `VT_REQUIRED_UNMAPPED` | `required: true` field (per **object type**, `type_fields[]`) with no mapping/default and no system default (`system_managed_name`, formula, defaulted `status__v`) ; `name__v` required unless `system_managed_name`; `object_type__v` required when `allow_types` | blocking |
| `VT_PICKLIST_VALUE_MISSING` | a **target** value produced by the crosswalk (or by derivation) is not in `GET /objects/picklists/{name}` (active only) — reported with distinct offending source values and row counts from the sample/extract | blocking if the source value occurs in data; warning if it never occurs; `--allow-picklist-create` turns it into a create + info |
| `VT_PICKLIST_MULTIVALUE` | source multipicklist mapped to a single-value target (or vice versa) | blocking |
| `VT_FK_TARGET_MISMATCH` | `fields[].object.name` ≠ the mapped parent's Vault object | blocking |
| `VT_FK_LOOKUP_NOT_UNIQUE` | loading a reference via `{field}.{lookup}` but the lookup field is not `unique: true` on the target | blocking (switch to id-based resolution automatically → info) |
| `VT_OBJECT_TYPE_MISSING` | object type api name from the crosswalk not in `object_types[]` / `configuration/Objecttype.{obj}.{type}` inactive | blocking |
| `VT_LIFECYCLE_STATE_MISSING` | `available_lifecycles` non-empty and the state crosswalk names a state not in `Objectlifecycle.{lifecycle}`; or object is lifecycled and no state mapping exists for a business status | blocking (state mapping required) |
| `VT_LEGACY_ID_FIELD_MISSING` / `LEGACY_ID_FIELD_SELECTED` | §3.2 | blocking / info |
| `VT_LEGACY_ID_FORMAT` | sampled Veeva-migrated `legacy_crm_id__v` values do not match `legacyId.format` (15 vs 18 chars, prefix) | blocking (config must match) |
| `VT_USER_UNMAPPED` | count of SFDC users referenced by extracted rows with no Vault match (from a sample in preflight, full in dry-run) | warning; blocking if any referenced by `ownerid__v` on an object with `unmappedUserPolicy = fail` |
| `VT_COUNTRY_UNMATCHED` | an SFDC country has no `country__v` row | blocking |
| `VT_CURRENCY_UNMATCHED` | `CurrencyIsoCode` value with no `currency__sys` row | blocking when the object has currency fields |
| `VT_RECORD_LIMIT` | `GET /limits` record headroom < planned rows | warning |
| `VT_TRIGGER_RISK` | `noTriggers = false` on an object listed as trigger-sensitive (§2.5.4) | warning |
| `VT_CUSTOM_FIELD_MISSING` | a customer `__c` field in the mapping is absent (never auto-created; MDL snippet emitted to the report) | blocking for required, warning otherwise |

### 5.3 Mapping lints (offline, no API)

`MAP_DUP_TARGET` (two sources → one target column), `MAP_UNUSED_SOURCE` (source field mapped to nothing — info), `MAP_PICKLIST_KEY_UNKNOWN`, `MAP_FK_PARENT_NOT_IN_PLAN` (FK to an object key that is disabled for this country → warning, field omitted), `MAP_CYCLE_UNDECLARED` (dependency cycle not covered by `selfRefs`/pass-2 declarations → blocking), `MAP_SCOPE_FIELD_MISSING` (2y-scoped object without `scope.dateField` → blocking), `MAP_COUNTRY_RULE_MISSING` (non-global object without `countryOf` → blocking), `MAP_HASH_CHANGED` (materialised mapping hash differs from the last successful run for the unit → info; blocking in `final-delta` unless `--accept-mapping-change`).

Additional runtime probes (`preflight.probeWrites = true`, CLI `--probe-writes`): (13) migration-mode permission (`created_date__v` accepted), (14) `created_by__v` accepted form (numeric id vs `created_by__v.user_name__v`), (15) `local_currency__sys` accepted form, (16) `DELETE ?idParam` support, (17) roll-up recalculation action presence (§2.5.6), (18) `null`-clears-field behaviour on PUT — each recorded as `info PROBE_RESULT` in `probe_results` (§2.4) and cached per vault (re-probed when `target.apiVersion` changes or `--reprobe`).

**Probe object.** All write probes run against one designated object, `preflight.probeObject` (Vault object API name). It is never guessed: the customer either (a) creates the recommended scratch object `migration_probe__c` with the MDL the report prints (`CREATE Object migration_probe__c (label('Migration Probe'), … fields: name__v, legacy_crm_id__c String(18) unique, amount__c Currency, owner__c Object(users))` — executed by the tool only under `--allow-mdl`), or (b) names an existing low-impact custom object. The probe object must have `allow_types = false`, no lifecycle, a Currency field (probe 15) and a user reference (probe 14); otherwise the probes that need the missing feature are skipped (`info PROBE_SKIPPED`). Each probe creates ≤ 2 rows with `name__v = 'VEEVA-MIGRATION-PROBE {run_id}'` and `legacy_crm_id__c = 'PROBE:{run_id}:{n}'`, reads them back by VQL and **deletes them in the same preflight** (`DELETE /vobjects/{probeObject}` by id); a failed cleanup leaves the row and emits `warning PROBE_ROW_LEFT` with the id. Probes never touch a business object, and `--dry-run` never runs them.

### 5.4 Type compatibility matrix

| SFDC `describe.type` | Vault `type` accepted | Transform | Notes |
|---|---|---|---|
| `id` | `String` (legacy-id field) | `legacyId` | never to `id` |
| `string`, `email`, `phone`, `url`, `encryptedstring` | `String` (`max_length`), `LongText` | `text(max)` | NFC, trim; `phone` → optional E.164 per country |
| `textarea` (`extraTypeInfo = plaintextarea`) | `LongText`, `String` (if ≤ `max_length`) | `longtext` | strip control chars |
| `textarea` (`richtextarea`) | `RichText`, `LongText` | `richtext` → sanitise to bold/italic/lists/links or downgrade to plain | |
| `boolean` | `Boolean`, `Picklist` (yes/no picklists e.g. `Do_Not_Call_vod__c`) | `bool` / `picklist` | `true`/`false` only |
| `int`, `double`, `percent` | `Number` | `number(scale)` | respect `scale` |
| `currency` | `Number`, `Currency` | `number(scale)` + `currency` (sets `local_currency__sys`) | |
| `date` | `Date` | `date` | verbatim, no TZ |
| `datetime` | `DateTime` | `datetime` | `.SSSZ` UTC; `Date` target accepts `datetime→date` only when declared |
| `picklist` | `Picklist` (single) | `picklist(map)` | value name |
| `multipicklist` | `Picklist` (`multi_value`) | `multipicklist(map)` | `;` → `,` |
| `reference` | `Object` | `ref(key)` / `refLookup(key, field)` | target `object.name` must equal the mapped object |
| `reference` → RecordType | `Object` (object type) | `objectType(map)` | `object_type__v.api_name__v` |
| compound (`address`, `location`, person `Name`) | components only | — | never selected |
| calculated / autoNumber | — | `skip` | |

Anything else → `VT_TYPE_INCOMPATIBLE`.

---

## 6. Load order and object catalogue with field mappings

### 6.0 Conventions used in this section

#### 6.0.1 Table columns
`Source (type)` = SFDC API name and describe type (`[META]` unless noted; "newer" = documented after 2017, confirm via describe) · `Target` = Vault API name · `Transform` = registry function (§6.0.3) · `Req` = `K` idParam/key, `Y` required by target, `y?` probably required by Vault CRM config, `n` optional, `—` not loaded · `Ev` = evidence for the **target** name (`OBS`, `DOC`, `UNV` = `[UNVERIFIED]`) · `CC` = expected to vary per country (`Y` = picklist crosswalk / required-ness / format is country-specific and lives in the country overlay, §7; `N` = global) · `Notes`.

#### 6.0.2 Mechanical rename rule (default; overrides live in each table)
```
object:   strip "__c" → strip "_vod" → lowercase → + "__v"        Call2_vod__c → call2__v ; Account → account__v ; User → user__sys
field:    strip "__c" → strip "_vod" → lowercase → + "__v"        Call_Datetime_vod__c → call_datetime__v
          customer Foo__c → foo__c (must pre-exist in Vault)       zvod_* → drop
          Id → legacy-id field ; Name → name__v ; OwnerId → ownerid__v ; CreatedById → created_by__v ; CreatedDate → created_date__v
          LastModifiedById → modified_by__v ; LastModifiedDate → modified_date__v ; RecordTypeId → object_type__v.api_name__v
          CurrencyIsoCode → local_currency__sys ; IsDeleted → (delete routing) ; SystemModstamp → (watermark only)
picklist value: strip "_vod" → lowercase → + "__v"                Submitted_vod → submitted__v ; Opt_In_vod → opt_in__v [DOC] ; Invited_vod → invited__v [OBS]
                plain-English Veeva value → lowercase, [^a-z0-9]+ → "_", + "__v"   "Detail Only" → detail_only__v   (UNV — validate)
                customer value → same with "__c"
object type:    strip "_vod" → lowercase → + "__v"                Speaker_Program_vod → speaker_program__v ; Approved_Email_vod → approved_email__v [DOC]
status fields:  Status_vod__c → {object}_status__v  [OBS on em_event__v, em_event_speaker__v, em_speaker__v, em_catalog__v, expense_header__v, contract__v]
                (platform status__v is active__v/inactive__v on every object)
person/contact fields on account__v/address__v: *_cda__v family [OBS] — not derivable; explicit override table
timezone:       TimeZoneSidKey America/New_York → america_new_york__sys [OBS]
```
Known confirmed exceptions: `Zip_vod__c` → `postal_code__v` (em_event) / `postal_code_cda__v` (address) / `zip__v` (em_attendee) `[OBS]`; `State_vod__c` → `state_province__v` (address, em_event) vs `state__v` (user__sys) `[OBS]`; `Multichannel_Activity_vod__c.Call_vod__c` → `call__v`; `Product_Metrics_vod__c.Products_vod__c` → `products__v` `[UNV]`.

#### 6.0.3 Transform registry (names are normative; implement in `src/transform/registry.ts`)
`copy` · `text(max?)` (trim, NFC, truncation policy) · `longtext` · `richtext` · `bool` · `number(scale?)` · `date` · `datetime` · `datetimeToDate` · `picklist(mapKey)` · `multipicklist(mapKey)` · `objectType(mapKey)` (→ `object_type__v.api_name__v`) · `state(mapKey)` (→ `state__v`, migration mode) · `ref(objectKey)` (id-map → Vault id) · `refUser` (→ numeric user id via user map + fallback policy) · `refLookup(objectKey, lookupField)` (emits `{field}.{lookupField}`) · `legacyId` (18-char) · `country(mode)` with `mode ∈ {ref, iso2, picklist, name}` · `territoryRef` (name text → `territory__v` id; falls back to text when target type is `String`) · `nameTemplate(templateKey)` (§7.3) · `currency` (→ `local_currency__sys`) · `userTimezone` · `localeLookup(kind)` (`language__sys` / `locale__sys` via `{field}.name__v` lookup — the lookup key is the Vault **display name** (`"United States"`, `"English"` `[SRC VAPIL sample]`), not the SFDC code, so the transform goes through the built-in crosswalk `locales.language: { en_US: 'English', de: 'German', … }` / `locales.locale: { en_US: 'United States', de_DE: 'Germany', … }` (config-overridable, `locales.*`), and preflight validates every distinct source code against `SELECT id, name__v FROM locale__sys` / `language__sys` `[UNVERIFIED object names]`, preferring the id form when the object is queryable — `VT_LOCALE_UNMATCHED` blocking in create mode) · `statusFromFlag(sourceFlag, inactiveWhen)` (→ `status__v = inactive__v` when the source inactive indicator holds, §6.0.4; migration mode) · `dateRange` (applied implicitly by `date`/`datetime`: values outside 1700-01-01…4000-12-31 are omitted with diagnostic `out_of_range(field)`, §5.1 `SF_DATETIME_RANGE`) · `const(value)` · `compositeExternalId(template)` · `secondPass` (marker: field omitted in pass 1, PUT in pass 2) · `deferredBlob` (loaded in the blob pass §8.6) · `skip` · `custom(fnName)` (object-module local function, unit-tested).

#### 6.0.4 Block S — system/audit fields applied to **every** object (listed once)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` (id) | legacy-id field per §3.2 (`legacy_crm_id__v` preferred) | `legacyId` | K | OBS/UNV | N | idParam of the upsert |
| `Name` (string, `nameField`, **not** `autoNumber`) | `name__v` | `text(128)` | Y | OBS | N | sent verbatim; when the target has `system_managed_name = true` it is still sent (migration mode allows it) unless `objects.<key>.preserveName = false`; person accounts use `nameTemplate` |
| `Name` (**`autoNumber: true`** — `Sample_Transaction_vod__c`, `Sample_Inventory_vod__c`, `Call2_*` children, `Order_Line_vod__c`, `Multichannel_Activity_Line_vod__c`, `Email_Activity_vod__c`, `Product_Metrics_vod__c` in most orgs) | `name__v` **only if** `objects.<key>.preserveAutoNumberName = true` (default **false**) | `text(128)` / `skip` | — | OBS | N | default: skipped — Vault assigns its own `system_managed_name` sequence (or `name__v` is not required); with the flag the SFDC auto-number is carried verbatim under migration mode so that printed references (sample cards, order numbers) stay searchable. Resolves the autoNumber ambiguity: this row wins over the generic `autoNumber → skip` rule below |
| inactive indicator (`Inactive_vod__c = true` / `Active_vod__c = false` / `IsActive = false` / `Status_vod__c ∈ objects.<key>.inactiveStatuses`) | `status__v` | `statusFromFlag(...)` → `inactive__v` | n | OBS (`status__v` required, defaults to `active__v` `[SRC]`) | N | **rule**: `status__v` is *omitted* (Vault defaults `active__v`) unless the object row in the §4.4 inactivation table lists a source flag and it holds — then `status__v = inactive__v` is sent (needs MigrationMode, `[DOC-MIRROR]`) **in addition to** the renamed business flag (`inactive__v`/`active__v`). Objects covered by default: `address` (`Inactive_vod__c`), `product`/`key_message`/`clm_presentation`/`account_plan`/`medical_event`/`sample_lot` (`Active_vod__c`), `user` (`IsActive`), `territory` (`Territory2Model.State != 'Active'`), `user_territory` (`IsActive`); disable per object with `objects.<key>.statusFromFlag = false`. Transactional objects never derive `status__v` (their business status lives in `{object}_status__v`/`state__v`). Closes field-mapping.md §6 #7 |
| `CreatedDate` (datetime) | `created_date__v` | `datetime` | n | OBS | N | migration mode only |
| `CreatedById` (reference→User) | `created_by__v` | `refUser` (fallback `migrationUserId`) | n | OBS | N | migration mode only; numeric user id |
| `LastModifiedDate` (datetime) | `modified_date__v` | `datetime` | n | OBS | N | migration mode only |
| `LastModifiedById` | `modified_by__v` | `refUser` | n | OBS | N | migration mode only |
| `OwnerId` (reference→User\|Group) | `ownerid__v` **if the target object has it** (metadata) | `refUser` (queue → §3.4) | n/y? | OBS (em_event__v) / UNV elsewhere | N | omitted on objects without the field (master-detail children) |
| `RecordTypeId` → `RecordType.DeveloperName` | `object_type__v.api_name__v` when `allow_types` | `objectType(<key>.objectType)` | Y (typed objects) | OBS (syntax) / UNV (names) | Y | crosswalk per object in its table |
| `CurrencyIsoCode` (picklist, multi-currency orgs) | `local_currency__sys` | `currency` | n | OBS (name) / UNV (value form) | N | only on objects with currency fields |
| `Mobile_ID_vod__c` (string, EXTID) | `mobile_id__v` if present | `copy` | n | OBS (em_event, user) / UNV | N | secondary match key |
| `Last_Device_vod__c` (picklist) | `last_device__v` if present | `const('data_load__v')` | n | UNV | N | source value `Data_Load_vod` exists |
| `Mobile_Created_Datetime_vod__c`, `Mobile_Last_Modified_Datetime_vod__c` | `mobile_created_datetime__v`, `mobile_last_modified_datetime__v` | `datetime` | n | OBS (em_event) / UNV | N | optional |
| `Lock_vod__c`, `Override_Lock_vod__c` (boolean) | `lock__v`, `override_lock__v` | `bool` | n | OBS (em_event) / UNV | N | |
| `Unlock_vod__c` (boolean) | `unlock__v` `[OBS on call2__v, sample_inventory__v — vault-crm-model.md §4.9/§4.11/§12]` | `skip` by default; `bool` when `objects.<key>.loadUnlockFlag = true` | n | OBS | N | **deliberate deviation from vault-crm-model.md §12** (which maps it 1:1): in Veeva CRM `Unlock_vod__c` is a transient request flag consumed by a trigger, and re-sending `true` under `noTriggers = false` would re-open submitted records; the field exists on the target, so the flag is offered for customers who want the raw value |
| `External_ID_vod__c` / `External_Id_vod__c` (string, EXTID) | `external_id__v` when present and not used as legacy-id field | `copy` (or `compositeExternalId`) | n | OBS | N | never overwrite an integration-owned value (§3.2 step 4) |
| `IsDeleted`, `SystemModstamp`, `LastActivityDate`, `LastViewedDate`, `LastReferencedDate`, `MasterRecordId` | — | routing / watermark / merge detection | — | — | N | never loaded |
| formula (`calculated`), roll-up, other `autoNumber` fields (non-`Name`), `zvod_*`, `*_Settings`, `Message_vod__c` | — | `skip` | — | — | N | Vault recomputes; roll-ups need post-load recalculation (§2.5.6); `Name` autoNumber and `Unlock_vod__c` follow their own rows above |
| customer `__c` fields (org-specific) | same name lower-cased `__c` | per type (§5.4) | n | must pre-exist | Y | discovered via describe; enabled per country through `objects.<key>.customFields: { mode: 'none' \| 'listed' \| 'allMatching', include: [...], exclude: [...] }` (default `none`; `allMatching` maps every source `__c` whose lower-cased name exists on the target) — §7.2.1 |

#### 6.0.5 Country predicate templates (SOQL) used by `countryOf`
- `field:Country_vod__r.Alpha_2_Code_vod__c` → `Country_vod__r.Alpha_2_Code_vod__c = '{ISO}'`
- `account` → `Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c = '{ISO}'` (or `Account_vod__c IN (in-scope account ids)` when the org's country field is customer-specific)
- `user` (= `user:User_vod__c`) → `User_vod__r.Country_vod__c = '{ISO}'` (type of `User.Country_vod__c` resolved at preflight; when it is a lookup: `User_vod__r.Country_vod__r.Alpha_2_Code_vod__c`)
- `user:<lookupField>` → same, through an explicit user lookup: `user:OwnerId` (→ `Owner.Country_vod__c`), `user:Inventory_For_vod__c`, `user:Organizer_vod__c`, `user:Team_Member_vod__c`
- `account:<lookupField>` → as `account` through a named account lookup (`account:From_Account_vod__c`, `account:Parent_Account_vod__c`)
- `parent:<key>` → `ParentField IN (ids of parent rows attributed to {ISO})` (children of calls/events/orders/emails/activities inherit the parent's country; implemented as `Parent__r.<parent countryOf path>` in SOQL when expressible (≤ 5 levels), else by id-set)
- **Fallback chain** `[ruleA, ruleB, …]` (YAML list) → the first rule whose path is non-null decides the row's country; in SOQL this is `(pathA = '{ISO}') OR (pathA = null AND pathB = '{ISO}')` (nested for longer chains). Every `countryOf` written in prose as "account (fallback user)" in §6.2 is exactly `['account', 'user:OwnerId']`, and "user (fallback account)" is `['user:OwnerId', 'account']`; a row where no rule yields a country is attributed to `GLOBAL` **only** for `global` objects — otherwise it is `skipped(country_unresolved)` and counted (`COUNTRY_UNRESOLVED` warning).
- `global` → no predicate
- The grammar is closed: `field:<path>` | `account` | `account:<field>` | `user` | `user:<field>` | `parent:<key>` | `global` | list of the preceding. `MAP_COUNTRY_RULE_INVALID` (blocking) for anything else.

### 6.1 Load order (topological by FK; parents before children; self-references patched in pass 2)

Reference/config data that must **pre-exist** in Vault and is only matched (assumption A2; the tool never loads it — this deliberately overrides field-mapping.md §4.12's "load config objects first", because consent headers/lines/types and EM event configurations are *configuration* owned by the customer's config-migration workstream, not data): `country__v`, `currency__sys`, `locale__sys`/`language__sys`, object types, picklists, lifecycles, `consent_type__v`, `consent_line__v`, `content_type__v`, `consent_template__v` (`consent_header__v`), `em_event_configuration__v`, `metric_configuration__v`, security profiles/policies. The SFDC counterparts (`Consent_Type_vod__c`, `Consent_Line_vod__c`, `Content_Type_vod__c`, `Consent_Template_vod__c`, `EM_Event_Configuration_vod__c`, `Metric_Configuration_vod__c`) are **extracted read-only** (`Id, Name, RecordTypeId, External_ID_vod__c` `[UNVERIFIED-SOURCE field]`, plus any `objects.<config>.keyField`) to build the crosswalks of §6.3.42/§6.3.22; a referenced row without a target match is a blocking `VT_CONSENT_CONFIG_UNMATCHED` / `VT_EM_CONFIG_UNMATCHED` finding.

| Step | Object keys (may run in parallel within a step when independent) | Pass-2 patches after the step |
|---|---|---|
| 0 | `country` (match-only), `user` (match; optional create) | — |
| 1 | `territory` (roots → children by `ParentTerritory2Id`) | `territory.parent_territory__v` |
| 2 | `user_territory` | — |
| 3 | `product` (by depth: Detail Group → Detail → Sample/Order/BRC/Kit Item) → `product_group` | `product.parent_product__v` (when depth ordering is not possible) |
| 4 | `account` (all; `primary_parent__v`, `business_professional_person__v` omitted) | `account.primary_parent__v`, `account.business_professional_person__v` |
| 5 | `address` | `address.controlling_address__v` |
| 6 | `child_account`, `affiliation` | `affiliation.child_affiliation__v` (mirror rows) |
| 7 | `account_territory` (optional) → `tsf` → `product_metrics` | — |
| 8 | `key_message` → `clm_presentation` → `clm_presentation_slide` ; `approved_document` | `key_message.shared_resource__v`, `clm_presentation_slide.sub_presentation__v` |
| 9 | `sample_lot` | — |
| 10 | `em_venue`, `em_catalog`, `em_speaker` | — |
| 11 | `em_event` (parents first) | `em_event.parent_event__v` |
| 12 | `em_attendee`, `em_event_speaker`, `em_event_team_member` | — |
| 12b | `expense_header` (needs `em_event`, `em_attendee`, `em_event_speaker`, `em_venue`, `account`, `user`) → `expense_line` | — |
| 13 | `medical_event` → `event_attendee` | — |
| 14 | `account_plan` | — |
| 15 | `medical_inquiry` (with `call2__v` omitted) | `medical_inquiry.call2__v` (after step 16) |
| 16 | `call2` parents (`Parent_Call_vod__c = null`) → `call2` attendee rows | `call2.parent_call__v` (only when parents/children could not be ordered), `call2.error_reference_call__v`, `call2.medical_inquiry__v` (if cyclic) |
| 17 | `call2_detail`, `call2_discussion`, `call2_key_message`, `call2_sample` | — |
| 18 | `sample_transaction` → `sample_inventory` → `sample_inventory_item` | `sample_transaction.ref_transaction_id__v` |
| 19 | `order` → `order_line` | `order.parent_order__v` |
| 20 | `sent_email` → `email_activity` | `sent_email.parent_email__v` |
| 21 | `multichannel_consent` (client-side external sort by `(Capture_Datetime_vod__c, Id)`, §2.2 step 9, so latest-wins semantics hold; `vaultConcurrency = 1`) | — |
| 22 | `multichannel_activity` → `multichannel_activity_line` | `multichannel_activity.multichannel_activity__v` |
| 23 | blob pass (§8.6): signatures, email bodies, photos, thumbnails | — |
| 24 | post-load: roll-up recalculation (`postLoad.recalculateRollups`, §2.5.6), corporate-currency recalculation (`postLoad.updateCorporateCurrency`), sample roll-up verification (§6.3.35), FK-consistency pass, reconciliation gate | — |

Cycle summary handled by pass 2: account↔account, address↔address, product↔product, territory↔territory, affiliation↔affiliation, key_message↔key_message, clm_presentation_slide→clm_presentation (sub), call2↔call2, sample_transaction↔sample_transaction, sent_email↔sent_email, order↔order, em_event↔em_event, multichannel_activity↔multichannel_activity, medical_inquiry↔call2.

The DAG is **derived at runtime** from SFDC `describe` (`referenceTo`) ∩ mapping and Vault metadata (`relationship_type = parent`), then validated against this table (`MAP_CYCLE_UNDECLARED`).

### 6.2 Object catalogue (summary)

| Key | SFDC object | Vault object (Ev) | Scope date field | Scope | `countryOf` | Depends on | Delete policy | NoTriggers |
|---|---|---|---|---|---|---|---|---|
| `country` | `Country_vod__c` | `country__v` (DOC/API) | — | match-only | global | — | — | — |
| `user` | `User` | `user__sys` (OBS) | — | full (match) | `field:Country_vod__c` (type resolved at preflight) | country | inactivate | — |
| `territory` | `Territory2` | `territory__v` (OBS) | — | full | global | — | inactivate | false |
| `user_territory` | `UserTerritory2Association` | `user_territory__v` (OBS) | — | full | global | user, territory | delete | false |
| `product` | `Product_vod__c` | `product__v` (OBS/DOC) | — | full | global | — | inactivate | false |
| `product_group` | `Product_Group_vod__c` | `product_group__v` (UNV) | — | full | global | product | delete | false |
| `account` | `Account` | `account__v` (OBS) | — | full | `field:Country_vod__r.Alpha_2_Code_vod__c` | country, user | inactivate | false |
| `address` | `Address_vod__c` | `address__v` (OBS) | — | full | account | account | inactivate | false |
| `child_account` | `Child_Account_vod__c` | `child_account__v` (DOC) | — | full | parent:account (`Parent_Account_vod__c`) | account | inactivate | false |
| `affiliation` | `Affiliation_vod__c` | `affiliation__v` (DOC) | — | full | parent:account (`From_Account_vod__c`) | account | inactivate | false |
| `account_territory` | `ObjectTerritory2Association` | `account_territory__v` (DOC) | — | full (optional, default disabled — Align) | account | account, territory | delete | false |
| `tsf` | `TSF_vod__c` | `tsf__v` (DOC) | — | full | account | account, territory, address | inactivate | false |
| `product_metrics` | `Product_Metrics_vod__c` | `product_metrics__v` (DOC) | — | full | account | account, product, child_account | inactivate | false |
| `key_message` | `Key_Message_vod__c` | `key_message__v` (DOC) | — | full (match-only if integration-owned) | global | product | inactivate | false |
| `clm_presentation` | `Clm_Presentation_vod__c` | `clm_presentation__v` (DOC) | — | full | global | product | inactivate | false |
| `clm_presentation_slide` | `Clm_Presentation_Slide_vod__c` | `clm_presentation_slide__v` (DOC) | — | full | global | clm_presentation, key_message | delete | false |
| `approved_document` | `Approved_Document_vod__c` | `approved_document__v` (DOC) | — | full | global | product, key_message | inactivate | false |
| `sample_lot` | `Sample_Lot_vod__c` | `sample_lot__v` (DOC) | — | full | `user:OwnerId` | product, user | inactivate | true |
| `em_venue` | `EM_Venue_vod__c` | `em_venue__v` (OBS) | — | full | global | — | inactivate | false |
| `em_catalog` | `EM_Catalog_vod__c` | `em_catalog__v` (OBS) | — | full | global | — | inactivate | false |
| `em_speaker` | `EM_Speaker_vod__c` | `em_speaker__v` (OBS) | — | full | account | account | inactivate | false |
| `em_event` | `EM_Event_vod__c` | `em_event__v` (OBS) | `Start_Time_vod__c` (datetime) ∨ open (`End_Time_vod__c >= today` or status ∉ closed/cancelled) | 2y | `field:Country_vod__r.Alpha_2_Code_vod__c` | country, user, em_venue, em_catalog, product, account | ignore | true |
| `em_attendee` | `EM_Attendee_vod__c` | `em_attendee__v` (OBS) | via parent `Event_vod__r.Start_Time_vod__c` | 2y | parent:em_event | em_event, account, user | ignore | true |
| `em_event_speaker` | `EM_Event_Speaker_vod__c` | `em_event_speaker__v` (OBS) | via parent | 2y | parent:em_event | em_event, em_speaker, account | ignore | true |
| `em_event_team_member` | `EM_Event_Team_Member_vod__c` | `em_event_team_member__v` (OBS) | via parent | 2y | parent:em_event | em_event, user | delete | true |
| `expense_header` | `Expense_Header_vod__c` `[UNVERIFIED-SOURCE object — inverse rename of the observed target; confirmed by describeGlobal]` | `expense_header__v` (**OBS** — full field list) | via parent `Event_vod__r.Start_Time_vod__c` ∨ `Payment_Date_vod__c` | 2y (`tovRetentionMonths` widens) | parent:em_event | em_event, em_attendee, em_event_speaker, em_venue, account, user | ignore | true |
| `expense_line` | `Expense_Line_vod__c` `[UNVERIFIED-SOURCE object]` | `expense_line__v` (**OBS**) | via parent `Expense_Header_vod__r…` | 2y (`tovRetentionMonths`) | parent:expense_header | expense_header, em_event | delete | true |
| `medical_event` | `Medical_Event_vod__c` | `medical_event__v` (DOC) | `Start_Date_vod__c` (date) | 2y + closure from calls | `['account', 'user:OwnerId']` | account, address, em_event | ignore | true |
| `event_attendee` | `Event_Attendee_vod__c` | `event_attendee__v` (OBS) | via parent `Medical_Event_vod__r.Start_Date_vod__c` | 2y | parent:medical_event | medical_event, account, user, em_attendee, em_event_speaker | ignore | true |
| `account_plan` | `Account_Plan_vod__c` | `account_plan__v` (DOC) | — | full (small) | account | account, user | inactivate | false |
| `medical_inquiry` | `Medical_Inquiry_vod__c` | `medical_inquiry__v` (DOC) | `CreatedDate` ∨ open (`Status_vod__c <> 'Closed'`, `Fulfillment_Status_vod__c <> 'Completed_vod'`) | 2y | account | account, user, product, call2 (cyclic, pass 2) | ignore | true |
| `call2` | `Call2_vod__c` | `call2__v` (DOC) | `Call_Date_vod__c` (date) ∨ `Status_vod__c = 'Planned_vod'` | 2y | `['account', 'user:User_vod__c', 'user:OwnerId']` | account, user, address, child_account, product, em_event, medical_event, medical_inquiry, account_plan, territory | ignore | true (parents then attendee rows, `load.partitionBy: Parent_Call_vod__c`) |
| `call2_detail` | `Call2_Detail_vod__c` | `call2_detail__v` (DOC) | via parent `Call2_vod__r.Call_Date_vod__c` | 2y | parent:call2 | call2, product | delete | true |
| `call2_discussion` | `Call2_Discussion_vod__c` | `call2_discussion__v` (DOC) | via parent | 2y | parent:call2 | call2, product, account, user, medical_event | delete | true |
| `call2_key_message` | `Call2_Key_Message_vod__c` | `call2_key_message__v` (DOC) | via parent | 2y | parent:call2 | call2, key_message, clm_presentation, product, account, user | delete | true |
| `call2_sample` | `Call2_Sample_vod__c` | `call2_sample__v` (UNV) | via parent | 2y (US: `sampleRetentionMonths`) | parent:call2 | call2, product, account | delete | true |
| `sample_transaction` | `Sample_Transaction_vod__c` | `sample_transaction__v` (DOC) | `COALESCE(Call_Date_vod__c, Transferred_Date_vod__c, Adjusted_Date_vod__c, Submitted_Date_vod__c, DAY_ONLY(CreatedDate))` — implemented as an OR of per-field predicates | 2y (US: `sampleRetentionMonths`) | `['user:OwnerId', 'account']` | sample_lot, account, user, call2 | ignore | per `objects.sample_transaction.load.sampleStrategy` (§6.3.35; default `noTriggersRecalc`) |
| `sample_inventory` | `Sample_Inventory_vod__c` | `sample_inventory__v` (DOC) | `Inventory_Date_Time_vod__c` (datetime) | 2y (US: retention) | `['user:Inventory_For_vod__c', 'user:OwnerId']` | user | ignore | true |
| `sample_inventory_item` | `Sample_Inventory_Item_vod__c` | `sample_inventory_item__v` (UNV) | via parent | 2y | parent:sample_inventory | sample_inventory, sample_lot | delete | true |
| `order` | `Order_vod__c` | `order__v` (DOC) | `Order_Date_vod__c` (date) ∨ status not submitted/voided | 2y | account | account, call2, address, user | ignore | true |
| `order_line` | `Order_Line_vod__c` | `order_line__v` (DOC) | via parent | 2y | parent:order | order, product | delete | true |
| `sent_email` | `Sent_Email_vod__c` | `sent_email__v` (DOC) | `Email_Sent_Date_vod__c` (datetime) ∨ `Status_vod__c IN ('Scheduled_vod','Saved_vod','Pending_vod')` ∨ (`Email_Sent_Date_vod__c = null AND CreatedDate >= cutoff`) | 2y | `['account', 'user:User_vod__c', 'user:OwnerId']` | account, user, approved_document, call2, product, key_message, em_event, em_attendee, em_event_speaker, em_event_team_member, event_attendee, medical_event, medical_inquiry | ignore | true |
| `email_activity` | `Email_Activity_vod__c` | `email_activity__v` (UNV) | via parent `Sent_Email_vod__r.Email_Sent_Date_vod__c` | 2y | parent:sent_email | sent_email | delete | true |
| `multichannel_consent` | `Multichannel_Consent_vod__c` | `multichannel_consent__v` (DOC) | — (**never scoped**) | full | account | account, product, sent_email | ignore | true |
| `multichannel_activity` | `Multichannel_Activity_vod__c` | `multichannel_activity__v` (UNV) | `Start_DateTime_vod__c` (datetime) | 2y | `['account', 'user:Organizer_vod__c', 'user:OwnerId']` | account, call2, sent_email, product, medical_event, event_attendee, user | ignore | true |
| `multichannel_activity_line` | `Multichannel_Activity_Line_vod__c` | `multichannel_activity_line__v` (UNV) | via parent | 2y | parent:multichannel_activity | multichannel_activity, key_message, clm_presentation | delete | true |

#### 6.2.1 Objects deliberately out of v1 — disposition table

Every SFDC object named in the research files but not mapped above is listed here with its disposition, so that no object is silently dropped. "FK handling" says what the tool does with references *into* the object from mapped objects: `omit+count` = the field is left unset and a `<CODE>` count is reported. All can be added as modules later using Block S + the rename rule; those marked *target observed* have the best evidence.

| SFDC object | Vault target (evidence) | Why out of v1 | FK handling from mapped objects |
|---|---|---|---|
| `Contact` | none confirmed (§3.4) | no Vault CRM contact object | `CONTACT_REF_DROPPED` / person-account mapping |
| `EM_Vendor_vod__c` | `em_vendor__v` `[UNV]`; referenced by `em_event__v.vendor__v` **[OBS]** | small catalog, needs its own field research | `em_event.vendor__v` **omit+count `EM_VENDOR_REF_DROPPED`**; module `em_vendor` is the first candidate for v1.1 (enable with `objects.em_vendor.enabled = true` once its table exists) |
| `EM_Event_Budget_vod__c`, `EM_Budget_vod__c`, `EM_Expense_Estimate_vod__c`, `EM_Event_Material_vod__c` | `em_event_budget__v`, `em_budget__v`, `em_expense_estimate__v`, `em_event_material__v` **[OBS objects, fields partial]** | budgets are planning data, not transfer-of-value evidence; ToV evidence is carried by `expense_header`/`expense_line`, which **are** in v1 | `expense_line.event_budget__v` omit+count `EM_BUDGET_REF_DROPPED` |
| `EM_Event_Session_vod__c`, `EM_Event_Session_Attendee_vod__c`, `EM_Event_History_vod__c` | `[UNV]` | sessions rare; history is an audit shadow (Vault has its own audit trail) | none |
| `EM_Speaker_Qualification_vod__c` | `em_speaker_qualification__v` **[OBS]** | config-like | none |
| `Contract_vod__c` | `contract__v` **[OBS status field]** | contract lifecycle needs its own analysis | `em_event_speaker.contract__v`, `order.contract__v` omit+count `CONTRACT_REF_DROPPED` |
| `Sample_Receipt_vod__c`, `Sample_Order_Transaction_vod__c` | `sample_receipt__v`, `sample_order_transaction__v` `[UNV]` | PDMA accountability objects — **not silently dropped**: when `describeGlobal` shows either with rows in the US unit, preflight emits `warning PDMA_OBJECT_UNMAPPED` with the row count so the programme decides (module or archive) before sign-off | none (no mapped object references them) |
| `Sample_Limit_vod__c` | `sample_limit__v` `[UNV]` | rule data, rebuilt in Vault | none |
| `Account_External_ID_Map_vod__c` | `account_external_id_map__v` `[UNV]` | integration crosswalk (Network/engage ids); Vault keeps its own | `multichannel_activity.account_external_id_map__v` loaded as **text** copy of the SFDC id (informational), never as a reference |
| `Account_Territory_Loader_vod__c` | none (Align loader staging) | transient Align input | none |
| `Account_Team_Member_vod__c` (account-plan team) | `account_team_member__v` **[DOC, vault-crm-model.md §4.17]** | child of account plans; account-plan children (`Account_Tactic_vod__c`, `Plan_Tactic_vod__c`, `Call_Objective_vod__c`) are all v1.1 together | none |
| `Call_Cycle_Entry_vod__c`, `Cycle_Plan*`, `MC_Cycle*` | `[UNV]` | planning data, superseded by Vault CRM cycle plans | none |
| `Channel_Metrics_vod__c`, `Metric_Configuration_vod__c` | `metric_configuration__v` **[DOC]** (config) | config / computed | none |
| `Call2_Expense_vod__c`, `Call_Clickstream_vod__c` | `[UNV]` | call expense detail rare (header amounts stay on `call2`); clickstream is analytics volume | none |
| `Suggestion_vod__c`, `Remote_Meeting_vod__c`, `Survey*`, `Engage_*`, `Data_Change_Request*`, `Account_List*`, `Rep_Roster_vod__c`, `ChildAccount_TSF_vod__c`, `Account_Partner_vod__c` | `suggestion__v` **[DOC]**, others `[UNV]` | transient / integration-owned / rare | `call2.suggestion__v`, `call2.remote_meeting__v`, `sent_email.suggestion__v`, `order.*_partner` omit+count `OUT_OF_SCOPE_REF_DROPPED` |
| `Account_Merge_History_vod__c` | — | read-only **input** to §3.4 merge detection, not loaded | — |
| `Message_vod__c`, `*_Settings_vod__c`, `Veeva_Settings_vod__c` | — | configuration | — |

### 6.3 Per-object mapping tables

Block S (§6.0.4) applies to every object and is not repeated. `objectType` crosswalks list `RecordType.DeveloperName → object type api name`; all object-type names are `UNV` unless tagged.

#### 6.3.1 `country` — `Country_vod__c` → `country__v` (match-only)
Purpose: build the country crosswalk. Not loaded. `[DOC/API: country__v is a Vault standard object]`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` | (crosswalk key) | — | — | — | N | `Account.Country_vod__c`, `EM_Event_vod__c.Country_vod__c`, possibly `User.Country_vod__c` point here |
| `Alpha_2_Code_vod__c` (string) `[SEC name]` | `country__v` key field — candidates in order: `alpha_2_code__v` `[UNV, mechanical rename — vault-crm-model.md §6]`, `country_code__v`, `abbreviation__v`, `external_id__v` `[OBS field exists on country__v]` | match | — | UNV | N | preflight tries the candidates in that order and otherwise scans `country__v` fields for a unique 2-char `String`; config `objects.country.targetKeyField` overrides; the chosen field is logged as `LEGACY_ID_FIELD_SELECTED`-style `info COUNTRY_KEY_FIELD_SELECTED` |
| `Name` | `country__v.name__v` | match (case-insensitive fallback) | — | OBS (`country__vr.name__v`) | N | |
| `Country_Code_vod__c` (string) | — | — | — | — | N | informational |

#### 6.3.2 `user` — `User` → `user__sys` (match by default; `mode: create` optional)
`[OBS]` full field list observed on a live vault. Vault CRM requires `country__v` on users for record detail pages `[DOC]`. Users cannot be deleted (inactivate via `status__v`). Required on `user__sys` create `[DOC-MIRROR]`: `email__sys, first_name__sys, last_name__sys, username__sys, language__sys, locale__sys, timezone__sys, security_profile__sys`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` | `legacy_crm_id__v` | `legacyId` | K (match) | OBS | N | match key; also `user_id18__c`-style customer fields seen in the wild |
| `Username` (string) | `salesforce_username__sys`; `username__sys` (create mode only) | `copy` | Y | OBS | N | `username__sys` must be domain-unique; may be re-domained per `objects.user.usernameTemplate` |
| `FederationIdentifier` | `federated_id__sys` | `copy` | n | OBS | N | SSO; match key |
| `Email` | `email__sys` | `text` | Y | OBS | N | fallback match key (unique hits only) |
| `FirstName`, `LastName` | `first_name__sys`, `last_name__sys` | `text` | Y | OBS | N | |
| `Alias`, `Title`, `CompanyName`, `Department`, `Division`, `EmployeeNumber` | `alias__sys`, `title__sys`, `company__sys`, `department__v`, `division__v`, `employee_number__v` | `text` | n | OBS | N | |
| `IsActive` (boolean) | `status__v` (`active__v`/`inactive__v`) + `isactive__v` | `custom(userStatus)` | Y | OBS | N | inactive creates need migration mode |
| `ProfileId` → `Profile.Name` | `security_profile__sys` (+ `profile_name__v` text, `application_profile__v`, `layout_profile__sys`) | `picklist(user.securityProfile)` | Y (create) | OBS | Y | crosswalk SFDC profile name → Vault security/application/layout profile api names; per-country profiles common |
| `UserRoleId` | `userroleid__v` | `copy` | n | OBS | N | semantics unverified |
| `ManagerId` | `manager__sys` | `refUser` | n | OBS | N | pass 2 (self-ref) |
| `LanguageLocaleKey` (`en_US`) | `language__sys` (+ `language_code__v`) | `localeLookup(language)` (`language__sys.name__v` lookup or id) | Y (create) | OBS | N | |
| `LocaleSidKey` | `locale__sys` (+ `locale_code__v`) | `localeLookup(locale)` | Y (create) | OBS | N | |
| `TimeZoneSidKey` (`America/New_York`) | `timezone__sys` | `userTimezone` → `america_new_york__sys` | Y (create) | OBS | N | validate against picklist |
| `Country_vod__c` (picklist **or** lookup — resolved at preflight) / `Country` | `country__v` (ISO-2 text), `country_code__v`, `vcountry__v` (reference → `country__v`) | `country(iso2)` / `country(ref)` | y? | OBS (names) / UNV (types) | N | write all three that exist; layouts differ per customer |
| `Street`, `City`, `State`, `PostalCode` | `street__v`, `city__v`, `state__v`, `postalcode__v` | `text` | n | OBS | Y | |
| `Phone`, `MobilePhone`, `Fax` | `office_phone__sys`, `mobile_phone__sys`, `fax__sys` | `text` | n | OBS | N | |
| `UserType` | `user_type__v` | `picklist(user.userType)` | n | OBS | N | semantics unverified |
| `DelegatedApproverId`, `CommunityNickname`, `SmallPhotoUrl` | `delegatedapproverid__v`, `communitynickname__v`, `smallphotourl__v` | `copy` | n | OBS | N | |
| `External_ID_vod__c`, `Master_Align_Id_vod__c` (Veeva) | `user_identifier__v`, `master_align_id__v` | `copy` | n | OBS | N | |
| Veeva user flags (org-specific; confirm via describe): `Approved_Email_Admin_vod__c`, `MCCP_Admin_vod__c`, `Network_Admin_vod__c`, `Consent_Admin_vod__c`, `Content_Admin_vod__c`, `Analytics_Admin_vod__c`, `Engage_Group_vod__c`, `Primary_Territory_vod__c`, `Share_Team_vod__c`, `Product_Expertise_vod__c`, `Inventory_Order_Allocation_Group_vod__c`, `Network_Additional_Countries_vod__c` | `approved_email_admin__v`, `mccp_admin__v`, `network_admin__v`, `consent_admin__v`, `content_admin__v`, `analytics_admin__v`, `engage_group__v`, `primary_territory__v`, `share_team__v`, `product_expertise__v`, `inventory_order_allocation_group__v`, `network_additional_countries__v` | `bool`/`text` | n | OBS | N | update-only fields (create mode) |
| `Territory_vod__c` (text) / `UserTerritory2Association` | — (→ `user_territory` object) | — | — | — | N | |
| Skip: `LastLoginDate`, `EmailEncodingKey`, device sync stamps, `PhotoUrl` | — | `skip` | — | — | N | |
| CRM licence flags | `license_vaultcrmcore__sys`, `license_vaultcrmengage__sys`, … | not mapped (Vault admin) | — | OBS | N | reported only |

Users API mapping (only `objects.user.mode = 'create'`): `Username → user_name__v`, `FirstName → user_first_name__v`, `LastName → user_last_name__v`, `Email → user_email__v`, `TimeZoneSidKey → user_timezone__v`, `LocaleSidKey → user_locale__v`, `LanguageLocaleKey → user_language__v`, profile crosswalk → `security_profile__v`, **`security_policy_id__v ← objects.user.securityPolicyId`** (present in the Postman Create Single User body `[SRC]`; required — `VT_USER_SECURITY_POLICY_MISSING`), `license_type__v ← objects.user.licenseType` (default `full__v`), `FederationIdentifier → federated_id__v`, `send_welcome_email__v = false`, `active__v ← IsActive`, `domain_active__v ← IsActive`, **`vault_membership = "{target.vaultId}:{active__v}:{security_profile}:{license_type}"`** `[SRC format]` (or a separate `PUT /objects/users/{id}/vault_membership/{vaultId}` after create when the bulk endpoint rejects the composite field — probe at first create). Every `user__sys`-side Veeva field (`country__v`, admin flags, `legacy_crm_id__v`) is then written by a second `PUT /vobjects/user__sys` by id.

#### 6.3.3 `territory` — `Territory2` → `territory__v` (`createPolicy` default `match-only`; Align usually owns territories)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` | legacy-id field | `legacyId` | K | UNV | N | |
| `Name` | `name__v` | `text(128)` | Y | OBS | N | must match the text stamped in `Territory_vod__c` fields (`territoryRef` resolves by this) |
| `DeveloperName` | `external_id__v` | `copy` | n | UNV | N | |
| `ParentTerritory2Id` | `parent_territory__v` | `ref(territory)` `secondPass` | n | OBS | N | roots first |
| `Description` | `description__v` | `text` | n | UNV | N | |
| `Territory2ModelId`, `Territory2TypeId` | — | `skip` (only the active model is extracted: `Territory2Model.State = 'Active'`) | — | — | N | |
| Country — `objects.territory.countryOf`, one of: `field:<Territory2 custom field>` (e.g. `field:Country__c`), `prefixMap` (`objects.territory.countryPrefixMap: { 'DE-': DE, 'US_': US, … }` matched against `DeveloperName` then `Name`), `fromUsers` (majority country of the territory's active `UserTerritory2Association` users, ties → `warning TERRITORY_COUNTRY_AMBIGUOUS`), or `const:<ISO>` | `country__v` | `country(ref)` | y? (`[DOC] "Country is required when selecting territories"`) | UNV | Y | default `fromUsers`; unresolved → `warning TERRITORY_COUNTRY_UNRESOLVED`, row still loaded when the target field is not required, else `pending_fk`-style hold |
| **Legacy Territory Management orgs** (`describeGlobal` lacks `Territory2`): `Territory.Id` → legacy-id field; `Territory.Name` → `name__v`; `Territory.ParentTerritoryId` → `parent_territory__v` (`ref(territory)` `secondPass`); `Territory.Description` → `description__v`; `Territory.DeveloperName`? (absent on legacy — `external_id__v` = `Name` instead); `UserTerritory.Id` → `user_territory` legacy id, `UserTerritory.UserId` → `user__v`, `UserTerritory.TerritoryId` → `territory__v`, `UserTerritory.IsActive` → `status__v`; account assignments come from `AccountShare WHERE RowCause = 'Territory'` `[DOC]` (`account_territory`, optional) | same targets | as Territory2 rows | — | UNV | N | selected automatically at preflight (`info SF_TERRITORY2` absent → legacy module variant); no `Territory2Model` filter applies |

#### 6.3.4 `user_territory` — `UserTerritory2Association` → `user_territory__v` `[OBS]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` | legacy-id field | `legacyId` | K | UNV | N | |
| `UserId` | `user__v` | `refUser` | Y | OBS | N | |
| `Territory2Id` | `territory__v` | `ref(territory)` | Y | OBS | N | |
| — | `name__v` | `custom(userTerritoryName)` = `{username}:{territory name}` | Y | OBS | N | |
| `Id` / composite | `external_id__v` | `compositeExternalId('{userVaultId}__{territoryVaultId}')` | n | OBS | N | |
| `RoleInTerritory2`, `IsActive` | `role__v`?, `status__v` | `picklist` / `custom` | n | UNV | N | drop when absent |

#### 6.3.5 `product` — `Product_vod__c` → `product__v` `[DOC/OBS]`
Load by depth of `Parent_Product_vod__c`. `product_type__v` value names are `UNV` (Veeva CRM stored plain English: `Detail`, `Sample`, `Detail Group`, `Detail Topic`, `Alternative Sample`, `High Value Promotional`, `Promotional & Educational Item`, `Order`, `BRC`, `Kit Item`, `Market`, `Submarket`, `Product Group`, `Sample Product Group`, `Inventory Monitoring`, `Vouchers`, `Medical Letters`, `Literature`, `Reprint`, `Brand`, `Therapeutic Area`) → expected `detail__v`, `sample__v`, `detail_group__v`, … — resolved from `GET /objects/picklists/{product_type picklist}` by label match at preflight.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` | `name__v` | `text(128)` | Y | OBS | N | natural key with type |
| `Product_Type_vod__c` (picklist) | `product_type__v` | `picklist(product.productType)` | y? | DOC (field) / UNV (values) | N | |
| `Parent_Product_vod__c` (ref→Product) | `parent_product__v` | `ref(product)` (depth-ordered; `secondPass` fallback) | n | DOC | N | |
| `External_ID_vod__c` (string, EXTID, **not unique** in META) | `external_id__v` | `copy` | n | OBS | N | match key when populated; not the idParam unless unique in target |
| `VExternal_Id_vod__c` (EXTID, unique) | `vexternal_id__v` | `copy` | n | UNV | N | PromoMats-synced products already exist — match |
| `Master_Align_Id_vod__c`, `Product_Identifier_vod__c` | `master_align_id__v`, `product_identifier__v` | `copy` | n | UNV | N | |
| `Manufacturer_vod__c` (picklist), `Therapeutic_Area_vod__c` (picklist), `Therapeutic_Class_vod__c` (dependent) | `manufacturer__v`, `therapeutic_area__v`, `therapeutic_class__v` | `picklist(...)` | n | UNV | Y | dependent pair validated or migration mode |
| `Company_Product_vod__c`, `Controlled_Substance_vod__c`, `Cold_Chain_vod__c`, `Restricted_vod__c`, `Bundle_Pack_vod__c`, `Inventory_Monitoring_vod__c`, `No_Details_vod__c`, `No_Metrics_vod__c`, `No_Cycle_Plans_vod__c`, `Require_Key_Message_vod__c`, `User_Aligned_vod__c`, `Sample_Quantity_Bound_vod__c`, `Pricing_Bound_vod__c`, `Pricing_Rule_Quantity_Bound_vod__c`, `Create_Lot_Catalog_vod__c` (boolean) | same names `__v` | `bool` | n | UNV | N | |
| `Require_Discussion_vod__c` {No_vod, Yes_vod} | `require_discussion__v` | `picklist` (`no__v`/`yes__v`) or `bool` per target type | n | UNV | N | |
| `Schedule_vod__c` (text 10), `Restricted_States_vod__c` (text 100) | `schedule__v`, `restricted_states__v` | `text` | n | UNV | Y | US controlled-substance schedule |
| `Sample_U_M_vod__c` (picklist), `Sample_Quantity_Picklist_vod__c` (longtext), `Quantity_Per_Case_vod__c`, `Inventory_Quantity_Per_Case_vod__c`, `Inventory_Order_UOM_vod__c` | `sample_u_m__v`, `sample_quantity_picklist__v`, `quantity_per_case__v`, `inventory_quantity_per_case__v`, `inventory_order_uom__v` | `picklist`/`longtext`/`number` | n | UNV | Y | |
| `Product_Value_vod__c`, `Cost_vod__c` (currency) | `product_value__v`, `cost__v` (+ `local_currency__sys`) | `number` + `currency` | n | UNV | N | |
| `Display_Order_vod__c`, `Sort_Code_vod__c`, `Description_vod__c`, `Distributor_vod__c` | `display_order__v`, `sort_code__v`, `description__v`, `distributor__v` | `number`/`text` | n | UNV | N | |
| `Product_Thumbnail_vod__c` (longtext 32000) | `product_thumbnail__v` | `deferredBlob` | n | UNV | N | |
| Skip: `No_Promo_Items_vod__c` (formula), `zvod_Custom_Text_vod__c` | — | `skip` | — | — | N | |
| Country/market scoping (customer field, e.g. `Country_vod__c` or `Market_vod__c` when present) | `country__v`? | `country(ref)` | n | UNV | Y | drives `(name, type, country)` natural key |

#### 6.3.6 `product_group` — `Product_Group_vod__c` → `product_group__v` `[UNV]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Product_vod__c` (ref→Product) | `product__v` | `ref(product)` | Y | UNV | N | |
| `Detail_Group_vod__c` (ref→Product) | `detail_group__v` | `ref(product)` | Y | UNV | N | |
| `Name` | `name__v` | `text` | Y | UNV | N | |
| `External_ID_vod__c` | `external_id__v` | `copy` | n | UNV | N | |

#### 6.3.7 `account` — `Account` → `account__v` `[OBS×4]`
Person vs business = object type. HCP names live on the account; no Contact rows. `primary_country__v` required `[DOC snippet]` — its type (reference to `country__v` vs picklist) `[UNV]` → `country(auto)` picks by metadata type. Standard SFDC B2B fields (`Industry`, `Rating`, `Ownership`, `Sic`, `TickerSymbol`, `AnnualRevenue`, `NumberOfEmployees`, `AccountSource`, `Type`, `Site`, `Jigsaw`, `ParentId`) are **skipped** (`ParentId` → `primary_parent__v` only when `Primary_Parent_vod__c` is empty and `objects.account.useParentIdFallback = true`).

Object-type crosswalk (`account.objectType`; person types `IsPersonType = true`): `Professional_vod → professional__v`, `Business_Professional_vod → business_professional__v`, `Hospital_vod → hospital__v`, `HospitalDepartment_vod → hospitaldepartment__v`, `Practice_vod → practice__v`, `Pharmacy_vod → pharmacy__v`, `Institution_vod → institution__v`, `Organization_vod → organization__v`, `MCO_vod → mco__v`, `MCOPlan_vod → mcoplan__v`, `Distributor_vod → distributor__v`, `Distributor_Branch_vod → distributor_branch__v`, `Wholesaler_vod → wholesaler__v`, `Employer_vod → employer__v`, `ExtendedCare_vod → extendedcare__v`, `Government_Agency_vod → government_agency__v`, `Laboratory_vod → laboratory__v`, `Board_vod → board__v`, `Publication_vod → publication__v` — all `UNV`, resolved by label match against `object_types[]` at preflight; customer record types → `objects.account.objectType` overrides.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `RecordType.DeveloperName` | `object_type__v.api_name__v` | `objectType(account.objectType)` | Y | OBS (syntax) | Y | |
| `RecordType.DeveloperName` (business accounts) / `Type` (SFDC standard picklist, when the org uses it) | `type__v` `[OBS — Reltio HOWTO writes it on HCO accounts]` | `picklist(account.type)` — default crosswalk = the object-type api name without `__v` re-suffixed (`hospital__v` → `hospital__v`), overridable | y? (preflight reads `required` per object type; blocking `VT_REQUIRED_UNMAPPED` would otherwise fire with no source) | OBS | Y | semantics `[UNV]` (account type/classification picklist vs. free text) — preflight validates values against the picklist; if `type__v` turns out to be a text field the crosswalk value is sent verbatim |
| `Name` (business accounts, `IsPersonAccount = false`) | `name__v` | `text(128)` | Y | OBS | N | |
| `FirstName`, `LastName`, `MiddleName`/`Middle_vod__c`, `Suffix`/`Suffix_vod__c` (person) | `first_name_cda__v`, `last_name_cda__v`, `middle__v`?, `suffix__v`? ; `name__v` | `text`; `name__v` = `nameTemplate(account.person)` | Y (last name; name) | OBS (first/last) / UNV (middle/suffix) | Y | template per country (§7.3): default `{FirstName} {LastName}`; JP `{LastName} {FirstName}`; CN `{LastName}{FirstName}` |
| `Salutation` (picklist) | `salutation__v` | `picklist(account.salutation)` | n | OBS | Y | |
| `Formatted_Name_vod__c` (formula) | `formatted_name__v` | `skip` (Vault computes) unless metadata shows `editable` and `objects.account.loadFormattedName` | — | DOC | N | |
| `Furigana_vod__c` (text 100) | `furigana__v` | `text` | n (JP: y?) | UNV | Y | JP kana; never transliterate |
| `Preferred_Name_vod__c` (12), `Alternate_Name_vod__c` (100) | `preferred_name__v`, `alternate_name__v` | `text` | n | UNV | N | |
| `Country_vod__c` (ref→Country_vod__c) | `primary_country__v` (and `country__v` if present) | `country(auto)` | **Y** | DOC/UNV | N | via country crosswalk |
| `Specialty_1_vod__c`, `Specialty_2_vod__c` (picklist, org-specific) | `spec_1_cda__v` `[OBS]`, `spec_2_cda__v` / `specialty_1__v`, `specialty_2__v` (whichever exists) | `picklist(account.specialty)` (multi-value on target `[OBS array]`) | n | OBS/UNV | **Y** | per-country specialty crosswalk |
| `Group_Specialty_1_vod__c`, `Group_Specialty_2_vod__c` | `group_specialty_1__v`, `group_specialty_2__v` | `picklist` | n | UNV | Y | |
| `Credentials_vod__c` (picklist) | `credentials__v` | `picklist(account.credentials)` | n | OBS | Y | |
| `Gender_vod__c` {F, M} | `gender__v` | `picklist(account.gender)` | n | UNV | N | |
| `Language_vod__c` {en_US, de, fr, …} | `language__v` | `picklist(account.language)` | n | UNV | Y | |
| `Career_Status_vod__c` {Peak_vod, Emerging_vod, Retired_vod} | `career_status__v` | `picklist` | n | UNV | N | |
| `Do_Not_Call_vod__c` {No_vod, Yes_vod} | `do_not_call__v` | `picklist` or `bool` (by target type) | n | UNV | N | |
| `PDRP_Opt_Out_vod__c` (boolean), `PDRP_Opt_Out_Date_vod__c` (date) | `pdrp_opt_out__v`, `pdrp_opt_out_date__v` | `bool`, `date` | n | UNV | Y | US only |
| `KOL_vod__c`, `Investigator_vod__c` (boolean) | `kol__v`, `investigator__v` | `bool` | n | UNV | N | |
| `NPI_vod__c` (text 25) | `npi__v` | `text` | n | OBS | Y | US |
| `ID_vod__c`, `ID2_vod__c` (20), `Account_Identifier_vod__c` (80), `Payer_Id_vod__c` | `id__v`, `id2__v`, `account_identifier__v`, `payer_id__v` | `text` | n | UNV | Y | country professional ids (DE LANR, FR RPPS, BR CRM…) often here |
| `VeevaID_vod__c` (newer) / customer VID field | `veeva_network_id__v` `[OBS]` (fallback `veeva_network__id__v`) | `copy` | n | OBS | N | **match key** (§3.3) |
| `Master_Align_Id_vod__c` (36) | `master_align_id__v` | `copy` | n | UNV | N | |
| `Primary_Parent_vod__c` (ref→Account) | `primary_parent__v` | `ref(account)` `secondPass` | n | DOC | N | |
| `Business_Professional_Person_vod__c` (ref→Account) | `business_professional_person__v` | `ref(account)` `secondPass` | n | UNV | N | |
| `Phone`, `Fax`, `PersonEmail`, `Website`, `PersonMobilePhone`, `PersonHomePhone` | `office_phone_cda__v`, `fax_cda__v`, `email_cda__v`, `website_cda__v`, `mobile_phone_cda__v`?, `home_phone_cda__v`? | `text` (optional E.164 per country) | n | OBS (first four) / UNV | Y | |
| `Account_Class_vod__c`, `Account_Group_vod__c`, `Hospital_Type_vod__c` {GP, HP} | `account_class__v`, `account_group__v`, `hospital_type__v` | `picklist` | n | UNV | Y | CN uses Hospital_Type |
| `Territory_vod__c` (text 255, `;`-joined names) | — | `skip` (derived from `tsf`/`user_territory` in Vault) | — | — | N | |
| `Segmentations_vod__c`, `Restricted_Products_vod__c`, `Sample_Default_vod__c` (longtext) | `segmentations__v`, `restricted_products__v`, `sample_default__v` | `longtext` | n | UNV | N | |
| `Order_Type_vod__c`, `Inventory_Monitoring_Type_vod__c` (multipicklist) | `order_type__v`, `inventory_monitoring_type__v` | `multipicklist` | n | UNV | Y | |
| `Approved_Email_Opt_Type_vod__c`, `CLM_Opt_Type_vod__c` {Explicit_Opt_In_vod, Implicit_Opt_In_vod, Never_vod} | `approved_email_opt_type__v`, `clm_opt_type__v` | `picklist` (`explicit_opt_in__v`…) | n | UNV | Y | GDPR markets |
| `Customer_Master_Status_vod__c` {Staging_vod, Inactive_vod, Valid_vod, Under_Review_vod, Rejected_vod} | `customer_master_status__v` | `picklist` | n | UNV | N | Network may repopulate |
| `Exclude_from_Zip_to_Terr_Processing_vod__c`, `Do_Not_Create_Child_Account_vod__c`, `Do_Not_Sync_Sales_Data_vod__c`, `Enable_Restricted_Products_vod__c`, `Practice_at_Hospital_vod__c`, `Practice_Near_Hospital_vod__c` (boolean) | same `__v` | `bool` | n | UNV | N | |
| `Call_Reminder_vod__c` (textarea), `Description` | `call_reminder__v`, `description__v` | `longtext` | n | UNV | N | |
| `Photo_vod__c` (longtext 131072) | `photo__v`? / attachment | `deferredBlob` | n | UNV | N | |
| `PersonBirthdate`, `PersonTitle` | `birthdate__v`?, `title__v`? | `date`/`text` | n | UNV | N | drop when absent |
| `IsPersonAccount`, `PersonContactId`, `PersonIndividualId`, `PersonLead*`, `PersonAssistant*`, standard address compounds, `Account_Search_*`, `Color_vod__c`, `Signature_Page_Display_Name_vod__c`, `Spend_Status*`, `Territory_Test_vod__c`, `ATL_Last_Update_Date_Time_vod__c` | — | `skip` (`IsPersonAccount` drives object-type choice only) | — | — | N | |

#### 6.3.8 `address` — `Address_vod__c` → `address__v` `[OBS×2]`
Master-detail → `account__v` parent. Primary address stamps onto the account via a standard trigger (keep `noTriggers = false`). No `OwnerId`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (MD→Account) | `account__v` | `ref(account)` | Y | OBS | N | |
| `Name` (= street line 1, 255) | `name__v` (128) | `text(128)` truncation policy `truncate`+log or spill to line 2 (`objects.address.line1Overflow = 'truncate' \| 'spillToLine2' \| 'fail'`) | Y | OBS | Y | |
| `Address_line_2_vod__c` (100) | `street_address_2_cda__v` `[OBS]` (fallback `address_line_2__v`) | `text` | n | OBS | N | |
| `City_vod__c` (40) | `city_cda__v` (fallback `city__v`) | `text` | n | OBS | N | |
| `State_vod__c` (picklist, 523 values) | `state_province__v` | `picklist(address.state)` | n | OBS | **Y** | US/CA/AU/BR/MX/JP prefectures/FR départements crosswalk; EU often empty — never default |
| `Zip_vod__c` (20), `Zip_4_vod__c` (4) | `postal_code_cda__v` (fallback `postal_code__v`/`zip__v`), `zip_4__v` | `text` (format check per country) | n | OBS / UNV | Y | keep ZIP+4 separate |
| `Country_vod__c` (picklist ISO-2) | `country__v` | `country(auto)` (picklist name or ref by metadata type) | y? | OBS | N | |
| `External_ID_vod__c` (EXTID, unique 120) | `external_id__v` | `copy` | n | OBS | N | Network-owned in bridged orgs |
| `Primary_vod__c` (boolean) | `primary__v` | `bool` | n | UNV | N | exactly one per account — validate |
| `Business_vod__c`, `Home_vod__c`, `Mailing_vod__c`, `Shipping_vod__c`, `Billing_vod__c`, `Inactive_vod__c`, `Include_in_Territory_Assignment_vod__c`, `Appt_Required_vod__c`, `Controlled_Address_vod__c`, `No_Address_Copy_vod__c`, `DEA_Address_vod__c` (boolean) | same `__v` (`inactive__v` `[DOC]`) | `bool` | n | DOC/UNV | N | `inactive__v` is also the inactivate-delete target |
| `Phone_vod__c`, `Phone_2_vod__c`, `Fax_vod__c`, `Fax_2_vod__c` | `phone__v`, `phone_2__v`, `fax__v`, `fax_2__v` (or `*_cda__v` if that is what exists) | `text` | n | UNV | Y | |
| `Brick_vod__c` (80) | `brick__v` | `text` | n | UNV | Y | EU (IQVIA brick) |
| `Latitude_vod__c`, `Longitude_vod__c` (number) | `latitude__v`, `longitude__v` | `number` | n | UNV | N | |
| `License_vod__c` (25), `License_Status_vod__c` {New_vod, Valid_vod, Invalid_vod, Expired_vod, Sampled_vod}, `License_Expiration_Date_vod__c` (date) | `license__v`, `license_status__v`, `license_expiration_date__v` | `text`/`picklist`/`date` | n | UNV | Y | US SLN; BR CRM number may map here |
| `DEA_vod__c` (9), `DEA_Status_vod__c` {Valid_vod, Invalid_vod}, `DEA_Expiration_Date_vod__c`, `DEA_Schedule_vod__c`, `DEA_License_Address_vod__c` | `dea__v`, `dea_status__v`, `dea_expiration_date__v`, `dea_schedule__v`, `dea_license_address__v` | as types | n | UNV | Y | US |
| `CDS_vod__c`, `CDS_Status_vod__c`, `CDS_Expiration_Date_vod__c`, `ASSMCA_vod__c` | `cds__v`, `cds_status__v`, `cds_expiration_date__v`, `assmca__v` | as types | n | UNV | Y | US / PR |
| `Network_License_Entity_ID_vod__c`, `Network_DEA_Entity_ID_vod__c`, `Network_CDS_Entity_ID_vod__c`, `Network_ASSMCA_Entity_ID_vod__c`, `Network_Sample_Eligibility_vod__c` {Eligible_vod, Ineligible_vod} | same `__v` | `text`/`picklist` | n | UNV | Y | bridge may repopulate |
| `Sample_Send_Status_vod__c` {Pending_vod, Valid_vod, Invalid_vod}, `Source_vod__c` {Manual, HMS}, `Customer_Master_Status_vod__c` | `sample_send_status__v`, `source__v`, `customer_master_status__v` | `picklist` | n | UNV | N | |
| `Controlling_Address_vod__c` (ref→Address) | `controlling_address__v` | `ref(address)` `secondPass` | n | UNV | N | |
| `Best_Times_vod__c`, `Office_Notes_vod__c`, `Staff_notes_vod__c` (longtext), `Comment_vod__c`, `Entity_Reference_Id_vod__c`, `Master_Align_Id_vod__c` | `best_times__v`, `office_notes__v`, `staff_notes__v`, `comment__v`, `entity_reference_id__v`, `master_align_id__v` | `longtext`/`text` | n | UNV | N | |
| Skip: `Map_vod__c`, `Sample_Status_vod__c`, `License_Valid_To_Sample_vod__c` (formulas) | — | `skip` | — | — | N | |

#### 6.3.9 `child_account` — `Child_Account_vod__c` → `child_account__v` `[DOC]` (all fields UNV)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Parent_Account_vod__c` (ref→Account) | `parent_account__v` | `ref(account)` | Y | UNV | N | |
| `Child_Account_vod__c` (ref→Account) | `child_account__v` | `ref(account)` | Y | UNV | N | same name as object (as in Veeva CRM) |
| `External_ID_vod__c` (`{ParentId}__{ChildId}`, unique 40) | `external_id__v` | `compositeExternalId('{parentVaultId}__{childVaultId}')` (default) or `copy` | n | UNV | N | must stay unique |
| `Mobile_ID_vod__c`, `External_Key_vod__c` (100) | `mobile_id__v`, `external_key__v` | `copy` | n | UNV | N | |
| `Hierarchy_Type_vod__c` (picklist, plain-English) | `hierarchy_type__v` | `picklist(child_account.hierarchyType)` | n | UNV | Y | |
| `Network_Primary_vod__c`, `Copy_Address_vod__c` (boolean) | `network_primary__v`, `copy_address__v` | `bool` | n | UNV | N | |
| `Customer_Master_Status_vod__c`, `Location_Identifier_vod__c`, `Alternate_Name_vod__c`, `Best_Times_vod__c`, `Child_Affiliation_Count_vod__c`, `Parent_Affiliation_Count_vod__c` | same `__v` | as types | n | UNV | N | |
| `Name` | `name__v` | `text` (system-managed in Vault likely → omit unless required) | y? | UNV | N | |
| Skip formulas: `Child_Name/Furigana/Record_Type/Identifier_vod__c`, `Parent_*`, `Parent_Child_Name/Furigana`, `Child_Account_Search_LastFirst`, `Formatted_Name_Furigana`, `Primary_vod__c`; `zvod_*` | — | `skip` | — | — | N | |

#### 6.3.10 `affiliation` — `Affiliation_vod__c` → `affiliation__v` `[DOC]` (fields UNV; not Network-bridged in Vault CRM)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `From_Account_vod__c`, `To_Account_vod__c` (ref→Account) | `from_account__v`, `to_account__v` | `ref(account)` | Y | UNV | N | |
| `From_Contact_vod__c`, `To_Contact_vod__c` (ref→Contact) | — | `skip` (`CONTACT_REF_DROPPED`) or person-account mapping (§3.4) | — | — | N | |
| `Child_affiliation_vod__c` (ref→self, mirror row) | `child_affiliation__v` | `ref(affiliation)` `secondPass` | n | UNV | N | |
| `External_Id_vod__c` (unique 255) | `external_id__v` | `copy` | n | UNV | N | |
| `Role_vod__c`, `Influence_vod__c`, `Relationship_Strength_vod__c` (picklist) | `role__v`, `influence__v`, `relationship_strength__v` | `picklist` | n | UNV | Y | |
| `Therapeutic_Area_vod__c` (multipicklist) | `therapeutic_area__v` | `multipicklist` | n | UNV | Y | |
| `Parent_vod__c` (boolean), `Comments_vod__c` | `parent__v`, `comments__v` | `bool`/`longtext` | n | UNV | N | |
| `Disable_Trigger_vod__c`, `destroy_vod__c` | — | `skip` | — | — | N | transient |
| Skip formulas: `To_Account_Name/Identifier/Record_Type_vod__c` | — | `skip` | — | — | N | |

#### 6.3.11 `account_territory` — `ObjectTerritory2Association` (Account) → `account_territory__v` `[DOC]` (optional; default disabled because Align/territory rules own it; creating one auto-creates `tsf__v` `[DOC]`)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `ObjectId` (Account) | `account__v` | `ref(account)` | Y | DOC | N | |
| `Territory2Id` | `territory__v` | `ref(territory)` | Y | DOC | N | |
| `AssociationCause` | — | `skip` | — | — | N | |
| — | `name__v` | `custom` | y? | UNV | N | |

#### 6.3.12 `tsf` — `TSF_vod__c` → `tsf__v` `[DOC]`
Object types on `tsf__v` mirror account object types `[DOC]` → `objectType` = the account's object type when `allow_types`. `territory__v` is an **object reference** in Vault `[DOC]` (source is the territory name text).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (MD→Account) | `account__v` | `ref(account)` | Y | DOC | N | |
| `Territory_vod__c` (text 80, EXTID = territory name) | `territory__v` | `territoryRef` | Y | DOC | N | unresolved → `pending_fk` |
| `External_Id_vod__c` (`{AccountId}__{TerritoryName}`, unique 255) | `external_id__v` | `compositeExternalId('{accountVaultId}__{territoryName}')` or `copy` | n | UNV | N | |
| `Address_vod__c` (ref→Address, preferred) | `address__v` | `ref(address)` | n | DOC | N | |
| `Preferred_Account_vod__c` (ref→Account) | `preferred_account__v` | `ref(account)` | n | DOC | N | |
| `My_Target_vod__c` (boolean), `Last_Activity_Date_vod__c` (date), `YTD_Activity_vod__c` (number), `Route_vod__c` (picklist), `Allowed_Products_vod__c` (textarea) | `my_target__v`, `last_activity_date__v`, `ytd_activity__v`, `route__v`, `allowed_products__v` | as types | n | UNV | Y | `YTD_Activity` may be trigger-maintained in Vault — load verbatim with `noTriggers=false` then let Vault recompute |
| customer target-class/frequency `__c` columns | same `__c` | per type | n | must exist | Y | |
| — (account object type) | `object_type__v.api_name__v` | `custom(tsfObjectType)` | Y if typed | DOC | N | |

#### 6.3.13 `product_metrics` — `Product_Metrics_vod__c` → `product_metrics__v` `[DOC]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (MD→Account) | `account__v` | `ref(account)` | Y | UNV | N | |
| `Products_vod__c` (ref→Product, plural) | `products__v` (fallback `product__v` — preflight picks the existing one) | `ref(product)` | Y | UNV | N | |
| `Detail_Group_vod__c` (ref→Product) | `detail_group__v` | `ref(product)` | n | UNV | N | |
| `Location_vod__c` (ref→Child_Account), `Location_Parent_vod__c`, `Location_Child_vod__c` (ref→Account) | `location__v`, `location_parent__v`, `location_child__v` | `ref(child_account)` / `ref(account)` | n | UNV | N | |
| `External_ID_vod__c` (unique 255) | `external_id__v` | `copy` | n | UNV | N | |
| customer metric columns (`Segment__c`, `Potential__c`, …; picklists often dependent) | same `__c` | per type; `picklist(product_metrics.<field>)` | n | must exist | **Y** | per-country segment crosswalks |

#### 6.3.14 `key_message` — `Key_Message_vod__c` → `key_message__v` `[DOC]`
Integration-owned when PromoMats/MedComms syncs CLM content (Vault-to-Vault) → default `createPolicy: match-only`; migrate only non-Vault-managed content. Status: `Status_vod__c` {Approved_vod, Staged_vod, Expired_vod} → `key_message_status__v` (pattern) / `status__v` — preflight picks.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` | `name__v` | `text(128)` | Y | UNV | N | |
| `Product_vod__c`, `Detail_Group_vod__c` (ref→Product) | `product__v`, `detail_group__v` | `ref(product)` | y? | DOC | N | one product per key message `[DOC]` |
| `Product_Strategy_vod__c` (ref) | `product_strategy__v` | `ref` (out of v1 → omitted) | n | UNV | N | |
| `Shared_Resource_vod__c` (ref→self) | `shared_resource__v` | `ref(key_message)` `secondPass` | n | UNV | N | |
| `Media_File_Name_vod__c` (EXTID, unique 255) | `media_file_name__v` | `copy` | n | UNV | N | match key |
| `VExternal_Id_vod__c` (EXTID unique), `Vault_Doc_Id_vod__c`, `Vault_GUID_vod__c`, `Vault_External_Id_vod__c`, `Vault_DNS_vod__c`, `Vault_Last_Modified_Date_Time_vod__c` | `vexternal_id__v`, `vault_doc_id__v`, `vault_guid__v`, `vault_external_id__v` `[OBS name on em_event]`, `vault_dns__v`, `vault_last_modified_date_time__v` | `copy`/`datetime` | n | UNV | N | match keys |
| `CLM_ID_vod__c`, `Slide_Version_vod__c`, `Category_vod__c`, `Language_vod__c`, `Segment_vod__c`, `Vehicle_vod__c`, `Description_vod__c`, `Custom_Reaction_vod__c`, `Display_Order_vod__c`, `Media_File_CRC_vod__c`, `Media_File_Size_vod__c`, `CDN_Path_vod__c`, `iOS_Viewer_vod__c` | same `__v` | as types | n | UNV | Y (language/category) | |
| `Status_vod__c` | `key_message_status__v` / `status__v` | `picklist(key_message.status)` (`approved__v`, `staged__v`, `expired__v`) | n | UNV | N | |
| `Active_vod__c`, `Is_Shared_Resource_vod__c` (boolean) | `active__v`, `is_shared_resource__v` | `bool` | n | UNV | N | |
| `Disable_Actions_vod__c` (multipicklist) | `disable_actions__v` | `multipicklist` | n | UNV | N | |

#### 6.3.15 `clm_presentation` — `Clm_Presentation_vod__c` → `clm_presentation__v` `[DOC]` (same integration caveat)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` | `name__v` | `text` | Y | UNV | N | |
| `Product_vod__c` (ref→Product) | `product__v` | `ref(product)` | y? | DOC | N | |
| `Presentation_Id_vod__c` (EXTID unique) | `presentation_id__v` | `copy` | n | UNV | N | match key |
| `VExternal_Id_vod__c`, `Vault_Doc_Id_vod__c`, `Vault_GUID_vod__c`, `Vault_External_Id_vod__c`, `Vault_DNS_vod__c`, `Vault_Last_Modified_Date_Time_vod__c` | as key_message | `copy` | n | UNV | N | |
| `Directory_vod__c`, `Survey_vod__c` (ref) | `directory__v`, `survey__v` | `text` / omitted | n | UNV | N | |
| `Version_vod__c`, `Type_vod__c` {HQ, Custom}, `Control_Visibility_vod__c` {Product_vod, Detail_Group_vod}, `Event_Content_vod__c` {Events_Only_vod, Events_CLM_vod} | `version__v`, `type__v`, `control_visibility__v`, `event_content__v` | `text`/`picklist` | n | UNV | N | |
| `Status_vod__c` {Approved_vod, Staged_vod, Expired_vod} | `clm_presentation_status__v` / `status__v` | `picklist` | n | UNV | N | |
| `Start_Date_vod__c`, `End_Date_vod__c` (date) | `start_date__v`, `end_date__v` | `date` | n | UNV | N | |
| `Approved_vod__c`, `Hidden_vod__c`, `Training_vod__c`, `Default_Presentation_vod__c`, `Enable_Survey_Overlay_vod__c` (boolean) | same `__v` | `bool` | n | UNV | N | |
| `Keywords_vod__c`, `Description_vod__c` | `keywords__v`, `description__v` | `longtext` | n | UNV | N | |
| `Original_Record_ID_vod__c`, `ParentId_vod__c`, `Copied_From_vod__c`, `Copy_Date_vod__c` | same `__v` | `copy` | n | UNV | N | ids inside remain legacy ids |

#### 6.3.16 `clm_presentation_slide` — `Clm_Presentation_Slide_vod__c` → `clm_presentation_slide__v` `[DOC]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Clm_Presentation_vod__c` (MD) | `clm_presentation__v` | `ref(clm_presentation)` | Y | DOC | N | |
| `Key_Message_vod__c` (ref) | `key_message__v` | `ref(key_message)` | y? | DOC | N | |
| `Sub_Presentation_vod__c` (ref→Clm_Presentation) | `sub_presentation__v` | `ref(clm_presentation)` `secondPass` | n | UNV | N | |
| `External_ID_vod__c` (unique), `VExternal_Id_vod__c` | `external_id__v`, `vexternal_id__v` | `copy` | n | UNV | N | |
| `Vault_External_Id_vod__c` `[UNVERIFIED-SOURCE]` (fallback: `Key_Message_vod__r.Vault_External_Id_vod__c`) | **`vault_external_id__v`** `[DOC — slide identity used by gotoSlide/CLM matching]` | `copy` / `custom(slideVaultExternalId)` | y? (when PromoMats content exists) | DOC | N | match key (§3.3); when neither source exists the row is created without it and `warning SLIDE_VAULT_EXTERNAL_ID_MISSING` counts it |
| `Display_Order_vod__c` (number), `Mandatory_Slides_vod__c` | `display_order__v`, `mandatory_slides__v` | `number`/`text` | n | UNV | N | |
| `Name` | `name__v` | `text` | Y | UNV | N | |

#### 6.3.17 `approved_document` — `Approved_Document_vod__c` → `approved_document__v` `[DOC]`
Object types: `Email_Template_vod → email_template__v`, `Email_Fragment_vod → email_fragment__v`, `Email_Receipt_vod → email_receipt__v`, `Engage_vod → engage__v`, `Events_Management_vod → events_management__v`, `Medical_Inquiry_Template_vod → medical_inquiry_template__v`, `Remote_Meeting_vod → remote_meeting__v`, `CoBrowse_Invite_Template_vod → cobrowse_invite_template__v`, `Case_Template_vod → case_template__v` (UNV). Integration-owned → `match-only` default.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` | `name__v` | `text` | Y | UNV | N | |
| `Document_ID_vod__c` (EXTID unique 100), `Vault_Document_ID_vod__c` (100), `Vault_Instance_ID_vod__c`, `Document_Last_Mod_DateTime_vod__c` | `document_id__v`, `vault_document_id__v`, `vault_instance_id__v`, `document_last_mod_datetime__v` | `copy`/`datetime` | n | UNV | N | match keys |
| `Status_vod__c` {Staged_vod, Expired_vod, Withdrawn_vod, Approved_vod} | `approved_document_status__v` / `status__v` | `picklist` | n | UNV | N | |
| — (no source) | `publish_method__v` `[INFER, vault-crm-model.md §4.15 — "Vault Auto Published" for PromoMats-synced fragments]` | `const(objects.approved_document.publishMethod)` — default **omitted** (field left null so the PromoMats integration can claim the row later); value names `[UNV]` (expect `vault_auto_published__v` / `manual__v`) resolved by label at preflight | n | INFER | N | only relevant when `createPolicy = create`; migrated (non-Vault-managed) content is expected to carry the *manual* value |
| `Product_vod__c`, `Detail_Group_vod__c`, `Key_Message_vod__c`, `Content_Type_vod__c`, `Survey_vod__c` | `product__v`, `detail_group__v`, `key_message__v`, `content_type__v`, `survey__v` | `ref(product)`, `ref(product)`, `ref(key_message)`, `refLookup(content_type, external_id__v)` via `objects.multichannel_consent.configMaps.contentType` (shared crosswalk, §6.3.42), omitted (`survey`) | n | UNV | N | |
| `Language_vod__c`, `Territory_vod__c` (text) | `language__v`, `territory__v` | `picklist`/`text` | n | UNV | Y | |
| `Email_Subject_vod__c`, `Email_From_Address/Name_vod__c`, `Email_ReplyTo_Address/Name_vod__c`, `Email_Domain_vod__c`, `Bcc_vod__c`, `Email_Allows_Documents_vod__c`, `Allow_Any_Product_Fragment_vod__c`, `Allowed_Document_IDs_vod__c`, `PI/ISI/Piece/Other_Document_ID*_vod__c`, `Engage_Document_Id_vod__c`, `Events_Management_Subtype_vod__c` {Save_The_Date_vod, Reminder_vod, Invitation_vod, Follow_Up_vod}, `Document_Host_URL_vod__c`, `Document_Description_vod__c` | same `__v` | as types | n | UNV | N | |
| `Email_HTML_1_vod__c`, `Email_HTML_2_vod__c` (131072), `Email_Fragment_HTML_vod__c`, `Email_Template_Fragment_HTML/Document_ID_vod__c` | same `__v` | `deferredBlob` (LongText ≤ 32k: split/truncate policy `objects.approved_document.htmlOverflow`) | n | UNV | N | |

#### 6.3.18 `sample_lot` — `Sample_Lot_vod__c` → `sample_lot__v` `[DOC]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` (lot number) | `name__v` | `text` | Y | DOC | N | |
| `Product_vod__c` (ref→Product) | `product__v` | `ref(product)` | Y | DOC | N | |
| `Sample_vod__c` (text 100, product name) | `sample__v` | `text` | Y | DOC | N | Vault stamps from product; load verbatim |
| `Sample_Lot_Id_vod__c` (EXTID unique 200) | `sample_lot_id__v` | `copy` | n | UNV | N | match key |
| `Expiration_Date_vod__c` (date) | `expiration_date__v` | `date` | n | UNV | N | |
| `Active_vod__c` (boolean), `Suppress_Lot_vod__c` | `active__v`, `suppress_lot__v` | `bool` | n | UNV | N | inactivate-delete target |
| `Allocated_Quantity_vod__c` (number), `U_M_vod__c` {Cases, Box, Unit, Wallet, Blister, Syringe} | `allocated_quantity__v`, `u_m__v` | `number`/`picklist` | n | UNV | Y | |
| `Batch_Lot_Id_vod__c` (newer) | `batch_lot_id__v` | `copy` | n | UNV | N | |
| `OwnerId` (rep) | `ownerid__v` | `refUser` | y? | UNV | N | |
| `Calculated_Quantity_vod__c` (roll-up) | — (`calculated_quantity__v` is Vault-computed) | `skip`; the source value is **extracted anyway** and kept in `reconciliation.extra` as the expected roll-up for the post-load verification of §6.3.35 | — | DOC | N | |
| `lot_catalog__v` (new Vault object) | — | not loaded in v1 (open question §9) | — | DOC | N | |

#### 6.3.19 `em_venue` — `EM_Venue_vod__c` → `em_venue__v` `[OBS]` and 6.3.20 `em_catalog` — `EM_Catalog_vod__c` → `em_catalog__v` `[OBS]`
Both upserted with `idParam=external_id__v` in the wild `[OBS]`; the tool still uses the legacy-id field as idParam and `external_id__v` as match key.

| Object | Source (type) | Target | Transform | Req | Ev | CC |
|---|---|---|---|---|---|---|
| em_venue | `Name` `[META-implied]`, `External_ID_vod__c` `[OBS idParam]`; **all other source names are `[UNVERIFIED-SOURCE]`** (`EM_Venue_vod__c` appears in no research file beyond its name): `Address_Line_1_vod__c`, `Address_Line_2_vod__c`, `City_vod__c`, `State_Province_vod__c`, `Postal_Code_vod__c`, `Country_vod__c`, `Phone_vod__c`, `Venue_Type_vod__c`, `Status_vod__c` — resolved by describe at preflight; absent ones dropped with `info SF_FIELD_MISSING` | `name__v`, `external_id__v`, `address_line_1__v`?, `address_line_2__v`?, `city__v`, `state_province__v`, `postal_code__v`, `country__v`, `phone__v`, `venue_type__v`?, `em_venue_status__v`? | `text`/`picklist`/`country(auto)` | Y (name) | OBS (object, external_id) / UNV (fields) | Y (state, country) |
| em_catalog | `Name`, `External_ID_vod__c` `[OBS idParam]`, `RecordTypeId` (topic types); `Description_vod__c`, `Status_vod__c` `[UNVERIFIED-SOURCE — sfdc-extract.md §10 #3 lists EM_Catalog fields as unknown]` | `name__v`, `em_catalog_name__v`, `external_id__v`, `description__v`, `em_catalog_status__v`, `object_type__v.api_name__v` (all **OBS**) | `text`/`picklist`/`objectType` | Y | OBS | N |

#### 6.3.21 `em_speaker` — `EM_Speaker_vod__c` → `em_speaker__v` `[OBS]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (ref→Account) | `account__v` | `ref(account)` | Y | OBS | N | source of `em_event_speaker.account__v` |
| `Name` | `name__v` | `text` (one org used "Last, First") | Y | OBS | Y | |
| `External_ID_vod__c` | `external_id__v` | `copy` | n | OBS | N | match key |
| `First_Name_vod__c`, `Last_Name_vod__c`, `Address_vod__c` (text) `[UNVERIFIED-SOURCE — targets observed, sources inferred; sfdc-extract.md §10 #3]` | `first_name__v`, `last_name__v`, `address__v` | `text` | n | OBS | N | fallback when absent: derive `first_name__v`/`last_name__v` from the linked account's `FirstName`/`LastName` (`custom(speakerNamesFromAccount)`) |
| `Status_vod__c` `[UNVERIFIED-SOURCE]` | `em_speaker_status__v` | `picklist(em_speaker.status)` | n | OBS | N | |
| `Next_Year_Status_vod__c` `[UNVERIFIED-SOURCE]`, `Year_To_Date_Utilization_vod__c` (roll-up) `[UNVERIFIED-SOURCE]` | `next_year_status__v` (observed on `em_speaker_qualification__v`, not the speaker — `[UNV on em_speaker__v]`), — | `picklist` / `skip` | n | OBS/DOC | N | |
| qualifications (`EM_Speaker_Qualification_vod__c`) | `em_speaker_qualification__v` | out of v1 | — | OBS | N | |

#### 6.3.22 `em_event` — `EM_Event_vod__c` → `em_event__v` `[OBS full field list]`
Object types (event types): `Speaker_Program_vod → speaker_program__v`, `Congress_vod → congress__v`, `Investigator_Meeting_vod → investigator_meeting__v`, `Round_Table_vod → round_table__v` (UNV names). Lifecycled (`state__v`, `stage__v`, `lifecycle__v` observed) → state crosswalk `em_event.state` from `Status_vod__c` required (migration mode). Loading with `noTriggers = true` (EM automated emails).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Id` | `legacy_crm_id__v` | `legacyId` | K | OBS | N | |
| `RecordType.DeveloperName` | `object_type__v.api_name__v` | `objectType(em_event.objectType)` | Y | OBS (field) | Y | |
| `Name`, `Event_Display_Name_vod__c` (80) | `name__v`, `event_display_name__v` | `text` | Y/n | OBS | N | |
| `Status_vod__c` (15 values incl. plain-English customer values) | `em_event_status__v` + `state__v` (via `em_event.state`) | `picklist(em_event.status)` + `state(em_event.state)` | Y | OBS | Y | `approved__v`, `rejected__v`, `pending_approval__v`, `closed__v`, `canceled__v`, `requested__v` UNV; customer values `in_draft__c`… |
| `Start_Time_vod__c`, `End_Time_vod__c` (datetime) | `start_time__v`, `end_time__v` (UTC) + `start_date__v`, `end_date__v` (date) + `start_time_local__v`, `end_time_local__v` + `time_zone__v` | `datetime`; `custom(emEventLocalTimes)` — local values derived from UTC + timezone (`Event_Time_Zone_vod__c` `[UNVERIFIED-SOURCE — field-mapping.md §4.14 only has "Event_Time_Zone…"; the exact API name is resolved by describe prefix match `Event_Time_Zone*`]` if present, else owner `TimeZoneSidKey`, else country default `countries.<ISO>.defaultTimezone`) | Y (start) | OBS | Y | document the timezone choice per run (`time_zone__v` value names `[OBS array, e.g. america_new_york__sys-style]`) |
| `Country_vod__c` (ref→Country_vod__c) | `country__v` (ref) | `country(ref)` | y? | OBS | N | |
| `Location_vod__c` (255), `Location_Address_vod__c`, `Location_Address_Line_2_vod__c`, `City_vod__c`, `State_Province_vod__c`, `Postal_Code_vod__c`, `Address_vod__c` (text) | `location__v`, `location_address__v`, `location_address_line_2__v`, `city__v`, `state_province__v`, `postal_code__v`, `address__v` | `text` | n | OBS | Y | |
| `Venue_vod__c`, `Vendor_vod__c`, `Topic_vod__c`, `Event_Configuration_vod__c` (ref) | `venue__v`, `vendor__v` `[OBS]`, `topic__v`, `event_configuration__v` | `ref(em_venue)`; `vendor__v` **omit+count `EM_VENDOR_REF_DROPPED`** (`EM_Vendor_vod__c` out of v1, §6.2.1 — becomes `ref(em_vendor)` when that module is enabled); `ref(em_catalog)`; `event_configuration__v` via `objects.em_event.configurationMap` (§7.2.1: keys = SFDC `EM_Event_Configuration_vod__c.Id`, values = Vault id or `external_id:<value>` → `refLookup(em_event_configuration, external_id__v)`; unset map → automatic match by `External_ID_vod__c` = `external_id__v`, then by `Name` = `name__v` per country) | n / y? (configuration) | OBS | Y (configuration per country) | `em_event_configuration__v` must pre-exist (§6.1); unmatched → blocking `VT_EM_CONFIG_UNMATCHED` |
| `Parent_Event_vod__c` (ref→self) | `parent_event__v` (+ `parent_event_id__v` text) | `ref(em_event)` `secondPass` | n | OBS | N | |
| `External_ID_vod__c`, `KOL_External_Id_vod__c`, `Stub_Mobile_Id_vod__c`, `Stub_SFDC_Id_vod__c` | `external_id__v`, `kol_external_id__v`, `stub_mobile_id__v`, `stub_sfdc_id__v` | `copy` | n | OBS | N | |
| `Description_vod__c` (32000), `Sponsor_vod__c`, `Web_Source_vod__c`, `Disclaimer_vod__c`, `Cancellation_Reason_vod__c`, `Last_Comment_vod__c` | `description__v`, `sponsor__v`, `web_source__v`, `disclaimer__v`, `cancellation_reason__v`, `last_comment__v`? | `longtext`/`text`/`picklist` | n | OBS/UNV | N | |
| `Estimated_Attendance_vod__c`, `Actual_Attendance_vod__c`, `Invited_Attendees_vod__c`, `Walk_In_Count_vod__c`, `Online_Registrant_Count_vod__c`, `Attendees_Requesting_Meals_vod__c`, `Attendees_With_Meals_vod__c`, `HCPs_With_Meals_vod__c` (number) | same `__v` | `number` | n | OBS | N | roll-up-like counters — verbatim (NoTriggers) |
| `Estimated_Cost_vod__c`, `Committed_Cost_vod__c`, `Actual_Cost_vod__c`, `Actual_Meal_Cost_Per_Person_vod__c`, `Flat_Fee_Expense_vod__c`, `Failed_Expense_vod__c` (currency) | same `__v` + `local_currency__sys` | `number` + `currency` | n | OBS | N | `*_corpv__sys` computed |
| `Attendee_Reconciliation_Complete_vod__c`, `Publish_Event_vod__c`, `QR_Sign_In_Enabled_vod__c`, `Meal_Optin_For_QR_Signin_vod__c` (boolean) | same `__v` | `bool` | n | OBS | N | |
| `Account_Attendee_Fields_vod__c`, `Contact_Attendee_Fields_vod__c`, `User_Attendee_Fields_vod__c`, `Walk_In_Fields_vod__c`, `Prescriber_Walk_In_Fields_vod__c`, `Non_Prescriber_Walk_In_Fields_vod__c`, `Other_Walk_In_Fields_vod__c`, `Online_Registration_Fields_vod__c` (config blobs) | same `__v` | `longtext` | n | OBS | N | |
| newer: `Event_Format_vod__c`, `Meal_Type_vod__c`, `Event_Identifier_vod__c`, `Program_Type_vod__c`, `Product_vod__c`, `Account_vod__c`, `Registration_URL_vod__c`, `Sign_In_URL_vod__c`, `Key_Contact_vod__c/_Name/_Email/_Phone`, `Location_Type_vod__c`, `Country_User_vod__c`, `Assigned_Host_vod__c`, `AV_Equipment_vod__c`, `Content_Length_vod__c`, `Vault_External_Id_vod__c`, `Vault_Binder_Path_vod__c`, `Engage_Webinar_vod__c`, `Cvent_*`, `*_ON24_*` | `event_format__v`, `meal_type__v`, `event_identifier__v`, `program_type__v`, `product__v`, `account__v`, `registration_url__v`, `sign_in_url__v`, `key_contact__v`/`key_contact_name__v`/`key_contact_email__v`/`key_contact_phone__v`, `location_type__v`, `country_user__v`, `assigned_host__v`, `av_equipment__v`, `content_length__v`, `vault_external_id__v`, `vault_binder_path__v`, `engage_webinar__v`, `cvent_event_id__v`…, `external_id_on24__v`… | as types (`ref(product)`, `ref(account)`, `refUser`) | n | OBS (targets) | Y (format/meal picklists) | source names confirmed via describe |
| newer (2): `Event_Type_vod__c` (picklist), `Event_Country_vod__c` (ref→Country_vod__c or text), `Virtual_Event_Type_vod__c` (picklist) `[DOC sfdc-extract.md §7.16 — confirm in describe]` | `event_type__v`? (⚠ distinct from `object_type__v`; only when the target field exists), `country__v` fallback source when `Country_vod__c` is null, `virtual_event_type__v`? | `picklist(em_event.eventType)` / `country(ref)` / `picklist` | n | UNV | Y | `Event_Type_vod__c` is a business classification, never used for the object-type crosswalk |
| `OwnerId` | `ownerid__v` | `refUser` | y? | OBS | N | |
| — (observed on the target, **no source**): `stage__v` (lifecycle stage), `registration_form__v`, `registration_url_long__v`, `webinar_status__v`, `webinar_error_datetime__v`, `webinar_error_message__v`, `stage_setting__v`, `approval_process_error__v`, `last_sync__v`, `state_stage_id__sys` | — | not loaded; `stage__v` is set by Vault from `state__v` (stage = lifecycle stage of the state) — the state crosswalk `em_event.state` must therefore map every status to a state **whose stage matches the business status**; preflight lists the stage of each mapped state from `Objectlifecycle.{lifecycle}` in the report (`info EM_STATE_STAGE_TABLE`) for reviewer sign-off | — | OBS | N | if `stage__v` proves writable in migration mode (probe), `objects.em_event.stageMap` may set it explicitly |

#### 6.3.23 `em_attendee` — `EM_Attendee_vod__c` → `em_attendee__v` `[OBS]`
Object type `Attendee_vod → attendee__v` (UNV). Status `[OBS value invited__v]`: `Nominated_vod → nominated__v`, `Approved_vod → approved__v`, `Invited_vod → invited__v`, `Accepted_vod → accepted__v`, `Rejected_vod → rejected__v`, `Attended_vod → attended__v`, `Signed_vod → signed__v`, `Cleared_Signature_vod → cleared_signature__v`, `Cancelled_vod → cancelled__v`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Event_vod__c` (ref→EM_Event) | `event__v` | `ref(em_event)` | Y | OBS | N | |
| exactly one of `Account_vod__c` / `User_vod__c` / `Contact_vod__c` | `account__v` / `user__v` / — | `ref(account)` / `refUser` / drop (or contact→person account) | y? | OBS | N | |
| `Attendee_Type_vod__c` (formula in source) | `attendee_type__v` | `custom(attendeeType)` → `person_account__v`/`business_account__v`/`user__v`/`contact__v` (UNV values) | y? | OBS | N | set explicitly |
| `Attendee_Name_vod__c`, `First_Name_vod__c`, `Last_Name_vod__c`, `Title_vod__c`, `Email_vod__c`, `Phone_vod__c`, `Address_Line_1_vod__c`, `Address_Line_2_vod__c`, `City_vod__c`, `Zip_vod__c` | `attendee_name__v`, `first_name__v`, `last_name__v`, `title__v`, `email__v`, `phone__v`, `address_line_1__v`, `address_line_2__v`, `city__v`, `zip__v` | `text` | n | OBS | N | |
| `Furigana_vod__c`, `Credentials_vod__c`, `Organization_vod__c`, `Meal_Preference_vod__c`, `Prescriber_vod__c`, `State_vod__c`, `Country_vod__c` | `furigana__v`?, `credentials__v`?, `organization__v`?, `meal_preference__v`?, `prescriber__v`?, `state_province__v`?, `country__v`? | as types | n | UNV | Y | |
| `Status_vod__c` | `em_attendee_status__v` (pattern; fallback `status__v` if that is the business status on this object) | `picklist(em_attendee.status)` | Y | OBS (values) / UNV (field) | N | |
| `Walk_In_Status_vod__c` {Needs_Reconciliation_vod, Reconciled_To_Existing_Account_vod, Reconciled_To_Existing_User_vod, Reconciled_To_New_Account_vod, Dismissed_vod} | `walk_in_status__v` | `picklist` | n | OBS | N | |
| `Online_Registration_Status_vod__c`, `RSVP_Status_vod__c`, `Did_Attend_vod__c`, `Meal_Opt_In_vod__c`, `Meal_Consumed_vod__c` | `online_registration_status__v`?, `rsvp_status__v`, `did_attend__v`, `meal_opt_in__v`, `meal_consumed__v` | `picklist`/`bool` | n | OBS | N | |
| `Start_Time_vod__c`, `End_Time_vod__c` (datetime) | `start_time__v`, `end_time__v` | `datetime` | n | UNV | N | |
| `Signature_vod__c` (base64), `Signature_Datetime_vod__c`, `Signee_vod__c` | `signature__v`, `signature_datetime__v`, `signee__v` | `deferredBlob`, `datetime`, `text` | n | UNV | N | |
| `External_ID_vod__c`, `Stub_*`, `Vessel_Number_vod__c`, `Walk_In_Reference_ID_vod__c`, `Entity_Reference_Id_vod__c` | `external_id__v` `[OBS]`, `stub_*__v`, `vessel_number__v`, `walk_in_reference_id__v`, `entity_reference_id__v` | `copy` | n | OBS/UNV | N | |
| `Registration_Disclaimer_vod__c` (newer) | `registration_disclaimer__v` | `longtext` | n | DOC | N | |
| newer sources (confirm via describe) `HCP_vod__c`, `Employed_vod__c`, `Profile_Type_vod__c`, `Postal_Code_vod__c`, `Address_vod__c`, `Role_vod__c`, `Product_vod__c`, `Topic_vod__c` `[UNVERIFIED-SOURCE names; targets OBS]` | `hcp__v`, `employed__v`, `profile_type__v`, `postal_code__v` (⚠ `zip__v` also exists — `Zip_vod__c` → `zip__v`, `Postal_Code_vod__c` → `postal_code__v`, never both from one source), `address__v`, `role__v`, `product__v` (`ref(product)`), `topic__v` (`ref(em_catalog)`) | `bool`/`picklist`/`text`/`ref` | n | OBS (targets, vault-crm-model.md §4.16 / field-mapping.md §4.14 — some belong to speaker rows) | N | loaded only when both source and target exist |

#### 6.3.24 `em_event_speaker` — `EM_Event_Speaker_vod__c` → `em_event_speaker__v` `[OBS]`
Object type `Event_Speaker_vod → event_speaker__v` (UNV).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Event_vod__c` | `event__v` | `ref(em_event)` | Y | OBS | N | |
| `Speaker_vod__c` (ref→EM_Speaker) | `speaker__v` | `ref(em_speaker)` | Y | OBS | N | |
| `Account_vod__c` (formula in source) | `account__v` | `custom(fromSpeakerAccount)` = `em_speaker.account__v` — only if metadata says editable | n | OBS | N | |
| `Status_vod__c` | `em_event_speaker_status__v` | `picklist(em_event_speaker.status)` (default `invited__v` `[OBS]`) | Y | OBS | N | `attended__v`/`signed__v` count toward utilisation |
| `Meal_Opt_In_vod__c`, `Meal_Preference_vod__c`, `Meal_Consumed_vod__c`, `RSVP_Status_vod__c`, `Did_Attend_vod__c`, `Walk_In_Status_vod__c` | `meal_opt_in__v`, `meal_preference__v`?, `meal_consumed__v`, `rsvp_status__v`, `did_attend__v`, `walk_in_status__v` | `bool`/`picklist` | n | OBS | N | |
| `Contract_vod__c` (ref→Contract) | `contract__v` | omitted in v1 | n | UNV | N | |
| `Session_Title_vod__c`, `Position_vod__c`, `Workplace_vod__c`, `Start_Time_vod__c`, `End_Time_vod__c`, `Vessel_Number_vod__c` | same `__v` | `text`/`datetime` | n | UNV | N | |
| `Signature_vod__c`, `Signature_Datetime_vod__c` | `signature__v`, `signature_datetime__v` | `deferredBlob`, `datetime` | n | UNV | N | |
| `External_ID_vod__c`, `Stub_*` | `external_id__v`, `stub_*__v` | `copy` | n | OBS/UNV | N | |
| Skip formulas: `Speaker_Name_vod__c`, `First/Last/Middle_Name_vod__c`, `Credentials_vod__c`, `Title_vod__c`, `Suffix_vod__c`, `Nickname_vod__c` | — | `skip` | — | — | N | |

#### 6.3.25 `em_event_team_member` — `EM_Event_Team_Member_vod__c` → `em_event_team_member__v` `[OBS]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Event_vod__c` | `event__v` | `ref(em_event)` | Y | OBS | N | |
| `Team_Member_vod__c` (ref→User) | `team_member__v` (+ `user_id__v` text) | `refUser` | Y | OBS | N | |
| `Role_vod__c` (picklist) | `role__v` | `picklist` | n | OBS | Y | |
| `Name` | `name__v` | `text` | Y | OBS | N | |

#### 6.3.25a `expense_header` — `Expense_Header_vod__c` `[UNVERIFIED-SOURCE object]` → `expense_header__v` `[OBS full field list]`
Transfer-of-value evidence (Sunshine Act / EFPIA) — the object family that `scope.tovRetentionMonths` widens. Source object and field names are the inverse rename of the observed target (`expense_header__v.payee__v` ← `Payee_vod__c`), confirmed by `describeGlobal`/`describe` at preflight; the module is auto-disabled with `warning SF_OBJECT_MISSING` when the org has no EM expenses (`objects.expense_header.optional = true` by default). Loaded with `noTriggers = true` (Vault EM expense triggers roll amounts into `em_event__v.actual_cost__v`, which is loaded verbatim). Status `Status_vod__c` → `expense_header_status__v` `[OBS]`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Event_vod__c` (ref→EM_Event) `[UNVERIFIED-SOURCE]` | `event__v` | `ref(em_event)` | Y | OBS | N | |
| `Name` | `name__v` | `text` (autoNumber rule, Block S) | y? | OBS | N | |
| `Payee_vod__c` (ref→ EM_Attendee / EM_Event_Speaker / Account / Venue — polymorphic in Veeva CRM by separate lookups) `[UNVERIFIED-SOURCE]`: `Incurred_Expense_Attendee_vod__c`, `Incurred_Expense_Speaker_vod__c`, `Incurred_Expense_Venue_vod__c`, `Payee_Account_vod__c`, `Payee_Venue_vod__c` | `payee__v` (text/picklist of payee kind `[UNV type]`), `incurred_expense_attendee__v` (`ref(em_attendee)`), `incurred_expense_speaker__v` (`ref(em_event_speaker)`), `incurred_expense_venue__v` (`ref(em_venue)`), `payee_account__v` (`ref(account)`), `payee_venue__v` (`ref(em_venue)`) | `ref(...)` / `picklist` | n | OBS | N | exactly the observed target field set |
| `Status_vod__c` `[UNVERIFIED-SOURCE]` | `expense_header_status__v` | `picklist(expense_header.status)` | y? | OBS | Y | |
| `Payment_Date_vod__c` (date) `[UNVERIFIED-SOURCE]` | `payment_date__v` | `date` | n | OBS | N | secondary scope date |
| amounts (`Actual_vod__c`, `Committed_vod__c`, currency) `[UNVERIFIED-SOURCE]` | `actual__v`, `committed__v` + `local_currency__sys` | `number` + `currency` | n | OBS (on expense_line; on header `[UNV]`) | N | |
| `OwnerId` | `ownerid__v` (if present) | `refUser` | n | UNV | N | |

#### 6.3.25b `expense_line` — `Expense_Line_vod__c` `[UNVERIFIED-SOURCE object]` → `expense_line__v` `[OBS]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Expense_Header_vod__c` (MD) `[UNVERIFIED-SOURCE]` | `expense_header__v` | `ref(expense_header)` | Y | OBS | N | |
| `Event_vod__c` (ref→EM_Event) `[UNVERIFIED-SOURCE]` | `event__v` | `ref(em_event)` | y? | OBS | N | derived from the header when absent |
| `Event_Budget_vod__c` (ref→EM_Event_Budget) `[UNVERIFIED-SOURCE]` | `event_budget__v` | omit+count `EM_BUDGET_REF_DROPPED` (§6.2.1) | n | OBS | N | |
| `Expense_Type_vod__c` (ref→EM_Catalog expense type) / `Expense_Type_Name_vod__c` `[UNVERIFIED-SOURCE]` | `expense_type__v` (`ref(em_catalog)` when the target is an object reference to `em_catalog__v`, else picklist), `expense_type_name__v` (text snapshot) | `ref`/`picklist`/`text` | y? | OBS | Y | |
| `Actual_vod__c`, `Committed_vod__c` (currency) `[UNVERIFIED-SOURCE]` | `actual__v`, `committed__v` + `local_currency__sys` | `number` + `currency` | y? (actual) | OBS | N | |
| `Description_vod__c` `[UNVERIFIED-SOURCE]` | `description__v` | `longtext` | n | OBS | N | |
| `Name` | `name__v` | autoNumber rule | y? | OBS | N | |

#### 6.3.26 `medical_event` — `Medical_Event_vod__c` → `medical_event__v` `[DOC]` (legacy events; shadows of EM events since 18R1 — migrate rows within scope or referenced by calls/discussions)
Object types: `Award_vod, Congress_vod, Investigator_Meeting_vod, Medical_Event_vod, Round_Table_vod, Satellite_Symposium_vod, Speaker_Program_vod, Workshop_vod` → `award__v`, `congress__v`, … (UNV).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Name` | `name__v` | `text` | Y | UNV | N | |
| `Account_vod__c` (ref→Account), `Address_vod__c` (ref→Address) | `account__v`, `address__v` | `ref` | n | UNV | N | |
| `EM_Event_vod__c` (ref→EM_Event, back-link) | `em_event__v` | `ref(em_event)` | n | UNV | N | |
| `Start_Date_vod__c`, `End_Date_vod__c` (date); `Start_Time_vod__c`, `End_Time_vod__c` (datetime) | `start_date__v`, `end_date__v`, `start_time__v`, `end_time__v` | `date`/`datetime` | Y (start date) | UNV | N | |
| `Active_vod__c` (boolean), `Alternate_Name_vod__c`, `Event_Display_Name_vod__c`, `Description_vod__c`, `Sponsor_vod__c`, `Country_Name_vod__c` (text), `Web_Source_vod__c` | `active__v`, `alternate_name__v`, `event_display_name__v`, `description__v`, `sponsor__v`, `country_name__v`, `web_source__v` | as types | n | UNV | N | |
| expense fields `Expense_Amount_vod__c` (currency), `Expense_Post_Status_vod__c`, `Expense_System_External_ID_vod__c`, `Concur_Report_Name_vod__c`, `Submit_Expense_vod__c`; attendee field-config blobs; cobrowse fields | same `__v` | as types | n | UNV | N | |
| `OwnerId` | `ownerid__v` | `refUser` | y? | UNV | N | |
| Skip: `Status_vod__c`, `Topic_vod__c` (formulas), `zvod_Cobrowse_vod__c` | — | `skip` | — | — | N | |

#### 6.3.27 `event_attendee` — `Event_Attendee_vod__c` → `event_attendee__v` `[OBS object]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Medical_Event_vod__c` (MD) | `medical_event__v` | `ref(medical_event)` | Y | UNV | N | |
| `Account_vod__c` / `User_vod__c` / `Contact_vod__c` | `account__v` / `user__v` / — | `ref(account)` / `refUser` / drop | y? | UNV | N | |
| `EM_Attendee_vod__c`, `EM_Event_Speaker_vod__c` (ref) | `em_attendee__v`, `em_event_speaker__v` | `ref(...)` | n | UNV | N | |
| `Status_vod__c` {Proposed, Invited, Accepted, Rejected, Attended, Did Not Attend, HQ Rejected, Confirmed, Signed_vod, Cleared_Signature_vod} | `event_attendee_status__v` / `status__v` | `picklist(event_attendee.status)` | n | UNV | N | mixed naming — explicit crosswalk |
| `Position_vod__c` {Award_Winner_vod, Chair_Person_vod, Organizer_vod, Participant_vod, Speaker_vod} | `position__v` | `picklist` | n | UNV | N | |
| `Walk_In_Status_vod__c`, `Start_Date_vod__c`, `Talk_Title_vod__c`, name/contact/address fields, `Expense_*`, `Cobrowse_*` | same `__v` | as types | n | UNV | N | |
| `Signature_vod__c`, `Signature_Datetime_vod__c` | `signature__v`, `signature_datetime__v` | `deferredBlob`, `datetime` | n | UNV | N | |

#### 6.3.28 `account_plan` — `Account_Plan_vod__c` → `account_plan__v` `[DOC]`
Object type `Account_Plan_vod → account_plan__v` (UNV).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (ref→Account) | `account__v` | `ref(account)` | Y | UNV | N | |
| `Name` | `name__v` | `text` | Y | UNV | N | |
| `Active_vod__c` (boolean), `Description_vod__c` | `active__v`, `description__v` | `bool`/`longtext` | n | UNV | N | |
| `OwnerId` | `ownerid__v` | `refUser` | y? | UNV | N | |
| `Total_Plan_Tactics_vod__c`, `Completed_Plan_Tactics_vod__c`, `Percent_Complete_vod__c`, `Plan_Tactic_Progress_vod__c` | — | `skip` (roll-ups) | — | UNV | N | |
| children `Account_Tactic_vod__c`, `Plan_Tactic_vod__c`, `Call_Objective_vod__c` | `account_tactic__v`, `plan_tactic__v`, `call_objective__v` | out of v1 | — | DOC (call objectives) | N | |

#### 6.3.29 `medical_inquiry` — `Medical_Inquiry_vod__c` → `medical_inquiry__v` `[DOC]`
Cyclic with `call2` (`Call2_vod__c` ↔ `Call2_vod__c.Medical_Inquiry_vod__c`): load inquiries with `call2__v` omitted, patch after calls.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (MD or lookup) | `account__v` | `ref(account)` | Y | DOC | N | |
| `Call2_vod__c` (ref→Call2) | `call2__v` | `ref(call2)` `secondPass` | n | UNV | N | |
| `Assign_To_User_vod__c` (ref→User) | `assign_to_user__v` | `refUser` | n | UNV | N | |
| `Inquiry_Text__c` (documented name, no `_vod`) / `Rich_Text_Inquiry__c`? | `inquiry_text__v`? | `longtext` | y? | UNV | N | confirm both names via describe/metadata |
| `Product_vod__c` (newer) | `product__v` | `ref(product)` | n | DOC | N | |
| `Status_vod__c` {New_vod, Saved_vod, Submitted_vod, Closed} | `medical_inquiry_status__v` / `status__v` + `state__v` if lifecycled | `picklist` (`new__v`, `saved__v`, `submitted__v`, `closed__c`?) + `state` | Y | UNV | N | |
| `Fulfillment_Status_vod__c` {New_vod, Assigned_vod, Completed_vod}, `Fulfillment_Created_vod__c`, `Previously_Submitted_vod__c` | `fulfillment_status__v`, `fulfillment_created__v`, `previously_submitted__v` | `picklist`/`bool` | n | UNV | N | |
| `Delivery_Method_vod__c` {Email_vod, Phone_vod, Mail_vod, Fax_vod, Urgent_Mail_vod, +customer} | `delivery_method__v` | `picklist(medical_inquiry.deliveryMethod)` | n | DOC (field) | Y | |
| `Email_vod__c`, `Phone_Number_vod__c`, `Fax_Number_vod__c`, `Address_Line_1/2_vod__c`, `City_vod__c`, `State_vod__c` (picklist US), `Zip_vod__c`, `Country_vod__c` (mixed codes/names) | `email__v`, `phone_number__v`, `fax_number__v`, `address_line_1__v`, `address_line_2__v`, `city__v`, `state__v`, `zip__v`, `country__v` | `text`/`picklist`; `custom(normaliseCountry)` → ISO-2 first | n | UNV | Y | |
| `Group_Identifier_vod__c` (EXTID 100), `Group_Count_vod__c`, `Entity_Reference_Id_vod__c` (20) | `group_identifier__v`, `group_count__v`, `entity_reference_id__v` | `copy`/`number` | n | UNV | N | |
| `Signature_vod__c`, `Signature_Date_vod__c`, `Disclaimer_vod__c`, `Request_Receipt_vod__c`, `Receipt_Email_vod__c`, `Submitted_By_Mobile_vod__c` | `signature__v` (`deferredBlob`), `signature_date__v`, `disclaimer__v`, `request_receipt__v`, `receipt_email__v`, `submitted_by_mobile__v` | as types | n | UNV | N | |
| `OwnerId` | `ownerid__v` | `refUser` | y? | UNV | N | |
| Skip: `zvod_Delivery_Method_vod__c`, `zvod_Disclaimer_vod__c` | — | `skip` | — | — | N | |

#### 6.3.30 `call2` — `Call2_vod__c` → `call2__v` `[DOC object; every field UNV]`
Group calls: attendee rows are child `call2__v` rows with `parent_call__v`. Object types: `CallReport_vod → call_report__v`? (unknown casing — resolved by label), `Event_vod → event__v`, `MSLMeetingBrief_vod → mslmeetingbrief__v`, `MeetingBrief_vod → meetingbrief__v`, `Medical_Inquiry_Fulfillment_vod → medical_inquiry_fulfillment__v`. Business status `Status_vod__c` {Planned_vod, Saved_vod, Submitted_vod} → `call2_status__v` (pattern) or `status__v` (preflight picks the field whose picklist contains `submitted__v`-like values) + lifecycle `state__v` if `available_lifecycles` non-empty (`call2.state` crosswalk, e.g. `Submitted_vod → submitted_state__v` UNV). **Submitted calls must be loaded in migration mode with `noTriggers = true`** and their sample rows and sample transactions loaded explicitly (§6.3.34).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `RecordType.DeveloperName` | `object_type__v.api_name__v` | `objectType(call2.objectType)` | Y | UNV | N | |
| `Name` | `name__v` | `text` | Y | UNV | N | may be system-managed → migration mode |
| `Status_vod__c` | `call2_status__v`/`status__v` + `state__v` | `picklist(call2.status)` + `state(call2.state)` | Y | UNV | N | `planned__v`, `saved__v`, `submitted__v` |
| `Call_Date_vod__c` (date) | `call_date__v` | `date` | Y | UNV | N | **never recomputed** from datetime (device-local derivation) |
| `Call_Datetime_vod__c` (datetime) | `call_datetime__v` | `datetime` | y? | UNV | N | |
| `Account_vod__c` (ref→Account) | `account__v` | `ref(account)` | y? | UNV | N | required unless attendee row of type User/Contact |
| `Contact_vod__c` (ref→Contact) | — | drop / person-account mapping | — | — | N | `CONTACT_REF_DROPPED` |
| `User_vod__c` (ref→User, the rep) | `user__v` | `refUser` | y? | UNV | N | |
| `OwnerId` | `ownerid__v` | `refUser` (queue → rep) | y? | UNV | N | |
| `Parent_Call_vod__c` (ref→self), `Parent_Call_Mobile_ID_vod__c` (text) | `parent_call__v`, `parent_call_mobile_id__v` | `ref(call2)` (parents loaded first; `secondPass` fallback), `copy` | n | UNV | N | |
| `Child_Account_vod__c` (ref→Child_Account), `Child_Account_Id_vod__c` (text) | `child_account__v`, `child_account_id__v` | `ref(child_account)`, `copy` | n | UNV | N | |
| `Location_Name_vod__c` (ref→Account), `Location_Id_vod__c`, `Location_vod__c` (text 128) | `location_name__v`, `location_id__v`, `location__v` | `ref(account)`, `copy`, `text` | n | UNV | N | |
| `Ship_To_Location_vod__c` (ref→Account); `Ship_To_Address_vod__c`, `Parent_Address_vod__c`, `DEA_Address_vod__c` (ref→Address) | `ship_to_location__v`, `ship_to_address__v`, `parent_address__v`, `dea_address__v` | `ref(account)` / `ref(address)` | n | UNV | N | |
| `Address_vod__c` (longtext 500, **text snapshot**), `Address_Line_1_vod__c`, `Address_Line_2_vod__c`, `City_vod__c`, `State_vod__c` (text 10), `Zip_vod__c`, `Zip_4_vod__c` | `address__v` (text — verify type; if `Object`, omit and report), `address_line_1__v`, `address_line_2__v`, `city__v`, `state__v`, `zip__v`, `zip_4__v` | `text` verbatim | n | UNV | N | PDMA evidence — never recomputed from current address |
| `Territory_vod__c` (text 100) | `territory__v` | `territoryRef` (text if target is `String`) | n | UNV | N | |
| `Call_Type_vod__c` (picklist, system-maintained: Detail Only, Detail with Sample, Group Detail, …) | `call_type__v` | `picklist(call2.callType)` — or `skip` when `objects.call2.loadCallType = false` (let Vault derive) | n | UNV | N | plain-English values → validate |
| `Call_Channel_vod__c` (newer) {Face_to_face_vod, Phone_vod, Video_vod, …} | `call_channel__v` | `picklist(call2.callChannel)` (`face_to_face__v`, `phone__v`, `video__v`) | n | UNV | Y | |
| `Attendee_Type_vod__c` {Group_Account_vod, Contact_vod, Person_Account_vod, User_vod, Event_vod, Business_Account_vod} | `attendee_type__v` | `picklist` (`person_account__v`…) | n | UNV | N | |
| `EM_Event_vod__c`, `Medical_Event_vod__c`, `Medical_Inquiry_vod__c`, `Account_Plan_vod__c` (ref) | `em_event__v`, `medical_event__v`, `medical_inquiry__v`, `account_plan__v` | `ref(...)`; `medical_inquiry__v` `secondPass` when cyclic | n | UNV | N | |
| `Remote_Meeting_vod__c`, `Suggestion_vod__c`, `Cobrowse_MC_Activity_vod__c` (ref→Multichannel_Activity), `Supervising_Physician_vod__c` (ref→Account_Authorization) | `remote_meeting__v`, `suggestion__v`, `cobrowse_mc_activity__v`, `supervising_physician__v` | omitted in v1 except `cobrowse_mc_activity__v` = `ref(multichannel_activity)` `secondPass` | n | UNV | N | |
| `Error_Reference_Call_vod__c` (ref→self), `Assigner_vod__c` (ref→User), `Assignment_Datetime_vod__c` | `error_reference_call__v`, `assigner__v`, `assignment_datetime__v` | `ref(call2)` `secondPass`, `refUser`, `datetime` | n | UNV | N | |
| `Product_Priority_1..5_vod__c` (ref→Product) | `product_priority_1__v`…`product_priority_5__v` | `ref(product)` | n | UNV | N | |
| `Signature_vod__c` (base64 longtext), `Signature_Date_vod__c` (datetime), `Signature_Page_Image_vod__c`, `Signature_Timestamp_vod__c` (number), `Signature_Location_Latitude/Longitude_vod__c`, `Location_Services_Status_vod__c` | `signature__v` (`deferredBlob`), `signature_date__v`, `signature_page_image__v`, `signature_timestamp__v`, `signature_location_latitude__v`, `signature_location_longitude__v`, `location_services_status__v` | as types | n | UNV | Y (US mandatory) | PDMA — never dropped for US |
| `Next_Call_Notes_vod__c`, `Pre_Call_Notes_vod__c` (textarea), `Call_Comments_vod__c` (32000) | `next_call_notes__v`, `pre_call_notes__v`, `call_comments__v` | `longtext` | n | UNV | N | |
| `Detailed_Products_vod__c` (textarea, `;` names), `Presentations_vod__c`, `Add_Detail_vod__c`, `Add_Key_Message_vod__c`, `Allowed_Products_vod__c`, `Attendee_list_vod__c`, `Attendees_vod__c`, `Total_Attendee_vod__c` | same `__v` | `longtext`/`text`/`number` verbatim (trigger-maintained in Vault; loaded verbatim under NoTriggers) | n | UNV | N | |
| `Duration_vod__c` (number), `Subject_vod__c` (128) | `duration__v`, `subject__v` | `number`/`text` | n | UNV | N | |
| `Is_Sampled_Call_vod__c`, `CLM_vod__c` `[DOC clm__v]`, `Submitted_By_Mobile_vod__c`, `Request_Receipt_vod__c`, `No_Disbursement_vod__c`, `Incurred_Expense_vod__c` (boolean), `Receipt_Email_vod__c` | `is_sampled_call__v`, `clm__v`, `submitted_by_mobile__v`, `request_receipt__v`, `no_disbursement__v`, `incurred_expense__v`, `receipt_email__v` | `bool`/`text` | n | DOC/UNV | N | |
| licence/sample snapshot: `License_vod__c`, `License_Status_vod__c`, `License_Expiration_Date_vod__c`, `DEA_vod__c`, `DEA_Expiration_Date_vod__c`, `DEA_Address_Line_1/2_vod__c`, `DEA_City/State/Zip/Zip_4_vod__c`, `CDS_vod__c`, `CDS_Expiration_Date_vod__c`, `ASSMCA_vod__c`, `Ship_*_vod__c` (14), `Disbursed_To_vod__c`, `Sample_Card_vod__c`, `Sample_Send_Card_vod__c`, `Sample_Card_Reason_vod__c`, `Credentials_vod__c`, `Salutation_vod__c`, `Supervising_Physician_Name/License/Credential_vod__c`, `Disclaimer_vod__c` | same `__v` | verbatim (`text`/`date`/`bool`) | n | UNV | Y (US) | PDMA evidence |
| expense: `Expense_Amount_vod__c` (currency), `Expense_Attendee_Type_vod__c`, `Expense_Post_Status_vod__c`, `Expense_System_External_ID_vod__c`, `Concur_Report_Name_vod__c`, `Total_Expense_Attendees_Count_vod__c`, `Entity_Reference_Id_vod__c` | same `__v` + `local_currency__sys` | as types | n | UNV | N | |
| device/geo: `Check_In_*`, `Submit_*`, `CLM_Location_*`, `Color_vod__c` | same `__v` | optional (`objects.call2.loadDeviceFields`, default false) | n | UNV | N | |
| Skip: `Is_Parent_Call_vod__c`, `Entity_Display_Name_vod__c`, `Ship_To_Address_Text_vod__c`, `Signature_on_Sync_vod__c` (formulas), `zvod_*` (11) | — | `skip` | — | — | N | `Unlock_vod__c` → `unlock__v` `[OBS on call2__v]` follows the Block S rule: skipped unless `objects.call2.loadUnlockFlag = true` |

#### 6.3.31 `call2_detail` — `Call2_Detail_vod__c` → `call2_detail__v` `[DOC]`
Common to all call children: `Call2_vod__c` (MD) → `call2__v` `ref(call2)` (Y); `Attendee_Type_vod__c` → `attendee_type__v`; `Override_Lock_vod__c` → `override_lock__v`; `Entity_Reference_Id_vod__c` → `entity_reference_id__v`; `Call2_Mobile_ID_vod__c` (text) → `call2_mobile_id__v`; `Is_Parent_Call_vod__c` formula skipped.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Product_vod__c` (ref→Product) | `product__v` | `ref(product)` | Y | DOC | N | |
| `Detail_Group_vod__c` (ref→Product) | `detail_group__v` | `ref(product)` | n | DOC | N | |
| `Type_vod__c` {EDetail_vod, Paper_Detail_vod} | `type__v` | `picklist` (`edetail__v` `[DOC]`, `paper_detail__v`) | n | DOC | N | |
| `Detail_Priority_vod__c` (number), `Detail_Priority_Text_vod__c` | `detail_priority__v`, `detail_priority_text__v` | `number`/`text` | n | DOC/UNV | N | |
| `Name` | `name__v` | `text` (likely system-managed) | y? | UNV | N | |

#### 6.3.32 `call2_discussion` — `Call2_Discussion_vod__c` → `call2_discussion__v` `[DOC]`
Object types `CallReport_vod, Event_vod, MSLMeetingBrief_vod, MeetingBrief_vod` (+ `medical_discussion__v` `[DOC]`).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Product_vod__c`, `Detail_Group_vod__c` | `product__v`, `detail_group__v` | `ref(product)` | n | DOC | N | |
| `Account_vod__c`, `User_vod__c` | `account__v`, `user__v` | `ref(account)`, `refUser` | n | UNV | N | |
| `Contact_vod__c` | — | drop | — | — | N | |
| `Call_Date_vod__c` (date) | `call_date__v` | `date` | n | UNV | N | |
| `Product_Strategy_vod__c`, `Product_Tactic_vod__c`, `Account_Tactic_vod__c` (ref) | `product_strategy__v`, `product_tactic__v`, `account_tactic__v` | omitted in v1 | n | UNV | N | |
| `Medical_Event_vod__c` (ref) | `medical_event__v` | `ref(medical_event)` | n | DOC | N | |
| `Discussion_vod__c` + customer discussion `__c` fields | `discussion__v`, same `__c` | `longtext`/per type | n | UNV | Y | discover via describe |
| Skip `zvod_Product_Map_vod__c` | — | `skip` | — | — | N | |

#### 6.3.33 `call2_key_message` — `Call2_Key_Message_vod__c` → `call2_key_message__v` `[DOC]` (custom `__c` fields unsupported on this object `[DOC]`)

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Key_Message_vod__c` (ref) | `key_message__v` | `ref(key_message)` | y? | DOC | N | |
| `Clm_Presentation_vod__c` (ref) | `clm_presentation__v` | `ref(clm_presentation)` — **only if the target field is an object reference** (document-model vaults have a document reference → omit, keep `clm_presentation_name__v`/`presentation_id__v` text) | n | DOC | N | |
| `Product_vod__c`, `Detail_Group_vod__c`, `Account_vod__c`, `User_vod__c` | `product__v`, `detail_group__v`, `account__v`, `user__v` | `ref`/`refUser` | n | UNV | N | |
| `Call_Date_vod__c` (date), `Start_Time_vod__c` (datetime), `Duration_vod__c` (number), `Display_Order_vod__c` | `call_date__v`, `start_time__v`, `duration__v`, `display_order__v` | as types | n | UNV | N | |
| `Reaction_vod__c` {Positive, Neutral, Negative}, `Vehicle_vod__c`, `Category_vod__c` {Efficacy, Safety, …} | `reaction__v` `[DOC]`, `vehicle__v` `[DOC]`, `category__v` | `picklist` (`positive__v`…) | n | DOC/UNV | N | |
| `Key_Message_Name_vod__c`, `Clm_Presentation_Name_vod__c`, `Clm_Presentation_Version_vod__c`, `Slide_Version_vod__c`, `Presentation_ID_vod__c`, `CLM_ID_vod__c` `[DOC clm_id__v]`, `Segment_vod__c`, `Entity_Reference_KM_Id_vod__c` | same `__v` | `text` | n | DOC/UNV | N | text snapshots — verbatim |

#### 6.3.34 `call2_sample` — `Call2_Sample_vod__c` → `call2_sample__v` `[UNV object]`
In Veeva CRM a trigger created `Sample_Transaction_vod__c` from these rows for `Product_Type ∈ {Sample, Alternative Sample, High Value Promotional}`; Vault does the same on submit. Which side is loaded with triggers is decided **once per country** by `objects.sample_transaction.load.sampleStrategy` (§6.3.35) — never both with triggers on (double inventory). Under `noTriggersRecalc` and `noTriggersVerify` this object is loaded with NoTriggers; under `triggersOnTransactions` it is loaded with NoTriggers too (its trigger would *create* transactions that are then loaded explicitly); under `triggersOnCallSamples` it is loaded **with** triggers and `sample_transaction` disbursement rows are *not* loaded (they are regenerated), other transaction types still are.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Product_vod__c` (ref) | `product__v` | `ref(product)` | Y | UNV | N | |
| `Account_vod__c` | `account__v` | `ref(account)` | n | UNV | N | |
| `Call_Date_vod__c` (date, REQ) | `call_date__v` | `date` | Y | UNV | N | |
| `Quantity_vod__c` (number, REQ) | `quantity__v` | `number` | Y | UNV | N | |
| `Lot_vod__c` (text 80, lot **name**) | `lot__v` (text) | `text` | n | UNV | N | not the lot FK |
| `Amount_vod__c`, `Product_Value_vod__c` (currency) | `amount__v`, `product_value__v` + `local_currency__sys` | `number` + `currency` | n | UNV | N | |
| `Manufacturer_vod__c`, `Distributor_vod__c` (text) | `manufacturer__v`, `distributor__v` | `text` | n | UNV | N | |
| `Delivery_Status_vod__c` {In_Progress_vod, Shipped_vod, Delivered_vod, Cancel_Request_vod, Cancelled_vod}, `Cold_Chain_Status_vod__c` {In Range, Not In Range} | `delivery_status__v`, `cold_chain_status__v` | `picklist` | n | UNV | N | |
| `Apply_Limit_vod__c`, `Limit_Applied_vod__c` (boolean), `Custom_Text_vod__c`, `Tag_Alert_Number_vod__c` | same `__v` | `bool`/`text` | n | UNV | N | |

#### 6.3.35 `sample_transaction` — `Sample_Transaction_vod__c` → `sample_transaction__v` `[DOC]`
Object types `Adjustment_vod → adjustment__v`, `Disbursement_vod → disbursement__v`, `Receipt_vod → receipt__v`, `Return_vod → return__v`, `Transfer_vod → transfer__v` (UNV). Status `Status_vod__c` {Saved_vod, Submitted_vod, In_Progress_vod} → `sample_transaction_status__v`/`status__v` + `state__v` (migration mode).

**Sample load strategy** (`objects.sample_transaction.load.sampleStrategy`, per country; applies jointly to `sample_transaction`, `call2_sample`, `sample_inventory*`, `sample_lot`). best-practices.md §6.3 warns: *never load sample transactions with NoTriggers unless the resulting inventory roll-ups are explicitly reloaded* — and the roll-up recalculation endpoint is `[UNVERIFIED]` (§2.5.6, §9 #19). The strategy therefore always pairs a load mode with a **verification** and a **fallback**:

| Strategy | Load | Roll-up handling | Preflight requirement |
|---|---|---|---|
| `noTriggersRecalc` (**default**) | `sample_transaction` + `call2_sample` with `noTriggers = true`, `state__v` submitted | `postLoad.recalculateRollups` action per object (`sample_lot__v`, `sample_inventory__v`) after the unit | recalc action **must** be present (probe 17) → otherwise the strategy is automatically downgraded to `noTriggersVerify` with `warning SAMPLE_STRATEGY_DOWNGRADED`; in the US overlay (`postLoad.recalculateRollups = required`) the miss is **blocking** `VT_ROLLUP_RECALC_UNAVAILABLE` unless the overlay names an explicit fallback strategy |
| `noTriggersVerify` | as above | no recalc call; **VQL verification** instead: for every touched `sample_lot__v`, `calculated_quantity__v` (read back) must equal the SFDC `Calculated_Quantity_vod__c` extracted with the lot (§6.3.18) **and** the tool's own recomputation Σ(signed `quantity__v` of loaded submitted transactions by object type: receipt/transfer-in +, disbursement/transfer-out/return −, adjustment ±) — mismatch → `RECON_SAMPLE_ROLLUP_MISMATCH` per lot, **gate-blocking for units with `sampleRetentionMonths` set** (US) and `warning` elsewhere; the report lists lots for a manual `Adjustment` or a Vault-side recalc by the admin | none |
| `triggersOnTransactions` | `sample_transaction` loaded **with triggers** (`noTriggers = false`, migration mode still on for `state__v`/audit) so Vault maintains `sample_lot__v`/inventory roll-ups itself; `call2_sample` with `noTriggers = true` (prevents duplicate transaction generation) | Vault-maintained; verification as in `noTriggersVerify` still runs (cheap) | `VT_TRIGGER_RISK` info only; the Vault CRM sample triggers may also *reject* historical rows (lot inactive/expired, user mismatch) → such rows are `failed(TRIGGER_REJECTED)` and re-tried automatically under `noTriggersVerify` for that batch (`load.sampleTriggerRejectFallback = true`, default) |
| `triggersOnCallSamples` | `call2_sample` with triggers so Vault regenerates *disbursement* transactions from submitted calls; `sample_transaction` loaded for **non-disbursement types only** (`Type_vod__c != 'Disbursement_vod'`) with triggers on | Vault-maintained | only meaningful when the org's `Sample_Transaction_vod__c` disbursements are pure trigger output (no manual edits); the tool checks a sample of 200 disbursements against their `call2_sample` rows (`quantity`, `lot`, `product`) and refuses the strategy with `blocking SAMPLE_DISBURSEMENT_DIVERGED` when > 0.1 % differ |

The US overlay in §7.4.1 sets `sampleStrategy: noTriggersRecalc` with `fallbackStrategy: triggersOnTransactions` so that the load never silently proceeds with unreloaded roll-ups. Whatever the strategy, `verify --samples` re-runs the VQL roll-up check on demand.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `RecordType.DeveloperName` / `Type_vod__c` | `object_type__v.api_name__v` / `type__v` | `objectType` / `picklist` | Y | UNV | N | |
| `Lot_vod__c` (MD→Sample_Lot) | `lot__v` | `ref(sample_lot)` | Y | UNV | N | |
| `Account_vod__c` (ref) | `account__v` | `ref(account)` | n (Y for disbursement) | UNV | N | |
| `Quantity_vod__c`, `Confirmed_Quantity_vod__c` (number), `U_M_vod__c` {Cases, Boxes, Units} | `quantity__v`, `confirmed_quantity__v`, `u_m__v` | `number`/`picklist` | Y (qty) | UNV | Y | |
| `Status_vod__c` | `sample_transaction_status__v`/`status__v` + `state__v` | `picklist` + `state(sample_transaction.state)` | Y | UNV | N | |
| `Call_Date_vod__c` (date), `Call_Datetime_vod__c`, `Call_Name_vod__c` (100), newer `Call2_vod__c`/`Call_Sample_vod__c` (ref) | `call_date__v`, `call_datetime__v`, `call_name__v`, `call2__v`?, `call_sample__v`? | as types; `ref(call2)`, `ref(call2_sample)` when present | n | UNV | N | |
| `Transfer_To_vod__c`, `Transferred_From_vod__c`, `Adjust_For_vod__c` (ref→User); `Transfer_To_Name_vod__c`, `Transferred_From_Name_vod__c` | `transfer_to__v`, `transferred_from__v`, `adjust_for__v`, `transfer_to_name__v`, `transferred_from_name__v` | `refUser`/`text` | n | UNV | N | |
| `Transferred_Date_vod__c`, `Adjusted_Date_vod__c`, `Submitted_Date_vod__c` (date), `Signature_Date_vod__c` (datetime) | same `__v` | `date`/`datetime` | n | UNV | N | scope fields per type |
| `Ref_Transaction_Id_vod__c` (ref→self) | `ref_transaction_id__v` | `ref(sample_transaction)` `secondPass` | n | UNV | N | |
| `Group_Transaction_Id_vod__c` (EXTID 255), `Shipment_ID_vod__c`, `Sample_Card_vod__c`, `Sample_Card_Reason_vod__c` | same `__v` | `copy` | n | UNV | N | |
| `Reason_vod__c` (20 plain-English values), `Return_To_vod__c` {HQ}, `Received_vod__c` (boolean), `Receipt_Comments_vod__c`, `Comments_vod__c`, `Request_Receipt_vod__c`, `Cold_Chain_Status_vod__c`, `Tag_Alert_Number_vod__c`, `Custom_Text_vod__c`, `Manufacturer_vod__c`, `Distributor_vod__c`, `Lot_Name_vod__c`, `Sample_vod__c` | same `__v` | `picklist`/`text`/`bool` | n | UNV | Y (reason) | |
| `OwnerId` | `ownerid__v` | `refUser` | y? | UNV | N | |
| signature + address/licence snapshot (`Signature_vod__c`, `Signature_Page_Display_Name_vod__c`, `Address_Line_1/2`, `City`, `State_vod__c` (picklist US), `Zip_vod__c` (6), `Zip_4`, `License*`, `DEA*`, `CDS*`, `ASSMCA`, `Credentials_vod__c`, `Salutation_vod__c`, `Disbursed_To_vod__c`, `Disclaimer_vod__c`) | same `__v` | verbatim; `signature__v` `deferredBlob` | n | UNV | Y (US) | PDMA |
| Skip: `Unlock_vod__c`, `zvod_Sample_Lines_vod__c`, formulas `Discrepancy_vod__c`, `Inventory_Impact_Quantity_vod__c`, `Group_Identifier_vod__c` | — | `skip` | — | — | N | |

#### 6.3.36 `sample_inventory` — `Sample_Inventory_vod__c` → `sample_inventory__v` `[DOC]` and 6.3.37 `sample_inventory_item` — `Sample_Inventory_Item_vod__c` → `sample_inventory_item__v` `[UNV]`

| Object | Source (type) | Target | Transform | Req | Ev | CC |
|---|---|---|---|---|---|---|
| sample_inventory | `Inventory_For_vod__c` (ref→User) | `inventory_for__v` | `refUser` | Y | UNV | N |
| sample_inventory | `Inventory_Date_Time_vod__c`, `Inventory_From_Date_vod__c`, `Previous_Inventory_Date_Time_vod__c`, `Submitted_Date_vod__c` | `inventory_date_time__v`, `inventory_from_date__v`, `previous_inventory_date_time__v`, `submitted_date__v` | `datetime`/`date` | Y (date time) | UNV | N |
| sample_inventory | `Status_vod__c`, `Inventory_Type_vod__c` (picklist, customer values) `[DOC field]`, `Submitted_vod__c`, `Audit_vod__c`, `No_Sample_Lots_vod__c` (boolean) | `sample_inventory_status__v`/`status__v` (+ `state__v`), `inventory_type__v`, `submitted__v`, `audit__v`, `no_sample_lots__v` | `picklist`/`bool` | Y (status) | DOC/UNV | Y (type) |
| sample_inventory | `Name`, `OwnerId` | `name__v`, `ownerid__v` | `text`/`refUser` | Y | UNV | N |
| sample_inventory_item | `Sample_Inventory_vod__c` (MD) `[META-implied by sfdc-extract.md §7.12 "lines in Sample_Inventory_Item_vod__c (lookup to Sample_Lot)"]`; the lot lookup name (`Lot_vod__c` or `Sample_Lot_vod__c`), `Quantity_vod__c`, `Product_vod__c`, `Name` are **`[UNVERIFIED-SOURCE]`** (sfdc-extract.md §10 #3) — preflight resolves the lot lookup as *the* reference field whose `referenceTo = Sample_Lot_vod__c` regardless of name | `sample_inventory__v`, `lot__v`, `quantity__v`, `product__v`, `name__v` | `ref`/`number` | Y | UNV | N |

#### 6.3.38 `order` — `Order_vod__c` → `order__v` `[DOC]` and 6.3.39 `order_line` — `Order_Line_vod__c` → `order_line__v` `[DOC]`
Object types `Direct_vod → direct__v`, `Transfer_vod → transfer__v`. Status `Status_vod__c` {Saved_vod, Submitted_vod, Voided…} → `order_status__v`/`status__v` + `state__v`.

| Object | Source (type) | Target | Transform | Req | Ev | CC |
|---|---|---|---|---|---|---|
| order | `Account_vod__c` (ref), `Call2_vod__c` (ref), `Parent_Order_vod__c` (self), `Wholesaler_vod__c` (ref→Account), `Ship_To_Address_vod__c`, `Billing_Address_vod__c` (ref→Address) | `account__v`, `call2__v`, `parent_order__v` (`secondPass`), `wholesaler__v`, `ship_to_address__v`, `billing_address__v` | `ref(...)` | Y (account) | UNV | N |
| order | `Wholesaler_Account_Partner_vod__c`, `Payer_vod__c`, `Price_Book_vod__c`, `Delivery_Location_vod__c` (ref→Account_Partner), `Contract_vod__c`, `Assortment_vod__c`, `Order_Campaign_vod__c` | — | omitted in v1 (objects out of scope) | n | UNV | N |
| order | `Order_Date_vod__c`, `Delivery_Date_vod__c` (date), `DateTime_vod__c`, `Signature_Date_vod__c` (datetime) | `order_date__v` `[DOC]`, `delivery_date__v`, `datetime__v`, `signature_date__v` | `date`/`datetime` | Y (order date) | DOC/UNV | N |
| order | `Status_vod__c`, `Lock_vod__c`, `Master_Order_vod__c`, `Delivery_Order_vod__c` | `order_status__v`/`status__v` + `state__v`, `lock__v`, `master_order__v`, `delivery_order__v` | `picklist`+`state`/`bool` | Y | UNV | N |
| order | `Order_List_Amount_vod__c`, `Order_Net_Amount_vod__c`, `Order_Discount_vod__c`, `Order_Free_Goods_vod__c`, `Order_Total_Quantity_vod__c` (currency/number) | same `__v` + `local_currency__sys` | `number` + `currency` | n | UNV | N |
| order | ship/bill address snapshots, `Notes_vod__c`, `Signature_vod__c` | same `__v`; `signature__v` `deferredBlob` | verbatim | n | UNV | N |
| order | `OwnerId` | `ownerid__v` | `refUser` | y? | UNV | N |
| order | Skip: `List_Amount_vod__c`, `Net_Amount_vod__c` (roll-ups), `Ship_To_Address_Text_vod__c`, `Total_Discount_vod__c` (formulas), `zvod_*` | — | `skip` | — | — | N |
| order_line | `Order_vod__c` (MD), `Product_vod__c`, `Product_Group_vod__c` (ref→**Product**, i.e. the detail-group product row — not `Product_Group_vod__c`) | `order__v`, `product__v`, `product_group__v` (→ `product__v` `[INFER vault-crm-model.md §4.19]`) | `ref(order)`, `ref(product)`, **`ref(product)`** (preflight checks `fields[].object.name = product__v`; if it is `product_group__v` instead, the transform switches to `ref(product_group)` resolved through the `(product__v, detail_group__v)` pair — `info FK_TARGET_SWITCHED`) | Y | UNV | N |
| order_line | `Quantity_vod__c`, `Free_Goods_vod__c`, `List_Price_*`, `Net_Price_*`, `Net_Amount_vod__c`, `List_Amount_vod__c`, `*_Discount_vod__c`, `Payment_*`, `U_M_vod__c`, `Product_Identifier_vod__c` | same `__v` | `number`/`picklist`/`text` | n | UNV | Y (u_m) |
| order_line | Skip `Delivery_Quantity_vod__c` (formula) | — | `skip` | — | — | N |

#### 6.3.40 `sent_email` — `Sent_Email_vod__c` → `sent_email__v` `[DOC]`
Object types (12): `Account_vod → account__v`, `CLM_vod → clm__v`, `Call_vod → call__v`, `Case_vod → case__v`, `CoBrowse_Invite_vod → cobrowse_invite__v`, `Double_Opt_In_vod → double_opt_in__v`, `Email_Receipt_vod → email_receipt__v`, `Events_Management_vod → events_management__v`, `Medical_Event_vod → medical_event__v`, `Medical_Inquiry_vod → medical_inquiry__v`, `Remote_Meeting_vod → remote_meeting__v`, `Suggestion_vod → suggestion__v` (UNV). Status {Scheduled_vod, Group_vod, Saved_vod, Pending_vod, Sent_vod, Delivered_vod, Bounced_vod, Unsubscribed_vod, Failed_vod, Marked_Spam_vod, Dropped_vod, Approved_vod} → `sent_email_status__v`/`status__v` (`scheduled__v`, …).

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (ref) | `account__v` | `ref(account)` | Y | UNV | N | |
| `User_vod__c` (ref→User) | `user__v` | `refUser` | y? | UNV | N | |
| `Approved_Email_Template_vod__c` (ref→Approved_Document) | `approved_email_template__v` | `ref(approved_document)` | y? | UNV | N | |
| `Call2_vod__c`, `Product_vod__c`, `Detail_Group_vod__c`, `Key_Message_vod__c`, `Content_Type_vod__c` (ref) | `call2__v`, `product__v`, `detail_group__v`, `key_message__v`, `content_type__v` | `ref(...)` (content type omitted in v1) | n | UNV | N | |
| `Parent_Email_vod__c` (self) | `parent_email__v` | `ref(sent_email)` `secondPass` | n | UNV | N | |
| `Event_vod__c` (ref→EM_Event), `EM_Attendee_vod__c`, `EM_Event_Speaker_vod__c`, `EM_Event_Team_Member_vod__c`, `Event_Attendee_vod__c`, `Medical_Event_vod__c`, `Medical_Inquiry_vod__c` | `event__v`, `em_attendee__v`, `em_event_speaker__v`, `em_event_team_member__v`, `event_attendee__v`, `medical_event__v`, `medical_inquiry__v` | `ref(...)` | n | UNV | N | |
| `Case_vod__c` (ref→Case), `Suggestion_vod__c` | — | drop / omit | — | — | N | |
| `Email_Sent_Date_vod__c` (datetime), `Scheduled_Send_Datetime_vod__c`, `Capture_Datetime_vod__c`, `MC_Capture_Datetime_vod__c`, `Last_Activity_Date_vod__c` | `email_sent_date__v`, `scheduled_send_datetime__v`, `capture_datetime__v`, `mc_capture_datetime__v`, `last_activity_date__v` | `datetime`/`date` | y? | UNV | N | |
| `Status_vod__c` | `sent_email_status__v`/`status__v` | `picklist(sent_email.status)` | Y | UNV | N | |
| `Account_Email_vod__c`, `Sender_Email_vod__c` (email), `Bcc_vod__c`, `Email_Fragments_vod__c`, `Email_Config_Values_vod__c` `[DOC]`, `User_Input_Text_vod__c` `[DOC]`, `Failure_Msg_vod__c`, `Territory_vod__c` (text), `Valid_Consent_Exists_vod__c` (boolean), `Receipt_Entity_Type_vod__c` {Call_vod, Medical_Inquiry_vod, Order_vod}, `Receipt_Record_Id_vod__c`, `Related_Transaction_ID_vod__c`, `Activity_Tracking_Mode_vod__c` `[DOC]` | same `__v` (`email_config_values__v`, `user_input_text__v`, `activity_tracking_mode__v` DOC) | `text`/`longtext`/`bool`/`picklist`; `Receipt_Record_Id_vod__c` stays a legacy id (text) | n | DOC/UNV | N | |
| `Email_Content_vod__c`, `Email_Content2_vod__c` (131072 each) | `email_content__v`, `email_content2__v` | `deferredBlob` (LongText ≤ 32k; policy `objects.sent_email.contentOverflow = truncate \| skip \| attachment`) | n | UNV | N | |
| Skip roll-ups/formulas: `Open_Count_vod__c`, `Click_Count_vod__c`, `Last_Open/Click_Date_vod__c`, `Opened_vod__c`, `Clicked_vod__c`, `Approved_Document_Views_vod__c`, `Product_Display_vod__c`, `Events_Management_Subtype_vod__c` | — | `skip` | — | — | N | |

#### 6.3.41 `email_activity` — `Email_Activity_vod__c` → `email_activity__v` `[UNV]`

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Sent_Email_vod__c` (ref) | `sent_email__v` | `ref(sent_email)` | Y | UNV | N | |
| `Event_Type_vod__c` (picklist: open/click/…), `Event_Datetime_vod__c` `[DOC sfdc-extract.md §7.15]` | `event_type__v`, `event_datetime__v` | `picklist`/`datetime` | Y (type, datetime) | UNV | N | |
| `URL_vod__c`, `User_Agent_vod__c`, `IP_Address_vod__c` `[UNVERIFIED-SOURCE]` + `objects.email_activity.customFields` | `url__v`, `user_agent__v`, `ip_address__v` | `text` | n | UNV | N | dropped silently when absent; PII (IP) — respect erasure list; `objects.email_activity.loadIpAddress` default `false` in `regions.EU` |

#### 6.3.42 `multichannel_consent` — `Multichannel_Consent_vod__c` → `multichannel_consent__v` `[DOC]`
Never time-scoped. Object types `Approved_Email_vod → approved_email__v` `[DOC]`, `CLM_vod → clm__v`, `Engage_vod → engage__v`, `Sample_Consent_vod → sample_consent__v` (UNV); each must correspond to a `consent_type__v` object type `[DOC]`. Required in Vault `[DOC]`: `channel_value__v`, `opt_type__v` (`opt_in__v`/`opt_out__v`), `optout_event_type__v` when opt-out. Loaded chronologically by `Capture_Datetime_vod__c`.

| Source (type) | Target | Transform | Req | Ev | CC | Notes |
|---|---|---|---|---|---|---|
| `Account_vod__c` (MD) | `account__v` | `ref(account)` | Y | UNV | N | |
| `Consent_Type_vod__c` (ref→`Consent_Type_vod__c`), `Consent_Line_vod__c` (ref→`Consent_Line_vod__c`), `Content_Type_vod__c` (ref→`Content_Type_vod__c`), `Sample_Consent_Template_vod__c` (ref→`Consent_Template_vod__c`) — config objects `[DOC sfdc-extract.md §7.15]`; their **source fields are `[UNVERIFIED-SOURCE]`** (only `Id`, `Name`, `RecordTypeId` are certain; `External_ID_vod__c` `[UNVERIFIED-SOURCE]`) and are extracted read-only (§6.1) | `consent_type__v`, `consent_line__v`, `content_type__v`, `sample_consent_template__v` (→ `consent_template__v`) | **one crosswalk per config object**, `objects.multichannel_consent.configMaps.{consentType, consentLine, contentType, consentTemplate}`; resolution order per SFDC config row: (1) explicit map entry — **key = SFDC 18-char Id** of the config row, value = Vault record id **or** `external_id:<value>` / `name:<value>` (resolved at preflight by VQL, cached); (2) automatic: `External_ID_vod__c` = `external_id__v` when both exist (`refLookup(<target>, external_id__v)`); (3) automatic: `Name` = `name__v` **within the same country and object type** (consent types are per country; ambiguity → blocking); no hit → blocking `VT_CONSENT_CONFIG_UNMATCHED` listing the SFDC row (Id, Name, record type, referencing-row count) so the overlay can be completed. The per-country overlay may key entries by SFDC Id only — human labels are never keys (they are not unique across countries) | Y (type) | DOC | **Y** | consent types are per country; `consent_line__v` must belong to the resolved `consent_type__v` (validated at preflight: `VT_CONSENT_LINE_TYPE_MISMATCH`) |
| `Opt_Type_vod__c` {Opt_In_Pending_vod, Opt_In_vod, Opt_Out_vod} | `opt_type__v` | `picklist` (`opt_in__v`, `opt_out__v` `[DOC]`, `opt_in_pending__v` UNV) | Y | DOC | N | |
| `Optout_Event_Type_vod__c` {Consent_Capture_vod, Unsubscribed_vod, Bounced_vod, Marked_Spam_vod} | `optout_event_type__v` | `picklist` | Y (opt-out) | DOC (field) | N | |
| `Channel_Value_vod__c` (80), `Sub_Channel_Key_vod__c` | `channel_value__v` `[DOC]`, `sub_channel_key__v` | `text` | Y | DOC/UNV | N | |
| `Capture_Datetime_vod__c`, `Consent_Confirm_Datetime_vod__c`, `Signature_Datetime_vod__c` (datetime), `Opt_Expiration_Date_vod__c` (date) | `capture_datetime__v`, `consent_confirm_datetime__v`, `signature_datetime__v`, `opt_expiration_date__v` | `datetime`/`date` | y? (capture) | UNV | N | |
| `Product_vod__c`, `Detail_Group_vod__c`, `Sent_Email_vod__c` (ref) | `product__v`, `detail_group__v`, `sent_email__v` | `ref(...)` | n | UNV | N | |
| `External_ID_vod__c` (unique 120), `Related_Transaction_Id_vod__c`, `Signature_ID_vod__c` | `external_id__v`, `related_transaction_id__v`, `signature_id__v` | `copy` | n | UNV | N | |
| `Signature_vod__c` (131072), `Default_Consent_Text_vod__c`, `Disclaimer_Text_vod__c` (65536) | `signature__v` (`deferredBlob`), `default_consent_text__v`, `disclaimer_text__v` | `deferredBlob`/`longtext` (truncation policy — consent text is evidence: default `fail` → route to attachment) | n | UNV | N | |
| `Activity_Tracking_vod__c`, `Activity_Tracking_Mode_vod__c` (newer) | `activity_tracking__v`, `activity_tracking_mode__v` | `longtext`/`picklist` | n | DOC | N | |
| `Sample_Consent_Template_Data_vod__c` | `sample_consent_template_data__v` | `longtext` | n | UNV | N | |

#### 6.3.43 `multichannel_activity` — `Multichannel_Activity_vod__c` → `multichannel_activity__v` `[UNV]` and 6.3.44 `multichannel_activity_line` — `Multichannel_Activity_Line_vod__c` → `multichannel_activity_line__v` `[UNV]`
Object types `CLM_vod → clm__v`, `Cobrowse_vod → cobrowse__v`, `Engage_vod → engage__v`.

| Object | Source (type) | Target | Transform | Req | Ev | CC |
|---|---|---|---|---|---|---|
| multichannel_activity | `Account_vod__c` (ref) | `account__v` | `ref(account)` | y? | UNV | N |
| multichannel_activity | `Call_vod__c` (ref→Call2 — note the name) | `call__v` | `ref(call2)` | n | UNV | N |
| multichannel_activity | `Sent_Email_vod__c`, `Product_vod__c`, `Detail_Group_vod__c`, `Medical_Event_vod__c`, `Event_Attendee_vod__c` (ref) | `sent_email__v`, `product__v`, `detail_group__v`, `medical_event__v`, `event_attendee__v` | `ref(...)` | n | UNV | N |
| multichannel_activity | `Organizer_vod__c` (ref→User) | `organizer__v` | `refUser` | n | UNV | N |
| multichannel_activity | `Multichannel_Activity_vod__c` (self) | `multichannel_activity__v` | `ref(multichannel_activity)` `secondPass` | n | UNV | N |
| multichannel_activity | `Start_DateTime_vod__c` (datetime), `Total_Duration_vod__c` (number), `Session_Id_vod__c`, `Territory_vod__c` (text), `Saved_For_Later_vod__c` (boolean), `Site_vod__c`, `Account_External_ID_Map_vod__c`, `Record_Type_Name_vod__c` | `start_datetime__v`, `total_duration__v`, `session_id__v`, `territory__v`, `saved_for_later__v`, `site__v`, `account_external_id_map__v`, `record_type_name__v` (or `object_type_name__v`) | as types | Y (start) | UNV | N |
| multichannel_activity | `VExternal_Id_vod__c` (unique), device/geo columns | `vexternal_id__v`, optional | `copy` | n | UNV | N |
| multichannel_activity_line | `Multichannel_Activity_vod__c` (MD), `Key_Message_vod__c`, `Clm_Presentation_vod__c` (ref), `Display_Order_vod__c`, `Duration_vod__c` `[DOC sfdc-extract.md §7.15]`; `Start_DateTime_vod__c`, `Name` **`[UNVERIFIED-SOURCE]`** (sfdc-extract.md §10 #3) | `multichannel_activity__v`, `key_message__v`, `clm_presentation__v`, `display_order__v`, `duration__v`, `start_datetime__v`, `name__v` | `ref`/`number`/`datetime` | Y (parent) | UNV | N |

#### 6.3.45 Worked example — repo sample `docs/samples/veeva-crm-calls-sample.csv` (denormalised call export; useful for tests)
`Id → call2.legacy id`; `Name → name__v`; `Account_vod__c → account__v` (id map); `Territory_vod__c → territory__v` (`territoryRef`); `Call_Date_vod__c/Call_Datetime_vod__c → call_date__v/call_datetime__v`; `Call_Type_vod__c ("Detail Only") → call_type__v` (`detail_only__v` UNV); `Call_Channel_vod__c (Face_to_Face_vod) → call_channel__v` (`face_to_face__v`); `Status_vod__c (Submitted_vod) → status field + state__v`; `Detailed_Products_vod__c → detailed_products__v`; `Sample_Product_vod__c/Sample_Quantity_vod__c/Sample_Lot → call2_sample__v` child rows (`product__v` by name+type, `quantity__v`, `lot__v`); `Next_Call_Notes_vod__c → next_call_notes__v`; `Ownerid → ownerid__v`; `Is_Parent_Call_vod__c → skip`; `Unlock_vod__c → unlock__v` only with `objects.call2.loadUnlockFlag = true`, else skip (Block S — differs from vault-crm-model.md §12, deliberately); `Mobile_Created_Datetime_vod__c → mobile_created_datetime__v`; denormalised columns (`Account_Type`, `Account_Specialty`, `Country`, `Product_Priority`, `Signature_Captured`, `Media_Shown`, `Key_Message_Reaction`, `Attendee_Count`, `Call_Duration_Minutes`, `Created_By_Platform`, `CLM_Key_Message_Count`, `Sample_Dropped`) are not Veeva fields: `Country` drives the unit, `Call_Duration_Minutes → duration__v`, `Attendee_Count → attendees__v`, `Sample_Dropped → is_sampled_call__v`, `Key_Message_Reaction → call2_key_message.reaction__v`, `Created_By_Platform → last_device__v` (`ipad__v`/`online__v`…), others ignored.

---

## 7. Country configuration model

### 7.1 Layering and resolution

```
defaults (tool built-ins)  ←  config.global  ←  config.regions.<REGION>  ←  config.countries.<ISO>
```
Resolution happens at plan time into a fully **materialised** per-(object, country) mapping (`mapping_snapshots`) whose hash is stored on the run. Picklist crosswalk lookup order: `(object, field, country, value)` → `(object, field, region, value)` → `(object, field, '*', value)` → derivation rule (§6.0.2) → `onUnmapped` policy. Field-map entries are merged by target field name: an overlay entry with the same target replaces the global one; `remove: [field]` deletes; `add: [...]` appends; `required: {field: true|false}` adjusts the requirement used by preflight (`VT_REQUIRED_UNMAPPED`) and by row validation.

### 7.2 What can be overridden per country

| Area | Config key (under `countries.<ISO>`) | Semantics |
|---|---|---|
| Scope window | `scope.historyMonths`, `scope.cutoffDate` (explicit ISO date wins), `scope.sampleRetentionMonths`, `scope.tovRetentionMonths`, `scope.objects.<key>.historyMonths` | `sampleRetentionMonths` applies to family `samples` = {`sample_transaction`, `call2_sample`, `sample_inventory`, `sample_inventory_item`, `call2` (only when `scope.samplesIncludeCalls = true`, US default)}; `tovRetentionMonths` applies to family `tov` = {`em_event`, `em_attendee`, `em_event_speaker`, `em_event_team_member`, `expense_header`, `expense_line`} (§6.2 — the expense modules exist precisely so this knob has an object to act on). Both may only **widen** the global window (`max(historyMonths, familyRetention)` per object); narrowing is allowed only for non-regulated objects and logs `SCOPE_NARROWED`. The families are fixed in code (`scope.regulatedFamilies` is read-only in the report) |
| Object enable/disable | `objects.<key>.enabled: false` | unit skipped; FKs into it are omitted (`MAP_FK_PARENT_NOT_IN_PLAN`) |
| Country derivation | `objects.<key>.countryOf` | e.g. a customer country field on Product or Call |
| Field map | `objects.<key>.fields.add[]`, `.override[]` (same shape as a mapping row: `{source, target, transform, required, clearOnNull, truncation}`), `.remove[]` | typical: customer `__c` fields per market, `furigana__v` (JP), `npi__v`/DEA (US), `brick__v` (EU), `cpf__c` (BR) |
| Required fields | `objects.<key>.required: { field: bool }` | preflight per object type honours the override |
| Picklist value maps | `picklists.<object>.<field>: { <sourceValue>: <targetName> \| null }` (`null` = skip value) | specialties, credentials, states/provinces/prefectures, hierarchy types, consent types, delivery methods, product types, reasons |
| Object-type map | `objects.<key>.objectType: { <DeveloperName>: <api_name> }` | customer record types per country |
| State map | `objects.<key>.state: { <status value>: <state api name> }` | lifecycle state names are vault-wide but statuses may differ by country |
| Name templates | `nameTemplates.person`, `.speaker`, `.userTerritory` | `{LastName} {FirstName}`, `{LastName}{FirstName}`, `{Salutation} {FirstName} {LastName}`, tokens `{FirstName}`, `{MiddleName}`, `{LastName}`, `{Suffix}`, `{Salutation}`, `{Furigana}`; `nameTemplates.person.separator` (space / full-width space `　` / none) |
| Date/number formats | `formats.date`, `formats.datetime`, `formats.decimalSeparator`, `formats.thousandsSeparator` | apply **only** to CSV/SQL staging inputs supplied by the customer (§8.6 blob/manual inputs, contact→account CSVs); API values are always ISO/`.` — the API side is never localised |
| Phone normalisation | `phone.normalise: true`, `phone.defaultRegion: 'DE'` | E.164 when unambiguous, pass-through otherwise |
| Postal code | `postalCode.pattern` (regex), `postalCode.onMismatch: warn \| fail` | validation only |
| Address line 1 overflow | `objects.address.line1Overflow` | `truncate` / `spillToLine2` / `fail` |
| Delete policy | `objects.<key>.deletePolicy` | `delete` / `inactivate` / `ignore` |
| Load flags | `objects.<key>.load.noTriggers`, `.load.migrationMode`, `.load.batchSize`, `.load.partitionBy`, `.load.orderBy`, `.load.sampleStrategy` (+ `.fallbackStrategy`, sample family only), `.createPolicy` | |
| Post-load | `postLoad.recalculateRollups` (`auto` \| `required` \| `off`), `postLoad.updateCorporateCurrency` | US sets `required` |
| Unmapped-user policy | `objects.<key>.unmappedUserPolicy` (fallback user is always `target.migrationUserId`) | |
| Erasure suppression | `privacy.erasureListPath` (CSV of SFDC ids honoured under GDPR/LGPD/PIPL erasure) | rows with those ids (and their children) are skipped with `ERASED_SKIPPED` — never resurrected |
| Target vault / residency | `target.vaultDns`, `target.apiVersion`, `dataResidency: 'eu' \| 'us' \| 'cn' \| 'jp'`, `staging.databaseUrl`, `staging.runDir` | CN routes to a China-hosted vault and CN-resident staging |
| Default timezone | `defaultTimezone` (IANA) | used by `emEventLocalTimes` when the source has no tz |
| Wave membership | `waves[].countries[]`, `waves[].freezeAt` | |

#### 7.2.1 Complete configuration key reference (normative for the zod schema)

Every key referenced anywhere in this document is listed here with its type and default; a key that appears in prose but not here is a spec bug. Keys marked *country* may be set at `global`, `regions.<R>` or `countries.<ISO>` level; others are global only.

| Key | Type / values | Default | Level | Used in |
|---|---|---|---|---|
| `source.apiVersion`, `source.loginUrl`, `source.auth{kind: jwt\|clientCredentials, clientId, username, aud, privateKeyPath, clientSecret}`, `source.timezone` | as §2.1.1 | `"67.0"`, —, —, `UTC` | global | §2.1 |
| `target.vaultDns`, `target.apiVersion`, `target.auth{kind: password\|accessToken\|oauth, …}`, `target.clientId`, `target.migrationMode`, `target.unchangedFieldBehavior`, `target.migrationUserId` (numeric Vault user id used for audit fallback and `unmappedUserPolicy = migrationUser`), `target.vaultId` (derived from auth, read-only) | | `v26.2`, —, —, `true`, `AlwaysIgnore`, — | country (`target.*` may be overridden per country/region) | §2.5, §3.5 |
| `staging.databaseUrl`, `staging.runDir`, `dataResidency` (`eu\|us\|cn\|jp`) | string | — | country | §7.5 |
| `legacyId.preferred[]`, `legacyId.format` (`{id18}\|{id15}`), `legacyId.externalIdFormat`, `legacyId.allowMdl` | | `[legacy_crm_id__v, external_id__v, legacy_crm_id__c]`, `{id18}`, `SF:{orgId15}:{id18}`, `false` | global | §3.2 |
| `scope.historyMonths`, `scope.cutoffDate`, `scope.sampleRetentionMonths`, `scope.tovRetentionMonths`, `scope.samplesIncludeCalls`, `scope.objects.<key>.historyMonths` (`null` = unscoped) | int / ISO date | `24`, —, —, —, `false`, — | country | §1.1, §7.2 |
| `delta.overlapMinutes` (5–15), `delta.safetyLagMinutes` | int | `10`, `5` | global | §4.1 |
| `performance.sfdcBulkConcurrency`, `.sfdcRestConcurrency`, `.vaultConcurrency`, `.vaultBatch`, `.burstFloor`, `.sfdcApiFloorPct`, `.batchWallTimeMs`, `.sortChunkRows` | int | `4`, `2`, `4`, `500`, `200`, `20`, `60000`, `500000` | global | §2.1.7, §2.5.2, §8.1, §2.2 |
| `extract.closureStrategy` (`soqlIn\|composite`), `extract.closureMaxRounds` | | `soqlIn`, `20` | global | §2.1.4, §2.2 |
| `load.strategy` (`vobjects\|loader`) | | `vobjects` | global | §2.5.4 |
| `pendingFk.maxRounds` | int | `3` | global | §8.4 |
| `reconcile.sampleSize`, `reconcile.tolerance` (rows; `final-delta` forces 0) | int | `200`, `0` | country | §8.8 |
| `preflight.probeWrites`, `preflight.probeObject`, `preflight.naturalKeyReview`, `preflight.reprobe` | bool, string, bool, bool | `false`, —, `true`, `false` | global | §2.6, §3.3, §5.3 |
| `postLoad.recalculateRollups` (`auto\|required\|off`), `postLoad.updateCorporateCurrency` | | `auto`, `true` | country | §2.5.6 |
| `picklists.derive`, `picklists.onUnmapped` (`error\|skip\|createValue`), `picklists.leaveReactivated`, `picklists.<object>.<field>: {src: tgt\|null}` | | `strip_vod_lowercase_v`, `error`, `false`, — | country | §2.5.6, §7.1 |
| `locales.language: {sfdcCode: vaultName}`, `locales.locale: {…}` | map | built-in table | global | §6.0.3 |
| `objects.user.mode` (`match\|create`), `.usernameTemplate`, `.securityPolicyId`, `.licenseType`, `.securityProfile: {sfdcProfileName: vaultProfile}` | | `match`, `{Username}`, —, `full__v`, — | global | §3.3, §6.3.2 |
| `objects.<key>.enabled`, `.optional`, `.countryOf` (§6.0.5 grammar), `.deletePolicy`, `.inactivateBy[]`, `.createPolicy` (`create\|match-only`), `.statusFromFlag`, `.inactiveStatuses[]`, `.preserveName`, `.preserveAutoNumberName`, `.loadUnlockFlag`, `.allowTypeChange`, `.dateRange` (`omit\|fail`), `.unmappedUserPolicy`, `.legacyIdField`, `.externalIdOwnedBy` (`integration\|migration`), `.rewriteCompositeExternalId`, `.customFields{mode, include[], exclude[]}`, `.required{field: bool}`, `.fields{add[], override[], remove[]}`, `.objectType{}`, `.state{}`, `.scope{historyMonths}`, `.load{noTriggers, migrationMode, batchSize, partitionBy, orderBy, sampleStrategy, fallbackStrategy, sampleTriggerRejectFallback}`, `.blobs{<name>: required\|optional\|attachment\|skip}` | per §6 | per-object defaults in §6.2 | country | throughout §6 |
| `objects.account.vidField` (SFDC field holding the Network VID), `.contactToPersonAccount`, `.useParentIdFallback`, `.loadFormattedName`, `.depthOrder`; `objects.address.line1Overflow`; `objects.approved_document.htmlOverflow`, `.publishMethod`; `objects.sent_email.contentOverflow`; `objects.call2.loadCallType`, `.loadDeviceFields`; `objects.country.targetKeyField`; `objects.territory.countryOf` (`field:<f>\|prefixMap\|fromUsers\|const:<ISO>`), `.countryPrefixMap`; `objects.em_event.configurationMap`, `.stageMap`; `objects.multichannel_consent.configMaps{consentType, consentLine, contentType, consentTemplate}`; `objects.email_activity.loadIpAddress` | | `VeevaID_vod__c`, `false`, `false`, `false`, `false`; `truncate`; `truncate`, —; `truncate`; `false`, `false`; —; `fromUsers`, —; —, —; —; `true` | country | §3.3, §6.3 |
| `nameTemplates.person`, `.speaker`, `.userTerritory`, `.separator` | template strings | `{FirstName} {LastName}`, `{LastName}, {FirstName}`, `{username}:{territory}`, `" "` | country | §7.2 |
| `formats.*`, `phone.normalise`, `phone.defaultRegion`, `postalCode.pattern`, `postalCode.onMismatch`, `defaultTimezone` | | —, `false`, —, —, `warn`, `UTC` | country | §7.2 |
| `privacy.erasureListPath`, `privacy.consentFullHistory`, `privacy.crossBorderTransfer` (`allowed\|forbidden`) | | —, `false`, `allowed` | country | §7.2, §7.4 |
| `regions.<R>{…}`, `countries.<ISO>{region, …}`, `waves[]{name, countries[], freezeAt}` | | — | global | §7.1 |

### 7.3 Config schema (excerpt, YAML; validated with zod)

```yaml
version: 1
source:
  apiVersion: "67.0"
  loginUrl: https://acme.my.salesforce.com
  auth: { kind: jwt, clientId: ${SF_CLIENT_ID}, username: migration@acme.com, aud: https://login.salesforce.com, privateKeyPath: ./sf.key }
  timezone: UTC
target:
  vaultDns: acme-crm.veevavault.com
  apiVersion: v26.2
  auth: { kind: password, username: ${VAULT_USER}, password: ${VAULT_PASSWORD} }   # or { kind: accessToken, token: ${VAULT_TOKEN} }
  clientId: acme-commercial-veeva-migration-client-crm
  migrationMode: true
  unchangedFieldBehavior: AlwaysIgnore
  migrationUserId: 12345
staging: { databaseUrl: ${MIG_DATABASE_URL}, runDir: ./runs }
legacyId:
  preferred: [legacy_crm_id__v, external_id__v, legacy_crm_id__c]
  format: "{id18}"
  externalIdFormat: "SF:{orgId15}:{id18}"
  allowMdl: false
scope: { historyMonths: 24 }
delta: { overlapMinutes: 10, safetyLagMinutes: 5 }
performance: { sfdcBulkConcurrency: 4, sfdcRestConcurrency: 2, vaultConcurrency: 4, vaultBatch: 500, burstFloor: 200, sfdcApiFloorPct: 20, batchWallTimeMs: 60000, sortChunkRows: 500000 }
extract: { closureStrategy: soqlIn, closureMaxRounds: 20 }
load: { strategy: vobjects }
pendingFk: { maxRounds: 3 }
reconcile: { sampleSize: 200 }
preflight: { probeWrites: false, probeObject: migration_probe__c, naturalKeyReview: true }
postLoad: { recalculateRollups: auto, updateCorporateCurrency: true }
picklists: { derive: strip_vod_lowercase_v, onUnmapped: error }      # error | skip | createValue (needs --allow-picklist-create)
locales: { language: { en_US: English, de: German, fr: French, ja: Japanese }, locale: { en_US: United States, de_DE: Germany } }
objects:
  user:    { mode: match }                                     # create mode adds securityPolicyId, licenseType, securityProfile map
  account: { countryOf: "field:Country_vod__r.Alpha_2_Code_vod__c", deletePolicy: inactivate, externalIdOwnedBy: integration, useParentIdFallback: false, vidField: VeevaID_vod__c }
  call2:   { countryOf: [account, "user:User_vod__c", "user:OwnerId"], deletePolicy: ignore, load: { noTriggers: true, partitionBy: { field: Parent_Call_vod__c, order: [null, notNull] } }, loadCallType: false, loadDeviceFields: false }
  sample_transaction: { load: { sampleStrategy: noTriggersRecalc } }
  multichannel_consent: { load: { orderBy: [Capture_Datetime_vod__c, Id] } }
  expense_header: { optional: true }
  expense_line:   { optional: true }
  key_message: { createPolicy: match-only }
  territory:   { createPolicy: match-only }
  account_territory: { enabled: false }
regions:
  EU:   { dataResidency: eu, scope: { tovRetentionMonths: 60 }, privacy: { consentFullHistory: true }, objects: { email_activity: { loadIpAddress: false } } }
  APAC: { dataResidency: jp }
  NA:   { dataResidency: us }
  LATAM: { dataResidency: us }
countries: { … see 7.4 … }
waves:
  - { name: pilot, countries: [NL] }
  - { name: eu1,   countries: [DE, FR, IT, ES, GB] }
  - { name: na,    countries: [US, CA] }
  - { name: apac,  countries: [JP, AU, KR] }
  - { name: cn,    countries: [CN] }
  - { name: latam, countries: [BR, MX] }
```

Every country listed in a wave **must** have an overlay in §7.4 (or an explicit `countries.<ISO>: { region: <R> }` line) — `CONFIG_COUNTRY_NO_OVERLAY` is a config error (exit 5) otherwise.

### 7.4 Worked country overlays

#### 7.4.1 United States (`US`)
```yaml
countries:
  US:
    dataResidency: us
    defaultTimezone: America/New_York
    scope:
      sampleRetentionMonths: 36            # PDMA / 21 CFR 203 — samples, call samples, inventories never below 3 years (family `samples`, §7.2)
      samplesIncludeCalls: true            # calls carrying disbursements must accompany their transactions → call2 joins the samples family
      objects: { sample_transaction: { historyMonths: 36 }, call2_sample: { historyMonths: 36 }, sample_inventory: { historyMonths: 36 }, sample_inventory_item: { historyMonths: 36 }, call2: { historyMonths: 36 } }
    phone: { normalise: true, defaultRegion: US }
    postalCode: { pattern: "^\\d{5}(-\\d{4})?$", onMismatch: warn }
    objects:
      account:
        required: { npi__v: false, primary_country__v: true }
        fields:
          add:
            - { source: NPI_vod__c, target: npi__v, transform: text }
            - { source: PDRP_Opt_Out_vod__c, target: pdrp_opt_out__v, transform: bool }
            - { source: PDRP_Opt_Out_Date_vod__c, target: pdrp_opt_out_date__v, transform: date }
      address:
        line1Overflow: spillToLine2
        fields:
          add:
            - { source: Zip_4_vod__c, target: zip_4__v, transform: text }
            - { source: License_vod__c, target: license__v, transform: text }
            - { source: License_Status_vod__c, target: license_status__v, transform: "picklist(address.licenseStatus)" }
            - { source: License_Expiration_Date_vod__c, target: license_expiration_date__v, transform: date }
            - { source: DEA_vod__c, target: dea__v, transform: text }
            - { source: DEA_Status_vod__c, target: dea_status__v, transform: "picklist(address.deaStatus)" }
            - { source: DEA_Expiration_Date_vod__c, target: dea_expiration_date__v, transform: date }
            - { source: DEA_Schedule_vod__c, target: dea_schedule__v, transform: text }
            - { source: CDS_vod__c, target: cds__v, transform: text }
            - { source: CDS_Status_vod__c, target: cds_status__v, transform: "picklist(address.cdsStatus)" }
            - { source: CDS_Expiration_Date_vod__c, target: cds_expiration_date__v, transform: date }
            - { source: ASSMCA_vod__c, target: assmca__v, transform: text }                        # Puerto Rico
            - { source: Network_Sample_Eligibility_vod__c, target: network_sample_eligibility__v, transform: "picklist(address.sampleEligibility)" }
      call2:
        blobs: { signature: required }           # signature pass mandatory (PDMA evidence)
        fields: { required: { signature_date__v: false } }
      sample_transaction:
        deletePolicy: ignore
        blobs: { signature: required }
        load: { sampleStrategy: noTriggersRecalc, fallbackStrategy: triggersOnTransactions }   # §6.3.35: recalc action must exist, else Vault maintains roll-ups itself; never NoTriggers without a reload path
      sample_lot: { statusFromFlag: true }
      product: { fields: { add: [ { source: Schedule_vod__c, target: schedule__v, transform: text }, { source: Restricted_States_vod__c, target: restricted_states__v, transform: text } ] } }
    postLoad: { recalculateRollups: required }                 # blocking VT_ROLLUP_RECALC_UNAVAILABLE unless fallbackStrategy applies
    picklists:
      address.state: { AL: al__v, AK: ak__v, "…": "…", PR: pr__v }     # 2-letter → target names resolved by label at preflight
      account.specialty: { "AN": anesthesiology__v, "CD": cardiovascular_disease__v, "…": "…" }   # AMA codes
      account.credentials: { MD: md__v, DO: do__v, NP: np__v, PA: pa__v, RN: rn__v, PharmD: pharmd__v }
      sample_transaction.reason: { "Damaged": damaged__v, "Expired": expired__v, "Lost": lost__v, "…": "…" }
```

#### 7.4.2 Germany (`DE`, inherits `regions.EU`)
```yaml
countries:
  DE:
    region: EU
    defaultTimezone: Europe/Berlin
    scope: { historyMonths: 24, tovRetentionMonths: 60 }        # EFPIA transfer-of-value: em_*/expense widened to 5y
    privacy: { erasureListPath: ./privacy/de-erasures.csv, consentFullHistory: true }
    phone: { normalise: true, defaultRegion: DE }
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    nameTemplates: { person: "{Salutation} {FirstName} {LastName}" }          # titles (Dr. med.) carried in Salutation/credentials
    objects:
      account:
        fields:
          add:
            - { source: ID_vod__c,  target: id__v,  transform: text }           # LANR
            - { source: ID2_vod__c, target: id2__v, transform: text }           # BSNR
            - { source: DHG_Type__c, target: dhg_type__c, transform: "picklist(account.dhgType)" }            # customer field, must pre-exist
            - { source: Profiling_Subtype__c, target: profiling_subtype__c, transform: "picklist(account.profilingSubtype)" }
            - { source: Approved_Email_Opt_Type_vod__c, target: approved_email_opt_type__v, transform: "picklist(account.optType)" }
            - { source: CLM_Opt_Type_vod__c, target: clm_opt_type__v, transform: "picklist(account.optType)" }
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address:
        required: { state_province__v: false }                # Bundesland rarely maintained — never default it
        fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] }
      multichannel_consent:
        scope: { historyMonths: null }                       # full history, opt-in and opt-out
        deletePolicy: ignore
        configMaps:                                          # keyed by SFDC 18-char Id, never by label — §6.3.42
          consentType: { a0X000000000AbCAAU: "external_id:AE_DE", a0X000000000AbDAAU: V4V000000001002 }   # value: vault id | external_id:<v> | name:<v>
          consentLine: { a0Y000000000AbEAAU: "name:Marketing E-Mail" }
      em_event: { scope: { historyMonths: 60 } }
      em_attendee: { scope: { historyMonths: 60 } }
      em_event_speaker: { scope: { historyMonths: 60 } }
      sample_transaction: { enabled: true, scope: { historyMonths: 24 } }                 # AMG §47 samples exist but no PDMA snapshot fields
    picklists:
      account.specialty: { "Allgemeinmedizin": allgemeinmedizin__c, "Innere Medizin": innere_medizin__c, "…": "…" }
      account.credentials: { "Dr. med.": dr_med__c, "Prof. Dr. med.": prof_dr_med__c, "PD Dr. med.": pd_dr_med__c }
      account.optType: { Explicit_Opt_In_vod: explicit_opt_in__v, Implicit_Opt_In_vod: implicit_opt_in__v, Never_vod: never__v }
      address.state: { BW: baden_wurttemberg__c, BY: bayern__c, "…": "…" }
      # (consent config crosswalks are under objects.multichannel_consent.configMaps above — never keyed by label)
```

#### 7.4.3 Japan (`JP`)
```yaml
countries:
  JP:
    dataResidency: jp
    defaultTimezone: Asia/Tokyo
    scope: { historyMonths: 24 }
    nameTemplates: { person: "{LastName}{separator}{FirstName}", separator: "　" }     # full-width space; never transliterate; kanji + kana kept separately
    phone: { normalise: false }
    postalCode: { pattern: "^\\d{3}-\\d{4}$", onMismatch: warn }
    objects:
      account:
        required: { furigana__v: true }
        fields:
          add:
            - { source: Furigana_vod__c, target: furigana__v, transform: text }
            - { source: Language_vod__c, target: language__v, transform: "picklist(account.language)" }
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v, salutation__v]
      address:
        line1Overflow: fail                                   # Japanese address line 1 must not be truncated silently
        fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] }
      em_attendee: { fields: { add: [ { source: Furigana_vod__c, target: furigana__v, transform: text } ] } }
      child_account: { fields: { add: [ { source: Alternate_Name_vod__c, target: alternate_name__v, transform: text } ] } }
      sample_transaction: { enabled: true, scope: { historyMonths: 36 } }   # JP sample-limit rules — retention per counsel
    picklists:
      address.state: { "北海道": hokkaido__c, "東京都": tokyo__c, "大阪府": osaka__c, "…": "…" }      # 47 prefectures
      account.specialty: { "内科": naika__c, "循環器内科": junkanki_naika__c, "…": "…" }
      account.language: { ja: ja__v, en_US: en__v }
```

#### 7.4.4 China (`CN`)
```yaml
countries:
  CN:
    dataResidency: cn
    target: { vaultDns: acme-crm-cn.veevavault.cn, apiVersion: v26.2, auth: { kind: password, username: ${VAULT_CN_USER}, password: ${VAULT_CN_PASSWORD} } }   # separate China-hosted vault
    staging: { databaseUrl: ${MIG_DATABASE_URL_CN}, runDir: /data/cn/runs }        # staging never leaves CN
    defaultTimezone: Asia/Shanghai
    scope: { historyMonths: 24 }
    nameTemplates: { person: "{LastName}{FirstName}", separator: "" }             # single-field Chinese names; LastName may hold the full name
    phone: { normalise: true, defaultRegion: CN }
    postalCode: { pattern: "^\\d{6}$", onMismatch: warn }
    privacy: { erasureListPath: /data/cn/privacy/erasures.csv, crossBorderTransfer: forbidden }   # PIPL: tool refuses to write CN rows to a non-CN vault
    objects:
      account:
        fields:
          add:
            - { source: Hospital_Type_vod__c, target: hospital_type__v, transform: "picklist(account.hospitalType)" }
            - { source: Administrative_Title_CN__c, target: administrative_title__c, transform: "picklist(account.adminTitle)" }   # customer fields (must pre-exist via MDL)
            - { source: Technical_Title_CN__c, target: technical_title__c, transform: "picklist(account.techTitle)" }
            - { source: Department_CN__c, target: department__c, transform: text }
            - { source: Hospital_Rank_CN__c, target: hospital_rank__c, transform: "picklist(account.hospitalRank)" }
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address: { fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] } }
      sample_transaction: { enabled: false }          # no sample programme in CN org (example)
      call2_sample: { enabled: false }
      sample_lot: { enabled: false }
      sample_inventory: { enabled: false }
    picklists:
      account.hospitalType: { GP: gp__v, HP: hp__v }
      account.adminTitle: { A001: a001__c, A002: a002__c, "…": "…" }          # code-valued picklists crosswalk 1:1
      address.state: { "北京市": beijing__c, "上海市": shanghai__c, "广东省": guangdong__c, "…": "…" }
```

#### 7.4.5 Brazil (`BR`)
```yaml
countries:
  BR:
    dataResidency: us                       # LGPD permits transfer with adequate safeguards — per counsel; example uses the Americas vault
    defaultTimezone: America/Sao_Paulo
    scope: { historyMonths: 24 }
    nameTemplates: { person: "{FirstName} {LastName}" }
    phone: { normalise: true, defaultRegion: BR }
    postalCode: { pattern: "^\\d{5}-?\\d{3}$", onMismatch: warn }
    privacy: { erasureListPath: ./privacy/br-erasures.csv }
    objects:
      account:
        fields:
          add:
            - { source: CPF__c, target: cpf__c, transform: text }                     # tax id — text, preserve leading zeros; customer field pre-created via MDL
            - { source: CRM_Number__c, target: crm_number__c, transform: text }       # Conselho Regional de Medicina licence
            - { source: ID_vod__c, target: id__v, transform: text }
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address:
        fields:
          add: [ { source: License_vod__c, target: license__v, transform: text } ]    # CRM number sometimes stored here
          remove: [dea__v, cds__v, zip_4__v, brick__v]
        required: { state_province__v: true }                 # UF is always populated
    picklists:
      address.state: { AC: ac__c, AL: al__c, AM: am__c, "…": "…", SP: sp__c, TO: to__c }   # 27 UFs
      account.specialty: { "Cardiologia": cardiologia__c, "Clínica Médica": clinica_medica__c, "…": "…" }
      account.credentials: { "Dr.": dr__c, "Dra.": dra__c }
```

#### 7.4.6 Canada (`CA`, inherits `regions.NA`)
Source specifics `[field-mapping.md §5 Canada row]`: bilingual accounts (`Account.Language_vod__c` {en_US, fr, …} plus a customer `Preferred_Language_*` field), Quebec Law 25 (GDPR-like: erasure list, consent history), 2-letter provinces in `State_vod__c`, postal `A1A 1A1`, Canadian specialties in a customer `Interest_*_CA` picklist (264 values seen). Data residency: PIPEDA/Law 25 permit transfer with safeguards `[GEN]` — example keeps the NA vault.
```yaml
countries:
  CA:
    region: NA
    defaultTimezone: America/Toronto
    scope: { historyMonths: 24 }
    privacy: { erasureListPath: ./privacy/ca-erasures.csv, consentFullHistory: true }   # Quebec Law 25
    phone: { normalise: true, defaultRegion: CA }
    postalCode: { pattern: "^[A-Za-z]\\d[A-Za-z] ?\\d[A-Za-z]\\d$", onMismatch: warn }
    nameTemplates: { person: "{FirstName} {LastName}" }
    objects:
      account:
        fields:
          add:
            - { source: Language_vod__c, target: language__v, transform: "picklist(account.language)" }
            - { source: Preferred_Language_CA__c, target: preferred_language__c, transform: "picklist(account.preferredLanguage)" }   # customer field, must pre-exist
            - { source: Interest_Specialty_CA__c, target: spec_1_cda__v, transform: "picklist(account.specialty)" }                 # customer specialty picklist (264 values) → target specialty
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address:
        required: { state_province__v: true }                 # provinces always populated (state picklists exist for CA)
        fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] }
    picklists:
      account.language: { en_US: en__v, fr: fr__v, fr_CA: fr__v }        # value names are language-neutral; Vault labels are translated, never encode EN/FR labels in API values
      account.preferredLanguage: { EN: en__c, FR: fr__c }
      address.state: { AB: ab__v, BC: bc__v, MB: mb__v, NB: nb__v, NL: nl__v, NS: ns__v, NT: nt__v, NU: nu__v, ON: on__v, PE: pe__v, QC: qc__v, SK: sk__v, YT: yt__v }   # 13 provinces/territories, resolved by label at preflight
      account.specialty: { "Cardiology": cardiology__c, "Médecine familiale": family_medicine__c, "…": "…" }   # bilingual source labels map to one target value
```

#### 7.4.7 France (`FR`, inherits `regions.EU`)
Source specifics `[field-mapping.md §5 EU row, §3.1]`: RPPS/ADELI professional ids in `ID_vod__c`/`ID2_vod__c` or customer fields; French **départements** stored in `Address_vod__c.State_vod__c` (the 523-value picklist includes them `[META]`); 5-digit postcodes; `Brick_vod__c` (IQVIA) common; the Loi Bertrand / DMOS transparency data is the ToV family (`tovRetentionMonths`).
```yaml
countries:
  FR:
    region: EU
    defaultTimezone: Europe/Paris
    privacy: { erasureListPath: ./privacy/fr-erasures.csv, consentFullHistory: true }
    phone: { normalise: true, defaultRegion: FR }
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    nameTemplates: { person: "{Salutation} {FirstName} {LastName}" }
    objects:
      account:
        fields:
          add:
            - { source: ID_vod__c,  target: id__v,  transform: text }     # RPPS
            - { source: ID2_vod__c, target: id2__v, transform: text }     # ADELI
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address:
        required: { state_province__v: false }
        fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] }
    picklists:
      address.state: { "01": ain__c, "75": paris__c, "2A": corse_du_sud__c, "…": "…" }    # départements — source values are the picklist *values* of State_vod__c for FR (codes or names, read from describe); resolved by label at preflight
      account.credentials: { "Dr": dr__c, "Pr": pr__c }
```

#### 7.4.8 Remaining wave countries — minimal overlays
Each overlay below is complete enough for `CONFIG_COUNTRY_NO_OVERLAY` and encodes the research-named specifics; picklist crosswalks are filled by the programme.
```yaml
countries:
  NL:   # pilot — GDPR; nurse-contact authorisation customer flag; postcode "1234 AB"
    region: EU
    defaultTimezone: Europe/Amsterdam
    postalCode: { pattern: "^\\d{4} ?[A-Za-z]{2}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: NL }
    objects:
      account:
        fields:
          add: [ { source: Authorization_talk_to_Nurses_NL__c, target: authorization_talk_to_nurses__c, transform: bool } ]   # customer field (field-mapping.md §5), must pre-exist
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address: { required: { state_province__v: false }, fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] } }
  ES:   # GDPR; profiling-check customer flag
    region: EU
    defaultTimezone: Europe/Madrid
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: ES }
    objects:
      account:
        fields:
          add: [ { source: Profiling_Check_Performed_ES__c, target: profiling_check_performed__c, transform: bool } ]        # customer field (field-mapping.md §5)
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address: { required: { state_province__v: false }, fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] } }
    picklists: { address.state: { "Madrid": madrid__c, "Barcelona": barcelona__c, "…": "…" } }   # provinces optional
  IT:   # GDPR; codice fiscale / albo number in ID_vod__c / customer field
    region: EU
    defaultTimezone: Europe/Rome
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: IT }
    objects:
      account:
        fields:
          add:
            - { source: ID_vod__c, target: id__v, transform: text }                       # codice fiscale
            - { source: Codice_Albo_IT__c, target: codice_albo__c, transform: text }     # customer field
          remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v]
      address: { fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] } }
    picklists: { address.state: { MI: milano__c, RM: roma__c, "…": "…" } }   # province sigle
  GB:   # UK GDPR; alphanumeric postcodes; no state
    region: EU
    dataResidency: eu
    defaultTimezone: Europe/London
    postalCode: { pattern: "^[A-Za-z]{1,2}\\d[A-Za-z\\d]? ?\\d[A-Za-z]{2}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: GB }
    objects:
      account: { fields: { add: [ { source: ID_vod__c, target: id__v, transform: text } ], remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v] } }   # GMC number
      address: { required: { state_province__v: false }, fields: { add: [ { source: Brick_vod__c, target: brick__v, transform: text } ], remove: [dea__v, cds__v, license__v, zip_4__v] } }
  AU:   # Privacy Act; state picklist exists (best-practices.md §6.2); 4-digit postcodes; AHPRA number
    region: APAC
    dataResidency: jp
    defaultTimezone: Australia/Sydney
    postalCode: { pattern: "^\\d{4}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: AU }
    objects:
      account: { fields: { add: [ { source: ID_vod__c, target: id__v, transform: text } ], remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v] } }
      address: { required: { state_province__v: true }, fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] } }
    picklists: { address.state: { NSW: nsw__v, VIC: vic__v, QLD: qld__v, WA: wa__v, SA: sa__v, TAS: tas__v, ACT: act__v, NT: nt__v } }
  MX:   # LFPDPPP; state picklist exists; 5-digit CP; cédula profesional
    region: LATAM
    defaultTimezone: America/Mexico_City
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    phone: { normalise: true, defaultRegion: MX }
    nameTemplates: { person: "{FirstName} {LastName}" }              # LastName commonly holds both apellidos — never split
    objects:
      account: { fields: { add: [ { source: ID_vod__c, target: id__v, transform: text } ], remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v] } }   # cédula
      address: { required: { state_province__v: true }, fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] } }
    picklists: { address.state: { CMX: cdmx__c, JAL: jalisco__c, NLE: nuevo_leon__c, "…": "…" } }   # 32 entidades
  KR:   # PIPA + Korean sample law (best-practices.md §6.3) — sample retention widened like the US
    region: APAC
    dataResidency: jp
    defaultTimezone: Asia/Seoul
    scope: { sampleRetentionMonths: 36 }
    privacy: { erasureListPath: ./privacy/kr-erasures.csv, consentFullHistory: true }
    nameTemplates: { person: "{LastName}{FirstName}", separator: "" }
    postalCode: { pattern: "^\\d{5}$", onMismatch: warn }
    objects:
      account: { fields: { remove: [npi__v, pdrp_opt_out__v, pdrp_opt_out_date__v] } }
      address: { fields: { remove: [dea__v, cds__v, license__v, zip_4__v, brick__v] } }
      sample_transaction: { load: { sampleStrategy: noTriggersRecalc, fallbackStrategy: triggersOnTransactions } }
```

#### 7.4.9 Regulatory pattern notes (all `[GEN]` — confirm with counsel)
| Regime | Countries | Tool consequence |
|---|---|---|
| GDPR / UK GDPR | EU/EEA, GB | `regions.EU`: `consentFullHistory`, erasure list, EU-hosted vault, `email_activity.loadIpAddress = false` |
| PIPEDA + Quebec Law 25 | CA | as GDPR pattern (erasure list, consent history); residency per counsel |
| LGPD | BR | as GDPR pattern; transfer with safeguards |
| PIPL | CN | separate CN vault + CN staging, `crossBorderTransfer: forbidden` |
| APPI | JP | audit log as record of provision; `dataResidency: jp` |
| PIPA + sample law | KR | GDPR pattern + `sampleRetentionMonths` |
| nFADP | CH (not in a wave; add `countries.CH: { region: EU, dataResidency: eu }` when needed) | GDPR pattern |
| PDMA / 21 CFR 203 | US | §7.4.1 |
| Sunshine / EFPIA / Loi Bertrand ToV | US, EU | `tovRetentionMonths` on the `tov` family incl. `expense_*` |

### 7.5 Data residency of the tool

Staging directories and the Postgres state contain personal data. Deployment rule: one staging DB + run directory per `dataResidency` region; logs contain ids and field names only (never values) outside the staging DB (pino `REDACT_PATHS` covers payload keys `row`, `payload`, `record`, `values`); the CLI refuses to run a country whose `dataResidency` differs from the host's `MIG_REGION` unless `--allow-cross-region` is given and logged.

---

## 8. Error handling, idempotency, logging, dry-run

### 8.1 Error classes

| Class | Examples | Handling |
|---|---|---|
| **Retryable transport** | SFDC HTTP 429/5xx, `REQUEST_LIMIT_EXCEEDED`, `SERVER_UNAVAILABLE`, `UNABLE_TO_LOCK_ROW`, `QUERY_TIMEOUT` (with smaller window); Vault HTTP 429/503, `responseStatus: EXCEPTION`, `API_LIMIT_EXCEEDED`, `SERVICE_UNAVAILABLE`, `RACE_CONDITION`, socket errors | exponential backoff with full jitter (`base 2 s, factor 2, cap 300 s, max 8 attempts`), then unit `failed(transport)`; the batch is re-sent whole (upsert makes it safe) |
| **Session** | SFDC `401 INVALID_SESSION_ID`; Vault `INVALID_SESSION_ID` | re-auth once (respecting the 20/min Vault auth limit), replay the request once, else fatal |
| **Structural (whole batch)** | Vault outer `FAILURE` (unknown column, > 500 rows, duplicate idParam, malformed JSON), SFDC `INVALID_FIELD`/`MALFORMED_QUERY` | unit aborted with `blocking` finding; never retried automatically (mapping bug) |
| **Row-level value** | Vault row `INVALID_DATA`, `PARAMETER_REQUIRED`, uniqueness violation, unresolved lookup | row `failed(error_type)` with message; batch continues; listed for `retry-failed` after a fix |
| **Permission** | `INSUFFICIENT_ACCESS`, `OPERATION_NOT_ALLOWED` (lifecycle/type without migration mode) | unit aborted, `blocking` |
| **Data** | unresolved required FK, unmapped picklist value (policy `error`), truncation with policy `fail`, unmapped user with policy `fail`, erased id | row `failed(code)` / `skipped(code)`; counted in reconciliation |

Batch-size feedback: if a Vault call exceeds `performance.batchWallTimeMs` (default 60 s) the batch size for that object is halved (min 50); it recovers by 25% after 10 consecutive fast batches.

### 8.2 Idempotency

- Upsert by `idParam = legacy-id field` with `X-VaultAPI-UnchangedFieldBehavior: AlwaysIgnore`; deterministic transforms; client-side dedupe of duplicate keys within a batch (last-wins by `SystemModstamp`).
- **Hash skip**: a row whose `source_hash` equals `id_map.source_hash` (last successful load for the same mapping hash) is not sent (`loaded_unchanged` locally). A mapping change invalidates the skip (hash includes `mapping_hash`).
- Creates never happen without `idParam`; a timed-out batch is re-sent as-is.
- Second-pass PUTs are idempotent (only self-ref fields, addressed by Vault `id`).
- Watermarks advance only after a unit fully succeeds; a crashed run resumes from `extract_checkpoints` (Bulk results are reusable for 7 days by `jobId + locator`), skips batches whose rows all have a terminal `row_results` state, and re-sends only rows without one.
- Deletes are recorded (`deleted_at`) rather than removed from the map; repeated delete of an already-deleted id is a no-op.

### 8.3 Throttling & concurrency

- SFDC: token bucket from `DailyApiRequests.Remaining − reserve`; `Sforce-Limit-Info` refreshes it; ≤ `sfdcBulkConcurrency` (4) Bulk jobs and `sfdcRestConcurrency` (2) REST workers.
- Vault: `vaultConcurrency` (4) parallel bulk calls **across objects without dependency and within an object by disjoint key ranges**; never the same record in two in-flight batches; pause when `X-VaultAPI-BurstLimitRemaining < burstFloor`; log `X-VaultAPI-ResponseDelay > 0` as `warn`.
- Session keep-alive every 10 min; end session at run end.

### 8.4 Pending FK queue

Rows with an unresolved required FK go to `pending_fk`; after closure and after every parent unit completes, the queue is re-evaluated (max `pendingFk.maxRounds` = 3 per run); leftovers are `failed(UNRESOLVED_FK)` with the target object and sample ids in the report.

### 8.5 Logging & audit

- Logger: pino via a package-local `getLogger(scope)` mirroring `src/lib/logger` conventions (`LOG_LEVEL`, JSON in production, readable lines in dev). Scopes: `Preflight`, `Extract`, `Closure`, `Transform`, `Load`, `Reconcile`, `Sfdc`, `Vault`, `Store`.
- Every log line carries `run_id`, `object_key`, `country`, and where applicable `batch_no`, `job_id`, `vault_execution_id` (`X-VaultAPI-ExecutionId`), `sfdc_request_id`.
- **Never log record payloads or field values at `info`**; `debug` may log payloads (including the FK-resolved request bodies that otherwise exist only in memory, §2.3) only when `MIG_DEBUG_PAYLOADS=1` and only to the staging directory. Redact `password`, `sessionId`, `access_token`, `assertion`, `Authorization`.
- Append-only audit (Postgres `audit_log` + `{runDir}/audit.jsonl`): run metadata (who, when, tool version, config hash, mapping hash, source org id, target vault id, API versions, `sfdc_now`, `freeze_at`), preflight findings, per-batch request summaries (object, batch no, row count, elapsed, burst remaining, outcome counts), per-row outcomes (`row_results`), reconciliation, manual overrides (`--accept-mapping-change`, `--allow-mdl`, `--force-unit`) with the operator's justification string. Vault stamps migrated records "created in migration mode" in its own audit trail.
- Run report: `{runDir}/report.md` + `report.json` — findings table, per-unit reconciliation table, failed-row summary by error type, unmapped users/picklist values with counts, timings.

### 8.6 Blob pass (second pass by id)

Fields marked `deferredBlob` (`Signature_vod__c`, `Signature_Page_Image_vod__c`, `Email_Content_vod__c`, `Email_Content2_vod__c`, `Email_HTML_*`, `Photo_vod__c`, `Product_Thumbnail_vod__c`, consent `Signature_vod__c`) are extracted separately via REST `Id IN (…)` (≤ 100 ids per call because of payload size) for ids that were loaded successfully, and written with `PUT /vobjects/{obj}` by Vault `id` (≤ 500 rows / call, request body ≤ **1 GB** `[SRC Postman/vault-api.md §6.1]` — the 50 MB figure applies only to File Staging simple uploads, §2.5.4; the tool nevertheless caps blob batches at `performance.blobBatchBytes`, default 64 MB, to keep a failed call cheap to retry). When the target field is missing or shorter than the value: policy `objects.<key>.blobs.<name> = required \| optional \| attachment \| skip`; `attachment` uses `POST /api/{version}/vobjects/{object}/{id}/attachments` (multipart) `[OBS on em_event__v]` and is allowed only when the object's metadata has **`allow_attachments = true`** `[SRC metadata key]` — preflight checks it per object (`VT_ATTACHMENTS_DISABLED`, §5.2) before the policy is accepted. `required` (US signatures) makes a missing/oversized target a `blocking` finding.

### 8.7 Post-load housekeeping

Roll-up recalculation (path to confirm, §9), FK-consistency pass, duplicate-account report (same `veeva_network_id__v`/natural key with different legacy ids) with an optional guarded `POST /vobjects/account__v/actions/merge` (manual approval file), Network bridge re-validation reminder.

### 8.8 Reconciliation gate & sampling

- Gate per unit = the two §2.8 invariants with zero tolerance: (1) `sfdc_scope_count == extracted_live`; (2) `extracted_live + closure == created + updated + unchanged + skipped + failed + pending_fk` **with `failed = 0` and `pending_fk = 0`** and every `skipped` reason documented (`erased`, `rule`, `contact_ref`, `country_unresolved`, `out_of_scope_ref` are the only accepted reasons without an exception file); plus `vault_count ≥ created + updated + unchanged` (pre-existing matched rows may exceed); orphan required FKs = 0; `deleted_routed == deleted_applied + deleted_ignored` (`deleted_pending = 0`); sample roll-up verification passed where the strategy requires it (§6.3.35); aggregate hashes equal within documented exclusions (derived fields are excluded from the hash set). `final-delta` requires every unit of the wave to pass or an explicit `--accept-gate-exceptions <file>`.
- Row sampling: stratified per (object, country, object type, status): `reconcile.sampleSize` (default 200) rows + boundary cases (oldest/newest in scope, longest text, non-ASCII names, multi-value picklists, merged parents), read back via VQL with the same field list, canonicalised (numbers padded to `scale`, datetimes `.000Z`, picklists as names, references mapped back to SFDC ids) and diffed field by field; report `{object, sfdc_id, field, expected, actual}`.

### 8.9 Dry-run

`--dry-run` on any mode: preflight → extract (full or `--limit N` per unit) → closure → transform → validation (type/length/picklist/required per object type) → payload files on disk → **simulated** counts and a report identical in shape to a real run, with `would_create`/`would_update` derived from the match step (VQL reads are allowed; writes are not). No watermark movement, no id-map writes except `match_method` cache rows flagged `dry_run = true` (purged at the next real run). The dry-run report is the artefact reviewers sign before `init`/`final-delta`.

### 8.10 CLI surface

```
veeva-migration preflight   --config cfg.yaml --wave eu1 [--country DE] [--probe-writes]
veeva-migration init        --config cfg.yaml --wave eu1 [--country DE] [--objects account,address] [--dry-run] [--limit 1000] [--allow-mdl] [--allow-picklist-create]
veeva-migration delta       --config cfg.yaml --wave eu1 [--country DE] [--dry-run]
veeva-migration final-delta --config cfg.yaml --wave eu1 --freeze-at 2027-03-06T22:00:00Z [--accept-gate-exceptions file]
veeva-migration verify      --config cfg.yaml --wave eu1 [--fk] [--sample 500]
veeva-migration retry-failed --config cfg.yaml --run <run_id> [--error-type INVALID_DATA]
veeva-migration blobs       --config cfg.yaml --run <run_id> [--objects call2,sample_transaction]
veeva-migration report      --run <run_id>
```
Exit codes: `0` success, `2` blocking preflight findings, `3` unit failures, `4` reconciliation gate failed, `5` config error.

---

## 9. Open questions / unverified items

Every item below is a preflight check or a runtime probe in the implementation; none may be hard-coded as truth.

### 9.1 Vault CRM data model
1. **`legacy_crm_id__v` on objects other than `user__sys` and `em_event__v`** — presence, uniqueness, 15- vs 18-char format, and whether Veeva's own migration populates it. Sample Veeva-migrated records before choosing the id convention (§3.2).
2. **Every `call2__v` field name** and the four call-child object names (`call2_detail__v`, `call2_discussion__v`, `call2_key_message__v`, `call2_sample__v`) — zero observations; status field name (`call2_status__v` vs `status__v`), lifecycle/state names for submitted calls, `territory__v` type (text vs reference), `address__v` type on call2 (text snapshot vs reference), `signature__v` type.
3. Object names by rename rule only: `sample_transaction__v`, `sample_lot__v`, `sample_inventory__v`, `sample_inventory_item__v`, `medical_inquiry__v`, `key_message__v`, `clm_presentation__v`, `clm_presentation_slide__v`, `multichannel_consent__v`, `multichannel_activity__v`, `multichannel_activity_line__v`, `email_activity__v`, `sent_email__v`, `approved_document__v`, `account_plan__v`, `product_metrics__v`, `product_group__v`, `medical_event__v`, `child_account__v`, `affiliation__v`, `tsf__v`, `order__v`, `order_line__v` (DOC-level evidence only for some).
4. Object-type API names for every typed object (accounts `professional__v`?, calls `call_report__v`?, events `speaker_program__v`?, sample transactions, consents, sent emails, approved documents, medical events, orders, attendees) — resolved by label match at preflight.
5. Picklist value names beyond the confirmed pairs (`opt_in__v`, `opt_out__v`, `invited__v`, `attended__v`, `signed__v`, `edetail__v`, `approved_email__v`, `active__v`/`inactive__v`): `submitted__v`/`saved__v`/`planned__v`, `face_to_face__v`, `disbursement__v`, sent-email/approved-document statuses, `product_type__v` values, plain-English values (`Detail Only`, `Positive`, `In Range`, `Manual`, `HQ`), ISO-2 country picklist names, US states.
6. Whether `call2__v`, `sample_transaction__v`, `order__v`, `medical_inquiry__v`, `sample_inventory__v` are **lifecycled** (`state__v`) and whether the platform `status__v` was repurposed as the business status on them.
7. `_cda__v` field family on `account__v`/`address__v`: complete list, meaning, and whether plain twins (`first_name__v`, `city__v`, `specialty_1__v`) also exist and which one Veeva's migration populates.
8. `account__v` country: `primary_country__v` vs `country__v`, reference vs picklist; `address__v.country__v` type; `user__sys` `country__v`/`country_code__v`/`vcountry__v` types and which the layouts require.
9. Network VID field spelling on `account__v`: `veeva_network_id__v` (Reltio) vs `veeva_network__id__v` (help snippets).
10. Existence of `ownerid__v`, `mobile_id__v`, `stub_sfdc_id__v`, `lock__v`/`override_lock__v` per object (observed only on `em_event__v`/`user__sys`).
11. `product_metrics__v` product reference (`products__v` vs `product__v`); `tsf__v.territory__v` reference vs text; whether Align must own `territory__v`/`user_territory__v`.
12. CLM object model vs document model in the target vault → type of `call2_key_message__v.clm_presentation__v`; whether CLM/AE content is integration-owned (then `match-only`).
13. `medical_inquiry__v` inquiry-text field name (source documented as `Inquiry_Text__c` without `_vod`); multi-product inquiry child object.
14. `lot_catalog__v` semantics vs `sample_lot__v`; whether Vault CRM requires lot catalog rows before `sample_lot__v`.
15. Vault CRM `contact__v` existence (SFDC `Contact` lookups on calls/affiliations/attendees).
16. `em_event_status__v`, `walk_in_status__v`, `rsvp_status__v`, `em_attendee` status field name (`em_attendee_status__v` by pattern) and value names.
17. `user__sys`: whether `username__sys` must equal SFDC `Username`; profile → `security_profile__sys`/`application_profile__v`/`layout_profile__sys` crosswalk (CRM profiles not enumerated); semantics of `userroleid__v`, `user_type__v`.
18. `country__v` key fields (`abbreviation__v`? `country_code__v`? `external_id__v`?).
19. Exact spelling/behaviour of the Vault roll-up recalculation endpoint after migration-mode loads — probed (§5.3 probe 17); the sample load never depends on it alone (`sampleStrategy` fallbacks, §6.3.35).
19b. `expense_header__v.payee__v` type (text/picklist/reference) and whether the `actual__v`/`committed__v` amounts exist on the header as well as the line (§6.3.25a).
19c. Whether `stage__v` on `em_event__v` is writable in migration mode or derived from `state__v` (§6.3.22).
19d. `account__v.type__v` semantics and required-ness per object type (§6.3.7); `publish_method__v` value names on `approved_document__v` (§6.3.17).
19e. Whether `em_event_configuration__v`/`consent_type__v` rows carry `external_id__v` populated with the Veeva CRM `External_ID_vod__c` (decides whether the automatic match in §6.3.42/§6.3.22 works without a map).

### 9.2 Vault platform API
20. Whether Vault ever returns HTTP **429** (documented behaviour is the 500 ms delay) — handle both.
21. Accepted value form for `created_by__v`/`modified_by__v` in migration mode (numeric user id assumed) — probe §5.3.14.
22. `local_currency__sys` accepted values (currency object id vs ISO code) — probe §5.3.15.
23. Exact JSON `type` strings in field metadata for long text / rich text / currency / formula / lookup.
24. Form of the field-metadata `picklist` property (`name` vs `Picklist.name`).
25. Multi-value **object reference** separator and `,,` escaping over REST (documented for Loader/picklists).
26. Hard limit on VQL `IN (…)` list length / query length (≤ 500 values assumed).
27. Behaviour of `?idParam` on `DELETE` (VAPIL documents it for create/upsert only) — probe §5.3.16.
28. Whether `X-VaultAPI-NoTriggers` skips Veeva CRM "system" triggers as well as standard/custom.
29. Whether JSON `null`/empty string clears a field on update; whether `max_length` applies to LongText; code points vs UTF-16 units for length.
30. Complete list of error `type` codes.
31. Vault Loader CLI flag names / `idparam` with `update`/`delete` tasks (only relevant if `load.strategy: loader` is ever enabled).
31b. Body/idempotency of `POST /vobjects/{object}/actions/updatecorporatecurrency` (§2.5.6) and whether `changetype` accepts JSON as well as CSV (§2.5.6).
31c. Whether the bulk Users API accepts the composite `vault_membership` string on create or requires the separate `vault_membership` PUT (§6.3.2).

### 9.3 Salesforce / Veeva CRM side
32. Field inventory is from a 2017 org: confirm via describe `Account.VeevaID_vod__c`, `User.Country_vod__c` (picklist vs lookup), `Call2_vod__c.Call_Channel_vod__c`, `Medical_Inquiry_vod__c.Inquiry_Text__c` + `Product_vod__c`, `Sample_Transaction_vod__c.Call2_vod__c`/`Call_Sample_vod__c`, `EM_Event_vod__c.Event_Type_vod__c`/`Event_Format_vod__c`/`Event_Time_Zone`, `Sample_Lot_vod__c.Batch_Lot_Id_vod__c`, `Country_vod__c` object fields, `EM_Speaker_vod__c`, `Email_Activity_vod__c`, `Multichannel_Activity_Line_vod__c`, `Sample_Inventory_Item_vod__c` fields.
32b. **`[UNVERIFIED-SOURCE]` inventory** (guessed source names; every one degrades to `info SF_FIELD_MISSING`): `Expense_Header_vod__c`/`Expense_Line_vod__c` and all their fields (§6.3.25a/b); `EM_Venue_vod__c.{Address_Line_1,Address_Line_2,City,State_Province,Postal_Code,Country,Phone,Venue_Type,Status}_vod__c`; `EM_Catalog_vod__c.{Description,Status}_vod__c`; `EM_Speaker_vod__c.{First_Name,Last_Name,Address,Status,Next_Year_Status,Year_To_Date_Utilization}_vod__c`; `EM_Event_vod__c.Event_Time_Zone*`; `EM_Attendee_vod__c.{HCP,Employed,Profile_Type,Postal_Code,Address,Role,Product,Topic}_vod__c`; `Email_Activity_vod__c.{URL,User_Agent,IP_Address}_vod__c`; `Multichannel_Activity_Line_vod__c.{Start_DateTime_vod__c,Name}`; `Sample_Inventory_Item_vod__c.{Lot|Sample_Lot,Quantity,Product}_vod__c`; `Clm_Presentation_Slide_vod__c.Vault_External_Id_vod__c`; `Consent_Type_vod__c`/`Consent_Line_vod__c`/`Content_Type_vod__c`/`Consent_Template_vod__c`/`EM_Event_Configuration_vod__c.External_ID_vod__c`; the exact name of the legacy `Territory` external-id equivalent.
33. Person-account record types `Professional_vod`/`Business_Professional_vod` (absent from the parsed org) — read `RecordType WHERE SobjectType='Account' AND IsPersonType=true`.
34. Master-detail vs lookup in the customer org for `Medical_Inquiry_vod__c.Account_vod__c`, `Multichannel_Consent_vod__c.Account_vod__c`, `TSF_vod__c.Account_vod__c`, `Address_vod__c.Account_vod__c`, `Product_Metrics_vod__c.Account_vod__c` (affects `OwnerId` presence and cascade semantics).
35. Territory model (Territory2 vs legacy) and whether `Territory_vod__c` text matches `Territory2.Name` or `DeveloperName`; whether `UserTerritory2Association`/`ObjectTerritory2Association` are `replicateable` (decides feed vs key-set delete detection, §2.1.6).
36. JWT `aud` for sandboxes after Spring '26 (`test.salesforce.com` vs sandbox My Domain) — configurable.
37. `POST /services/data/vXX.X/query` with a JSON body (long `Id IN` lists) — existence unverified; GET with ≤ 400 ids is the baseline.
38. Exact numbers to re-check on the live limits cheatsheet: Bulk 2.0 15 GB/job, 7-day retention, 150M vs 100M records/day, `maxRecords` max on `/results`.
39. Whether the org has multi-currency and person accounts enabled; whether `MasterRecordId` merge history is still within the Recycle Bin window.
40. Salesforce anomalous-export transaction security policies (July 2026) — integration-user exemption.

### 9.4 Programme / policy
41. "2 years of activity" is a customer policy knob, not a Veeva rule — confirm per programme; per-country regulatory retention (PDMA 3y, EFPIA/Sunshine ≥ 5y, JP/KR sample laws, LGPD/PIPL/APPI transfer bases) with counsel.
42. What Veeva's own migration service migrates for this customer (objects, whether it preserves `CreatedDate`/`CreatedById`, which id field it fills) — obtain from the Veeva migration lead; it decides whether the tool runs as sole loader or as delta/custom loader.
43. Whether CLM/Approved Email content and territories are integration-owned in the target (PromoMats/MedComms connection, Align) → `createPolicy`.
44. Country-specific rules in §7.4 are general practice (customer field names are illustrative) — replace with the programme's real field inventory.
