# Vault CRM Regression Testing — Gap Analysis & Plan

Status: proposal, 2026-07-31. Scope: make Lastest a credible tool for **Veeva Vault CRM release regression** in regulated life sciences.

---

## 1. What the segment actually needs (researched)

### The forcing function

- Legacy Salesforce-based Veeva CRM end-of-support was **pulled forward from Sep 2030 to 31 Dec 2029**. Bulk migration window is **2026–2029** — right now.
- **Vault CRM ships 3 validated Major Releases per year** plus minor releases; the Vault platform ships 2 (R1 spring, R2 fall). Every release is a forced upgrade the customer did not schedule.
- Every migration project *and* every release wave produces the same deliverable: **evidence that the customer's own configuration still works**.

### What Veeva gives you vs. what the customer still owes

Veeva ships a validation package per release: project plan, requirements spec, test protocol, **IQ/OQ**, traceability matrix, validation summary report. That covers the *platform*.

It does **not** cover the customer's own configuration: custom objects, page layouts, MyInsights dashboards, CLM presentations, Approved Email templates, territory/alignment rules, integrations. That gap is **PQ/UAT**, and it is done today by consultants executing manual test scripts with screenshots pasted into Word. That is the budget Lastest is going after.

### Environment model

- **Prerelease sandbox** — self-service entitlement on production/preproduction vaults, available before GR and for ~4 weeks after. This is the *only* place release-wave regression can run.
- **Full Data Sandbox** — replica of prod config + metadata + data, **refreshable**. A refresh resets everything.
- So the real cycle is: prerelease sandbox appears → run regression → diff vs. production baseline → file findings → GR lands.

### Technical surface

- Vault CRM is Veeva's own web stack (no longer Salesforce Lightning), but has the same automation hazards: component-scoped shadow roots, runtime-generated ids, heavy async rendering. Playwright pierces open shadow roots natively — this is a genuine structural advantage over Selenium-based incumbents.
- **Vault REST API + VQL** (and the open-source VAPIL Java client, Postman collections) give first-class programmatic record create/query/delete — so API-based test data seeding and teardown is *available*, not blocked.
- Veeva explicitly does not certify its internal automation tooling for customer use, and states customers must validate their own tooling.

### Incumbents

- **Opkey** — GxP-compliant, "100% validated for 21 CFR Part 11", 500+ prebuilt Veeva Vault tests. The one to beat.
- **Spotline V-Assure** — reads Vault config, generates IQ/OQ/PQ scripts, outputs 21 CFR Part 11 / EU Annex 11 / GAMP 5 formatted reports.

Both sell **evidence documents**, not test runs. That is the product category.

---

## 2. What Lastest has today (code audit)

### Test data / spreadsheets / variables — the good part

Two data-source backends, structurally identical:

| | Google Sheets | CSV |
|---|---|---|
| lib | [src/lib/google-sheets/](src/lib/google-sheets/) | [src/lib/csv/](src/lib/csv/) |
| queries | `integrations.ts` | [csv-sources.ts](src/lib/db/queries/csv-sources.ts) |
| storage | OAuth + `cachedHeaders`/`cachedData` | uploaded file under `storage/csv-sources/` + same cache |
| token | `{{sheet:alias.column[row]}}` | `{{csv:alias.column[row]}}` |
| forms | column / cell (`A1`) / whole-row-as-JSON | same |

**Variables** — [`TestVariable`](packages/db/src/schema.ts#L708), stored as jsonb on the `tests` row:

- `mode: "assign" | "extract"`
- `sourceType: "gsheet" | "csv" | "static" | "ai-generated"` (+ AI presets: names, email, UK/US address, phone, custom prompt)
- `sourceRowMode: "fixed" | "increment" | "random"` — increment walks a per-test cursor (`tests.variableRowCursors`) across runs
- extract mode reads a page field post-test (`targetSelector` + `attribute`) and can assert `expectedValue` with a severity

**Resolution** — [`resolveTestCodeForRunner()`](src/lib/execution/executor.ts#L157): purely **textual substitution into the test source** before the code is handed to the runner. Row picks are made once per run so all occurrences agree.

### Honest limits of that design

1. **One-way, read-only.** No write-back to the sheet/CSV, so no "record the created Account id for the next test".
2. **Flat and scalar.** A row is strings. No relational fixtures (Account → Call → Call Product), no dependency ordering, no referential integrity.
3. **No lifecycle.** No seeding before, no teardown after. Data must already exist in the target system.
4. **Not environment-scoped.** A data source is repo-scoped and global; there is no "QA dataset vs. UAT dataset".
5. **String substitution, not binding.** Values are baked into code and hashed into the run. Fine for typing into a form; wrong for anything the app returns.
6. **No PII handling.** `cachedData` is stored in plaintext jsonb. HCP names in a pharma dataset are regulated personal data.

### Environments

[`environmentConfigs`](packages/db/src/schema.ts#L1511) is effectively a **per-repo singleton**: one `baseUrl`, `startCommand`, `healthCheckUrl`. Multi-environment is faked via `repositories.branchBaseUrls` (branch → URL).

**Baselines are keyed by `branch`** ([`baselines`](packages/db/src/schema.ts), `branch` + `browser` + `stepLabel`). There is no environment dimension at all. A Vault customer has no branches — they have PROD / UAT / QA / prerelease sandbox.

### Compliance surface

- **No audit-log table anywhere.** `grep auditLog|audit_trail` → zero hits.
- Approvals record `approvedBy` (text) + `approvedAt` on baselines and layer baselines. No reason-for-change, no re-authentication, no signature manifest, no immutability.
- Roles: `owner | admin | member | viewer` on team membership. **No author ≠ approver segregation.**
- Evidence export today = a public `/r/<slug>` share link. Not an auditor artifact.

### Things that are already right

- `provider: "local"` repositories exist and are creatable ([repos.ts:256](src/server/actions/repos.ts#L256), API route, public-shares) — **no-repo mode is technically present**; onboarding just pushes GitHub first.
- Playwright-based → shadow DOM piercing for free.
- 9-layer check model (`src/lib/verify/`) with enforce/log/disable already generalises past pixels: dom, network, console, a11y, url, text.
- `storageStates` + `setupScripts` + per-test setup chain — the auth plumbing for a long-session enterprise login exists.
- `step_comparisons` + `layer_baselines` + change maps give per-step, per-layer verdicts — the right granularity for a test protocol.

---

## 3. Gap analysis

Ordered by whether it blocks a sale. **B** = blocks first paid pilot, **P** = blocks production rollout, **D** = differentiator.

### B1 — No-repo onboarding path
Present in the data model, absent in the funnel. Onboarding demands GitHub. A pharma QA lead has no repo.
→ Small. Mostly UI + copy.

### B2 — Environment as a first-class object
Need `environments` (PROD / PREPROD / UAT / QA / PRERELEASE-26R2), each with base URL, credentials ref, dataset ref, and **baselines keyed by environment, not branch**. Plus baseline **promotion** (UAT baseline → PROD baseline) and **survival of a sandbox refresh** (a refresh must not orphan every baseline).
→ Largest single schema change. Touches `baselines`, `layer_baselines`, `visual_diffs`, `builds`, comparison-mode logic.

### B3 — Vault-native test data management
Needs, beyond spreadsheets:
- Vault REST/VQL connector: authenticate, create records, query, delete.
- **Seed → run → teardown** lifecycle per test/suite.
- Relational fixtures with dependency ordering and id capture (create Account → bind `{{fixture:account.id}}` → create Call).
- Per-environment datasets.
- PII masking / synthetic HCP generation (the `ai-generated` var source is the seed of this — extend presets to HCP/HCO/NPI/product).
→ Medium-large. The API is documented and open; this is buildable.

### B4 — Enterprise auth into the app under test
Entra ID / Okta / SAML with MFA, service accounts, long-session refresh, session keep-alive across a 2-hour suite. `storageStates` is the right primitive but MFA and expiry are unhandled.
→ Medium.

### B5 — Requirements traceability
Test ↔ requirement ↔ defect ↔ evidence. Integrations with **Jira, Azure DevOps, Xray/Zephyr/qTest, and Vault QMS itself**. GitHub Issues is a non-starter — enterprise QA does not live in GitHub.
→ Medium. Start with a generic `requirements` table + external-ref field + one connector.

### B6 — Vendor-change test impact analysis
Smart Run selects tests from git diffs. In this segment the change comes from Veeva. Need: ingest the release notes / prerelease sandbox → map to affected objects/pages → surface at-risk tests. This is the "we tell you what 26R2 breaks before it lands" pitch.
→ Medium. Highest-differentiation item on the list.

### P1 — Audit trail (21 CFR Part 11 §11.10(e))
Append-only, tamper-evident, who/what/when/**why**, covering every approval, config change, and baseline mutation. Defined retention. **No table exists today.**
→ Medium. Do it once, properly, or it is worthless.

### P2 — Electronic signatures (§11.50 / §11.70)
Re-authentication at approval, printed name + date/time + meaning of signature, signature bound to the record.
→ Small on top of P1.

### P3 — Segregation of duties
Author ≠ approver enforced. Test manager role. Formal execution cycles with sign-off.
→ Small-medium. Current RBAC is dev-tool grade.

### P4 — Auditor-grade evidence export
Signed PDF execution report: test protocol, steps, expected vs. actual, screenshots with timestamps, approver identity, deviations, summary. **This is the deliverable the buyer is actually purchasing.**
→ Medium. `step_comparisons` already holds the data.

### P5 — Validation package for Lastest itself
IQ/OQ documentation, vendor audit pack, change-control release notes. Regulated buyers validate the tool before using it.
→ Documentation work, not engineering. Cheap. Blocks procurement.

### P6 — Security & procurement
SOC 2 Type II, pen test report, DPA, security questionnaire answers, sub-processor list. `docs/gdpr/` exists — that is a start, SOC 2 is not.
→ External spend + time. Start early, it is calendar-bound.

### P7 — Air-gapped / private install
Internal registry images, no phone-home, AD/LDAP, proxy support. Self-host already exists; the hardening does not.
→ Medium.

### D1 — Functional + data assertions
"Call report submits → record exists in Vault with correct fields" spans UI + API + data. Visual diff alone is a feature, not a regression suite. The `network` and `url` layers plus a Vault/VQL assertion layer get most of the way.
→ Medium. Highest product value after B3.

### D2 — Locale coverage
Vault CRM is deployed multi-language across affiliates. Date/currency/text-region diffing must hold across locales.
→ Small-medium; mostly OCR-service work.

### D3 — Scale ergonomics
Thousands of tests, campaign scheduling, quota management, flake triage at volume, suite-level parallelism.
→ Medium. The EB pool already exists; UX does not.

### Explicitly out of scope
**SAP GUI / thick client / Citrix.** Playwright cannot do it. Vault CRM is browser + iPad/Windows native apps — cover the browser, decline the native apps, say so plainly.

---

## 4. Plan

### Phase 0 — Services first (weeks 0–8, no engineering prerequisite)

Run release-wave regression **for** one or two customers, using Lastest internally, output hand-assembled Word/PDF evidence. Requires almost none of the above.

Purpose: prove the segment is real, get paid in weeks, and let the customer's actual objections order Phases 1–3 instead of this document ordering them.
Price: fixed-fee €15–40k per release wave / migration validation.

### Phase 1 — "Runnable by the buyer" (weeks 4–14)
Goal: a Vault QA lead can onboard and get a green run without a developer.

1. **B1** no-repo onboarding — surface `provider: "local"` in the funnel, drop the GitHub gate, replace "repository" language with "application".
2. **B2** environments + environment-keyed baselines + promotion + refresh survival.
3. **B4** enterprise auth: SAML/MFA-tolerant storage-state capture, session keep-alive, service accounts.
4. **B3a** Vault REST/VQL connector, read-only first (query records to assert against).

Exit: a prerelease-sandbox regression run against a real customer config, unassisted.

### Phase 2 — "Buyable" (weeks 12–26)
Goal: survives QA/compliance review.

5. **P1** audit trail — append-only, hash-chained, reason-for-change on every mutation.
6. **P2** e-signature at approval (re-auth + meaning + binding).
7. **P3** author ≠ approver, test-manager role, execution cycles with sign-off.
8. **P4** signed PDF evidence export.
9. **P5** IQ/OQ + vendor audit pack for Lastest itself.
10. **B5a** generic requirements model + one connector (Jira first, Xray second).

Exit: passes a customer's supplier-qualification questionnaire.

### Phase 3 — "Defensible" (months 6–12)
11. **B3b** full TDM: seed/teardown lifecycle, relational fixtures with id capture, per-environment datasets, PII masking, synthetic HCP/HCO generation.
12. **D1** Vault data assertions as a check layer (UI action → VQL verification).
13. **B6** vendor-change impact analysis from release notes + prerelease sandbox diffing. **The headline feature.**
14. **P6** SOC 2 Type II (start the clock at Phase 1 — it is calendar-bound, not effort-bound).
15. **D3** scale ergonomics; **D2** locale coverage; **P7** air-gapped install.

### What to stop
Arcade, gamification, leaderboard, launch board off the homepage. They actively read as "hobbyist toy" to this buyer and produce zero pipeline.

### Open-source decision (do it now, it is checkable in 5 seconds)
935 commits / 3 stars / 0 releases / PRs not accepted, next to "best open-source alternative to Chromatic". Either commit (tagged releases, accept PRs, docs site) or demote it from headline positioning. For a regulated buyer, "source-available, self-hostable, air-gapped" is a *stronger* claim than "open source" anyway — and it is true today.

### The one metric
Not signups, not stars: **number of paid release-wave engagements delivered.** In Phase 2+, accounts that ran a second regression cycle against a new release.

---

## 5. Effort summary

| Phase | Items | Rough effort | Unblocks |
|---|---|---|---|
| 0 | services delivery | 0 eng | revenue in weeks |
| 1 | B1, B2, B3a, B4 | ~10–14 eng-weeks | first pilot |
| 2 | P1–P5, B5a | ~14–20 eng-weeks | first purchase order |
| 3 | B3b, B6, D1, D2, D3, P6, P7 | ~6 months | defensibility vs. Opkey |

The uncomfortable part: Phase 2 is almost entirely unglamorous compliance plumbing, and it is the phase that converts interest into money.

---

## 6. The data gap — data-driven coverage model

This is the part that also fixes the QA agent's "how far should I go?" problem. Same mechanism, two payoffs.

### 6.1 The problem, stated precisely

**Business need:** a Vault CRM regression suite must exercise the same journey across *many data variants in one environment* — Call Report for each country × call type × channel × product; Account for each HCP/HCO record type; MyInsights per territory; Approved Email per locale. The journey is one test. The risk lives in the data combinations.

**What Lastest measures today:**

- [`getRouteCoverageStats()`](src/lib/db/queries/routes.ts#L48) — `withTests / totalRoutes`, where a route counts as covered if *any* test exists in its functional area. Binary, surface-based.
- [`computeQaSummary()`](src/lib/qa-agent/plan.ts#L998) — a business-area × test-group matrix (9 groups: journey/smoke/api/ui/hybrid/a11y/perf/resilience/negative). Better, but the rows are LLM-invented `businessArea` strings, not anything derived from data.
- [`MAX_PLAN_ITEMS = 20`](src/lib/qa-agent/plan.ts#L102) — an arbitrary hardcoded backstop, explicitly documented as "defensive". Overflow trims by priority.

So the agent's stopping rule is literally a constant, and coverage is "does this page have a test". Neither has any relationship to the data space. **That is why the agent doesn't know when to stop or what is worth doing** — nothing in the system can answer either question, so the agent can't either.

**Execution gap:** [`TestVariable.sourceRowMode`](packages/db/src/schema.ts#L725) is `fixed | increment | random` — **one row per run**. `increment` walks a cursor across *successive* runs. There is no fan-out: one test cannot execute as N runs across N data rows in a single build. Data diversity within an environment is currently impossible to express.

**Baseline gap:** baselines are keyed `(test, stepLabel, branch, browser)`. Two countries running the same step would fight over one baseline. Any matrix execution is blocked on this — and it's the same key change Phase 1 (**B2**) already makes for environments.

### 6.2 The model

Three new concepts. The design goal is that **coverage becomes a measured quantity over a data space**, not a page count.

**Dimension** — a field on an object type with an enumerable value domain, plus the observed distribution.

```
coverage_dimensions
  id, repositoryId, environmentId
  objectType        -- 'call__v', 'account__v', or a DB table name
  field             -- 'country__v', 'call_type__v'
  label
  valueSource       -- 'profiled' | 'csv' | 'sheet' | 'manual'
  sourceAlias       -- FK-ish link to a csv/gsheet data source when applicable
  values  jsonb     -- [{ value, label, recordCount, share }]
  profiledAt
```

**Cell** — a combination of dimension values that **actually occurs in the data**, with a weight.

```
coverage_cells
  id, repositoryId, environmentId, objectType
  coords  jsonb     -- { country: 'DE', callType: 'Detail', channel: 'F2F' }
  observedCount     -- how many real records match
  weight  numeric   -- see 6.4
  status            -- 'uncovered' | 'planned' | 'covered' | 'failing' | 'excluded'
  excludedReason    -- why we deliberately are not testing this
  lastRunAt, lastVerdict
```

**Assignment** — which run exercised which cell.

```
coverage_cell_runs
  cellId, testResultId, buildId, verdict
```

### 6.3 The cheap unlock

`resolveTestCodeForRunner()` already computes `assignedVariables: Record<string, string>` per run and **already persists it on the `test_results` row** ([executor.ts:172](src/lib/execution/executor.ts#L169)).

That map *is the cell coordinate of that run.* Coverage per cell is computable from data Lastest already writes, with zero new instrumentation in tests. Step 1 of this whole workstream is a backfill query, not a feature.

Likewise, the existing CSV/Sheets caches are already value domains — a "Countries" sheet's `cachedHeaders`/`cachedData` is a dimension. **v1 of the profiler needs no SUT connector at all.**

### 6.4 Weighting — "mit van értelme csinálni"

Every cell gets a score. This is what gets handed to the AI as a priority ordering, and it must be explainable, not a black box:

```
weight(cell) =
    w_vol   * norm(log1p(observedCount))       -- real-world volume
  + w_crit  * criticality(objectType, area)    -- from functional-area config
  + w_fail  * historicalFailureRate(cell)      -- from coverage_cell_runs
  + w_churn * configChurn(cell)                -- vendor release touched this object (feeds from B6)
  - w_dup   * redundancy(cell)                 -- near-neighbour already covered
```

`redundancy` is what prevents combinatorial explosion: if `DE/Detail` and `FR/Detail` both pass, `ES/Detail` carries little new information.

Cells that do **not** occur in the data are never generated. 12 countries × 8 call types = 96 combinations, but production may only contain 41. Testing the other 55 is pure waste — and today nothing in the system knows that.

### 6.5 Stopping rule — "meddig menjen"

Replace the `MAX_PLAN_ITEMS = 20` constant with a principled target. The established answer to "how far into a combinatorial space" is **combinatorial test design**: target *t-way* coverage rather than the full cartesian product.

Default policy:

- **2-way (pairwise) coverage of occurring value pairs = 100%.** For 12 countries × 8 call types × 4 channels this is ~15–20 runs instead of hundreds, and empirically catches the large majority of interaction defects.
- **3-way** only for cells above a risk threshold (high volume × high criticality × recent vendor churn).
- **Weighted volume coverage ≥ 90%** — the covered cells must account for 90% of real record volume.

The agent halts when:

```
stop when
     pairwiseCoverage      >= target        (default 1.00)
 AND weightedVolumeCoverage>= target        (default 0.90)
  OR marginalWeight(nextBestCell) < epsilon (default 0.01)
  OR budget (minutes | €) exhausted
```

And — this is the part that matters for trust — **every stop is explained**:

> Stopped at 47 tests. Pairwise coverage 100%, weighted volume 92%. Next best cell (PT / Sample Drop, 0.3% of volume) is below the 1% marginal threshold. 55 combinations excluded: not present in data.

The agent can now justify both what it did *and what it deliberately did not do*. That is the missing artifact.

### 6.6 What the planner is fed instead

Today: a page snapshot digest + "write ~20 tests". Unverifiable.

New: a **ranked cell list**.

```json
[{ "objectType": "call__v",
   "coords": { "country": "DE", "callType": "Detail", "channel": "F2F" },
   "weight": 0.14, "observedCount": 48210,
   "covered": false, "lastFailure": "2026-05-02", "churn": "26R2 touched call__v layout" }]
```

The planner's job becomes "produce tests that cover these cells", which is **checkable after the fact** — run the tests, read `assignedVariables`, confirm the cells went green. Plan quality stops being a matter of trusting the LLM.

### 6.7 Matrix execution — data diversity in one environment

Needed on top of the current variable system:

1. **`sourceRowMode: "matrix"`** — executor fans one test out into N runs, one per selected row. The single largest change to [`resolveTestCodeForRunner()`](src/lib/execution/executor.ts#L157), which today returns one resolved code string.
2. **Row selector expressions** — bind a test to a *slice*, not a row: `country IN (DE, FR, IT)`, or `where: weight > 0.05`, or `cells: pairwise(country, callType)` so the coverage engine picks the rows.
3. **Cell-keyed baselines** — extend the baseline key to `(test, step, environment, dataCell, browser)`. Same migration as **B2**; do them together, once.
4. **Representative-cell visual policy** — do *not* store a PNG baseline per cell; storage and review load would explode. One designated representative cell per slice gets the visual layer; the remaining cells run the cheap layers (dom / network / url / data assertions). This is the practical mitigation, and it needs to be a first-class setting, not a convention.
5. **Write-back / id capture** — extend variables so a created record's id can be captured and bound downstream (`{{fixture:account.id}}`). Prerequisite for relational fixtures in **B3b**.

### 6.8 Where the numbers come from

Two profilers, in this order:

1. **Lastest-side (no connector, build first):** `test_results.assignedVariables`, `coverage_cell_runs`, per-test failure history, `step_comparisons`, `routes`, `functional_areas`, and existing CSV/Sheet caches. Gives dimensions, historical failure rate, current coverage. Enough to ship the whole model without touching the customer's system.
2. **SUT-side (real distributions):** Vault VQL — `SELECT country__v, call_type__v, COUNT(*) FROM call__v GROUP BY ...` — via the **B3a** connector. Generic SQL and REST profilers after. This is what turns `observedCount` from a guess into a fact, and it is the same connector Phase 1 already builds.

### 6.9 Per-object-type reporting (the data-driven spec)

The coverage report rolls up three ways, all from `coverage_cells`:

- **per object type / table** — `call__v: 41 cells, 38 covered (93%), 96% weighted volume`
- **per dimension** — `country: 12/12 values touched; call_type: 7/8 (Sample Drop uncovered)`
- **per cell** — the full grid, with weight, status, exclusion reason, last verdict

That grid, exported, *is* the PQ test protocol coverage matrix a validation auditor asks for. It is the same artifact as **P4** (evidence export) — build the model once, sell it twice.

---

## 7. Data-workstream plan

Runs alongside Phases 1–3, not after them. **D0 has no prerequisites and should start immediately** — it is independent of the whole Vault decision and improves the QA agent for every existing customer.

| | Work | Effort | Depends on | Delivers |
|---|---|---|---|---|
| **D0** | Dimension registry + Lastest-side profiler (CSV/Sheets caches + `assignedVariables` backfill) + cell ledger + read-only coverage report | 2–3 wks | none | *We can measure.* Per-object-type coverage today. |
| **D1** | Matrix execution: `sourceRowMode:"matrix"`, row selectors, cell-keyed baselines, representative-cell visual policy | 3–4 wks | B2 (same key migration) | Per-country / per-call-type diversity in one environment |
| **D2** | Weighting + pairwise generator + stop rule; planner fed ranked cells; **delete `MAX_PLAN_ITEMS`**; stop-reason surfaced in UI | 2–3 wks | D0, D1 | *The agent knows when to stop and can explain why* |
| **D3** | SUT profilers (Vault VQL first, then SQL/REST); config-churn signal from vendor release notes | 4+ wks | B3a, B6 | Real distributions; release-aware prioritisation |
| **D4** | Write-back / id capture → relational fixtures | folded into B3b | D1 | Seed → run → teardown chains |

### Sequencing note

D0 → D2 is the highest-leverage sequence in this entire document. It is ~6 weeks, needs no Vault connector, no compliance work, and no customer, and it converts the QA agent from "generates 20 tests and hopes" into "covers a measured space and reports what it skipped and why". That claim is demonstrable in a sales call, and it is the same engine that produces the coverage matrix a validation auditor requires.

### Risks

- **Cell explosion in storage/review.** Mitigated by 6.7 item 4 (representative-cell visual policy). Must be designed in from D1, not retrofitted.
- **Garbage dimensions.** A profiler that auto-detects dimensions from free-text fields produces thousands of useless values. Cap cardinality (default: skip fields with >50 distinct values unless explicitly marked as a dimension) and require confirmation for auto-detected dimensions.
- **Weight tuning becomes a black box.** Keep the formula in 6.4 literally visible and editable in settings, with per-term contribution shown on each cell. If a user cannot see why a cell ranked first, they will not trust the stop.
- **`assignedVariables` backfill quality.** Historical runs whose tests had no variables produce no cells. Coverage will look worse before it looks better — say so up front rather than shipping a number that appears to regress.

---

## 8. Revised phase table

| Phase | Items | Rough effort | Unblocks |
|---|---|---|---|
| **D0–D2** | data coverage model, matrix execution, stop rule | ~6–10 eng-weeks | **start now** — helps every existing customer, no Vault dependency |
| 0 | services delivery | 0 eng | revenue in weeks |
| 1 | B1, B2, B3a, B4 | ~10–14 eng-weeks | first pilot (B2 shares the baseline-key migration with D1) |
| 2 | P1–P5, B5a | ~14–20 eng-weeks | first purchase order |
| 3 | B3b, B6, D1(assertions), D3, D2(locale), P6, P7 | ~6 months | defensibility vs. Opkey |

---

## Sources

- [About Vault CRM Releases — Veeva](https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/General/AboutCRMReleases.htm)
- [About Vault Releases — Veeva Release Notes](https://rn.veevavault.help/en/gr/about-vault-releases/)
- [Prerelease FAQ — Veeva](https://rn.veevavault.help/en/gr/pre-release-faq/)
- [Using a Full Data Sandbox — Vault CRM Help](https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/FullDataSandbox.htm)
- [Veeva Vault Validation Features Brief](https://www.veeva.com/resources/veeva-vault-validation-product-brief/)
- [Veeva Professional Services — CSV whitepaper (PDF)](https://www.veeva.com/wp-content/uploads/2025/04/Veeva-Professional-Services-Project-_Computer-Systems-Validation-CSV-whitepaper.pdf)
- [Veeva Vault Developer Portal — API reference](https://developer.veevavault.com/docs/api/v4/)
- [VAPIL — Vault API Library (GitHub)](https://github.com/veeva/vault-api-library)
- [Veeva CRM to Vault CRM Migration: roadmap & timeline — IntuitionLabs](https://intuitionlabs.ai/articles/veeva-vault-crm-migration-roadmap)
- [Veeva Salesforce split — GRAX](https://www.grax.com/blog/veeva-split-from-salesforce/)
- [Opkey — Veeva testing](https://www.opkey.com/veeva)
- [Spotline V-Assure for Veeva Vault](https://spotline.com/v-assure-designed-for-veeva-vault)
- [Salesforce test automation with Playwright — Testrig](https://www.testrigtechnologies.com/salesforce-test-automation-with-playwright-challenges-setup-and-proven-strategies/)
