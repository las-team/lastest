# Veeva CRM (Salesforce-based) — Configuration Model by Country and Rep Type

Research date: 2026-09-07. Scope: Veeva CRM on the Salesforce platform (the `_vod` data model),
not Vault CRM. Salesforce API ~v64.0 assumed; the Veeva CRM release stream is `YYRx.y`
(e.g. 24R3.0). Where a Vault CRM page was the only reachable source it is called out.

> **Source-access note.** During this research `crmhelp.veeva.com`, `vaultcrmhelp.veeva.com`
> and `support.veeva.com` were blocked for direct page fetches by the network egress proxy.
> Every "confirmed" statement below comes from search-engine extracts of those pages (URL
> cited under each section). Statements tagged **[inferred]** are practitioner knowledge
> or naming-convention extrapolation and must be verified against a real org
> (`describeSObject` / Setup) before being relied on in a config inventory.

---

## 0. Summary of the configuration axes

Veeva CRM has no single "configuration object". Behaviour is the intersection of four
Salesforce/Veeva layers, each of which can be varied by **profile** (the rep-type axis) and,
less directly, by **country**:

| Layer | Mechanism | Varies by profile? | Varies by country? |
|---|---|---|---|
| Security & UI | Salesforce Profile, Permission Sets, Page Layouts, Record Types, FLS | Yes — the primary axis | Only by cloning profiles per country (customer convention) |
| Feature switches | Veeva Settings (Salesforce hierarchy custom settings, `*_Settings_vod__c`) | Yes — org default overridden by profile-level record | Only via profile (no native country level) |
| Offline data scope | VMOCs (`VMobile_Object_Configuration_vod__c`) — one per object × profile × device | Yes — `Profile_ID_vod__c` | Via `Where_Clause_vod__c` filters on country fields |
| Labels/text | Veeva Messages (`Message_vod__c`) keyed by Name + Category + Language | Indirectly (profile-specific message names referenced from profile-level settings) | Via **language** (`Language_vod__c`), not country |
| Data & alignment | `User.Country_Code_vod__c`, `Account.Country_vod__c`, `Address_vod__c.Country_vod__c`, territories/TSF | — | Yes — the data-side country axis |

Veeva's own summary: "Veeva CRM is a highly configurable application which follows the same
configuration principles and utilizes the same configuration tools as Salesforce.com … most
of the application [is] configurable using Salesforce.com's Application and Administrative
Setup functions."
Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/General/Veeva_CRM_Configuration_Overview.htm

---

## 1. Salesforce Profiles as the "rep type" axis

### 1.1 What Veeva ships

- Veeva CRM is delivered as a **Veeva-provisioned org**; per the admin do's-and-don'ts page it
  "cannot be installed on an existing salesforce.com org and is not a managed package"
  (i.e. it is not something you install from AppExchange into your own org). The data model
  uses the `_vod` **suffix** convention (`Call2_vod__c`, `Country_vod__c`) rather than a
  `vod__` namespace prefix on objects/fields. Apex/Visualforce/Lightning components shipped by
  Veeva do carry the `vod` namespace **[inferred]**.
- "Veeva CRM includes profile definitions for standard user profiles such as sales rep users,
  first-line manager, marketing users, and medical and scientific liaison (MSL) users." These
  are described as **sample profiles**: "it is recommended to keep these profiles as a
  reference point and make copies of them to implement your own profiles."
- "Field level security controls which profile a user (Specialty Sales or MSL for example)
  can see and which fields users can edit on objects."
- Veeva also ships **Veeva-delivered permission sets** for feature areas; e.g. the Events
  Management quick-start says "Veeva recommends cloning the Veeva-delivered permission sets
  and enabling the features that you want to use."
- Business Admin vs System Admin is a role distinction Veeva formalises in its training
  tracks ("Veeva CRM for Business Administrators", "System Administrator Track",
  "Configuration Track").

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/Security/ImplementingSecurityinVeevaCRM.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Administrative_Do's_and_Don'ts.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Events%20Management/Configuration/QuickStartGuide.htm
- https://education.veeva.com/products/veeva-crm-for-business-administrators-on-demand

### 1.2 Exact shipped profile names — NOT confirmed

The search extracts describe the profile *types* (sales rep, first-line manager, marketing,
MSL, business admin, system admin, integration) but never list the literal profile names in a
fresh org. Practitioner experience **[inferred]** is that a fresh org contains profiles along
the lines of `Sales Rep`, `Field Manager`/`Sales Manager`, `Business Admin`, `System Admin`,
`Marketing`, `MSL` (Medical CRM), `Integration User` / `Data Loader`, `Content Admin`
(Approved Email / CLM), plus the Salesforce standard profiles. Treat the literal names as
org-specific; read them from `Profile` via the Tooling/Metadata API.

### 1.3 Customer convention: clone per country × rep type

Because Veeva Settings and VMOCs are keyed by **profile**, and Veeva CRM has **no native
"country" level** in either mechanism, the standard multi-country pattern is to clone the
sample profile once per country (and rep type):

```
DE Sales Rep          FR Sales Rep          IT Sales Rep
DE Specialty Rep      FR Specialty Rep
DE KAM                FR KAM
DE MSL                FR MSL
DE Field Manager      FR Field Manager
DE Inside Sales       FR Inside Sales
DE Business Admin     FR Business Admin
```

Each clone then gets its own: page-layout assignments, record-type visibility/defaults,
profile-level Veeva Settings records, and VMOC rows. Permission sets are layered on top for
cross-cutting features (Approved Email, CLM, Engage, Events, Medical, Order Management,
Samples) so the profile matrix does not explode further. **[inferred — convention, not a
Veeva doc statement]** The doc-confirmed part is only that settings, VMOCs and layouts are
profile-keyed (sections 2–3).

### 1.4 The rep-type field on User (separate from Profile)

Since 22R1 (April 2022) Veeva requires three User fields, prompting mobile users at login if
blank:

| Field (User) | Meaning | Values |
|---|---|---|
| `User_Type_vod__c` | "indicates the role of the end user" | standard picklist values (rep, manager, MSL, etc.) — data-loaded by the customer |
| `Country_Code_vod__c` | "end user's primary country of operations" | 2-letter ISO codes |
| `Call_Channel_vod__c` | primary call channel | picklist |

"all three fields … are optional in 21R2 (August '21) and mandatory in 22R1 (April '22)."
This gives a **data-level** rep-type × country classification independent of the profile
name — useful for a config inventory to cross-check profile naming conventions.

Source: https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm

---

## 2. Veeva Settings (hierarchy custom settings)

### 2.1 Mechanism

- "Veeva Settings are similar to custom objects and provide the ability to define specific
  application behavior for an organization or profile."
- "Settings for an organization are overridden by profile settings." (Salesforce hierarchy
  custom setting: Organization default record → Profile-level record.)
- Vault CRM's equivalent page states "only global and profile-level settings are supported,
  with user-level settings not supported." For Salesforce Veeva CRM the platform *permits*
  User-level records on hierarchy custom settings, and some Veeva features honour them, but
  Veeva's documentation consistently describes only org and profile levels. **Treat
  user-level Veeva Settings as unsupported/undocumented** for inventory purposes.
- Sync coupling: "When using profile level Veeva Settings, enable the Enhanced Sync setting
  on the VMOC for the Veeva_Settings_vod__c Veeva Settings to avoid a Force Full Refresh when
  users switch between profiles."
- Some settings are **pointers to a Veeva Message**: "some custom settings are pointers to a
  related Veeva Message, where the Veeva Message continues to control the configuration
  option" (the setting value is `MessageName;;Category` **[inferred format]**).
- Record access: end users need Read on the custom settings objects; a support article
  exists for "Why an End User Does Not Have Record Access to Custom Setting Records".

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Profile_Config_Veeva_Custom_Settings.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/VeevaCustomSettings.htm
- https://support.veeva.com/hc/en-us/articles/8316112903195

### 2.2 Settings objects (Setup → Custom Settings)

Confirmed labels from the Appendix and feature pages, with API names:

| Label (confirmed) | API name | Confidence | Notes |
|---|---|---|---|
| Veeva Settings | `Veeva_Settings_vod__c` | confirmed (named in sync guidance) | The master settings object: call reporting, samples, accounts, sync (`SYNC_CONFIGURATION_MODE_VOD`), territory links, etc. |
| Approved Email Settings | `Approved_Email_Settings_vod__c` | confirmed | e.g. `ENABLE_APPROVED_EMAIL_RECEIPTS_vod__c`, `APPROVED_EMAIL_TEST_ADDRESS_vod__c` |
| Multichannel Settings | `Multichannel_Settings_vod__c` | confirmed | CLM / Engage / multichannel; explicitly documented as profile-specific |
| Events Management Settings | `Events_Management_Settings_vod__c` | label confirmed; API name by convention | |
| Engage Settings | `Engage_Settings_vod__c` | label confirmed; API name by convention | |
| Network Settings | `Network_Settings_vod__c` | label confirmed; API name by convention | Network/DCR integration |
| Global Account Search Settings | `Global_Account_Search_Settings_vod__c` | label confirmed; API name by convention | |
| Mobile CRM Settings | `Mobile_CRM_Settings_vod__c` | label confirmed; API name by convention | iPad/Windows/Mac app behaviour |
| Territory Settings | `Territory_Settings_vod__c` | label confirmed; API name by convention | |
| Medical Settings | `Medical_Settings_vod__c` | **not confirmed** | Medical CRM configuration is largely in `Veeva_Settings_vod__c` plus Medical-specific settings; verify |
| CLM Settings | — | **not confirmed as separate object** | CLM configuration lives in `Multichannel_Settings_vod__c` (and legacy `Veeva_Settings_vod__c`) **[inferred]** |
| Sample Management Settings | — | **not confirmed as separate object** | Sample settings (`SAMPLE_*`, disbursement, receipt) live in `Veeva_Settings_vod__c` **[inferred]** |
| Order Management Settings | `Order_Management_Settings_vod__c` | **not confirmed** | verify |
| Concur Settings | `Concur_Settings_vod__c` | **not confirmed** | Events Management → Concur expense integration; verify |

Full catalogue: https://crmhelp.veeva.com/doc/Content/CRM_topics/General/AppendixACustomSettings.htm
Approved Email fields: https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/ConsentCapture/AdvFunct/CCReceipts.htm
Multichannel profile-specific: https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/CLM/InitialConfig/ConfiguringCLM/CLMConfigUsers.htm

### 2.3 How to inventory settings by profile

SOQL shape (hierarchy custom settings expose `SetupOwnerId`, which is the Org Id, a Profile Id
or a User Id):

```sql
SELECT Id, SetupOwnerId, SetupOwner.Type, SetupOwner.Name,
       ENABLE_APPROVED_EMAIL_RECEIPTS_vod__c, APPROVED_EMAIL_TEST_ADDRESS_vod__c
FROM Approved_Email_Settings_vod__c
```

Apex equivalent: `Veeva_Settings_vod__c.getInstance(profileId)` (Salesforce hierarchy
resolution: user → profile → org). A per-country view is derived by mapping each
profile-level row to the country encoded in the profile name (or via the users' `Country_Code_vod__c`
distribution per profile).

---

## 3. VMOCs — `VMobile_Object_Configuration_vod__c`

### 3.1 Purpose

"A user can set a VMobile Object Configuration (VMOC) record per Profile for a specific
object. Each VMOC is offline device-specific, and for each object to be synced down to mobile
platforms, an active VMOC must exist for the relevant Device_vod field." VMOCs therefore
define, per **object × profile × device**, whether the object syncs offline and which rows.

### 3.2 Fields (confirmed list from support article)

| Field | Purpose |
|---|---|
| `Object_Name_vod__c` | API name of the object to sync (the task's "Object_API_Name_vod__c" is **not** the real name) |
| `Profile_ID_vod__c` | Salesforce Profile Id this VMOC applies to. **Must be the 18-character Id**: "If the Profile_ID_vod is filled with a 15-digit Salesforce ID, no records are downloaded at all." Blank = applies to all profiles without a profile-specific VMOC **[inferred]** |
| `Profile_Name_vod__c` | Human-readable profile name (documentation / convenience) |
| `Device_vod__c` | Target platform (values seen in docs: `iPad`, `Windows` for CRM Desktop Windows, Mac; historically `iPhone`, `Online`) **[values partly inferred]** |
| `Active_vod__c` | Switch; "Even with Active_vod = True, no records may be downloaded if other configuration issues exist." |
| `Where_Clause_vod__c` | Meta-SOQL WHERE clause restricting which rows sync |
| `Type_vod__c` | VMOC type (e.g. top-level vs child/related) **[inferred]** |
| `Enable_Enhanced_Sync_vod__c` | "Enhanced Sync VMOCs transfer all newly shared records regardless of the Last Modified By date" |
| `Meta_Data_Only_vod__c` | Sync object metadata only, no rows |
| `Field_List_vod__c` / `Exclude_Field_List_vod__c` | Include/exclude field lists |
| `Include_Related_Objects_vod__c`, `Parent_Object_Name_vod__c`, `Child_Object_Name_vod__c`, `Child_Relationship_vod__c`, `Relationship_Field_vod__c`, `Relationship_Name_vod__c` | Related-object (child) sync configuration |
| `Account_Lookup_Field_vod__c` | Which lookup ties the object to Account for account-scoped sync |

There is no dedicated "Owner filter" field; owner scoping is expressed in `Where_Clause_vod__c`
using tokens (e.g. `OwnerId = @@VOD_USER_ID@@` **[token name inferred]**) or via sharing.

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/MobileDeviceSetup/Sync/VMOCs.htm
- https://support.veeva.com/hc/en-us/articles/115000112054
- https://support.veeva.com/hc/en-us/articles/115003391048
- https://support.veeva.com/hc/en-us/articles/360039940353

### 3.3 Where-clause syntax and tokens

Documented example for `Message_vod__c` when `SYNC_CONFIGURATION_MODE_VOD` = 1:

```sql
WHERE Category_vod__c IN ('RemoteMeeting', 'iPad', 'CONTENT', 'CLM', 'Common')
  AND Language_vod__c IN (@@VOD_USER_LANG_CD@@, 'en_US')
```

"`@@VOD_USER_LANG_CD@@` is a special META-SOQL variable that represents the language code for
the signed in user." When `SYNC_CONFIGURATION_MODE_VOD` = 0, "ensure there is only one
Message_vod__c VMOC record."

Other meta-SOQL tokens commonly used **[inferred; verify in the VMOCs help page]**:
`@@VOD_USER_ID@@`, `@@VOD_USER_PROFILE_ID@@`, `@@VOD_TERRITORY@@`/territory tokens, and
`@@VOD_USER_COUNTRY@@`-style tokens for country.

Source: https://support.veeva.com/hc/en-us/articles/360039940353

### 3.4 Country filtering via VMOCs (customer practice)

Veeva documents no country-level VMOC key. Country scoping is achieved by **[inferred, widely
used]**:

1. **Profile per country** (section 1.3) — a `DE Sales Rep` VMOC on `Product_vod__c` with
   `WHERE Country_vod__c = 'DE'` or `WHERE Country_Code_vod__c = 'DE'`, one row per country.
2. **Literal country lists** on reference data objects: `Product_vod__c`, `Product_Metrics_vod__c`,
   `Key_Message_vod__c`, `CLM_Presentation_vod__c`, `Approved_Document_vod__c`,
   `Sample_Lot_vod__c`, `Message_vod__c`, `Metadata`-like objects — filtered on a customer-added
   or Veeva `Country_vod__c` / `Country_Code_vod__c` field.
3. **Sharing/territory** for transactional data (Account, Call2, TSF) — the VMOC is generic
   and territory sharing decides which accounts a rep sees.

For a config inventory: export all VMOC rows and group by `Object_Name_vod__c` →
`Profile_Name_vod__c` → `Device_vod__c`, and regex the `Where_Clause_vod__c` for ISO codes /
country fields to reconstruct the country matrix.

---

## 4. Veeva Messages — `Message_vod__c`

- "The Veeva Messages custom object stores text and labels for all Veeva CRM configured
  components, labels and error messages."
- Key: a message is addressed by **Name + `Category_vod__c` + `Language_vod__c`**. The VMOC
  where clause above shows categories (`Common`, `iPad`, `CLM`, `CONTENT`, `RemoteMeeting`, …)
  and languages (`en_US` and Salesforce locale codes such as `de`, `fr`, `ja`).
- Text field: `Text_vod__c` (the body shown to users; some messages carry tokens, e.g. Events
  Management warning text). **Name confirmed by wide practitioner use; not directly seen in
  fetched text.**
- `Active_vod__c` exists on `Message_vod__c` **[inferred]**.
- Language resolution: the message with `Language_vod__c` = the user's language is used; the
  VMOC fallback `IN (@@VOD_USER_LANG_CD@@, 'en_US')` ensures English is present offline.
  Veeva ships translations for all supported languages (see Supported Languages page).
- **There is no Country field on `Message_vod__c`**: localisation is by *language*, not
  country. Country-specific wording (e.g. Austrian vs German phrasing, UK vs US English) is
  handled either by (a) a distinct Salesforce locale/language for the user, or (b)
  profile-specific messages: "You can clone a Veeva Message, updating the Message Name so it
  is unique to the profile", then point the **profile-level** Veeva Setting at the new
  message name (the settings→message pointer mechanism from section 2.1).
- Related but distinct object: `Key_Message_vod__c` (CLM/call key messages) also has
  `Category_vod__c` and `Language_vod__c` ("available Key Messages are those where the
  Language_vod field matches the user's language or where Language_vod is blank"). Do not
  confuse the two in the inventory.

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Veeva_Messages.htm
- https://support.veeva.com/hc/en-us/articles/115004071907-How-to-Set-Up-a-CRM-Veeva-Message-to-be-Used-for-a-Specific-Profile
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/Supported_Languages.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/KeyMessages.htm

---

## 5. Country modelling

### 5.1 Fields (confirmed)

| Object | Field | Notes |
|---|---|---|
| `User` | `Country_Code_vod__c` | Primary country of operations, 2-letter ISO, mandatory since 22R1 |
| `User` | standard `Country` (address) | Must hold the ISO 3166-1 alpha-2 code for Network/DCR: "the Country field on the User object … using the country's 2-digit ISO 3166-1 alpha 2 code"; missing → "Cannot process DCR transaction without Country_Mapping_vod__c" |
| `User` | `Network_Additional_Countries_vod__c` | "semicolon-delimited list" of extra countries; Network account search spans primary + these |
| `Account` | `Country_vod__c` | Account country; used as the CRM side of the Network `primary_country__v` mapping ("either the Country_vod field on the Account object, or a custom text or lookup field") |
| `Address_vod__c` | `Country_vod__c` | Picklist "purposely designed to only use a two-digit code" |
| `Address_vod__c` | `Zip_vod__c` | Alignment key; multi-country orgs with clashing postal codes prefix values with the country code |
| (activity objects) | `Country_User_vod__c`, `Country_Account_vod__c` | Stamped copies of the user's and account's country for reporting/benchmarking ("Stamping Country Information for Account and User"); host object(s) not confirmed — likely `Call2_vod__c` and other transactional objects **[inferred]** |

### 5.2 Is there a `Country_vod__c` *object*?

Not confirmed. In Salesforce Veeva CRM, country is modelled as **picklist fields** (above);
the search results surface `Country_vod__c` only as a field on Account and Address_vod__c.
Vault CRM has a `country__v` object, which may be the origin of the assumption. Verify with
`describeGlobal` before adding it to an inventory.

### 5.3 Territories and alignment

- Veeva CRM uses Salesforce territory management (Territory2 / Enterprise Territory
  Management) with Veeva objects layered on top **[platform fact; inferred for current
  releases]**.
- `TSF_vod__c` (Territory Specific Fields): one record per Account × Territory, carrying
  territory-scoped attributes (targeting, `Address_vod__c` preferred address, `My_Target_vod__c`
  etc.). "When a user has multiple territories, the first matching territory (sorted
  alphabetically) is used to find the TSF record of the account, and if the TSF_vod.Address_vod__c
  field is null, the Primary Address is displayed."
- Alignment methods: manual, Zip-to-Terr (`Zip_to_Terr_vod__c` records vs `Address_vod__c.Zip_vod__c`),
  external systems (Veeva Align), and **partial alignments**, which "are useful for
  organizations that span multiple countries who want to perform an alignment for only one
  of those countries."
- Account visibility is thus territory-driven; country segregation of *data* is normally a
  consequence of territory hierarchy (a country node with rep territories beneath), not of a
  country field.

### 5.4 Org topology

Veeva customers run either one org per region/cluster (EU, NA, APAC, LATAM) or one global
org; a shared org relies on the profile-per-country + VMOC where-clause + territory pattern.
Network (MDM) is typically one instance with per-country data, and CRM users are enabled per
country ("Country [Code] is not enabled for user" error). **[inferred practice; Network
per-country enablement confirmed by support article]**

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Using%20Network/SupportingMultiCountryUsers.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/AcctsAdvancedFunc/StampingCountryInformation.htm
- https://support.veeva.com/hc/en-us/articles/360041355594
- https://support.veeva.com/hc/en-us/articles/360000545054
- https://support.veeva.com/hc/en-us/articles/360002264294
- https://support.veeva.com/hc/en-us/articles/360015433733
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/TerritoryManagement/TMComponents.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/TerritoryManagement/TestingAlignments.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Configuration/DCR_Configuration.htm

---

## 6. Objects a configuration inventory must cover

### 6.1 Core objects

Names below follow the Veeva CRM Data Model; those marked ✔ appeared verbatim in the sources
consulted, the rest are standard Veeva object names **[from practitioner knowledge — verify
with describeGlobal]**.

| Area | Object | Notes |
|---|---|---|
| Accounts | `Account` ✔ | Record types split person vs business accounts (see 6.2) |
| | `Address_vod__c` ✔ | `Country_vod__c`, `Zip_vod__c`, primary flag |
| | `Child_Account_vod__c` | HCP↔HCO affiliations |
| | `TSF_vod__c` ✔ | Territory-specific fields |
| | `Account_Territory_Loader_vod__c` | Bulk manual alignment loader |
| | `Zip_to_Terr_vod__c` | Zip-to-territory mapping ("zip-to-terr mapping record" ✔) |
| | `Product_Metrics_vod__c` ✔ | Per-account product metrics (segmentation) |
| Calls | `Call2_vod__c` ✔ | Record types = call types; layouts per profile |
| | `Call2_Detail_vod__c` | Product detailed |
| | `Call2_Discussion_vod__c` ✔ | Product discussions; record types mirror `Call2_vod__c` |
| | `Call2_Key_Message_vod__c` ✔ (as "Key Messages on the Call Report") | Key messages delivered |
| | `Call2_Sample_vod__c` | Samples/promo items disbursed |
| | `Call2_Expense_vod__c`, `Call_Objective_vod__c` ✔, `Call_Clickstream_vod__c` ✔ | |
| Products | `Product_vod__c` | Product hierarchy (Detail, Detail Group, Sample, Promo Item, Key Message types) |
| | `Key_Message_vod__c` ✔ | `Category_vod__c`, `Language_vod__c` |
| CLM | `CLM_Presentation_vod__c`, `CLM_Presentation_Slide_vod__c` | Content via Vault |
| Approved Email | `Approved_Document_vod__c`, `Sent_Email_vod__c`, `Email_Activity_vod__c` | |
| Samples | `Sample_Transaction_vod__c`, `Sample_Lot_vod__c`, `Sample_Inventory_vod__c`, `Sample_Limit_vod__c` | |
| Planning | `Cycle_Plan_vod__c`, `Cycle_Plan_Target_vod__c`, `Cycle_Plan_Detail_vod__c`, `Time_Off_Territory_vod__c` | |
| Medical | `Medical_Inquiry_vod__c`, `Medical_Event_vod__c` (legacy events), `Medical_Insight_vod__c` (KMI ✔ "Key Medical Insights") | |
| Events | `EM_Event_vod__c`, `EM_Attendee_vod__c`, `EM_Event_Rule_vod__c` ✔ ("Event Rule" / `Warning_Text_vod__c`), `EM_Business_Rule_vod__c` | |
| Order Mgmt | `Order_vod__c`, `Order_Line_vod__c`, `Pricing_Rule_vod__c` | |
| Config/meta | `Message_vod__c` ✔, `VMobile_Object_Configuration_vod__c` ✔, `Veeva_Settings_vod__c` ✔ + other `*_Settings_vod__c`, `Metadata_Reference_vod__c`? (**unconfirmed**), `Multichannel_Activity_vod__c`, `Data_Change_Request_vod__c` | |

### 6.2 Record types and layouts

- **Call report layouts are per call record type per profile**: "Each call object type can be
  assigned its own layout for each Security Profile, which enables different types of users
  to capture data relevant to their unique role." Add `RecordTypeId` to `Call2_vod__c` layouts
  to let users pick the call type.
- **Discussion section per call type**: "create record types on the Call2_Discussion_vod
  object that have the same exact names as the record types on the Call2_vod object … the
  layout used for the product discussion section is the layout associated to the record type
  in the Call2_Discussion_vod object with the same name."
- **Account record types**: Veeva ships person-account and business-account record types —
  the developer names `Professional_vod`, `Hospital_vod`, `Business_Professional_vod`,
  `Pharmacy_vod`, `Practice_vod`, `MCO_vod`, etc. are standard Veeva names **[inferred; the
  search extracts confirmed only that record types exist]**. Customers typically add
  country-specific ones (e.g. `Apotheke_vod` style customisations are *not* Veeva-standard).
- Inventory dimension: for every profile → object → record type: visibility, default,
  assigned page layout (Salesforce `ProfileLayout`/`RecordType` metadata via Metadata API
  `Profile` type with `layoutAssignments` and `recordTypeVisibilities`).

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/InitialConfig/ConfiguringCR.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/AdvFunct/Executing/Header/RecordTypes.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/ProductDiscussions.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Custom_Fields.htm ("objects without _vod in the name may be freely deleted or renamed"; `_vod` items are core)

---

## 7. Configuration documentation practice

Veeva's own artefacts:

- **Functionality Guide** per release — "intended for Sales Operations, Business
  Administrators, System Integrators, and others responsible for making decisions about what
  features are needed … and deciding which features work together with existing customer
  configurations." Lists each new feature with the configuration (settings, VMOCs, FLS,
  layouts) it requires.
- **Appendix A: Custom Settings** — the canonical settings catalogue.
- **Data Model Guide** — "complete Veeva CRM data model, Veeva CRM objects, standard and
  custom fields, ERD diagrams."
- **Engage Company Configuration file** — an `.xlsx` that "is the only method of configuring
  and updating information in the Engage app" (an example of a Veeva-owned workbook format).

Customer/SI artefacts **[inferred, industry practice]** — a "Configuration Workbook" or
"Business Admin Guide"/FDD typically has one tab or section per layer, each with a
**Profile × Country matrix**:

1. Profiles & permission sets — name, cloned-from, country, rep type, feature PSLs.
2. Veeva Settings — one row per setting field; columns = Org default + each profile value.
3. VMOCs — object, profile, device, active, where clause, enhanced sync.
4. Veeva Messages — customised/added messages by name, category, language.
5. Objects & fields — custom fields, FLS by profile, picklist values (country-specific value
   sets, e.g. Account specialties, call types, sample lots).
6. Record types & page layouts — per object, per profile, per country.
7. Territory / alignment model — hierarchy, TSF, zip-to-terr, Align integration.
8. Integrations — Network/DCR country mappings (`Country_Mapping_vod__c`), Vault (CLM/AE
   content), Align, Nitro/Compass, data loads.
9. Automation — validation rules, workflows/flows, Apex triggers (country- or profile-guarded).
10. Sample management / compliance rules per country (signature, limits, receipts).
11. Approved Email / CLM / Engage / Events per country (content, templates, consent).
12. Reports & dashboards.

Sources:
- https://crmhelp.veeva.com/doc/Content/CRM_topics/ReleaseNotes/24R3.0/24R3.0FunctionalityGuide.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/AppendixACustomSettings.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Data_Loading_in_CRM.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/Engage/EngageMeeting/Connect/InitialConfig/CompanyConfigFile.htm

---

## 8. Extracting the configuration (API shapes)

All of this is reachable through standard Salesforce APIs (v64.0):

| Need | API | Shape |
|---|---|---|
| Profiles, layout & record-type assignments, FLS | Metadata API `retrieve` types `Profile`, `PermissionSet`, `Layout`, `RecordType`, `CustomObject` | `package.xml` → zip of XML |
| Settings by profile | REST `GET /services/data/v64.0/query?q=SELECT+SetupOwnerId,...+FROM+Veeva_Settings_vod__c` | JSON records; `SetupOwnerId` prefix `00e` = Profile, `00D` = Org, `005` = User |
| VMOCs | `SELECT Object_Name_vod__c, Profile_ID_vod__c, Profile_Name_vod__c, Device_vod__c, Active_vod__c, Where_Clause_vod__c, Enable_Enhanced_Sync_vod__c FROM VMobile_Object_Configuration_vod__c` | JSON |
| Messages | `SELECT Name, Category_vod__c, Language_vod__c, Text_vod__c FROM Message_vod__c` (large — use Bulk API 2.0) | CSV |
| Users by country/type | `SELECT ProfileId, Profile.Name, Country_Code_vod__c, User_Type_vod__c, Network_Additional_Countries_vod__c FROM User WHERE IsActive = true` | JSON |
| Object/field describe | `GET /services/data/v64.0/sobjects/Call2_vod__c/describe` | JSON incl. `recordTypeInfos` |

Version caveat: Salesforce v64.0 is assumed for 2026; Veeva CRM release/version pinning of
the org's API version could not be confirmed.

---

## Uncertainties

1. **Direct page content unavailable** — crmhelp/vaultcrmhelp/support.veeva.com were
   egress-blocked; all confirmations are via search-engine extracts of those pages.
2. **Literal names of Veeva-shipped sample profiles** are not documented in the extracts.
3. **User-level Veeva Settings**: Vault CRM says unsupported; Salesforce Veeva CRM docs
   mention only org and profile. Whether individual settings honour user-level records is
   unconfirmed.
4. **API names of several settings objects** (`Events_Management_Settings_vod__c`,
   `Engage_Settings_vod__c`, `Network_Settings_vod__c`, `Global_Account_Search_Settings_vod__c`,
   `Mobile_CRM_Settings_vod__c`, `Territory_Settings_vod__c`) are extrapolated from confirmed
   labels. `Medical_Settings_vod__c`, `Order_Management_Settings_vod__c`, `Concur_Settings_vod__c`,
   a separate CLM settings object and a Sample Management settings object are unconfirmed.
5. **`Message_vod__c.Text_vod__c` / `Active_vod__c`** not seen verbatim in extracts.
6. **`Country_vod__c` as an object** — not found; appears only as a field. Vault CRM's
   `country__v` object may be the source of the assumption.
7. **Host object of `Country_User_vod__c` / `Country_Account_vod__c`** stamped fields.
8. **VMOC `Device_vod__c` picklist values** and the full meta-SOQL token list (only
   `@@VOD_USER_LANG_CD@@` confirmed).
9. **Account record-type developer names** (`Professional_vod`, `Hospital_vod`, …) and the
   object list in 6.1 beyond the ✔-marked ones come from practitioner knowledge.
10. **`Metadata_Reference_vod__c`** existence unconfirmed.
11. Salesforce API version of a Veeva CRM org and the 2026 Veeva release number in force
    were not confirmed.

## All sources consulted

- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/Veeva_CRM_Configuration_Overview.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/Security/ImplementingSecurityinVeevaCRM.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Administrative_Do's_and_Don'ts.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Profile_Config_Veeva_Custom_Settings.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/AppendixACustomSettings.htm
- https://vaultcrmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/SettingUp/VeevaCustomSettings.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Veeva_Messages.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/Supported_Languages.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Getting_Started/MobileDeviceSetup/Sync/VMOCs.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/RequiringUserTypeAndCountry.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/AcctsAdvancedFunc/StampingCountryInformation.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Using%20Network/SupportingMultiCountryUsers.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Integration/Network_Integration/Configuration/DCR_Configuration.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/TerritoryManagement/TMComponents.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Accounts/TerritoryManagement/TestingAlignments.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/InitialConfig/ConfiguringCR.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/AdvFunct/Executing/Header/RecordTypes.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/ProductDiscussions.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Activities/Call_Reporting_2/DefaultFunct/KeyMessages.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/CLM/InitialConfig/ConfiguringCLM/CLMConfigUsers.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/ConsentCapture/AdvFunct/CCReceipts.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Events%20Management/Configuration/QuickStartGuide.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/Multichannel/Engage/EngageMeeting/Connect/InitialConfig/CompanyConfigFile.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/ReleaseNotes/24R3.0/24R3.0FunctionalityGuide.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Custom_Fields.htm
- https://crmhelp.veeva.com/doc/Content/CRM_topics/General/SettingUp/Data_Loading_in_CRM.htm
- https://support.veeva.com/hc/en-us/articles/115000112054
- https://support.veeva.com/hc/en-us/articles/115003391048
- https://support.veeva.com/hc/en-us/articles/360039940353
- https://support.veeva.com/hc/en-us/articles/115004071907
- https://support.veeva.com/hc/en-us/articles/8316112903195
- https://support.veeva.com/hc/en-us/articles/360041355594
- https://support.veeva.com/hc/en-us/articles/360000545054
- https://support.veeva.com/hc/en-us/articles/360002264294
- https://support.veeva.com/hc/en-us/articles/360015433733
- https://education.veeva.com/products/veeva-crm-for-business-administrators-on-demand
