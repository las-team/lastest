# @lastest/veeva-migration

Veeva CRM (Salesforce) → Vault CRM data migration tool: extracts from the
Salesforce org, matches or creates records in the Vault CRM vault, and keeps
the two in sync until cutover.

- **Spec:** [`docs/MIGRATION_SPEC.md`](docs/MIGRATION_SPEC.md) — the normative
  contract (scope, architecture, ID matching, delta strategy, preflight checks,
  per-object mapping tables, country configuration). Every vendor API name in it
  carries an evidence tag; anything `[UNVERIFIED]` is a configurable default
  that preflight validates against live metadata.
- **Builder guide:** [`docs/CONTRACTS.md`](docs/CONTRACTS.md) — module
  contracts, how to write an object module, the testkit.
- **Config reference:** [`config/README.md`](config/README.md) and
  [`config/migration.example.yaml`](config/migration.example.yaml).

## What it does

| Stage         | Module           | Summary                                                                                                                                                       |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight     | `src/preflight`  | Describe-driven source checks, Vault metadata checks (target fields, types, lengths, required-per-object-type, FK target objects, picklists, object types, lifecycle states), legacy-id field resolution, offline mapping lints. Blocking findings stop the run (exit 2). |
| Extract       | `src/extract`    | SOQL scope predicates per object (explicit cutoff literal, open-item terms, retention widening), REST vs Bulk API 2.0 selection, streaming CSV to the run dir, FK id-set collection, FK-closure of older parents, delete routing.               |
| Transform     | `src/transform`  | Pure transform registry (§6.0.3), mechanical rename rule, `applyMapping` producing payloads + diagnostics + source hash; FKs resolved only through the id crosswalk.                                                                          |
| Load          | `src/load`       | 500-row bulk upserts by legacy id with `X-VaultAPI-MigrationMode` / `NoTriggers` / `UnchangedFieldBehavior`, pre-existing record matching, pending-FK rounds, second-pass self-reference patches, delete/inactivate policies, blob pass.       |
| Reconcile     | `src/reconcile`  | Count invariants, Vault counts by VQL, orphan FK checks, stratified read-back sampling, cutover gate.                                                                                                                                         |
| Run           | `src/run`        | Unit planning (object × country), FK-topological load order with declared cycles broken in pass 2, run modes, watermarks, resumability, reports.                                                                                              |
| State         | `src/store`      | Id map (SFDC id → Vault id per vault), watermarks, row results, pending FKs, checkpoints, findings, reconciliation, audit log. Memory, file (NDJSON) and Postgres implementations behind one contract.                                        |
| Clients       | `src/sfdc`, `src/vault` | Salesforce (JWT bearer / client credentials, REST, Bulk API 2.0, describe cache, limits) and Vault (session auth, burst-limit pacing, VQL paging, metadata, bulk records, MDL, Users API).                                            |

### Objects

46 object modules under `src/objects/<family>/<key>.ts`, one per
Veeva CRM → Vault CRM pair (accounts, addresses, child accounts, affiliations,
territories/TSF, products, product metrics, key messages, CLM presentations and
slides, approved documents, sample lots/transactions/inventories, EM events
with attendees/speakers/team members/venues/catalog, expense headers/lines,
medical events and attendees, medical inquiries, account plans, calls with
details/discussions/key messages/samples, orders and lines, sent emails and
email activities, multichannel consent/activities/lines, users, countries).
Each module declares its field mapping rows, object-type and picklist
crosswalks, scope, country derivation, dependencies, self-references, match
rules, delete policy and load flags; `validateObjectModule` lints every module
in its test.

### Init vs delta

- `init` — full extract (master data in full, activity data scoped to the last
  `scope.historyMonths`, default 24, widened per country for regulated
  families), idempotent upsert by legacy id, watermark set only after the unit
  succeeds.
- `delta` — `SystemModstamp` window with overlap and safety lag, deleted-row
  feed (or key-set reconciliation for non-replicateable objects), closure for
  newly referenced parents, hash-skip of unchanged rows.
- `final-delta` — delta with a frozen high watermark and a reconciliation gate.
- `--dry-run` on any mode writes nothing to Vault or the watermarks.

### Countries

Configuration layers `defaults ← global ← regions.<R> ← countries.<ISO>` and is
materialised per (object, country) into a hashed mapping. Shipped overlays:
regions EU, NA, APAC, LATAM; countries US, DE, JP, CN, BR, CA, FR, NL, ES, IT,
GB, AU, MX, KR, CH. Per country you can override scope windows, object
enablement, field mappings, required fields, picklist crosswalks, object-type
and state maps, name templates, delete policies, load flags, target vault and
data residency.

## Usage

```bash
# from the repo root
pnpm --filter @lastest/veeva-migration cli preflight   --config cfg.yaml --wave eu1
pnpm --filter @lastest/veeva-migration cli init        --config cfg.yaml --wave eu1 --country DE --dry-run --limit 1000
pnpm --filter @lastest/veeva-migration cli init        --config cfg.yaml --wave eu1
pnpm --filter @lastest/veeva-migration cli delta       --config cfg.yaml --wave eu1
pnpm --filter @lastest/veeva-migration cli final-delta --config cfg.yaml --wave eu1 --freeze-at 2027-03-06T22:00:00Z
pnpm --filter @lastest/veeva-migration cli verify      --config cfg.yaml --wave eu1
pnpm --filter @lastest/veeva-migration cli retry-failed --config cfg.yaml --run <run_id>
pnpm --filter @lastest/veeva-migration cli report      --run <run_id>
```

Exit codes: `0` success, `2` blocking preflight findings, `3` unit failures,
`4` reconciliation gate failed, `5` config error.

Library use:

```ts
import { loadConfig, runPreflight, runMigration, OBJECT_MODULES } from "@lastest/veeva-migration";
```

Start from `config/migration.example.yaml`; secrets are referenced as `${ENV}`.

## Development

```bash
pnpm vitest run packages/veeva-migration                       # 1190 hermetic tests (fakes, no network)
pnpm exec tsc --noEmit -p packages/veeva-migration/tsconfig.json
pnpm eslint packages/veeva-migration
MIG_TEST_DATABASE_URL=postgres://… pnpm vitest run --config vitest.integration.config.ts packages/veeva-migration
```

## Status and caveats

- Vendor documentation hosts were unreachable during research, so several
  target object/field names are derived by the rename rule and tagged
  `[UNVERIFIED]`; preflight confirms or degrades them against live metadata.
  See spec §9 for the full list.
- Not implemented: Vault Loader API load strategy, `POST /query` JSON body for
  long id lists, forward schema migrations for the Postgres store.
- Country overlays use illustrative customer field names; replace them with the
  programme's real field inventory before preflight.
