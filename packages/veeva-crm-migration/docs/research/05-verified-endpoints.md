# Verified endpoint reference (from open-source client sources)

The vendor documentation hosts (`developer.salesforce.com`, `help.salesforce.com`,
`crmhelp.veeva.com`, `developer.veevavault.com`) were **not reachable** from the
environment this package was authored in (network egress policy). The endpoint
paths below were therefore cross-checked against open-source client libraries
that _were_ reachable, and are treated as the ground truth the code is written
against. Everything not listed here came from search-result snippets and prior
knowledge and is marked as unverified in the other research docs.

## Vault REST API — from VAPIL (`veeva/vault-api-library`, Vault API `v26.2`)

Source: `src/main/java/com/veeva/vault/vapil/api/{client/VaultClient.java,request/*.java}`
on `main` (fetched 2026-09-07). Every path is relative to
`https://{vaultDNS}/api/{version}` unless absolute. VAPIL's `VAULT_API_VERSION`
constant is `v26.2`.

### Authentication (`AuthenticationRequest.java`)

| Purpose | Method + path | Body / headers |
| --- | --- | --- |
| Username + password → session id | `POST /auth` | `application/x-www-form-urlencoded`: `username`, `password`, optional `vaultDNS` |
| OAuth2 / OIDC access token → session id | `POST https://login.veevavault.com/auth/oauth/session/{oauth_oidc_profile_id}` | header `Authorization: Bearer {accessToken}`; form body optional `client_id`, `vaultDNS` |
| Keep session alive | `POST /keep-alive` | session header |
| End session | `DELETE /session` | session header |
| Discovery (which auth type a user has) | `POST https://login.veevavault.com/auth/discovery` | form: `username`, optional `client_id` |

The session id is sent on every later call as `Authorization: {sessionId}`
(no `Bearer` prefix). Responses carry `responseStatus: "SUCCESS" | "FAILURE" | "EXCEPTION"`
plus `errors[] { type, message }`.

### Metadata & MDL (`MetaDataRequest.java`)

| Purpose | Method + path |
| --- | --- |
| List component types | `GET /metadata/components` |
| Component type metadata | `GET /metadata/components/{component_type}` |
| Component record collection | `GET /configuration/{component_type}` |
| Component record (JSON) | `GET /configuration/{component_type}.{record_name}` |
| Component record as MDL | `GET /mdl/components/{component_type}.{record_name}` |
| Execute MDL script (sync) | `POST /mdl/execute` — raw body, `Content-Type: text/plain` |
| Execute MDL script (async, needed for `Object` changes on large data) | `POST /mdl/execute_async` — raw body, `text/plain` |
| Async MDL job results | `GET /mdl/execute_async/{job_id}/results` |
| Cancel raw-object deployment | `POST /metadata/vobjects/{object_name}/actions/canceldeployment` |
| List objects | `GET /metadata/vobjects` |
| Object metadata (fields, object types, …) | `GET /metadata/vobjects/{object_name}` |
| Field metadata | `GET /metadata/vobjects/{object_name}/fields/{field_name}` |
| Page layouts of an object | `GET /metadata/vobjects/{object_name}/page_layouts` |
| Page layout metadata | `GET /metadata/vobjects/{object_name}/page_layouts/{layout_name}` |
| Upload content file for MDL component | `POST /mdl/files` |

### Configuration migration (`ConfigurationMigrationRequest.java`)

| Purpose | Method + path |
| --- | --- |
| Import package (VPK) | `POST /services/package` (multipart file) — returns a job; results at `GET /vobject/vault_package__v/{package_id}/actions/import/results` |
| Validate package file before import | `POST /services/package/actions/validate` |
| Validate an imported package | `POST /services/vobject/vault_package__v/{package_id}/actions/validate` |
| Deploy an imported package | `POST /vobject/vault_package__v/{package_id}/actions/deploy` ; results `GET …/actions/deploy/results` |
| Outbound package dependencies | `GET /vobject/outbound_package__v/{package_id}/dependencies` |
| Vault compare (config diff between two vaults) | `POST /objects/vault/actions/compare` |
| Vault configuration report | `POST /objects/vault/actions/configreport` ; report `GET /objects/vault/actions/configreport/{job_id}/report` |
| Component query (VQL over components) | `POST /query/components` |
| Enable / disable configuration mode | `POST /services/configuration_mode/actions/enable` / `…/disable` |

### Queries, picklists, security (`QueryRequest`, `PicklistRequest`, `SecurityPolicyRequest`)

| Purpose | Method + path |
| --- | --- |
| VQL query | `POST /query` (form param `q`) — paginated via `responseDetails.next_page` |
| Picklists | `GET /objects/picklists`, `GET /objects/picklists/{name}`, `POST` (create values), `PUT …/{name}/{value}` (rename) |
| Security policies | `GET /objects/securitypolicies`, `GET /objects/securitypolicies/{name}` |

Record-migration headers on `ObjectRecordRequest`: `X-VaultAPI-MigrationMode: true`
and `X-VaultAPI-NoTriggers: true` — relevant if record data is ever loaded, not for
configuration.

The canonical API reference these classes link to is
`https://general.veevavault.dev/vault-api/api-reference/26.2/...` (e.g.
`.../metadata-definition-language-mdl/execute-mdl-script`).

## Salesforce REST / OAuth — from jsforce (`jsforce/jsforce` `main`)

| Purpose | Path (from `src/connection.ts`, `src/api/tooling.ts`, `src/oauth2.ts`) |
| --- | --- |
| Login host | `https://login.salesforce.com` (or `https://test.salesforce.com` for sandboxes, or My Domain) |
| Token endpoint | `{loginUrl}/services/oauth2/token` with `grant_type` = `password` \| `refresh_token` \| `authorization_code` (jsforce) — `client_credentials` and `urn:ietf:params:oauth:grant-type:jwt-bearer` use the same endpoint |
| REST version root | `{instanceUrl}/services/data/v{XX.0}` |
| Describe | `/sobjects/{name}/describe`, global: `/sobjects` |
| Tooling API root | `{instanceUrl}/services/data/v{XX.0}/tooling` (query: `/tooling/query?q=…`, sobjects: `/tooling/sobjects/{Type}/{Id}`) |
| SOQL | `/query?q=…`, follow `nextRecordsUrl` while `done === false` |

Layout describes (`/sobjects/{name}/describe/layouts`, `/describe/layouts/{recordTypeId}`)
and `/limits` are standard REST resources; jsforce exposes them through the same
`_baseUrl()` helper.
