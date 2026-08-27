# Pharma / Vault CRM — Restricted Scope Profile

Status: proposal, 2026-08-26. Branch `feat/pharma-readyness`.

Companion to [vault-crm-gap-analysis.md](vault-crm-gap-analysis.md), which asks
"what do we have to build to sell into regulated life sciences". This document
asks the two narrower questions that are actually blocking today:

1. **What has to work for the MuniConS Vault/CRM tests to run at all?**
2. **What should the product stop showing this buyer?**

Nothing here supersedes the gap analysis. It cites its item ids (B1–B6, P1–P7,
D1–D3) rather than re-deriving them.

---

## 1. What the MuniConS bundle actually is

`~/dev/municons-demo` — 11 tests across 7 functional areas, generated from
`tests/` into `municons-tests-bundle.json` by `build-bundle.mjs`.

**Nine run** against `municons.com`, a WordPress marketing site:

| Test | Exercises | Platform function it leans on |
|---|---|---|
| `00-release-gate` | 34 routes, status + console + requestfailed, staging-host and mixed-content detection | network + console capture, nav retry |
| `01-environment-integrity` | resolved `body` background origin per locale | in-page `evaluate` |
| `02-locale-parity` | 18 DE↔EN pairs, mutual `hreflang`, `html[lang]`, orphan detection | multi-route walk |
| `03/04` funnels | contact + career forms, 3 file uploads, stops before POST | form fill, upload |
| `05-consent-gate` | no tracker request, no tracking cookie before consent | request interception, cookie read |
| `06-accessibility-baseline` | alt coverage, exactly one `<h1>` | DOM assertions |
| `07/08` visual sweeps | 21 DE + 20 EN full-page shots | visual layer + baselines |

**Two are quarantined placeholders** — `09-veeva-vault-release-regression` and
`10-salesforce-release-regression`. They are the pitch. Per the demo's own
README, they have **never run against a real sandbox**.

So: the nine prove the engine. They prove nothing about Vault. Section 2 is
what stands between the placeholders and a first green run.

---

## 2. Functions required to execute the Vault / CRM tests

Read line-by-line off `tests/09-*.js` and `tests/10-*.js`.

| # | What the test does | Function needed | Status |
|---|---|---|---|
| 1 | `process.env.VAULT_USER` / `VAULT_PASSWORD` / `SF_USER` / `SF_PASSWORD` | Per-repo **named secret store**, injected into the test process at execution | **Missing — verified, see §2.1** |
| 2 | `process.env.VAULT_DOC_ID` (seeded fixture doc) | Fixture-ref binding | Partial — `TestVariable` `sourceType:"static"` covers it, but the test reads `process.env`, so it depends on #1 |
| 3 | Login form fill + submit | `getByLabel` / `getByRole` fill | Works |
| 4 | `#doc_info/<id>` hash-route navigation, `waitForSelector` | Playwright nav | Works |
| 5 | Lifecycle state + available user-action list read via `allInnerTexts()` | Declarative "expected action set for this role" assertion | Ad-hoc today. Belongs in the **text/dom layer**, not in each test's body |
| 6 | Part 11 §11.50 manifestation must contain name / date / **meaning** | Text-layer enforcement on a step region | Layer exists; `text` defaults to `log` — see §3.2 |
| 7 | Opens the signature dialog and **cancels** — never signs | **Platform write-guard**, not a per-test comment | **Missing — see §2.2** |
| 8 | Audit-trail row count > 0 (§11.10(e)) | DOM assertion | Works. The *evidence* of it is not retained as an auditor artifact — P1/P4 |
| 9 | Visual baselines: doc viewer, library, tasks | Visual layer + baselines | Works, but baselines are keyed by **branch**. A Vault customer has PROD/UAT/prerelease, not branches — B2 |
| 10 | Vault doc viewer / some Vault surfaces render in **iframes** | `frameLocator` traversal, and recorder authoring across frames | **Gap** — `frameLocator` appears nowhere in the repo |
| 11 | Salesforce Lightning web components | Open shadow-root piercing | Works — Playwright does this natively |
| 12 | A 2-hour suite behind Entra/Okta SAML + MFA | Long-session auth, keep-alive, service accounts | B4. `storageStates` is the right primitive; MFA and expiry unhandled |
| 13 | Screenshots of a CRM containing HCP / patient-adjacent data | PII masking **before** the PNG is stored | Partial — `src/lib/playwright/dynamic-masking.ts` has timestamps/relative-times; no name/NPI/email presets |

### 2.1 The blocker: there is no secret store

`ONBOARDING.md` tells the customer to put `VAULT_USER` / `VAULT_PASSWORD` in
"Settings → Environment". **That surface does not exist.**

Verified:

- `environment_configs` ([settings.ts:178](../packages/db/src/schema/settings.ts#L178))
  holds `baseUrl` / `startCommand` / `healthCheckUrl` / `reuseExistingServer`.
  No key-value pairs, no secrets.
- There is no env-var management component in `src/components/settings/`.
- The executor never builds an `env:` map for the runner, and
  `packages/embedded-browser/src/test-executor.ts` reads only infra vars
  (`EB_BOOTSTRAP_TOKEN`, `LASTEST_URL`, …).

So `process.env.VAULT_USER` inside a test resolves against the EB container's
own process environment. Both placeholder tests are structurally unrunnable.

The one existing encrypted credential path —
`setup_configs.authConfig`, encrypted at rest via
[`crypto-fields.ts`](../src/lib/crypto-fields.ts) — is API-seeding only and is
never exposed to a browser test.

**Do not close this by setting `VAULT_USER` on the EB fleet env.** That makes a
customer's Vault service-account password a fleet-wide shared secret held by
every EB pod — precisely the anti-pattern `CLAUDE.md` documents for
`SYSTEM_EB_TOKEN`, and the reason dynamic EBs get per-session bootstrap tokens
instead. The secret must be per-repo, encrypted with the same
`crypto-fields.ts` primitive, and injected per execution into that one run's
process env.

This is the smallest item on the list and it gates every other Vault item.

### 2.2 The write-guard (segment-specific, new)

Both placeholder tests open a mutating dialog and cancel it, with a comment
explaining why:

> Cancel — do not actually sign. A signed record in a validated sandbox is an
> audit-trail entry that cannot be removed.

That is a convention living in a code comment. One careless edit — or one
AI-authored test — writes to a validated system, and the resulting audit entry
cannot be removed. It is also the first thing a pharma QA lead will ask about.

The platform can enforce it, and it already has the machinery: the **network
layer records all HTTP traffic** and gates on responses. Proposed:

- Per-repo **validated-system mode**. When on, any non-idempotent request
  (`POST` / `PUT` / `PATCH` / `DELETE`) to the SUT origin that is not on an
  explicit allowlist fails the step and the build.
- Allowlist entries carry a typed reason, the same way a coverage cell
  exclusion does.
- The run report states the guard was active and lists what it allowed.

This extends a principle the coverage work already committed to and documented
— *"Profilers are read-only. No customer points a tool holding write
credentials at a validated GxP system."* — from the data path to the browser
path.

It is also the strongest claim in the segment: **the tool cannot write to your
validated system, and every run proves it.** Incumbents sell evidence
documents; nobody sells the guarantee.

---

## 3. The restricted scope — a `regulated` profile

One team flag, `regulatedMode`, sitting beside `earlyAdopterMode` and
`gamificationEnabled` on `teams`
([identity.ts:62](../packages/db/src/schema/identity.ts#L62)). Everything below
reads off it.

Three rules it encodes:

1. **Nothing probabilistic produces a verdict.** AI may author; it may never adjudicate.
2. **Nothing leaves the tenant without an authenticated identity attached.**
3. **Nothing on screen suggests the tool is a game.**

### 3.1 Test scope

| In scope | Note |
|---|---|
| Procedural Playwright tests | The only execution mode in the bundle; the only one an auditor can read |
| Setup chains + storage-state auth | `default_setup_steps`, `storage_states` — the long-session primitive |
| Matrix / data-driven runs | `sourceRowMode:"matrix"` + `rowFilter`. Country × call type × channel is *the* pharma shape |
| Coverage matrix + specification export | Already the PQ protocol coverage artifact — `/coverage` → Specification |
| API tests | Once the Vault REST/VQL connector lands (B3a). Until then the `api` layer has nothing to assert against |

| Out of scope | Why |
|---|---|
| Explorer autonomous crawls **in an evidence build** | Non-deterministic run content cannot be an execution record. Keep the feature; exclude its runs from evidence cycles |
| AI-generated test data for regulated fields | Synthetic HCP/HCO/NPI is fine and wanted (B3b) — but it must be *labelled synthetic* in the record, not silently generated |
| Gamified authoring (Bug Blitz scoring on test writing) | Incentivising volume against a validation protocol is the wrong incentive, and it reads as unserious |
| SAP GUI / thick client / Citrix | Playwright cannot do it. Decline plainly — the gap analysis already says so |

### 3.2 Eval scope — check-layer defaults

The 11 layers, with the regulated default and the reason it differs from the
product default. Modes are seeded into `PlaywrightSettings` via each layer's
`modeField`.

| Layer | `modeField` | Product default | **Regulated** | Why |
|---|---|---|---|---|
| `visual` | `visualMode` | enforce | **enforce** | A release restyling a validated layout is the headline finding |
| `text` | `textMode` | log | **enforce** | A template change that drops "Meaning" from the §11.50 manifestation is a compliance finding, not cosmetic. This is the single most important default change |
| `dom` | `domMode` | log | **enforce** | "A configured component silently stopped rendering" is exactly what the Salesforce test hand-rolls at `records-lwc-highlights-panel`. Make it a layer |
| `network` | `networkMode` | enforce | **log**, ratchet to enforce | Vault and Lightning poll noisily; enforcing on day one buries the real findings. Ratchet after one clean cycle — and see §2.2, the write-guard rides this layer regardless of mode |
| `console` | `consoleMode` | enforce | **log** | Same reason. Vendor-owned console noise is not the customer's defect |
| `perf` | `perfMode` | log | **disable** | Sandbox perf is non-deterministic and belongs to Veeva, not to the customer's validated config |
| `url` | `urlMode` | log | **enforce** | Vault hash routing — a route that no longer resolves is a real regression and a cheap one to catch |
| `api` | `apiMode` | enforce | **disable** until B3a | Nothing to assert against until the VQL/REST connector exists. Flip to enforce with D1 |
| `storage` | `storageMode` | log | **disable** | Browser cookies/localStorage are not a GxP artifact and add review load |
| `a11y` | `a11yMode` | log | **disable** | A red a11y score on a vendor UI is a finding against Veeva. Available on request; off by default |
| `design` | `designMode` | disable | **disable** | Design tokens are meaningless against a vendor-styled UI |

**Verdict policy** — all forced, not merely defaulted:

| Setting | Regulated value | Why |
|---|---|---|
| Auto-approve (`auto-approve.ts`, `auto-approve-toggle.tsx`) | **off, locked** | An approval is an attributable human act. P2 will put re-auth and meaning behind it |
| Confirm-on-green (`confirm-on-green.ts`) | **off** | A case must not silently settle itself into the execution record |
| AI diffing (`aiDiffingEnabled`) | **off, locked** | A probabilistic verdict cannot be evidence |
| `builtInAiEnabled` | **off** (MCP mode) | AI runs in the consultant's own agent, against their own key, outside the evidence path |
| AI in authoring (`plugins/authoring-ai`, QA Agent planning) | **allowed, labelled** | Drafting a test is not adjudicating one. The line is worth drawing explicitly rather than banning AI outright |

### 3.3 UI scope — the hide list

Disposition is one of **hidden** (not rendered under `regulatedMode`),
**hard-disabled** (server-side refusal, not just a missing nav item), or
**relabelled**.

| Surface | Where | Disposition | Why |
|---|---|---|---|
| Public share links `/r/<slug>` | `plugins/share`, `src/app/(public)/r`, `src/app/(public)/share` | **hard-disabled** | An unauthenticated URL serving screenshots of a validated system, potentially containing HCP data. This one must be a server-side refusal — hiding the button is not a control |
| Leaderboard | `sidebar.tsx` `gamificationNav` | hidden | |
| Gamification toggle + admin card, seasons, Bug Blitz | `settings/page.tsx` Features card, `gamification-toggle.tsx`, `gamification-admin-card.tsx`, `plugins/gamification` | hidden | |
| Awards, public awards page | `plugins/awards`, `src/app/(public)/awards` | hidden | |
| Launch board / cohorts | `plugins/launch` | hidden | |
| Playground | `plugins/playground` | hidden | |
| QuickStart panel + email template | `src/app/(app)/page.tsx` `QuickstartPanel`, `plugins/quickstart`, Features card | hidden | Registers a demo user and sends mail from the product. Unexplainable to this buyer |
| Early-adopter toggle | `early-adopter-toggle.tsx` | hidden | Also keeps Compose / Compare / Impact off, which `EARLY_ADOPTER_ITEMS` already handles |
| GitHub / GitLab connect cards, CI cards, PR/MR comment settings | `settings/page.tsx` (github, gitlab, `GithubActionsCard`, `GitlabPipelinesCard`), `plugins/ci` | hidden | A pharma QA lead has no repo. B1's no-repo path is the same work |
| QA Agent nav entry | `sidebar.tsx` `executionNav` | hidden by default, opt-in | "An AI wrote our validation protocol" loses the room. Available, not advertised |
| Explorer nav entry | `sidebar.tsx` `executionNav`, `plugins/explorer` | hidden by default | Per §3.1 — the runs must not land in an evidence cycle |
| Ranger | `plugins/ranger` | hidden | |
| Billing card | `settings/page.tsx` | hidden when self-hosted / invoiced | Enterprise procurement is not a Stripe portal |
| AI logs, MCP prompts, AI settings | `settings/page.tsx` ai tab | kept, demoted | MCP connect stays — it is how the consultant drives the tool |
| Verify, Coverage, Tests, Setup, Runs, Dashboard | — | **kept** | Verify is the review surface; Coverage *is* the PQ coverage matrix |
| Recorder | `plugins/recorder` | **kept** | Authoring without a developer is B1's whole point |

### 3.4 Relabelling

Vocabulary carries as much as the hide list.

| Today | Regulated |
|---|---|
| Repository | Application / System |
| Branch | Environment (PROD / UAT / prerelease 26R2) — B2 makes this real; the label should not wait for it |
| Build | Execution cycle |
| Bug / Bug Blitz | Finding / Deviation |
| Baseline approved | Approved by *name*, *date/time*, *reason* — P2 |

---

## 4. Implementation sketch — smallest honest diff

1. `regulated_mode boolean default false` on `teams`; toggle in Settings → Features (`pnpm db:push`).
2. `src/lib/segment/regulated.ts` — one module exporting the three lists from §3.1–3.3 (`ALLOWED_TEST_MODES`, `REGULATED_CHECK_MODES`, `HIDDEN_SURFACES`). No logic scattered across call sites.
3. `sidebar.tsx` filters `definitionNav` / `executionNav` / `gamificationNav` through it — the same shape as the existing `EARLY_ADOPTER_ITEMS` filter.
4. `settings/page.tsx` gates the cards named above.
5. **Share plugin refuses server-side** when the owning team is regulated. Not a nav filter.
6. Check-mode defaults seeded from `REGULATED_CHECK_MODES` at repo creation; the cogwheel dialog still lets a user change them (this is a default, not a lock) except where §3.2 says *locked*.
7. Auto-approve, confirm-on-green and AI diffing forced off, with the toggles rendered disabled and explained rather than hidden — a control the customer can see is off is worth more than one they cannot find.

Items 1–7 are UI and defaults. They are not the Vault work; they are what makes
the Vault work demonstrable without the demo undercutting itself in the first
ten seconds.

**Order of work:** §2.1 (secrets) → §2.2 (write-guard) → §3 (profile). The first
is the only thing that turns two quarantined placeholders into a run.

---

## 5. What this deliberately does not do

Hiding the leaderboard does not make the product 21 CFR Part 11 compliant. The
audit trail (P1), e-signature (P2), segregation of duties (P3) and auditor-grade
evidence export (P4) are all still owed, and no configuration profile
substitutes for them.

This document buys two things and claims nothing else: the placeholder tests
become runnable, and the product stops contradicting its own pitch on screen.
