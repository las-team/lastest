# @lastest/veeva-crm-migration

Extract the functional configuration of a **Veeva CRM** org (the Salesforce-based
product), document it **per country and per rep category**, and plan or apply
the equivalent setup in **Veeva Vault CRM**.

One function, four stages:

| Stage      | Input                    | Output                                                            |
| ---------- | ------------------------ | ----------------------------------------------------------------- |
| `extract`  | Salesforce credentials   | `snapshot.json` — profiles, objects, layouts, VMOCs, settings, …   |
| `document` | `snapshot.json`          | `docs/` — `README.md`, `profiles.md`, `<CC>/<category>.md`, intake |
| `plan`     | `snapshot.json`          | `vault-plan/` — MDL files, API calls, manual checklist, summary    |
| `apply`    | `vault-plan/` + Vault    | `apply-report.json` — dry-run by default, `--execute` to run       |

The package is consumed as TypeScript source (no build step) and has **zero
runtime dependencies**: Salesforce and Vault are called through native `fetch`.

## Usage

```ts
import { migrateVeevaCrmConfig } from "@lastest/veeva-crm-migration";

const result = await migrateVeevaCrmConfig({
  stages: ["extract", "document", "plan"], // "apply" is never implied
  outDir: "./out",
  sfdc: {
    kind: "client_credentials",
    loginUrl: "https://acme.my.salesforce.com",
    clientId: process.env.SFDC_CLIENT_ID!,
    clientSecret: process.env.SFDC_CLIENT_SECRET!,
  },
  countries: ["DE", "FR"], // optional filter for document/plan
  repCategories: ["sales_rep", "msl"], // optional filter
});
```

Or from the CLI (credentials come from the environment, never from flags):

```bash
# Salesforce: SFDC_INSTANCE_URL + SFDC_ACCESS_TOKEN, or SFDC_CLIENT_ID + SFDC_CLIENT_SECRET
#             (+ SFDC_LOGIN_URL = My Domain), or SFDC_CLIENT_ID + SFDC_USERNAME + SFDC_JWT_PRIVATE_KEY
# Vault:      VAULT_DNS + VAULT_SESSION_ID, or VAULT_DNS + VAULT_USERNAME + VAULT_PASSWORD
pnpm --filter @lastest/veeva-crm-migration cli extract  --out ./out
pnpm --filter @lastest/veeva-crm-migration cli document --out ./out --countries DE,FR
pnpm --filter @lastest/veeva-crm-migration cli plan     --out ./out --classification ./rules.json
pnpm --filter @lastest/veeva-crm-migration cli apply    --out ./out                 # dry-run
pnpm --filter @lastest/veeva-crm-migration cli apply    --out ./out --execute --allow-review
```

Flags: `--countries`, `--rep-categories`, `--objects`, `--include-managed`,
`--api-version`, `--classification <file>` (classifier rules and overrides),
`--keep-empty-profiles`, `--execute`, `--allow-review` (run the steps flagged
`review`), `--continue-on-error`, `--async-mdl`. Run `--help` for details.

Run `extract` against a **sandbox**: the Salesforce daily API limit is shared
org-wide, and a full extract of a mid-size org needs a few thousand calls
(field-level-security pages dominate).

## What "configuration" means here

The extraction covers what makes a Veeva CRM org behave the way it does for a
given profile, and nothing that is data:

- Profiles and permission sets: object CRUD, field-level security, tab and app
  visibility, record-type visibility, page-layout assignments, active users per
  country (aggregate counts only, no names or e-mails).
- Objects in scope (Veeva core set by default, every non-managed custom object,
  optionally every `_vod__c` object): fields, picklists, record types, page
  layouts, validation rules.
- VMOCs (`VMobile_Object_Configuration_vod__c`), Veeva Settings hierarchy custom
  settings (org / profile / user level), Veeva Messages.
- An inventory of Apex triggers, flows and workflow rules, flagged when they
  contain country logic. These have no Vault CRM equivalent and are listed for
  manual follow-up.

Apex bodies, reports, dashboards, sharing rules, territory models and record
data are out of scope.

## Rep categories and countries

- **Rep category** is a property of the Salesforce profile, because the profile
  is the axis on which Veeva Settings, VMOCs, layouts and record types vary.
  Categories: `sales_rep`, `specialty_rep`, `kam`, `msl`, `manager`,
  `inside_sales`, `admin`, `other`. A regex table over the profile name decides
  (see `src/model/classify.ts`), with fallbacks on `User_Type_vod__c` and licence
  hints, and explicit overrides via `classify.categoryOverrides`.
- **Country** comes from active users' `Country_Code_vod__c` (then standard
  `CountryCode` / `Country`), from country tokens in profile names (`DE Sales
  Rep`) and from VMOC where clauses. A profile with no country signal goes to the
  `global` bucket.
- Every profile is listed in `docs/profiles.md` with its category, countries and
  the reason for the decision, so a wrong guess is visible in one place.

## Documentation model: global core + local delta

Each `<CC>/<category>.md` describes what the country's profiles of that category
actually get (object access, layouts, FLS, VMOCs, settings, messages) and then a
**delta vs global**: only the items that differ from the category's global
baseline, each with an id, the global and local values, and an empty reason-code
column (`REG` / `LANG` / `INTEG` / `PROC` / `LEGACY`) for the country business
admin to fill. Absence means inheritance; "same as global" is never written.

`docs/intake-template.md` is the short specification request, pre-filled from
the extract so the business admin only confirms or corrects.

## How to request the specification (brief)

Distilled from `docs/research/04-specification-best-practices.md`:

1. Extract the as-is automatically before asking anyone anything. Admins know
   their process, not their settings; pre-filled questions turn "describe your
   setup" into "confirm or correct".
2. Build one matrix, rep type × country → profile, from active-user counts.
   Empty cells are candidates to drop, not migrate.
3. Document global core + local delta, and require a reason code on every delta.
   That is what makes countries give up deltas they no longer need.
4. Run one 2–3 hour fit-gap session per country walking the pre-filled intake
   with confirm / change / drop decisions. No open-ended requirement gathering.
5. Keep a decision log and a RACI from day one, naming who signs the local delta.
6. Put requirement ids on every row so the workbook doubles as the GAMP 5
   configuration specification.

## Vault CRM setup

`plan` maps each component to its Vault CRM counterpart and emits, in dependency
order: picklists → custom objects and fields → object types → page layouts →
permission sets → security profiles → application profiles → Veeva Settings
records → VMOC records → manual steps. Steps are `mdl` (executed through
`POST /api/mdl/execute`), `api` (Vault REST calls) or `manual` (checklist).

- One security profile, permission set and application profile per country × rep
  category (`sp_de_sales_rep__c`, `ps_de_sales_rep__c`, `app_de_sales_rep__c`).
  Permissions of several profiles in the same group are OR-merged, and every flag
  not shared by all of them is listed in the step notes and in `unmapped.md`.
- Generated MDL uses `CREATE` / `ALTER … ADD`, never `RECREATE`, so a component
  that already exists fails its statement instead of being replaced.
- Steps generated from an unverified MDL grammar or mapping carry `review: true`
  and are skipped by `apply` unless `--allow-review` is given.
- Everything with no Vault equivalent (Apex, flows, validation rules, user-level
  settings, objects outside the extract set) lands in `unmapped.md` and the
  manual checklist. Customer-modified Veeva Messages become
  `translations/<lang>.csv` for the Message Catalog import.

`vault-plan/` contains `plan.json`, `steps.md`, `manual-checklist.md`,
`unmapped.md`, one `<CC>/<category>.mdl` per group plus `GLOBAL/all.mdl`, and
`translations/` when there are messages to carry over.

`apply` is idempotent (an existence pre-check before every step; records are
looked up by name and updated instead of duplicated), stops on the first
failure unless told otherwise, and is a dry-run unless `--execute` is given.

## Assumptions and open questions

Stated in full in `docs/DESIGN.md` §9. The important ones:

- **Documentation hosts were unreachable** while this package was written
  (`developer.salesforce.com`, `help.salesforce.com`, `crmhelp.veeva.com`,
  `developer.veevavault.com` are blocked by the authoring environment's network
  policy). Endpoint paths were cross-checked against open-source client sources
  (`docs/research/05-verified-endpoints.md`); everything else is marked as
  verified, inferred or unverified in `docs/research/`.
- Whether the Tooling REST `Profile` object exposes a `Metadata` blob is
  unverified. Without it, record-type visibility per profile has no fetch-only
  source and is flagged in the snapshot warnings.
- Vault MDL grammar for `Permissionset`, `Securityprofile` and `Pagelayout`
  sub-components is representative, not verified. Apply one generated step to a
  sandbox, fetch it back with `GET /api/mdl/components/{type}.{name}`, diff, and
  adjust `src/vault/mdl.ts`.
- Vault object and field names follow the `_vod__c → __v` suffix rule; the ones
  not individually confirmed are marked in `src/vault/mapping.ts`.
- API versions: Salesforce is discovered at runtime; Vault defaults to `v26.2`.

## Layout

```
src/
  model/    types, classification, baseline/delta computation, country table
  sfdc/     Salesforce client (OAuth client-credentials / JWT / token), queries, extractor
  docs/     Markdown renderer (index, profiles, country and category pages, intake template)
  vault/    Vault client, mapping table, MDL generators, planner, applier, plan writer
  index.ts  migrateVeevaCrmConfig()
  cli.ts
docs/
  DESIGN.md          the implementation design, with a list of where the code deviates
  research/          research notes with sources and uncertainties
```

Tests: `pnpm vitest run packages/veeva-crm-migration`. Typecheck:
`pnpm --filter @lastest/veeva-crm-migration typecheck`.
