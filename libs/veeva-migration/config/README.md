# `config/` — shipped configuration and country overlays

This directory holds the reference configuration for `@lastest/veeva-migration`
and the built-in region / country overlays that the tool merges beneath your own
config file. The normative description is `docs/MIGRATION_SPEC.md` §7.

```
config/
├── migration.example.yaml   # complete key reference (§7.3 / §7.2.1) — copy and edit
├── regions/<R>.yaml         # body of `regions.<R>`      (EU, NA, APAC, LATAM)
└── countries/<ISO>.yaml     # body of `countries.<ISO>`  (US, DE, JP, CN, BR, CA, FR, NL, ES, IT, GB, AU, MX, KR, CH)
```

## 1. Layering

Every country resolves to one fully materialised configuration (§7.1):

```
defaults (tool built-ins)  ←  global (top level of your file)  ←  regions.<R>  ←  countries.<ISO>
```

Later layers win. Two merge steps happen before that:

1. **Shipped overlays beneath your file** — `mergeOverlays(config)`
   (`src/config/countries.ts`). For every country in your `countries:` block
   that has a shipped `countries/<ISO>.yaml`, the shipped body is placed
   _beneath_ your block, and the region it names is added from
   `regions/<R>.yaml` (beneath your `regions.<R>` if you have one). So

   ```yaml
   countries:
     DE: {} # ← already carries the whole §7.4.2 Germany overlay
   ```

   Rules: your scalars replace; objects merge recursively;
   `objects.<key>.fields` blocks merge **by target** (`add`/`override` rows with
   the same `target` replace the shipped row, new targets are appended,
   `remove` lists are unioned, `required` maps merge); any other array
   (`inactivateBy`, `load.orderBy`, `countryOf` lists, …) is replaced wholesale
   by yours. Unreferenced overlays are never loaded — a `${ENV}` inside one
   (CN vault credentials) is only required when you actually list that country
   and do not override the key. Pass `overlays: EMPTY_OVERLAYS` (or the CLI's
   equivalent) to opt out entirely.

2. **Per-country resolution** — `resolveCountry(config, iso2)` merges
   defaults ← global ← region ← country. `objects.<key>.fields` blocks are kept
   **per layer** and applied in order (override → remove → add per layer) by
   `materialise()`, so a region `remove` beats a global `add`, and a country
   `add` beats both. Picklist maps are merged value by value with the same
   precedence: `(country) → (region) → (global) → module defaults → derivation
   (strip_vod_lowercase_v) → onUnmapped`.

Field-map entries are matched by **target field name**: an overlay entry with
the same target replaces the module row, `remove: [target]` deletes it, `add`
appends (or replaces a same-target row), `required: {target: bool}` adjusts the
requirement used by preflight (`VT_REQUIRED_UNMAPPED`) and by row validation.

## 2. What can be overridden per country (§7.2)

Every key below may be set at the top level, under `regions.<R>` or under
`countries.<ISO>` (last wins). One-line examples:

| Area                     | Key                                                                                                                                                                              | Example                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scope window             | `scope.historyMonths`, `scope.cutoffDate`, `scope.sampleRetentionMonths`, `scope.tovRetentionMonths`, `scope.samplesIncludeCalls`, `scope.objects.<key>.historyMonths`           | `scope: { sampleRetentionMonths: 36, samplesIncludeCalls: true }` — family retention may only **widen** the window (§7.2)            |
| Object enable/disable    | `objects.<key>.enabled`                                                                                                                                                          | `objects: { sample_transaction: { enabled: false } }` — FKs into it are omitted (`MAP_FK_PARENT_NOT_IN_PLAN`)                        |
| Country derivation       | `objects.<key>.countryOf`                                                                                                                                                        | `objects: { product: { countryOf: "field:Country_Code__c" } }` (§6.0.5 grammar)                                                      |
| Field map                | `objects.<key>.fields.add[]`, `.override[]`, `.remove[]`                                                                                                                         | `fields: { add: [{ source: Furigana_vod__c, target: furigana__v, transform: text }], remove: [npi__v] }`                             |
| Required fields          | `objects.<key>.required.<field>`                                                                                                                                                 | `objects: { account: { required: { furigana__v: true } } }`                                                                          |
| Picklist value maps      | `picklists.<object>.<field>.<sourceValue>` (`null` = skip value)                                                                                                                 | `picklists: { account.credentials: { "Dr. med.": dr_med__c, Unknown: null } }`                                                       |
| Object-type map          | `objects.<key>.objectType`                                                                                                                                                       | `objects: { account: { objectType: { Hospital_DE: hospital__c } } }`                                                                 |
| State map                | `objects.<key>.state`                                                                                                                                                            | `objects: { call2: { state: { Submitted_vod: submitted_state__v } } }`                                                               |
| Name templates           | `nameTemplates.person`, `.speaker`, `.userTerritory`, `.separator`                                                                                                               | `nameTemplates: { person: "{LastName}{separator}{FirstName}", separator: "　" }`                                                     |
| Date/number formats      | `formats.date`, `.datetime`, `.decimalSeparator`, `.thousandsSeparator`                                                                                                          | `formats: { decimalSeparator: ",", thousandsSeparator: "." }` — CSV/SQL staging inputs only, never the API side                      |
| Phone normalisation      | `phone.normalise`, `phone.defaultRegion`                                                                                                                                         | `phone: { normalise: true, defaultRegion: DE }` — E.164 when unambiguous                                                             |
| Postal code              | `postalCode.pattern`, `postalCode.onMismatch`                                                                                                                                    | `postalCode: { pattern: "^\\d{5}$", onMismatch: warn }` — validation only                                                            |
| Address line 1 overflow  | `objects.address.line1Overflow`                                                                                                                                                  | `objects: { address: { line1Overflow: spillToLine2 } }` (`truncate` / `spillToLine2` / `fail`)                                       |
| Delete policy            | `objects.<key>.deletePolicy`                                                                                                                                                     | `objects: { sample_transaction: { deletePolicy: ignore } }`                                                                          |
| Load flags               | `objects.<key>.load.noTriggers`, `.migrationMode`, `.batchSize`, `.partitionBy`, `.orderBy`, `.sampleStrategy` (+ `.fallbackStrategy`, sample family only), `.createPolicy`      | `objects: { sample_transaction: { load: { sampleStrategy: noTriggersRecalc, fallbackStrategy: triggersOnTransactions } } }`          |
| Post-load                | `postLoad.recalculateRollups`, `postLoad.updateCorporateCurrency`                                                                                                                | `postLoad: { recalculateRollups: required }` (US)                                                                                    |
| Unmapped-user policy     | `objects.<key>.unmappedUserPolicy`                                                                                                                                               | `objects: { call2: { unmappedUserPolicy: migrationUser } }` — fallback user is always `target.migrationUserId`                       |
| Erasure suppression      | `privacy.erasureListPath`                                                                                                                                                        | `privacy: { erasureListPath: ./privacy/de-erasures.csv }` — rows (and children) skipped with `ERASED_SKIPPED`, never resurrected     |
| Target vault / residency | `target.vaultDns`, `target.apiVersion`, `target.auth`, `dataResidency`, `staging.databaseUrl`, `staging.runDir`                                                                  | `target: { vaultDns: acme-crm-cn.veevavault.cn }`, `dataResidency: cn`, `staging: { databaseUrl: "${MIG_DATABASE_URL_CN}" }` (CN)    |
| Default timezone         | `defaultTimezone`                                                                                                                                                                | `defaultTimezone: Asia/Tokyo` — used by `emEventLocalTimes` when the source has no tz                                                |
| Wave membership          | `waves[].countries[]`, `waves[].freezeAt`                                                                                                                                        | `waves: [{ name: eu1, countries: [DE, FR], freezeAt: "2027-01-15T22:00:00Z" }]` (global only)                                        |
| Reconciliation           | `reconcile.sampleSize`, `reconcile.tolerance`                                                                                                                                    | `reconcile: { sampleSize: 500 }` — `final-delta` forces tolerance 0                                                                  |
| Picklist policy          | `picklists.derive`, `picklists.onUnmapped`, `picklists.leaveReactivated`                                                                                                         | `picklists: { onUnmapped: skip }`                                                                                                    |
| Privacy                  | `privacy.consentFullHistory`, `privacy.crossBorderTransfer`                                                                                                                      | `privacy: { consentFullHistory: true, crossBorderTransfer: forbidden }`                                                              |
| Module-specific flags    | `objects.account.vidField`, `.contactToPersonAccount`, `.useParentIdFallback`, `.loadFormattedName`, `.depthOrder`; `objects.call2.loadCallType`, `.loadDeviceFields`; … (§7.2.1) | `objects: { email_activity: { loadIpAddress: false } }` — any extra key under `objects.<key>` passes through to `mapping.options`    |

Global-only keys (`source`, `legacyId`, `delta`, `performance`, `extract`,
`load`, `pendingFk`, `preflight`, `locales`, `objects.user.*`, `regions`,
`countries`, `waves`) are rejected inside a region or country block.

`${VAR}` and `${VAR:-default}` are resolved from the environment after YAML
parsing. **Inside a YAML flow map the reference must be quoted**
(`{ clientId: "${SF_CLIENT_ID}" }`); block style (`clientId: ${SF_CLIENT_ID}`)
is fine either way.

## 3. Adding a country

1. Create `config/countries/<ISO>.yaml` (upper-case ISO-3166 alpha-2 name) with
   the body of `countries.<ISO>` — usually `region: <R>` plus the market
   specifics: `defaultTimezone`, `postalCode`, `phone`, `nameTemplates`,
   `privacy`, `objects.account.fields` (customer `__c` fields, `remove` of the
   US-only `npi__v` / `pdrp_*` rows), `objects.address` (`brick__v`, `state_province__v`
   requirement, `remove` of the US licence fields) and `picklists.address.state`.
   A file for a new region goes in `config/regions/<R>.yaml`; regions are
   `[A-Z][A-Z0-9_]*`.
2. Never hand-key ids or labels that only exist in one org (consent
   `configMaps`, event configurations) into a shipped overlay — they belong in
   the customer's own file (see the commented block in `countries/DE.yaml`).
3. Keep `${ENV}` references out of shipped overlays unless the value is a
   secret or a residency-bound endpoint (as in `CN.yaml`); they are demanded
   only when that country is listed.
4. Reference it from your config: `countries: { <ISO>: {} }` (plus a wave
   entry). Every wave country must have a `countries.<ISO>` block —
   `CONFIG_COUNTRY_NO_OVERLAY` is a config error (exit 5) otherwise.
5. Run `veeva-migration preflight --config … --country <ISO>`. Unverified
   target field names in the overlay degrade to `VT_FIELD_MISSING` warnings
   (the row is dropped from the materialised mapping), picklist target values
   are validated against the vault, and `SCOPE_NARROWED` warns when a
   non-regulated object is narrowed below the global window.
6. `src/config/countries.test.ts` parses every shipped file against the zod
   schema and asserts the expected file set — update `EXPECTED_COUNTRIES`
   when you add one.

Picklist crosswalks in the shipped overlays carry the values named in the spec
plus the geographic enumerations that are fixed by standard (US states, DE
Länder, BR UFs, JP prefectures, MX entidades, CN provinces — marked `[GEN]` in
the files). Specialties, credentials and reasons are filled by the programme
per org; the spec's `"…": "…"` placeholders are not shipped.

## 4. Regulatory pattern notes (§7.4.9 — all `[GEN]`, confirm with counsel)

| Regime                                 | Countries                                   | Tool consequence                                                                                                                                      |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GDPR / UK GDPR `[GEN]`                 | EU/EEA, GB                                  | `regions/EU.yaml`: `consentFullHistory: true`, erasure list per country, EU-hosted vault (`dataResidency: eu`), `email_activity.loadIpAddress: false` |
| PIPEDA + Quebec Law 25 `[GEN]`         | CA                                          | as the GDPR pattern (erasure list, consent history); residency per counsel — the shipped overlay keeps the NA vault                                    |
| LGPD `[GEN]`                           | BR                                          | as the GDPR pattern; transfer with safeguards — shipped overlay uses the Americas vault (`regions/LATAM.yaml`)                                         |
| PIPL `[GEN]`                           | CN                                          | separate CN vault + CN staging (`countries/CN.yaml`), `privacy.crossBorderTransfer: forbidden` — the tool refuses to write CN rows to a non-CN vault    |
| APPI `[GEN]`                           | JP                                          | audit log as record of provision; `dataResidency: jp` (`regions/APAC.yaml`)                                                                           |
| PIPA + Korean sample law `[GEN]`       | KR                                          | GDPR pattern + `scope.sampleRetentionMonths: 36`                                                                                                      |
| nFADP `[GEN]`                          | CH                                          | GDPR pattern — `countries/CH.yaml` ships (`region: EU`, `dataResidency: eu`) although CH is not in a §7.3 wave                                          |
| PDMA / 21 CFR 203 `[GEN]`              | US                                          | `countries/US.yaml`: `sampleRetentionMonths: 36`, `samplesIncludeCalls: true`, signature blobs `required`, `postLoad.recalculateRollups: required`      |
| Sunshine / EFPIA / Loi Bertrand ToV `[GEN]` | US, EU                                 | `scope.tovRetentionMonths` on the `tov` family (`em_*`, `expense_*`) — 60 months in `regions/EU.yaml`                                                  |

Data residency of the tool itself (§7.5): one staging DB and run directory per
`dataResidency`; the CLI refuses to run a country whose residency differs from
the host's `MIG_REGION` unless `--allow-cross-region` is given (and logged).
