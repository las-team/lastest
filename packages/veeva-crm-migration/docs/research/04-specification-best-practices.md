# Gathering and writing a per-country / per-rep-type configuration specification (Veeva CRM → Vault CRM)

Research date: 2026-09-07. Companion to `01-salesforce-apis.md` (how to extract the as-is
configuration) and `02-veeva-crm-configuration-model.md` (what the configuration axes are).
This document is about the **human side**: what to ask each country, how to keep the answer
short but sufficient, and what the resulting configuration document should look like.

> **Source-access note.** `crmhelp.veeva.com`, `vaultcrmhelp.veeva.com`, `support.veeva.com`,
> `education.veeva.com`, `vaultcrmalign.veeva.com` and most third-party analysis sites
> (intuitionlabs.ai, grax.com, infosys.com, kneat.com, salesforceben.com) were **blocked by the
> network egress proxy for direct fetches**. Every "confirmed" statement below comes from
> search-engine extracts of those pages (URL cited per section). Statements tagged
> **[inferred]** or **[practice]** are practitioner method, not Veeva/Salesforce doctrine, and
> the doc says so where it matters. There is no public Veeva page describing a
> "Configuration Assessment questionnaire" by that name — see Uncertainties.

---

## 0. Summary — the six things that actually reduce rework

| # | Practice | Why it reduces rework |
|---|---|---|
| 1 | **Extract the as-is automatically before asking anyone anything.** Profiles, permission sets, layouts, record types, Veeva Settings (org + profile), VMOCs, Messages, custom objects/fields, Apex/flows, reports — from the API, per profile. | Business admins do not know their own config; they know their *process*. Asking them to describe settings produces guesses. Pre-filling the questionnaire from the extract turns "describe your setup" into "confirm or correct", which is 5–10× faster and far more accurate. |
| 2 | **One matrix: rep type × country → profile.** Build it from `User.Profile`, `User_Type_vod__c`, `Country_Code_vod__c` counts of *active* users. | It is the join key for everything else. Every other question is answered per cell of this matrix, and empty/near-empty cells are candidates to delete rather than migrate. |
| 3 | **Global core + local delta.** One global template document; each country documents only deviations, each with a reason code (regulatory / language / integration / legacy-no-reason). | Vault CRM is an opportunity to collapse profile sprawl. Forcing a *reason* on every delta is what makes countries give up deltas they no longer need. |
| 4 | **Fit-gap workshop per country, 2–3 h, walking the pre-filled intake.** Not open-ended requirement gathering. | Open workshops re-litigate the global design. Pre-filled intake + "confirm / change / drop" keeps scope. |
| 5 | **Decision log + RACI from day 1, with an explicit "who signs the local delta".** | Late reversals of settings are the most common source of re-test in validated systems. |
| 6 | **Requirement IDs on every row** (URS → FS/CS → test) so the config workbook is itself the GAMP 5 Configuration Specification. | Avoids writing the spec twice (once for the project, once for validation). |

---

## 1. Discovery / spec-gathering method

### 1.1 Sequence (what to do in which order)

```
Week 0   Automated as-is extract (per org, per profile)         → Inventory workbook (machine-generated)
Week 0   Usage overlay: active users per profile/country,
         records per record type, layout assignments, VMOC hits → "Used / unused / orphan" flags
Week 1   Persona matrix (rep type × country → profile)            → Confirmed with global process owner
Week 1   Global template decisions (what is "core")                → Global config doc v0.1
Week 2+  Per-country: send PRE-FILLED intake (§2), 1 week to reply
Week 3+  Per-country fit-gap workshop (2–3 h) walking the intake   → Local delta sheet v0.1 + decision log entries
Week 4+  Consolidate → Config Workbook v1.0 (global + N local delta tabs), RTM linkage
```
**[practice]** — the ordering is method, not a Veeva mandate. What *is* documented by
Veeva/analysts is that migration begins with a current-state assessment and audit of "every
custom object, field, validation rule, workflow/trigger, page layout, report, and
integration" and that this "as-built" assessment forms the baseline; documenting which
features are standard vs custom is essential for effort planning and later validation.
Source: https://intuitionlabs.ai/articles/veeva-vault-crm-migration-guide (search extract);
https://www.grax.com/blog/veeva-salesforce-migration-guide/ (search extract).

### 1.2 Current-state inventory first (automated)

Extract per profile — the mechanics are in `01-salesforce-apis.md` §4 and §6. The minimum
inventory a country intake must be pre-filled from:

| Inventory item | Source (Salesforce / Veeva CRM) | Used for |
|---|---|---|
| Active users by profile × country × user type | `SELECT Profile.Name, Country_Code_vod__c, User_Type_vod__c, COUNT(Id) FROM User WHERE IsActive = true GROUP BY …` | Persona matrix; detect orphan profiles |
| Profile → permission sets, apps, tabs, object/field permissions | `PermissionSet` (incl. profile-owned, `IsOwnedByProfile = true`), `ObjectPermissions`, `FieldPermissions`, `SetupEntityAccess` | Rep-type capability list |
| Record types + layout assignment per profile | `RecordType`, Tooling `ProfileLayout` / `Layout`; `describe/layouts/{recordTypeId}` | Call types, account types, unused layouts |
| Veeva Settings, org + profile level | `SELECT SetupOwnerId, … FROM Veeva_Settings_vod__c` (and every `*_Settings_vod__c`) | Feature switches per rep type; user-level anomalies |
| VMOCs | `VMobile_Object_Configuration_vod__c` (`Object_vod__c`, `Profile_ID_vod__c`, `Device_vod__c`, `Where_Clause_vod__c`, `Active_vod__c`) | Offline scope; undocumented country filters |
| Veeva Messages | `Message_vod__c` by `Name`/`Category_vod__c`/`Language_vod__c` | Translation coverage |
| Custom objects/fields (non-`_vod`), Apex, flows, validation rules | Tooling `CustomObject`, `CustomField`, `ApexClass`, `ApexTrigger`, `Flow`, `ValidationRule` | Fit-gap: nothing here migrates automatically |
| Reports/dashboards, folders | `Report`, `Dashboard` + folder sharing | Per-country reporting needs |
| Integrations | Named credentials, connected apps, Network Bridge config, Align, Nitro, SAP jobs | Integration re-build list |

Assessment reports in the analyst literature cover exactly this list: custom objects/fields
(and whether each maps to a Vault CRM equivalent), automation (flows, triggers, validation
rules), integrations, data volume/quality, adoption, and Apex/Lightning components "which have
no equivalent in Vault's architecture and cannot be migrated"; unsupported field types
(e.g. Auto Number, Geolocation) must be re-evaluated.
Source: https://intuitionlabs.ai/articles/veeva-crm-vault-migration-checklist (search extract);
https://craftware.com/veeva-crm-migration-what-really-changes-for-your-business/ (search extract).

### 1.3 Persona / role matrix (rep type × country)

Veeva CRM carries rep type on the **User** record, separately from Profile:
`User_Type_vod` "indicates the role of the end user. Customers should data load this
information with a standard picklist value"; `Country_Code_vod` is "set by the administrator
indicating the end user's primary country of operations", 2-letter ISO. Mobile users are
prompted for both at login if unset.
Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm ;
https://crmhelp.veeva.com/doc/Content/CRM_topics/General/VeevaCRMStandardMetrics.htm (search extracts).

The matrix (one row per *active* combination) is the spine of the specification:

| Country | Rep type (`User_Type_vod__c`) | Current profile(s) | Active users | Target Vault CRM security profile | Target application profile | Delta ref |
|---|---|---|---|---|---|---|
| DE | Primary Care Rep | `DE_PC_Rep` | 212 | `pc_rep__c` (global) | `app_pc_rep_de__c` | DE-01, DE-04 |
| DE | MSL | `DE_MSL` | 18 | `msl__c` (global) | `app_msl__c` (global) | — |
| DE | Key Account Mgr | `DE_KAM`, `DE_KAM_old` | 9 + 0 | `kam__c` (global) | `app_kam__c` (global) | drop `DE_KAM_old` |

Rule **[practice]**: a cell with 0 active users, or a second profile that differs from the
first only by name, is proposed for deletion in the intake — the country must argue to keep
it, not to drop it.

### 1.4 Fit-gap workshop per country (what it is and is not)

- Input: the pre-filled intake (§2) and the country's current profile capability list.
- Format: walk the intake top to bottom; each line gets one of **Confirm / Change / Drop**
  plus a *reason code* for anything that is not the global default.
- Output: local delta sheet v0.1, decision-log entries, open questions with owner + date.
- Out of scope: re-designing the global template. Global changes are parked as "global change
  requests" and decided by the global process owner, not in the country session.

Reason codes that work **[practice]**: `REG` (law/regulation — cite it), `LANG`, `INTEG`
(a local integration depends on it), `PROC` (a genuinely different local process), `LEGACY`
(nobody knows why). `LEGACY` deltas default to *drop* at go-live.

### 1.5 As-is / to-be template (one row per configuration item)

| ID | Area | Item | As-is (extracted) | As-is evidence | To-be (global) | To-be (local, if any) | Reason code | Decision # | URS ref | Test ref |
|---|---|---|---|---|---|---|---|---|---|---|
| DE-04 | Calls | Call record types available to PC Rep | `Call_vod`, `Group_Call_vod`, `Pharmacy_Call_DE` | `RecordType`/`ProfileLayout` extract 2026-09-01 | `call__v` object types: `call`, `group_call` | + `pharmacy_call_de` | PROC | D-031 | URS-CAL-07 | OQ-CAL-07-DE |

The "As-is evidence" column (extract file + date) is what makes the workbook auditable.

### 1.6 RACI and decision log

Minimal RACI that avoids the classic failure ("the country admin said yes but the global
owner said no"):

| Activity | Global process owner | Country business admin | SI / config team | Validation / QA | IT security |
|---|---|---|---|---|---|
| Global template content | A/R | C | R | C | C |
| Local delta content | A | R | C | I | C |
| Sign-off of local delta | A | R (signs) | I | C | I |
| Config Spec / RTM | C | I | R | A | I |
| Profile / permission model | A | C | R | C | R |
| Translations | I | R | C | I | — |

Decision log columns: `ID · Date · Question · Options considered · Decision · Rationale ·
Decided by · Affects (countries/rep types) · Config IDs impacted · Status`. Keep it as a
sheet in the workbook, not in email.

### 1.7 Intake questionnaire principles

- Pre-fill every answer you can from the extract; mark each pre-filled value with its source.
- Closed questions (yes/no, pick from list) wherever possible; free text only for "why".
- One page per country per rep type is the target length; if it is longer, it is asking
  things the extract should have answered.
- Ask for **evidence**, not opinion, on regulatory claims ("which law/SOP requires this?").

---

## 2. Intake template — "what we need from each country business admin"

Send one copy **per country**; sections 2–9 repeat **per rep type** in that country.
Pre-filled cells are shown in `[brackets: source]`.

### Section 1 — Country header
| Field | Answer |
|---|---|
| Country (ISO-2) | `[DE: User.Country_Code_vod__c]` |
| Business admin (name, e-mail) / backup | |
| Languages users work in | `[de, en: Message_vod__c languages in use; User.LanguageLocaleKey]` |
| Salesforce org (if multi-org) | `[EU-org]` |
| Field-force data source | `[Veeva Align / manual / HR feed]` |
| Local regulations that shape CRM (cite) | e.g. HWG §7 (samples, DE), GDPR consent basis |

### Section 2 — Rep types in this country
| Rep type (`User_Type_vod__c`) | Current profile | Active users | Keep / merge / drop | Target global profile | Comment |
|---|---|---|---|---|---|
| `[Primary Care Rep]` | `[DE_PC_Rep]` | `[212]` | | | |

### Section 3 — Per rep type: activities / call reporting
| Question | Global default | This rep type |
|---|---|---|
| Call record types used | `[call, group_call]` | Confirm / Change |
| Call report sections/fields that are mandatory locally | — | list |
| Call channels (F2F, phone, video/Engage, e-mail) | | |
| Call objectives / key messages / detailing (CLM) | `[yes/no from Multichannel_Settings_vod__c]` | |
| Samples / promotional items on call | `[yes/no from Call2_Sample_vod__c usage]` | |
| Signature capture & local disclaimer text | | |
| Expenses, attendees, follow-up activities | | |

### Section 4 — Per rep type: multichannel
| Capability | On today? `[extract]` | Keep | Local rules |
|---|---|---|---|
| Approved Email | | | consent basis, opt-in text, sender domains |
| CLM (content from Vault PromoMats/MedComms) | | | content language(s) |
| Engage (meetings/connect) | | | |
| Events Management | | | budget/approval workflow, attendee limits, local compliance |
| Medical Inquiry | | | routing, local MI system integration |
| Consent Capture | | | channels, legal basis, retention |
| Suggestions / Next-Best-Action (Nitro/Crossix) | | | |

### Section 5 — Samples & compliance (country level)
| Question | Answer |
|---|---|
| Samples disbursed at all? | yes/no |
| Sample limit template(s) in use and which profiles/groups (`Template_Group_vod__c`) | `[extract Sample_Limit_vod__c templates]` |
| One-time sample opt-in signature required? | yes/no |
| Country-specific disclaimers on signature page (`Signature_Page_vod__c`) | text + language |
| Inventory / lot / expiry / reconciliation requirements | |
| Who signs off sample compliance locally | |

Veeva documents that "to comply with different sample and product disbursement regulations
across various countries or regions, admins can assign different sample limit templates to
different user groups/profiles" via `Template_Group_vod`, that "some countries require a
one-time sample opt-in signature", and that country-specific disclaimers are records on
`Signature_Page_vod`.
Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/SampleManagement/AdvFunct/Restrictions/SampleLimitTemplates.htm ;
https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/CallSampling/InitialConfig/ConfiguringCS.htm (search extracts).

### Section 6 — Accounts, territories, alignment
| Question | Answer |
|---|---|
| Account types / record types in use (HCP, HCO, pharmacy…) | `[extract]` |
| Territory source: Align / manual; hierarchy depth | |
| Multi-country users (`Network_Additional_Countries_vod__c`) | `[extract]` |
| Local account custom fields that reps must see | `[non-_vod fields on Account]` |
| Cycle plans / MCCP used? | |

### Section 7 — Integrations touching this country
| Integration | In use | Direction | Owner | Notes |
|---|---|---|---|---|
| Veeva Network / OpenData (Network Bridge, DCR) | `[extract]` | | | which countries in the bridge |
| Veeva Align | | | | |
| Nitro / data warehouse | | | | |
| SAP / order management / sample logistics | | | | |
| Local MI, event, expense tools | | | | |

### Section 8 — Local customisations (must be listed; none migrate automatically)
| Type | API name | Purpose | Still needed? | Owner |
|---|---|---|---|---|
| Custom object | `[Pharmacy_Visit__c]` | | | |
| Custom field | | | | |
| Apex / Flow / validation rule | | | | |
| Custom report / dashboard | | | | |

### Section 9 — Languages & text
| Question | Answer |
|---|---|
| UI languages needed | |
| Veeva Messages with local overrides (`Message_vod__c` where language ≠ en) | `[extract count]` |
| Missing translations found by extract (name exists in `en` only) | `[list]` |
| Who translates / approves | |

### Section 10 — Sign-off
Name, role, date; statement "I confirm the above reflects the required local configuration;
items not listed follow the global template."

Machine-readable form of the same intake **[practice]** — useful if the intake is generated
from and merged back into a workbook:

```yaml
country: DE
admin: { name: "…", email: "…" }
languages: [de, en]
rep_types:
  - user_type: Primary Care Rep
    current_profile: DE_PC_Rep
    active_users: 212
    disposition: keep            # keep | merge:<profile> | drop
    target_security_profile: pc_rep__c
    target_application_profile: app_pc_rep_de__c
    call:
      record_types: [call, group_call, pharmacy_call_de]   # delta: pharmacy_call_de
      samples: true
      signature_disclaimer: "DE_HWG7"
    multichannel:
      approved_email: { enabled: true, consent_basis: "opt-in", note: "double opt-in" }
      clm: { enabled: true }
      engage: { enabled: false }
      events: { enabled: true, approval_workflow: "local-medical" }
      medical_inquiry: { enabled: false }
samples:
  enabled: true
  limit_templates: [{ name: "DE_HWG_Limit", template_group: "DE_PC_Rep" }]
  opt_in_signature_required: true
integrations: [network_bridge_eu, align, sap_samples_de]
customisations:
  - { type: custom_object, api: Pharmacy_Visit__c, keep: false, reason: LEGACY }
deltas:
  - { id: DE-04, item: call.record_types, reason: PROC, decision: D-031 }
```

---

## 3. Structure of a good per-country configuration document

### 3.1 Documents and their audiences

| Document | Audience | Content | Relationship |
|---|---|---|---|
| **Global Configuration Workbook** (the "core") | Config team, validation | Every configuration item of the global template, one row each, with IDs | Master |
| **Local Delta Sheet — <country>** | Country admin (signs), config team | Only rows that differ from core, each with reason code + decision ref | Child; inherits everything not listed |
| **Functional Design Spec** (FS) | Validation, SI | Narrative of *behaviour* per process (call, sample, AE…) with references to workbook IDs | Sits above the workbook in the V-model |
| **Business Admin Guide — <country>** | Country admin after go-live | How to run the local config day-to-day (add a user, change a message, alignment loads) | Derived from the delta sheet, written last |

Veeva itself ships "workbook"-style configuration artefacts for some features (e.g. the
Engage Connect *Company Configuration File* is a downloadable file admins fill and upload),
which is the closest official precedent for a configuration workbook format.
Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/Engage/EngageMeeting/Connect/InitialConfig/CompanyConfigFile.htm (search extract).

### 3.2 Global Configuration Workbook — recommended tabs

1. **Cover & version** — doc ID, version, status, approvals, change history.
2. **Scope** — countries, rep types, orgs, release (Vault CRM `2xRx`), out-of-scope list.
3. **Persona matrix** — §1.3 table (the join key).
4. **Security** — security profiles, permission sets (object/field/tab/page layout), application
   profiles; one row per profile × permission set.
5. **Objects & object types** — per object: object types (ex record types), layouts per
   object type × profile, fields (custom only; standard listed by exception).
6. **Veeva Settings** — one row per setting × scope (global / application profile), value, purpose.
7. **VMOCs** — one row per object × application/security profile × device: active, where
   clause, purpose of the where clause, country filter yes/no.
8. **Multichannel** — AE, CLM, Engage, Events, MI, Consent: settings and content sources.
9. **Samples & compliance** — limit templates, opt-in, disclaimers, inventory.
10. **Territories & alignment** — Align field forces, hierarchy, TSF fields.
11. **Messages & translations** — message keys that were changed from Veeva defaults, per language.
12. **Integrations** — per integration: system, direction, objects, credentials owner, schedule.
13. **Reports & dashboards** — global set with folder and audience.
14. **Data migration rules** — object → object mapping, filters, transformation notes.
15. **Decision log**, **Open items**, **RTM** (URS ↔ row IDs ↔ tests).

### 3.3 Local Delta Sheet — "global core + local delta" model

Rules that make the model work **[practice]**:

- A country sheet contains **only** rows whose value differs from core. "Same as global" is
  never written down; absence means inheritance.
- Every delta row carries: `Delta ID (CC-nn)`, `Workbook row ID it overrides`, `Global value`,
  `Local value`, `Reason code`, `Evidence / citation`, `Decision #`, `URS ref`, `Test ref`,
  `Status (proposed / approved / built / verified)`.
- A delta must be expressible in the target's configuration model. In Vault CRM that means:
  a different **application profile** (settings/VMOCs), a different **security profile /
  permission set** (access), an extra **object type**/layout, a **where clause**, a
  **message translation**, or a **data rule** (sample limit template, disclaimer record).
  If a requested delta needs custom code, it is not a delta — it is a custom-development item
  and goes to the fit-gap backlog.
- Deltas are **additive or narrowing**, never a fork of the core: a country may hide a field,
  add an object type, tighten a limit; it may not rename a global object type or change a
  global picklist value's meaning.

Example (rendered):

| Delta ID | Overrides | Item | Global | DE local | Reason | Evidence | Decision | URS | Test | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| DE-01 | VS-017 | Veeva Setting `ENABLE_SAMPLE_OPT_IN` (app profile `app_pc_rep_de__c`) | off | on | REG | HWG §7; local SOP-DE-014 | D-012 | URS-SMP-03 | OQ-SMP-03-DE | approved |
| DE-02 | VM-022 | VMOC `product_metrics__v` where clause | none | `country__v = 'DE'` | PROC | data volume >50k rows | D-019 | URS-SYN-02 | OQ-SYN-02-DE | built |
| DE-03 | MSG-104 | Message `CALL_SUBMIT_CONFIRM` (de) | Veeva default | local text | LANG | — | — | URS-UI-01 | PQ-UI-01-DE | verified |

Compact "delta matrix" view for management (countries as columns, one glyph per row:
`=` inherits, `Δ` delta, `✗` feature off) is worth generating from the same data.

### 3.4 Naming conventions (so the document and the org agree)

Salesforce/Veeva CRM side (as-is) and Vault CRM side (to-be) differ in API naming: Veeva CRM
uses `_vod__c` / `__c`; Vault CRM objects and fields end in `__v` (Veeva-managed) or `__c`
(customer), e.g. `account__v`, `call__v`, `veeva_settings__v`,
`vmobile_object_configuration__v`, with custom items re-created "with the new API name
(suffixed with __v) and equivalent properties".
Source: https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/TransitionToVault.htm ;
https://intuitionlabs.ai/articles/veeva-vault-crm-migration-guide (search extracts).

Recommended conventions **[practice]**:

| Thing | Pattern | Example |
|---|---|---|
| Security profile (global) | `<reptype>` | `pc_rep__c`, `msl__c`, `kam__c` |
| Application profile | `app_<reptype>[_<cc>]` — country suffix only when a delta exists | `app_pc_rep__c`, `app_pc_rep_de__c` |
| Permission set | `ps_<feature>` (feature-based, not country-based) | `ps_approved_email__c`, `ps_samples__c` |
| Object type (ex record type) | `<meaning>[_<cc>]` | `pharmacy_call_de__c` |
| Custom field (local) | `<cc>_<meaning>__c` so locality is visible in the API name | `de_pharmacy_id__c` |
| Workbook row IDs | `<TAB>-<nnn>` global; `<CC>-<nn>` delta | `VS-017`, `DE-01` |
| Decision IDs | `D-<nnn>` | `D-031` |
| Requirement IDs | `URS-<AREA>-<nn>` | `URS-SMP-03` |
| Test IDs | `<IQ/OQ/PQ>-<AREA>-<nn>[-<CC>]` | `OQ-SMP-03-DE` |

Country code always ISO-3166-1 alpha-2, matching `Country_Code_vod` (a Global Value Set on
User and Account in Veeva CRM).
Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/ReleaseNotes/20R3.1/New_in_Veeva_CRM_20R3.1.htm (search extract).

### 3.5 Versioning and change control

- Workbook is a controlled document: semantic version (`1.0` baseline for build, `1.x`
  during build, `2.0` at validation freeze); every row has `Last changed in version`.
- Local delta sheets version independently but declare the core version they were written
  against (`core: 1.3`). A core change that touches an inherited row triggers a review task
  in every country that has no delta on that row (they inherit the change) and a decision
  in every country that does.
- After go-live, configuration is deployed as Vault **Configuration Migration Packages**
  (VPK) between vaults; Veeva's own guidance is to use the **Vault Compare** report to
  isolate and track changes when building the outbound package. Keep the package
  manifest, or the MDL, next to the workbook version it implements.
  Source: https://support.veeva.com/hc/en-us/articles/6611648252955-Planning-and-Preparing-for-a-Vault-Configuration-Migration-Deployment ;
  https://support.veeva.com/hc/en-us/articles/6611450164507-Vault-Configuration-Migration-Package-Deployment-Guide (search extracts).

### 3.6 Traceability for validated systems (GAMP 5 / CSV)

A commercial CRM configured per customer is a **GAMP 5 Category 4 (configured product)**.
The minimum documentation set cited for Category 4: Validation Plan, User Requirements
Specification, supplier assessment, **Configuration Specification**, IQ/OQ/PQ protocols and
reports, deviations, Validation Summary Report; with the mapping *PQ ↔ user requirements,
OQ ↔ functional specification, IQ ↔ design/configuration specification*. GAMP 5 Second
Edition (July 2022) states the approach "is not inherently linear" and supports iterative
and incremental delivery, and prescribes a **Requirements Traceability Matrix** linking each
URS requirement to specification elements and to test cases.
Source: https://kneat.com/article/what-is-gamp-5/ ;
https://casrai.org/guides/computer-system-validation-csv-gamp-5-iq-oq-pq ;
https://guidance-docs.ispe.org/doi/book/10.1002/9781946964571 (search extracts).

Practical consequence for the workbook:

```
URS-SMP-03  "DE reps may only disburse samples to HCPs who signed a one-time opt-in"
   └─ FS-SMP-03   behaviour: call report blocks sample lines until opt-in signature on file
        └─ CS rows: VS-017 (global off) → DE-01 (on, app_pc_rep_de__c); MSG-118 (de text)
             └─ IQ-SMP-03-DE (setting value verified in prod vault)
             └─ OQ-SMP-03-DE (negative test: no opt-in → sample line rejected)
             └─ PQ-SMP-03-DE (DE rep executes real call flow)
```

- The workbook **is** the Configuration Specification: do not maintain a separate prose CS.
- Each local delta needs its own test ID (country-suffixed) because the configured value
  differs; inherited rows are covered by the global test once.
- Risk-based scope: rows flagged `GxP-impact = yes` (samples, consent, MI, adverse-event
  capture, signature) get IQ+OQ; cosmetic rows (labels, non-GxP layouts) get IQ only.
  **[practice, consistent with GAMP 5 risk-based approach]**

---

## 4. Veeva-specific guidance

### 4.1 The as-is axes you are documenting (recap of `02-…`)

| Axis | Veeva CRM (Salesforce) | Documented hierarchy |
|---|---|---|
| Access | Profile (+ permission sets), page layouts, record types, FLS | — |
| Feature switches | Veeva Settings custom settings, e.g. `Veeva_Settings_vod__c`, `Multichannel_Settings_vod__c` | "Settings for an organization are overridden by profile settings"; **"only global and profile-level settings are supported, and user-level settings are not supported"** |
| Offline scope | `VMobile_Object_Configuration_vod__c` per object × profile × device with `Where_Clause_vod__c` | Where clause is the SOQL filter deciding which records sync; for profile-specific Veeva Messages add `WHERE SetupOwnerId in (@@VOD_SF_PROFILEID@@, @@VOD_MY_ORGID@@)` |
| Text | `Message_vod__c` by name/category/language; English is the fallback when no message matches the user's language | — |

Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Profile_Config_Veeva_Custom_Settings.htm ;
https://support.veeva.com/hc/en-us/articles/115000840194-Are-User-Level-Veeva-Settings-Supported-in-CRM- ;
https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/MobileDeviceSetup/Sync/VMOCs.htm ;
https://crmhelp.veeva.com/doc/Content/CRM_topics/MyInsights/MyInsightsAdvFunct/TabTranslations.htm (search extracts).

### 4.2 The to-be constructs in Vault CRM (what a per-rep-type row must resolve to)

| Vault CRM construct | What it controls | Documented statement |
|---|---|---|
| **Security profile** | Bundle of permission sets applied to a user | "Security profiles are the primary way that Vault applies permission sets to individual users" |
| **Permission set** | Object permissions, field permissions, page access, tab visibility, object page layout assignments | "…do **not** include VMOCs and custom settings, including Veeva Settings and Multichannel Settings" |
| **Application profile** | Grouping of users with the same application settings — Veeva Settings and VMOCs — independent of security profile | "changes to the application configuration can be applied to the entire group, regardless of individual Security Profiles"; "The Application Profile field overrides the Security Profile field" |
| `veeva_settings__v` | Global record exists out of the box; profile-level records reference an application/security profile; users need read on the object and all its fields | VMOC for `veeva_settings__v` on iPad: `WHERE application_profile__v = @@USER_APP_PROFILE_ID@@ OR (application_profile__v = null AND security_profile__v = null)` |
| `vmobile_object_configuration__v` | Offline sync scope; carries `application_profile__v` | Users need Read on `application_profile__v` on this object |
| **Object types** | Replace Salesforce record types | e.g. TSF layouts defined per account object type by matching API name |
| **Vault Messages → Veeva Messages** | Vault Messages are the source; a daily 2 AM "Vault Message to Veeva Message Copy" job feeds the mobile app; translations via **Bulk Translations** tool; Default Value used when no translation exists | — |
| **Align functional profile** | One CRM security profile + zero-to-many application roles + (Vault CRM) an application profile, assigned per field-force hierarchy level; per-roster-member override possible | "any roster member assigned to that hierarchy level inherits the CRM Security Profile and application roles defined by the functional profile" |

Sources: https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/PermissionSets.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/ApplicationProfiles.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/VeevaCustomSettings.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/Security/SecurityVaultCRM.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/Veeva_Messages.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Accounts/ManagingAccountInfo/WorkingwithTerritoryFields.htm ;
https://vaultcrmalign.veeva.com/doc/Content/Align/UserMgmt/FunctProfiles.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Align/UserMgmt/AppProfiles.htm (search extracts).

**Design implication for "global core + local delta" (inferred from the above):** Vault CRM
separates *access* (security profile / permission sets) from *application behaviour*
(application profile). That is the natural place to put the two axes:

- **Rep type → security profile** (global; countries should not need their own).
- **Rep type × country → application profile** — but only where a country has a
  settings/VMOC delta; otherwise the country uses the global application profile.
- **Country → data**, not config, wherever Veeva already models it as data: sample limit
  templates (`Template_Group`), signature-page disclaimers, Network Bridge country lists,
  `Country_Code_vod` on User/Account, translations.

This keeps the number of application profiles ≈ (rep types) + (countries with real deltas),
instead of (rep types × countries) as the Salesforce profile-cloning habit produced.

### 4.3 What Veeva provides for the migration (as far as public sources say)

| Item | What the sources say | Confidence |
|---|---|---|
| Veeva-run migration of standard configuration and data | "Veeva promises to handle the migration from Veeva CRM to Vault CRM for its customers, however, this does not cover custom code, custom objects, and third-party integrations"; "most data that is standard will be migrated by Veeva without changes except for suffixes in data models" | Secondary sources only (grax.com, intuitionlabs.ai search extracts) |
| Pre-migration report | "Tools like Veeva's pre-migration report and Vault Loader exist to streamline migration"; "a technical assessment or readiness review with Veeva is recommended" | Secondary source; report contents not public |
| Enablement | "Veeva CRM to Vault CRM Enablement Workshop" (Veeva Education Services) for CRM admins, product partners re-building integrations, and services partners supporting migrations | Official page exists; agenda not retrievable |
| Strategy partner | Veeva contracted Accenture for migration strategy and business-process optimisation | Secondary source |
| Timeline | Existing-customer migrations begin 2025, bulk 2026–2029 | Secondary source |
| Config tooling on the Vault side | Configuration Migration Packages (VPK), Vault Compare report, MDL; Vault Loader; Record Migration Mode for bulk loads | Official support/platform pages (search extracts) |
| Vault CRM help page for admins moving from Veeva CRM | "Transitioning to Vault CRM for Veeva CRM Users" | Official page; body not retrievable |

Sources: https://www.grax.com/blog/veeva-salesforce-migration-guide/ ;
https://intuitionlabs.ai/articles/veeva-vault-crm-migration-roadmap ;
https://education.veeva.com/products/veeva-crm-to-vault-crm-enablement-workshop ;
https://support.veeva.com/hc/en-us/sections/360002781174-Vault-Config-Migration ;
https://platform.veevavault.help/en/lr/761685/ ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/TransitionToVault.htm (search extracts).

**What customers are expected to provide** (assembled from the above and the checklist
literature; no official Veeva "Configuration Assessment questionnaire" was found):

1. The as-is inventory (§1.2) — custom objects/fields with ownership and whether each maps
   to a Vault CRM equivalent; automation (flows/triggers/validation rules); Apex/LWC (none
   migrate); integrations and their credentials owners; data volumes and quality.
2. Integration users / API credentials for the target vault (e.g. Network Bridge: add a new
   system in Network for Vault CRM — Veeva suggests cloning the existing CRM system — and
   supply the Vault CRM integration user).
3. Decisions on unsupported items (unsupported field types such as Auto Number, Geolocation;
   Visualforce/Apex logic to re-implement or drop).
4. Which features are standard vs custom (drives Veeva-migrated vs customer-rebuilt).
5. Test users per country/rep type for full-data sandbox trials.

Source: https://intuitionlabs.ai/articles/veeva-crm-vault-migration-checklist ;
https://docs-vdm.veevanetwork.com/doc/vndocst/Content/Network_topics/Whats_new/24R3.0/Vault_CRM.htm (search extracts).

### 4.4 Country modelling hooks that already exist (document these, don't invent new ones)

| Hook | Where | Source |
|---|---|---|
| Primary country of user / account | `Country_Code_vod` global picklist (Global Value Set) on User and Account; ISO-2 | https://crmhelp.veeva.com/doc/Content/CRM_topics/ReleaseNotes/20R3.1/New_in_Veeva_CRM_20R3.1.htm |
| Additional countries for multi-country users | `Network_Additional_Countries_vod__c` on User (semicolon list); Network Bridge can be single- or multi-country, one schedule per multi-country bridge | https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Using%20Network/SupportingMultiCountryUsers.htm ; https://docs-vdm.veevanetwork.com/doc/vndocad/Content/Network_topics/CRM/Add_multi_country_Network_Bridge.htm |
| Sample regulation by country | Sample limit templates by `Template_Group_vod` + sharing rules; sample opt-in; `Signature_Page_vod` country disclaimers | see §2 Section 5 sources |
| Address country | `Address_vod__c.Country_vod__c` (2-char) | https://support.veeva.com/hc/en-us/articles/360002264294-… |
| Rep type on user | `User_Type_vod__c` | https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm |

---

## 5. Pitfalls (and the query or check that surfaces each)

| Pitfall | Why it hurts the migration | How to detect in the as-is extract | What the spec should do |
|---|---|---|---|
| **Profile sprawl** (clones per country / region / "…_new") | Every profile becomes a candidate security + application profile; test effort scales with it | `SELECT Profile.Name, COUNT(Id) FROM User WHERE IsActive = true GROUP BY Profile.Name`; diff profile permission sets pairwise | Persona matrix; merge profiles whose permissions differ < N items; default disposition for 0-user profiles = drop. Salesforce's own direction is few generic profiles + permission sets / permission set groups. |
| **User-level Veeva Settings records** | Veeva documents only org + profile levels; user-level records are unsupported and produce behaviour the profile documentation cannot explain | `SELECT SetupOwnerId FROM Veeva_Settings_vod__c` (and every `*_Settings_vod__c`); `SetupOwnerId` prefix `005` = User, `00e` = Profile, `00D` = Org **[inferred from SF ID prefixes]** | List every user-level record as an *anomaly*; the country must either promote it to a profile-level delta or drop it. |
| **Undocumented VMOC where clauses** | They silently implement country/brand scoping and data-volume limits; lost on migration, they cause sync bloat or missing data | `SELECT Object_vod__c, Profile_ID_vod__c, Device_vod__c, Where_Clause_vod__c, Active_vod__c FROM VMobile_Object_Configuration_vod__c WHERE Where_Clause_vod__c != null`; group by object, diff across profiles | One workbook row per VMOC × profile with a *purpose* column; where clauses referencing country/territory fields become explicit deltas. Veeva: "not recommended to populate the Where Clause field and leave the Device field empty". |
| **Orphaned record types** | Migrated to object types nobody uses; layouts and picklist dependencies multiply | `SELECT Id, DeveloperName, SobjectType, IsActive FROM RecordType`; then `SELECT RecordType.DeveloperName, COUNT(Id) FROM Call2_vod__c GROUP BY RecordType.DeveloperName` (per object); cross with profile record-type availability | Object type list = record types with (records in the last 24 months OR assigned to an active profile); rest is dropped with a decision entry. |
| **Unused page layouts** | Each layout must be re-created per object type × profile in Vault | Tooling `ProfileLayout` joined to active profiles; layouts with no assignment to an active profile | Layout matrix (object type × security profile) in the workbook; unassigned layouts not carried over. |
| **Translation gaps** | English fallback masks missing local messages until a user in that language hits it; Vault's translation flow (Vault Messages → daily copy job → Veeva Messages, Bulk Translations tool) is different from editing `Message_vod__c` directly | For each `Message_vod__c.Name` used by an active profile, check existence per language in `User.LanguageLocaleKey` set | Translations tab lists only customer-changed messages per language; mark "en-only" as delta `LANG`; plan Bulk Translations upload per country. |
| **Settings changed but never documented** ("someone flipped it in 2019") | No requirement to trace to; validation cannot justify the value | Compare profile-level settings vs org default; anything differing with no decision log entry | Every differing setting gets a row + reason; `LEGACY` defaults to global value. |
| **Country-specific logic in Apex / flows** | None migrates; often the only place a local rule lives | Tooling `ApexTrigger`/`Flow` bodies grepped for `Country`, `Country_Code_vod`, ISO codes | Move the rule into the intake Section 8 with keep/drop; if kept, into fit-gap backlog with a Vault mechanism (object lifecycle/workflow, validation, Vault Java SDK) |
| **Multi-org data model drift** | Same object with different custom fields per org | Describe diff across orgs | Global workbook rows carry `Org` column; convergence decisions logged |
| **Local reports nobody opens** | Migrated reporting scope balloons | `Report.LastRunDate` (< 12 months) | Only reports run in the last 12 months are in scope; rest listed as dropped |

Sources: https://support.veeva.com/hc/en-us/articles/115000840194-Are-User-Level-Veeva-Settings-Supported-in-CRM- ;
https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/MobileDeviceSetup/Sync/VMOCs.htm ;
https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/Veeva_Messages.htm ;
https://www.salesforceben.com/clean-up-profiles-and-permission-sets-in-salesforce/ ;
https://www.captechconsulting.com/technical/managing-salesforce-permissions-at-scale (search extracts).
Detection queries are **[practice]** built on the field names confirmed in `01-…` / `02-…`.

---

## 6. Minimal artefact set (what "done" looks like for one country)

1. `persona-matrix.csv` — rows for this country, dispositions filled.
2. `intake-<CC>.md` (or `.yaml`) — pre-filled, confirmed, signed (Section 10).
3. `delta-<CC>.csv` — every row with reason code, decision #, URS + test refs.
4. Decision-log entries `D-nnn` referenced from the delta sheet.
5. Translations list per language (`en-only` items flagged).
6. Integration list with credential owners named.
7. Custom-development backlog items (anything that could not be expressed as a delta).

If a country produces more than ~2 pages of deltas, that is the signal to re-run the
fit-gap session on *why*, not to accept the list.

---

## Uncertainties

1. **"Configuration Assessment questionnaire".** No public Veeva page by that name was
   found; the "pre-migration report" and "technical assessment / readiness review" are named
   only in third-party sources (grax.com, intuitionlabs.ai). The list in §4.3 of what
   customers must provide is assembled from those sources and cannot be confirmed as Veeva's
   official request list.
2. **Veeva's "global template with local variants" recommendation.** No Veeva document states
   this as doctrine. It is inferred from Vault CRM's separation of security profiles vs
   application profiles, Align functional profiles, and the data-level country hooks
   (sample limit templates, disclaimers, Network multi-country bridge). Treat §4.2's design
   implication as practitioner guidance.
3. **Body text of official pages** (`TransitionToVault.htm`, `ApplicationProfiles.htm`,
   `Veeva_Messages.htm`, `RequiringUserTypeAndCountry.htm`, the Education workshop agenda)
   was not readable — only search-engine extracts were used. Exact field lists on
   `veeva_settings__v` / `vmobile_object_configuration__v` (beyond `application_profile__v`,
   `security_profile__v`) are unverified.
4. **User-level Veeva Settings detection via `SetupOwnerId` prefix** is inferred from
   standard Salesforce ID prefixes (`005` User, `00e` Profile, `00D` Organization); Veeva's
   article says user level is unsupported, not what happens if such a record exists.
5. **GAMP 5 wording** is quoted from secondary summaries (kneat.com, casrai.org), not from the
   ISPE text (paywalled). The category-4 document list and the IQ/OQ/PQ ↔ CS/FS/URS mapping
   are consistent across sources but should be checked against the customer's own
   validation SOPs, which take precedence.
6. **Vault CRM / Vault API release numbers** were not confirmed for any statement here;
   Vault API ~v25.x assumed per task brief, and `05-verified-endpoints.md` cites VAPIL at v26.2.
7. All SOQL/Tooling detection queries in §5 are untested against a live org in this session.

---

## All sources consulted

Official (Veeva / Salesforce / ISPE) — via search extracts unless noted:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Profile_Config_Veeva_Custom_Settings.htm
- https://support.veeva.com/hc/en-us/articles/115000840194-Are-User-Level-Veeva-Settings-Supported-in-CRM-
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/MobileDeviceSetup/Sync/VMOCs.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/VeevaCRMStandardMetrics.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/ReleaseNotes/20R3.1/New_in_Veeva_CRM_20R3.1.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Using%20Network/SupportingMultiCountryUsers.htm
- https://docs-vdm.veevanetwork.com/doc/vndocad/Content/Network_topics/CRM/Add_multi_country_Network_Bridge.htm
- https://docs-vdm.veevanetwork.com/doc/vndocst/Content/Network_topics/Whats_new/24R3.0/Vault_CRM.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/SampleManagement/AdvFunct/Restrictions/SampleLimitTemplates.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/CallSampling/InitialConfig/ConfiguringCS.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/MyInsights/MyInsightsAdvFunct/TabTranslations.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/Engage/EngageMeeting/Connect/InitialConfig/CompanyConfigFile.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/TransitionToVault.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/PermissionSets.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/ApplicationProfiles.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/VeevaCustomSettings.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/Security/SecurityVaultCRM.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/Veeva_Messages.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Accounts/ManagingAccountInfo/WorkingwithTerritoryFields.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Align/UserMgmt/AppProfiles.htm
- https://vaultcrmalign.veeva.com/doc/Content/Align/UserMgmt/FunctProfiles.htm
- https://platform.veevavault.help/en/lr/23647/ (Managing Security Profiles & Permission Sets)
- https://platform.veevavault.help/en/lr/761685/ (Record Migration Mode)
- https://support.veeva.com/hc/en-us/sections/360002781174-Vault-Config-Migration
- https://support.veeva.com/hc/en-us/articles/6611648252955-Planning-and-Preparing-for-a-Vault-Configuration-Migration-Deployment
- https://support.veeva.com/hc/en-us/articles/6611450164507-Vault-Configuration-Migration-Package-Deployment-Guide
- https://education.veeva.com/products/veeva-crm-to-vault-crm-enablement-workshop
- https://guidance-docs.ispe.org/doi/book/10.1002/9781946964571 (GAMP 5 2nd ed., landing page only)

Secondary / practitioner:
- https://intuitionlabs.ai/articles/veeva-vault-crm-migration-guide
- https://intuitionlabs.ai/articles/veeva-crm-vault-migration-checklist
- https://intuitionlabs.ai/articles/veeva-vault-crm-migration-roadmap
- https://www.grax.com/blog/veeva-salesforce-migration-guide/
- https://craftware.com/veeva-crm-migration-what-really-changes-for-your-business/
- https://kneat.com/article/what-is-gamp-5/
- https://casrai.org/guides/computer-system-validation-csv-gamp-5-iq-oq-pq
- https://www.salesforceben.com/clean-up-profiles-and-permission-sets-in-salesforce/
- https://www.captechconsulting.com/technical/managing-salesforce-permissions-at-scale
