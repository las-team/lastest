# CONTRACTS — builder's guide for `@lastest/veeva-migration`

Read this first. The normative spec is `docs/MIGRATION_SPEC.md` (§ references below point there). This document tells you **which files you own, which interfaces you must implement or consume, and how to test** — without talking to the other builders. Everything named here already exists, compiles (`tsc --noEmit` clean) and is tested (`pnpm vitest run packages/veeva-migration` green) at the time of writing.

## 0. Ground rules (all areas)

- Package root: `/home/user/lastest/packages/veeva-migration`. ESM, TypeScript strict, consumed as TS source. **Package-local relative imports only** (`../types`, never `@/`), no `.js` suffixes, no default exports.
- Never run `pnpm install`, never touch files outside your ownership list, never edit `docs/MIGRATION_SPEC.md`.
- Never hard-code an `[UNVERIFIED]` API name as truth. It is a *default* (carried in `evidence: "UNV"` on a mapping row, or in a config default) that preflight validates and degrades safely (`VT_FIELD_MISSING` warning → field dropped).
- Logging: `import { getLogger } from "../logger"` → `const log = getLogger("Load", { run_id, object_key, country })`. Scopes: `Preflight | Extract | Closure | Transform | Load | Reconcile | Sfdc | Vault | Store | Config | Cli`. **Never log payloads or field values at `info`** (the keys `row/payload/record/values/password/sessionId/access_token/assertion/authorization/token/secret` are redacted anyway).
- Tests: hermetic (no network, no postgres), `<name>.test.ts` beside the code, built on `src/testkit`. Run one area: `cd /home/user/lastest && pnpm vitest run packages/veeva-migration/src/<dir>`.
- Typecheck your files only: `cd /home/user/lastest && pnpm exec tsc --noEmit -p packages/veeva-migration/tsconfig.json 2>&1 | grep -E 'src/(<your dirs>)'`.
- Format before returning: `cd /home/user/lastest && pnpm prettier --write packages/veeva-migration/src/<your dirs>`.
- Ids: every SFDC id stored, keyed or compared is the **18-char** form — call `to18()` from `src/transform/ids.ts` at every boundary. Never hand-write an 18-char id in fixtures; use `to18("a0K000000000001")` (the suffix is a checksum, `"…AAA"` is only valid for all-digit/lowercase bodies).
- YAML config: `${ENV}` references **inside flow maps must be quoted** (`{ clientId: "${SF_CLIENT_ID}" }`); block-style `clientId: ${SF_CLIENT_ID}` is fine.

## 1. File ownership per area

| Area | Owns (create/overwrite) | Must NOT edit | Consumes |
|---|---|---|---|
| **architect (done)** | `package.json`, `tsconfig.json`, `bin/`, `src/types.ts`, `src/logger.ts`, `src/hash.ts`, `src/country-of.ts`, `src/index.ts`, `src/objects/types.ts`, `src/objects/registry.ts`, `src/transform/{ids,rename,spec,registry,apply}.ts`, `src/config/*`, `src/testkit/*`, all `src/<area>/types.ts`, `src/cli.ts` (placeholder) | — | — |
| **sfdc** | `src/sfdc/*.ts` except `types.ts` (auth.ts, rest.ts, bulk.ts, describe-cache.ts, soql.ts, retry.ts, client.ts, index.ts) | `src/sfdc/types.ts` | `SfdcClient` contract, `getLogger` |
| **vault** | `src/vault/*.ts` except `types.ts` (auth.ts, http.ts, client.ts, vql.ts, metadata.ts, records.ts, mdl.ts, users.ts, index.ts) | `src/vault/types.ts` | `VaultClient` contract |
| **store** | `src/store/*.ts` except `types.ts` (schema.ts drizzle/SQL, postgres.ts, migrate.ts, index.ts) | `src/store/types.ts`, `src/testkit/memory-store.ts` | `StateStore` contract; re-run `src/testkit/memory-store.test.ts` against postgres by swapping `makeStore` (integration test, `*.integration.test.ts`) |
| **preflight** | `src/preflight/*.ts` except `types.ts` (source-checks, target-checks, legacy-id, lints, probes, crosswalks, report, index) | `src/preflight/types.ts` | `Preflight`, `PreflightInput/Result`, `ResolvedTarget`, `MaterialisedMapping`, `validateObjectModule`, fakes |
| **extract** | `src/extract/*.ts` except `types.ts` (predicate, columns, stream, csv, checkpoint, closure, sort, partition, index) | `src/extract/types.ts` | `Extractor`, `SfdcClient`, `buildCountryPredicate`, `ExtractCheckpoint` |
| **load** | `src/load/*.ts` except `types.ts` (batcher, resolve-refs, upsert, second-pass, deletes, pending, blobs, retry, index) | `src/load/types.ts` | `Loader`, `VaultClient`, `StateStore`, `PayloadRow`, deferred value helpers |
| **reconcile** | `src/reconcile/*.ts` except `types.ts` | `src/reconcile/types.ts` | `Reconciler`, both clients, store |
| **run / cli** | `src/run/*.ts` except `types.ts` (plan.ts, engine.ts, modes/*.ts, report.ts, index.ts), **`src/cli.ts`** (replace the placeholder; keep `buildProgram()` exported) | `src/run/types.ts` | everything |
| **object families** (13 agents) | `src/objects/<family>/<key>.ts` (+ `<key>.test.ts`) for the keys of that family (see `OBJECT_FAMILIES` in `src/objects/registry.ts`) | `src/objects/types.ts`, `src/objects/registry.ts` (imports are already wired to your file names) | `defineObject`, `blockS`, `validateObjectModule`, `materialise`, `applyMapping`, testkit |

Every area may add its own `*.test.ts` files inside its directory. If you need a shared helper that does not exist, put it in **your** area and export it from your `index.ts`; do not edit another area's files.

## 2. Public types (`src/types.ts`) — the vocabulary

- `ObjectKey` (46-key string union; `OBJECT_KEYS` array in §6.1 order; `isObjectKey()`), `CountryCode` (`"US"`, … or `GLOBAL_COUNTRY = "GLOBAL"`), `Unit = { objectKey, country }` + `unitId(unit)` → `"account:US"`.
- `RunMode = 'preflight'|'init'|'delta'|'final-delta'|'verify'|'retry-failed'|'blobs'|'report'`.
- `SourceRow` — an extracted SFDC row: `{ Id: string; IsDeleted?; SystemModstamp?; [column]: unknown }`. Relationship columns are **flattened dotted keys** (`"Account_vod__r.Country_vod__r.Alpha_2_Code_vod__c"`), exactly as Bulk CSV headers. Values from CSV are strings; from REST JSON they are typed. `readSource(row, path)` (in `transform/apply.ts`) reads either form.
- `Payload = Record<targetField, PayloadValue>`; `PayloadValue = string|number|boolean|null|DeferredFk|DeferredUser|DeferredComposite`. **Payloads never contain Vault ids** (§2.3); references are:
  - `DeferredFk` = `{ $fk: { object: ObjectKey, sfdcId } }`
  - `DeferredUser` = `{ $user: sfdcId }`
  - `DeferredComposite` = `{ $composite: { template: "{u}__{t}", parts: { u: DeferredUser, t: DeferredFk|string } } }`
  - guards: `isDeferredFk/isDeferredUser/isDeferredComposite/isDeferredValue`.
- `RowDiagnostic { kind, field?, code?, value?, objectKey?, detail?, fatal? }` — kinds: `skipped|truncated|unresolved_fk|unmapped_picklist|out_of_range|invalid_value|queue_owner_replaced|audit_user_fallback|contact_ref_dropped|out_of_scope_ref_dropped|required_missing|second_pass|deferred_blob|unmapped_user|country_unresolved|custom`. `fatal: true` = the row must not be loaded.
- `RowState` (§2.4 `row_results.state`), `Finding { severity: 'blocking'|'warning'|'info', code, objectKey?, country?, field?, detail, count? }`.
- Policies: `DeletePolicy`, `CreatePolicy`, `UnmappedUserPolicy`, `TruncationPolicy`, `SampleStrategy`, `BlobPolicy`, `LoadOptions`, `MatchRule/MatchKey/MatchMethod` (§3.3), `ScopeSpec` (`full | dated | via-parent`), `CountryOfSpec` (parsed §6.0.5 rule), `RetentionFamily`.
- `TransformSpec` — discriminated union of every §6.0.3 registry entry (see §4 below), `FieldMapping` (one table row), `Requirement = 'K'|'Y'|'y?'|'n'|'-'`, `EvidenceTag`.
- SFDC describe shapes (`SfdcObjectDescribe`, `SfdcFieldDescribe`, …), Vault metadata shapes (`VaultObjectMetadata`, `VaultFieldMetadata`, `VaultObjectTypeConfig`, `VaultLifecycle`, `VaultPicklistValue`), `normaliseVaultType()` (case-insensitive, §2.5.6).
- `ResolvedMetadata` / `ResolvedField` — what a transform sees (type, `maxLength`, `scale`, `picklistValues`, `referenceObject`, `required`, per-object-type required fields, lifecycle states).
- `IdResolver { resolve(objectKey, sfdcId) → vaultId?; resolveUser(sfdcId) → number?; resolveTerritoryByName?(name) }`.
- `CountryContext` (per-country crosswalks & policies), `TransformContext`, `TransformResult`, `CustomTransformFn`.
- `MaterialisedMapping` (per object+country, with `mappingHash`), `ResolvedScope`, `ObjectOptions`, `SelfRef`.
- Store rows: `Watermark`, `IdMapRow`, `RowResult`, `PendingFk`, `FkIndexRow`, `ExtractCheckpoint`, `RunRecord`, `ReconciliationRow`, `MappingSnapshot`, `AuditLogEntry`, `ProbeResult`, `StoredFinding`.

Helpers outside `types.ts` you will use: `src/hash.ts` (`hashObject`, `canonicalJson`, `sha256`, `hash32`), `src/transform/ids.ts` (`to18`, `to15`, `isSfdcId`, `isUserId`, `isQueueId`, `isContactId`, `formatLegacyId`), `src/country-of.ts` (`parseCountryOf`, `formatCountryOf`, `countryOfSoqlPath`, `buildCountryPredicate`, `relationshipName`), `src/transform/rename.ts` (§6.0.2 `renameObject/renameField/renamePicklistValue/renameObjectType/renameStatusField/renameTimezone`), `src/transform/spec.ts` (`parseTransform("ref(account) secondPass")`, `formatTransform`, `innerTransform`, `refTarget`).

## 3. ObjectModule contract (`src/objects/types.ts`)

```ts
export interface ObjectModule {
  key: ObjectKey; source: string; target: string; targetEvidence: EvidenceTag; enabledByDefault: boolean;
  scope: ScopeSpec;               // {kind:'full'} | {kind:'dated', predicates:[{field,type}], openPredicate?, retentionFamily?} | {kind:'via-parent', parentKey, parentField, type?, retentionFamily?}
  countryOf: CountryOfSpec[];     // ordered fallback chain (§6.0.5)
  dependsOn: ObjectKey[];         // every object this one references (ref/refUser targets except 'user' need not be listed... but list them anyway when in §6.2)
  selfRefs: SelfRef[];            // { target, source, objectKey? } — pass-2 patches; objectKey defaults to the module itself
  partitionBy?; orderBy?; depthOrderBy?;
  fields: FieldMapping[];         // Block S rows first, then object-specific rows (complete after defineObject)
  objectTypes: Record<DeveloperName, apiName>; states: Record<status, stateApiName>;
  picklists: Record<mapKey, Record<src, tgt|null>>;   // module crosswalk DEFAULTS (config layers on top)
  deletePolicy; inactivate: {field,value}[]; createPolicy; load: LoadOptions; match: MatchRule[];
  blobs?: Record<blobName, BlobPolicy>; configObjects?: string[]; custom?: Record<fnName, CustomTransformFn>;
  optionDefaults?: Partial<ObjectOptions>;   // module defaults for object-specific flags (loadCallType, vidField, …)
  blockS: BlockSOptions; notes?: string;
}
```

`defineObject(input: ObjectModuleInput)` normalises: parses textual transforms and `countryOf`, fills defaults (`enabledByDefault: true`, `scope: full`, `countryOf: global`, `deletePolicy: ignore`, `createPolicy: create`, `load: { noTriggers: true }`, `match: [{ method: 'legacy_id' }]`), and **prepends Block S** (§6.0.4) via `blockS(key, input.blockS)`. A module row with the same `target` as a Block S row **replaces** it.

`blockS(key, opts)` rows (in order): `Id → legacy_crm_id__v (legacyId, K)`, `Name → name__v (text(128), Y)`, `[status__v statusFromFlag]`, `created_date__v`, `created_by__v`, `modified_date__v`, `modified_by__v`, `ownerid__v`, `[object_type__v.api_name__v]`, `[local_currency__sys]`, `mobile_id__v`, `last_device__v = data_load__v`, `mobile_created_datetime__v`, `mobile_last_modified_datetime__v`, `lock__v`, `override_lock__v`, `unlock__v` (gated by `loadUnlockFlag`), `external_id__v`. Opt-outs: `BlockSOptions { name: 'text'|'autoNumber'|'none'|{nameTemplate}, ownerId, audit, objectType (auto-true when objectTypes given), currency (default off), mobileId, lastDevice, mobileDatetimes, locks, unlock, externalId, statusFromFlag: {sourceFlag, inactiveWhen}, legacyIdField }`. Rows for "if present" fields carry `optionalSource: true` (describe miss = `info`, row dropped).

`FieldMapping` flags you will use: `required` (`K` idParam, `Y` required, `y?` probably, `n`, `-`), `evidence` (`OBS|DOC|UNV|…`), `unverifiedSource` (source guessed → describe miss is `info`), `optionalSource`, `sourceType` (declared SFDC type for `SF_FIELD_TYPE_MISMATCH`), `clearOnNull`, `truncation` (`truncate` default | `fail` | `omit`), `enabledBy: '<flag>'` (row kept only when `objects.<key>.<flag>` is truthy), `disabledBy: '<flag>'` (row dropped when the flag is explicitly `false`), `blobName` (policy key under `objects.<key>.blobs`), `countryConfigurable`, `notes`.

`validateObjectModule(module, allKeys?) → ModuleLintIssue[]` (blocking/warning): unique targets (`MAP_DUP_TARGET`), known/non-self `dependsOn`, transform kinds & `ref()` keys valid, `custom(fn)` defined, `compositeExternalId` tokens covered, exactly one `K` `legacyId`, scope shape (`via-parent` parent must be in `dependsOn`), `countryOf` parent must be in `dependsOn`, `selfRefs` targets mapped and their `objectKey` in `dependsOn`, `ref(<self>)` without `selfRefs`/`partitionBy`/`depthOrderBy` → `MAP_CYCLE_UNDECLARED` (warning), `ref(X)` with `X ∉ dependsOn` → `MAP_FK_PARENT_NOT_DECLARED` (warning). `assertValidObjectModule` throws on blocking issues. **Your module test must assert `validateObjectModule(mod).filter(i => i.severity === 'blocking')` is empty** — `src/objects/registry.test.ts` also asserts it for every registered module.

### 3.1 Cycles and pass 2

`loadOrder()` builds the DAG from `dependsOn` and **removes** the edge `dep → module` when `module.selfRefs` contains an entry with `objectKey === dep` (or the module itself). So: to reference a later/cyclic object, (a) list it in `dependsOn`, (b) map the field with `… secondPass`, (c) declare it in `selfRefs` with `objectKey`. Example: `medical_inquiry` has `dependsOn: [..., 'call2']`, field `Call2_vod__c → call2__v: "ref(call2) secondPass"`, `selfRefs: [{ target: 'call2__v', source: 'Call2_vod__c', objectKey: 'call2' }]` — the stub already does this. `call2.cobrowse_mc_activity__v → ref(multichannel_activity) secondPass` needs the same pattern.

### 3.2 Worked example — `call2_detail` (§6.3.31)

```ts
// src/objects/call2/call2_detail.ts
import { defineObject } from "../types";

export const call2_detail = defineObject({
  key: "call2_detail",
  source: "Call2_Detail_vod__c",
  target: "call2_detail__v",
  targetEvidence: "DOC",
  scope: { kind: "via-parent", parentKey: "call2", parentField: "Call2_vod__r.Call_Date_vod__c", type: "date" },
  countryOf: "parent:call2:Call2_vod__c",
  dependsOn: ["call2", "product"],
  // Block S opt-outs: children have an auto-number Name and no OwnerId (master-detail)
  blockS: { name: "autoNumber", ownerId: false, currency: false },
  fields: [
    // common to all call children (§6.3.31 preamble)
    { source: "Call2_vod__c", target: "call2__v", transform: "ref(call2)", required: "Y", evidence: "DOC", sourceType: "reference" },
    { source: "Attendee_Type_vod__c", target: "attendee_type__v", transform: "picklist(call2_detail.attendeeType)", required: "n", evidence: "UNV" },
    { source: "Entity_Reference_Id_vod__c", target: "entity_reference_id__v", transform: "text", required: "n", evidence: "UNV" },
    { source: "Call2_Mobile_ID_vod__c", target: "call2_mobile_id__v", transform: "copy", required: "n", evidence: "UNV" },
    { source: "Is_Parent_Call_vod__c", target: "is_parent_call__v", transform: "skip", required: "-", notes: "formula" },
    // object-specific rows (§6.3.31 table)
    { source: "Product_vod__c", target: "product__v", transform: "ref(product)", required: "Y", evidence: "DOC", sourceType: "reference" },
    { source: "Detail_Group_vod__c", target: "detail_group__v", transform: "ref(product)", required: "n", evidence: "DOC" },
    { source: "Type_vod__c", target: "type__v", transform: "picklist(call2_detail.type)", required: "n", evidence: "DOC" },
    { source: "Detail_Priority_vod__c", target: "detail_priority__v", transform: "number", required: "n", evidence: "DOC" },
    { source: "Detail_Priority_Text_vod__c", target: "detail_priority_text__v", transform: "text", required: "n", evidence: "UNV" },
  ],
  picklists: {
    "call2_detail.type": { EDetail_vod: "edetail__v", Paper_Detail_vod: "paper_detail__v" },
    "call2_detail.attendeeType": { Person_Account_vod: "person_account__v", Group_Account_vod: "group_account__v", User_vod: "user__v", Contact_vod: null },
  },
  deletePolicy: "delete",
  load: { noTriggers: true },
  match: [{ method: "legacy_id" }, { method: "mobile_id", keys: [{ target: "mobile_id__v", source: "Mobile_ID_vod__c" }] }],
  notes: "Master-detail child of call2; deleted with the parent (§4.4).",
});
```

And its test:

```ts
// src/objects/call2/call2_detail.test.ts
import { describe, expect, it } from "vitest";
import { call2_detail } from "./call2_detail";
import { validateObjectModule } from "../types";
import { materialise, resolveCountry } from "../../config/resolve";
import { applyMapping } from "../../transform/apply";
import { parseConfig } from "../../config/schema";
import { buildCountryContext, buildIdResolver, buildVaultMetadata, resolveMetadata } from "../../testkit";
import { to18 } from "../../transform/ids";

const config = parseConfig({ version: 1, source: { loginUrl: "https://x.my.salesforce.com", auth: { kind: "jwt", clientId: "c", username: "u", privateKeyPath: "k" } }, target: { vaultDns: "x.veevavault.com", auth: { kind: "password", username: "u", password: "p" }, migrationUserId: 1 }, countries: { US: {} } });

describe("call2_detail module", () => {
  it("is structurally valid", () => {
    expect(validateObjectModule(call2_detail).filter((i) => i.severity === "blocking")).toEqual([]);
  });
  it("transforms a row", () => {
    const mapping = materialise(call2_detail, resolveCountry(config, "US"), config, { now: new Date("2026-09-07T00:00:00Z") });
    const metadata = resolveMetadata(buildVaultMetadata("call2_detail__v", [
      { name: "call2__v", type: "Object", object: { name: "call2__v" }, required: true },
      { name: "product__v", type: "Object", object: { name: "product__v" }, required: true },
      { name: "type__v", type: "Picklist", picklist: "type__v" },
    ]), { picklists: { type__v: ["edetail__v", "paper_detail__v"] } });
    const callId = to18("a0K000000000001"), productId = to18("a0P000000000001");
    const ids = buildIdResolver({ call2: { [callId]: "V0K1" }, product: { [productId]: "V0P1" } }, { "005000000000001AAA": 111 });
    const r = applyMapping({ Id: to18("a0D000000000001"), Call2_vod__c: callId, Product_vod__c: productId, Type_vod__c: "EDetail_vod", CreatedById: "005000000000001AAA", CreatedDate: "2025-01-01T00:00:00.000Z" }, mapping, { country: buildCountryContext(), metadata, ids, runMode: "init" });
    expect(r.status).toBe("ok");
    expect(r.payload).toMatchObject({ call2__v: { $fk: { object: "call2", sfdcId: callId } }, product__v: { $fk: { object: "product", sfdcId: productId } }, type__v: "edetail__v" });
    expect(r.payload.name__v).toBeUndefined(); // auto-number name skipped by default
  });
});
```

Things family agents must also deliver per module: `objectTypes` (RecordType DeveloperName → object type api name, all `UNV` unless noted), `states` (status value → lifecycle state) where the object is lifecycled, `inactivate` set per §4.4 (`status__v = inactive__v` is implied — list only the business flag, e.g. `[{ field: 'inactive__v', value: true }]`), `match` precedence per §3.3, `blobs` (`{ signature: 'optional' }`; the US overlay sets `required`), `custom` functions (unit-tested), `optionDefaults` for object-specific flags named in §7.2.1, and `configObjects` for consent config crosswalks. For `[UNVERIFIED-SOURCE]` fields set `unverifiedSource: true`. Keep the `notes` field free of the "STUB" marker.

## 4. Transforms (`src/transform/registry.ts`)

`applyTransform(spec, value, row, ctx) → TransformResult` where `TransformResult` is `{ value, targetField?, diagnostic?, unresolved? }` or `{ omit: true, diagnostic?, defer?: 'secondPass'|'blob', deferredValue?, targetField?, unresolved? }`. Textual form (config overlays) ↔ `TransformSpec`: `parseTransform` / `formatTransform`.

| Kind | Text | Behaviour |
|---|---|---|
| copy | `copy` | scalar passthrough; empty → omit |
| text | `text`, `text(128)` | NFC, trim, strip C0 controls; max = spec ∨ `targetField.maxLength` ∨ 1500; truncation policy from the row |
| longtext / richtext | `longtext`, `richtext` | as text with 32 000 default; richtext keeps b/i/strong/em/ul/ol/li/a/p/br/u, strips the rest (plain text when the target is not RichText) |
| bool / number | `bool`, `number(2)` | `true/false/1/0`; rounds to `scale`, checks `min/max` |
| date / datetime / datetimeToDate | | `YYYY-MM-DD` / `…T..:..:..SSSZ` (UTC); 1700–4000 range → `out_of_range` (`SF_DATETIME_RANGE`), fatal only with `dateRange: fail` |
| picklist / multipicklist | `picklist(account.specialty)` | order: `ctx.country.picklist(mapKey, v)` (layered config) → `ctx.mapping.picklists[mapKey]` (module defaults) → `null` = skip → derivation (`renamePicklistValue`, `__c` when the target field is `__c`) → validated against `targetField.picklistValues` → `onUnmapped` (`error` = fatal, `skip`, `createValue`). Multi: `;` split, `,` joined, literal commas doubled |
| objectType | `objectType(call2.objectType)` | `ctx.mapping.objectTypes` → country picklist map → `renameObjectType`; validates against `metadata.objectTypes`; writes `object_type__v.api_name__v` |
| state | `state(call2.state)` | `ctx.mapping.states` → writes `state__v`; missing state is fatal when the object is lifecycled |
| ref | `ref(account)` | emits `{$fk}`; `unresolved` set when `ids.resolve` misses; Contact ids → `CONTACT_REF_DROPPED` |
| refUser | `refUser` | emits `{$user}`; audit fields (`created_by__v`/`modified_by__v`) fall back to `ctx.migrationUserId` (`AUDIT_USER_FALLBACK`); business fields follow `options.unmappedUserPolicy` (`fail`/`skipRow`/`migrationUser`/`omit`); queue owners (`00G`) → `row.User_vod__c` or migration user (`QUEUE_OWNER_REPLACED`) |
| refLookup | `refLookup(product, external_id__v)` | value verbatim to `product__v.external_id__v` |
| legacyId | `legacyId` | `formatLegacyId(Id, metadata.legacyIdFormat, orgId15)` to `metadata.legacyIdField` |
| country | `country(ref\|iso2\|picklist\|name)` | via `ctx.country.countries` (by SFDC id or ISO-2) |
| territoryRef | | by name via `ids.resolveTerritoryByName`; text when the target is a String |
| nameTemplate | `nameTemplate(person)` | tokens `{FirstName} {MiddleName} {LastName} {Suffix} {Salutation} {Furigana} {separator} {username} {territory}` from `row[token]` / `row[token+'_vod__c']` |
| currency | | `ctx.country.currency(iso)` to `local_currency__sys` |
| userTimezone | | `America/New_York → america_new_york__sys` |
| localeLookup | `localeLookup(language\|locale)` | `ctx.country.locales` → `{target}.name__v` |
| statusFromFlag | `statusFromFlag(Inactive_vod__c, true)`, `…(Status_vod__c, in:Closed_vod,Cancelled_vod)`, `…(X, not:Y)` | `status__v = inactive__v` when the condition holds, else omit |
| const | `const(data_load__v)` | |
| compositeExternalId | `compositeExternalId('{u}__{t}', u=user:UserId, t=ref:territory:Territory2Id, n=field:Name, c=const:X)` | literal when all parts are strings, else `{$composite}` resolved by the loader |
| secondPass | `ref(territory) secondPass` | inner value deferred (`defer: 'secondPass'`) |
| deferredBlob | `deferredBlob(signature)`, `text deferredBlob` | deferred to the blob pass (`defer: 'blob'`) |
| skip / custom | `skip`, `custom(userStatus)` | custom returns a `TransformResult`, a raw `PayloadValue`, or `undefined` (= omit) |

`applyMapping(row, mapping, ctx: ApplyContext) → ApplyResult` (`src/transform/apply.ts`) runs the whole row: `status: 'ok'|'pending_fk'|'failed'|'skipped'`, `payload`, `secondPass`, `blobs`, `diagnostics`, `unresolvedRequiredFks`, `unresolvedOptionalFks`, `fkEdges` (→ `fk_index`), `sourceHash = sha256(canonical({m: mappingHash, p: payload, s: secondPass}))`, `objectType`, `failure`, `skipReason`. Rules: empty source → key omitted unless `clearOnNull` (then `null`); required = `mapping.required[target] ?? (K|Y) ?? metadata.required`; unresolved **required** FK keeps the deferred ref and yields `pending_fk`; unresolved **optional** lookup is omitted; `ctx.country.erased` → `skipped(erased)`.

## 5. Config (`src/config`)

- `loadConfig(path)` / `loadConfigFromText(yaml, env)` → `MigrationConfig` (zod-validated, env-interpolated; `ConfigError.exitCode = 5`). `configHash(config)` ignores secret rotation.
- `resolveCountry(config, iso2) → ResolvedCountryConfig` = defaults ← global ← `regions[R]` ← `countries[ISO]`: `target`, `staging`, `dataResidency`, `scope` (`historyMonths`, `cutoffDate?`, `sampleRetentionMonths?`, `tovRetentionMonths?`, `samplesIncludeCalls`, `objects`), `reconcile`, `postLoad`, `picklists` (`derive`, `onUnmapped`, `leaveReactivated`, `maps[mapKey][src]`), `objects[key]` (merged flags), `fieldLayers[key]` (ordered `fields` blocks), `nameTemplates`, `formats`, `phone`, `postalCode`, `defaultTimezone`, `privacy`, `locales`.
- `materialise(module, countryConfig, config, { now }) → MaterialisedMapping`: field ops applied **per layer** in order (`override` → `remove` → `add`), `enabledBy/disabledBy` flags, `required` overrides, layered picklists (map keys prefixed `<key>.` or referenced by a transform), `objectTypes`/`states` merges, `countryOf` override, scope resolution (family widening only; `SCOPE_NARROWED` warning for non-regulated narrowing; explicit `cutoffDate` = `today − months` in UTC), `load` defaults (`batchSize = performance.vaultBatch`, `migrationMode = target.migrationMode`, `strategy = load.strategy`), `options` (`ObjectOptions` = `OBJECT_OPTION_DEFAULTS` ← module policies ← `optionDefaults` ← config; note `allowTypeChange` defaults `false` for `em_event/call2/sample_transaction/order/medical_inquiry`, `externalIdOwnedBy: integration` for `account/address/product/key_message/clm_*/approved_document/territory`), `findings`, `mappingHash` (sha256 of the canonical mapping; findings excluded).
- `makePicklistLookup(maps)` builds the `CountryContext.picklist` function; `computeCutoffDate(now, months)`.
- Config keys: `MigrationConfigSchema` in `schema.ts` mirrors §7.2.1 exactly; `objects.<key>` accepts the listed keys plus **passthrough** for module-specific flags (they land in `ObjectOptions[flag]` and are readable via `mapping.options.<flag>`; declare defaults in `optionDefaults`).

## 6. Clients and store (interfaces only — implement them)

- `src/sfdc/types.ts` — `SfdcClient`: `orgId`, `apiVersion`, `describeGlobal()`, `describe(obj)`, `recordTypes()`, `query(soql, {all?, batchSize?})` → `AsyncIterable<SourceRow>` (flattened relationship keys), `count(obj, where?)`, `queryIds(obj, ids, columns)` (≤ 400 ids per call, `queryAll` semantics), `explain(soql)`, `bulkQuery(soql, {all?, pkChunking?, resume?, maxRecords?})` → `SfdcBulkResult` (async-iterable of `SfdcBulkPage { jobId, locator, nextLocator, pageNo, rows, csv, records }` + `job: Promise<SfdcBulkJobInfo>`), `abortBulkJob`, `getDeleted`, `getUpdated`, `limits()`, `serverNow()`, `availableVersions()`. Retry classes per §2.1.7 / §8.1 live inside the implementation.
- `src/vault/types.ts` — `VaultClient`: `authenticate/keepAlive/endSession/availableVersions/me`, `vql(q)` → `AsyncIterable<VqlPage>` (picklists normalised to arrays), `vqlCount(q)`, `listObjects/objectMetadata/fieldMetadata/picklistValues/objectTypes/lifecycleStates` (+ optional `createPicklistValues`, `setPicklistValueStatus`), `upsert(obj, rows, { idParam, migrationMode, noTriggers, unchangedFieldBehavior, referenceId })` → `VaultBulkResponse { responseStatus, data: VaultRowResult[], burst }`, `update`, `deleteRecords`, optional `changeType/addAttachment/createUsers/objectAction/limits`, `executeMdl`, `users()`. Throw `VaultApiError(type, message, status, errors)` for non-row failures. `burst` holds the last response's `X-VaultAPI-*` counters.
- `src/store/types.ts` — `StateStore { vaultDns, runs, watermarks, idMap, rowResults, pendingFk, fkIndex, checkpoints, findings, reconciliation, mappingSnapshots, auditLog, probeResults, countryStatus, migrate?, close }`. Every method's semantics are documented inline and pinned by `src/testkit/memory-store.test.ts` — the postgres implementation must pass the same suite. The store is **bound to one target vault** (`vaultDns`); id-map keys are `(objectKey, 18-char sfdcId)`; `put` keeps `firstSeenRun`; a live `(vaultObject, vaultId)` is unique; `merge` sets `mergedInto`/`vaultId`/`matchMethod = merged` and inserts the loser if absent; `markDeleted(…, null)` undeletes; all reads return copies.
- `src/preflight/types.ts` — `Preflight.run(PreflightInput) → PreflightResult { findings, resolvedTargets: Map<objectKey, ResolvedTarget { targetObject, legacyIdField, metadata, rawMetadata, objectTypes, picklists, describe, replicateable, columns }>, mappings (pruned), blockedUnits, blocking, source facts, countries crosswalk }`.
- `src/extract/types.ts` — `Extractor.extractUnit(unit, ExtractPlan) → ExtractManifest { files, fkSets, extractedLive, extractedDeleted, closureRows, sfdcScopeCount, deletedIds, deletedLatestCovered, predicate, columns, queueOwners }`, `closure(ClosureRequest) → ClosureResult`, `readRows(files)`.
- `src/load/types.ts` — `Loader.loadBatches(rows: AsyncIterable<PayloadRow>, LoadPlan) → LoadResult`, `secondPass`, `applyDeletes(DeleteRequest)`, `retryPending`, `loadBlobs?`. `PayloadRow { sfdcId, systemModstamp, payload, secondPass?, sourceHash, objectType?, diagnostics, closure? }` — produced from `ApplyResult` by the run engine.
- `src/reconcile/types.ts` — `Reconciler.reconcileUnit(ReconcileInput) → ReconcileResult { row: ReconciliationRow, findings, pass, diffs?, orphanFks? }`, `sample`, `orphanFks`, optional `keySet`, `fkConsistency`.
- `src/run/types.ts` — `RunEngine.plan(RunOptions) → RunPlan { steps: RunStep[], mappings, modules, cutoffDates, postLoad }`, `execute(RunOptions) → RunSummary { exitCode }`; `EXIT_CODES = { success: 0, blockingFindings: 2, unitFailures: 3, gateFailed: 4, configError: 5 }`. `loadOrder(OBJECT_MODULES, enabledKeys)` from `src/objects/registry.ts` gives the `LoadStep[]` (keys + pass-2 patches); the engine expands keys × countries into units (`GLOBAL` objects once).

## 7. Testkit (`src/testkit`)

```ts
import { FakeSfdcClient, FakeVaultClient, MemoryStateStore, buildDescribe, buildVaultMetadata, resolveMetadata,
         buildCountryContext, buildIdResolver, buildTransformContext, buildMaterialisedMapping,
         sampleAccountRows, sampleCall2Rows, sampleAccountDescribe, sampleCall2Describe,
         sampleAccountVaultMetadata, sampleCall2VaultMetadata, IDS, SAMPLE_USER_ID, SAMPLE_QUEUE_ID } from "../testkit";
```

- `FakeSfdcClient` — `addDescribe(describe)`, `addRows(obj, rows)`, `upsertRow`, `deleteRow(obj, id, deletedDate)` (sets `IsDeleted` + feed), `addDeleted`, `addRecordTypes`, `getRows`; `calls[]` records every call; `failNext = { method, error, remaining }` injects errors. SOQL subset: `SELECT cols|COUNT() FROM obj [WHERE …] [ORDER BY …] [LIMIT n]` with `= != < <= > >= IN NOT IN LIKE AND OR NOT ( )`, `null/true/false`, quoted strings, unquoted date/datetime literals; dotted paths read flattened keys first. `query` hides `IsDeleted = true`; `{ all: true }` shows them; unknown columns throw `INVALID_FIELD`. `bulkQuery` pages by `bulkPageSize` (default 2) with `loc-N` locators and honours `resume`. `getDeleted` throws for `replicateable: false` describes.
- `FakeVaultClient` — `addObject(metadata, records?)`, `putRecord`, `addPicklist(name, values)` (inactive values hidden from `picklistValues`), `addObjectTypes`, `addLifecycle`, `addUsers`, `records(obj)`, `record(obj, id)`, `expireSession()`, `calls[]` (with `headers` = write options), `failNext`, `rowFailures[]`. Requires `authenticate()` first (`INVALID_SESSION_ID` otherwise; > 20 auths → `API_LIMIT_EXCEEDED`). `upsert` enforces ≤ 500 rows, unique `idParam`, duplicate keys in a batch, unknown columns, required fields on create, and skips audit/state/inactive-status fields unless `migrationMode`. VQL subset: `SELECT f FROM o [WHERE a = 'x' AND b != null AND c IN (…) AND d CONTAINS (…) AND e LIKE 'x%'] [ORDER BY f] [PAGESIZE n|LIMIT n|MAXROWS n] [SKIP n]`; `PAGESIZE 0` returns only `total`; Picklist fields come back as arrays.
- `MemoryStateStore` — the reference `StateStore`; helpers `seedIdMap(objectKey, vaultObject, { sfdcId: vaultId }, country?)`, `idResolver()`.
- Fixtures: `buildDescribe(name, fields, { systemFields, recordTypes, replicateable, keyPrefix })`, `buildVaultMetadata(name, fields, { objectTypes, lifecycles, legacyIdField, allowAttachments, systemManagedName })`, `resolveMetadata(meta, { picklists, objectTypes, lifecycle, legacyIdField, legacyIdFormat })`, `buildCountryContext({ iso2, picklists, countries, nameTemplates, picklistPolicy, locales, currencies, erased })`, `buildIdResolver(map, users, territories)`, `buildTransformContext({...})`, `buildMaterialisedMapping({ objectKey, fields, ... })`, sample Account/Call2 rows + describes + Vault metadata, `IDS` (checksum-correct ids).

## 8. Conventions recap

- **Evidence tags** on every mapping row (`evidence`) and module (`targetEvidence`); `UNV` names must survive preflight pruning without code changes.
- **Block S** is never repeated in modules — only opt-outs via `blockS: {...}` and overrides by same-target rows.
- **`[UNVERIFIED]` handling**: default + preflight validation + safe degradation; never a thrown error in transforms for a missing target field (preflight drops the row from the materialised mapping first).
- **Config keys**: only those in §7.2.1 (`MigrationConfigSchema` is strict at every level except `objects.<key>` passthrough and `picklists` map keys). Module-specific flags must be listed in the module's `optionDefaults` with their default.
- **Findings codes**: use the exact codes from §5.1–5.3 and §7; new codes must be prefixed by area (`SF_`, `VT_`, `MAP_`, `SCOPE_`, `CONFIG_`, `EXTRACT_`, `LOAD_`, `RECON_`, `PROBE_`).
- **Determinism**: transforms are pure; order-independence is asserted by hashing; keys inside a `LoadStep` follow `OBJECT_KEYS` order.
