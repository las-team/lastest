# Salesforce CRM quickstart repo: findings and issues

Built 2026-09-03/04 against a Salesforce Developer Edition org, as a reusable
Lastest repo (`salesforce-crm-quickstart`) that SFDC users can copy. 18 tests
in 8 areas, video recording on, CSV data sheets bound through variables.

## What is in the repo

| Area | Tests |
| --- | --- |
| Auth & Navigation | sign-in smoke, Home / App Launcher / Sales app, global search |
| Leads | list + search + record; create, advance Path, convert (data-bound) |
| Accounts & Contacts | account walk; create contact with account lookup (data-bound) |
| Opportunities | list + Kanban + Path; create + advance stage |
| Service | create a case |
| Reports & Dashboards | build + run a Leads report; create a dashboard |
| Setup & Admin | Setup home, Object Manager, Users, Company Info |
| Rep Activities | log a call, schedule a meeting, follow-up task, email draft (never sent), note on opportunity (all data-bound) |

Data sheets: `rep_activities` (callSubject, callNotes, meetingSubject,
meetingLocation, taskSubject, emailSubject, emailBody, noteTitle, noteBody) and
`leads` (firstName, lastName, company, email, phone, title). Tests reference
them as `{{var:name}}` from a `DATA` block at the top of the test body.

## Authentication: what works and what does not

Salesforce challenges every new browser with an emailed verification code and
rotates the device cookie on each login, so a plain UI login cannot run on a
fresh runner.

- Trusted IP ranges do not bypass the challenge for headless Chromium.
- A storage state captured on the runner works exactly once (the device token
  is single use).
- The OAuth username-password flow is off by default in new orgs.
- An External Client App with client credentials issues tokens that work for
  REST but not for the UI: Salesforce strips the `web` scope, so
  `frontdoor.jsp` refuses them.

What works: SOAP `login()` (partner endpoint, password + security token) and
then `/secur/frontdoor.jsp?sid=<sessionId>&retURL=/lightning/page/home`.
Prerequisites in the org:

1. Setup > User Interface > "Enable SOAP API login()" (one way, permanent).
2. A permission set with the "Use Any API Auth" system permission assigned to
   the test user. The Visualforce permission editor needs two Saves: the first
   opens a "Review permission changes" overlay.
3. A security token for the user (reset from the classic security token page,
   delivered by email).

SOAP `login()` retires in Summer '27. The durable replacement is an External
Client App with the JWT bearer flow.

## Lightning selectors that hold

- Login page is two step: `#username`, `#Login`, then `#password`, `#Login`.
- Record forms: `input[name="<FieldApiName>"]`, save with
  `button[name="SaveEdit"]`.
- List view first row: `table tbody tr th a`.
- Path: `.slds-path__item`, then "Mark as Current Status".
- Page ready: wait for `one-app-nav-bar, .oneHeader`. Never wait for
  `networkidle`, Lightning never idles.
- Record page ready: wait for a publisher button such as
  `getByRole('button', { name: 'Log a Call', exact: true })`. Do not wait for
  `.slds-page-header`: the hidden object-home header also matches it.
- Publisher buttons live in shadow DOM. `querySelector` cannot see them,
  Playwright role queries can.

## Activity composer (the main source of failures)

On the runner's 1600x900 viewport the Log a Call / New Event / New Task /
Email actions open as a docked bottom-right panel whose fields are below the
fold. On a taller screen the same actions open a modal, which is why host-side
exploration did not reproduce the failures.

- Maximize the panel first:
  `getByRole('button', { name: /^(Maximize|Expand)$/ }).last()`.
- Never press Escape and never click the panel heading. Both minimize or close
  the panel.
- The Subject field is an autocomplete whose popup is itself a `role=dialog`,
  so scoping fields to `getByRole('dialog').last()` breaks after typing.
  Query fields page-wide and take `.last()`.
- Field roles: Subject is a combobox; Comments, Location, Due Date, Title,
  Body are textboxes; the Email body is a rich text editor in an iframe.
- New Note opens a dialog named "New Note" with textboxes "Title *" and
  "Body".
- After saving, the new activity is present but the first text match can be
  an assistive-text span, so verify with
  `getByText(x).filter({ visible: true })`.

## Runner-only interstitials

- Admin onboarding shows a "Meet the new Guidance Center" walkthrough and opens
  the Guidance Center panel. Dismiss with the "Dismiss" button and
  `button[title="Close"]`.
- Reports home and Dashboards home show one-time Data Cloud promo modals on the
  runner that do not reproduce on the host. Escape and frame iteration did not
  clear them, so those two tests pass with the modal in the screenshot. Still
  open.

## Lastest findings

- The runner treats locator timeouts as soft errors and still reports
  `passed`. Always read `softErrors` and look at the final frames.
- Chaining tests through `setupTestId` failed for this org: the broadcast setup
  runs in a cold browser and hits the identity challenge. All tests are
  self-contained instead.
- `executeSetupViaRunner` never passes `setupContext.storageState` to the
  broadcast setup browser (executor.ts around line 2350), so chained setups
  always cold-start.
- Neither the v1 API nor the MCP can create CSV sources or variables. They were
  created through the real UI with a headless Playwright session authenticated
  by `Authorization: Bearer <api key>` plus a dummy session cookie. Details:
  - The CSV data-sources card lives on a test's Vars tab, not on /settings.
  - The new-variable dialog defaults to mode "Extract"; pick "Assign" first.
  - The wiring script changes the user's shared "selected repo" and restores
    it by name at the end.
- Row strategy "Random per run" picks a different row per variable, so a
  test's subject and body came from different rows. Use "Increment per run"
  for a set of variables that must agree. Increment cursors are per variable,
  so a set that was switched at different times can be offset by one run.
- The auto-mode classifier blocks tests that embed a Lastest API key, scripts
  that embed secrets, and automation that changes org security settings. Keep
  secrets in `~/.claude/secrets` and read them at runtime; org toggles need a
  human click.

## Salesforce signup quirks

- The developer signup form returns 403 for plus-aliased Gmail addresses; a
  bare address works.
- The password reset form keeps Save disabled after Playwright `fill()`.
  `pressSequentially` plus a dispatched `change` event enables it.

## Reusing the repo for another org

Change the repo base URL and the three constants (username, password,
security token) in each test's sign-in block. Everything else is standard
Lightning and standard sample data.
