/**
 * Salesforce CRM quickstart seed.
 *
 * The 18-test suite built against a Salesforce Developer Edition org
 * (`docs/salesforce-crm-quickstart.md`), productized as an onboarding template
 * so an SFDC user lands on a repo that already exercises Leads, Accounts,
 * Contacts, Opportunities, Cases, Reports, Dashboards, Setup and the rep
 * activity composers — rather than on an empty project.
 *
 * Every test is self-contained: it signs in through the SOAP `login()` call
 * and `/secur/frontdoor.jsp`, because Salesforce challenges each new browser
 * with an emailed verification code and rotates the device cookie on every
 * login, so neither a UI login nor a captured storage state survives on a
 * fresh runner. The three values that login needs — user name, password and
 * security token — come in through the injected `credentials` parameter as
 * `credentials.salesforce.*`, which is what a Salesforce connector named
 * `salesforce` (Settings → Integrations, "Browser login") provisions. Never in
 * the source, never hashed into a baseline, never in run history — the same
 * channel `pharma-seed.ts` uses, for the reasons `docs/credentials-plan.md` §1
 * gives.
 *
 * Seeded **quarantined**: the base URL is the org the user types in the next
 * onboarding step, and the `salesforce` credential does not exist until they
 * add it. Quarantined tests run but never block a build, so the first build
 * stays green until both are in place — then un-quarantining is one toggle.
 *
 * Tests that took their values from CSV data sheets in the original repo carry
 * inline defaults here, plus a comment naming the sample sheet under
 * `docs/samples/salesforce/` and the variable to bind. CSV sources and
 * variables live behind the data-sources plugin boundary and are created from
 * the test's Vars tab, not from a seed.
 *
 * Sibling of `pharma-seed.ts` and `sandbox-seeds.ts`: same area→test→version
 * insert, same "no-op if the repo already has tests" idempotence.
 */
import { db } from "@/lib/db";
import { tests, testVersions, functionalAreas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuid } from "crypto";
import { upsertPlaywrightSettings } from "@/lib/db/queries/settings";

/** Onboarding sandbox template id that routes to this seed. */
export const SALESFORCE_QUICKSTART_TEMPLATE_ID = "salesforce-crm";

/** Path of the two sample data sheets the data-bound tests describe. */
export const SALESFORCE_SAMPLE_DATA_DIR = "docs/samples/salesforce";

/**
 * Playwright profile the suite was green under. Lightning needs the taller
 * navigation budget, and the 1600x900 viewport is load-bearing: below it the
 * activity composers open as a docked panel whose fields sit below the fold,
 * which is what the `Maximize` click in the rep tests handles. Console and
 * network stay on `log`: Lightning emits third-party console noise and a
 * handful of 4xx telemetry calls on every page, none of which is a regression.
 */
export const SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE = {
  viewportWidth: 1600,
  viewportHeight: 900,
  navigationTimeout: 60000,
  consoleMode: "log",
  networkMode: "log",
  enableVideoRecording: true,
  freezeAnimations: false,
} as const;

/* ───────────────────────────── shared blocks ───────────────────────────── */

const SHOT_HELPER = String.raw`  const shot = (n, s) => screenshotPath.replace('.png', '-' + n + '-' + s + '.png');`;

/**
 * The sign-in block every test opens with. `String.raw` because the bodies
 * carry regex escapes (`\/lightning\/r\/`) that a cooked template would eat.
 */
const SIGN_IN = String.raw`  // ── Sign in via the SOAP API + frontdoor.jsp (no device activation, no cookies) ──
  // Salesforce challenges every new browser with an emailed verification code and rotates
  // the device token on each login, so a UI login cannot be automated on a fresh runner.
  // Instead: SOAP login() with password + security token (org: Setup > User Interface >
  // "Enable SOAP API login()"; user: the "Use Any API Auth" permission), then open the
  // session with /secur/frontdoor.jsp. The three values are read from the repo's
  // Credentials store at run time — never written into this source, never hashed into
  // the baseline, never recorded in run history.
  const sf = credentials?.salesforce;
  if (!sf?.username || !sf?.password) {
    throw new Error('This test needs a credential named "salesforce" with username, password and securityToken fields. Add a Salesforce connector named "salesforce" (Browser login) under Settings → Integrations (or a credential under Setup → Credentials), then reference it as credentials.salesforce.username.');
  }
  const xml = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  stepLogger.log('Step 0: sign in via the SOAP API and open the session with frontdoor.jsp');
  const soapBody = '<?xml version="1.0" encoding="utf-8" ?><env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><n1:login xmlns:n1="urn:partner.soap.sforce.com"><n1:username>' + xml(sf.username) + '</n1:username><n1:password>' + xml(sf.password + (sf.securityToken || '')) + '</n1:password></n1:login></env:Body></env:Envelope>';
  const loginRes = await page.request.post(baseUrl + '/services/Soap/u/60.0', { headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': 'login' }, data: soapBody });
  const loginXml = await loginRes.text();
  const sidMatch = loginXml.match(/<sessionId>([^<]+)/);
  if (!sidMatch) {
    const fault = loginXml.match(/<faultstring>([^<]*)/);
    throw new Error('Salesforce API login failed: ' + (fault ? fault[1] : loginXml.slice(0, 200)));
  }
  await page.goto(baseUrl + '/secur/frontdoor.jsp?sid=' + encodeURIComponent(sidMatch[1]) + '&retURL=' + encodeURIComponent('/lightning/page/home'), { waitUntil: 'domcontentloaded' });
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(2500);
  // Admin onboarding can pop a "Meet the new Guidance Center" walkthrough and open the
  // Guidance Center side panel on the first page; both intercept clicks, so dismiss them.
  await page.getByRole('button', { name: /^Dismiss$/ }).first().click({ timeout: 3000 }).catch(function () {});
  await page.locator('button[title="Close"], button[aria-label="Close"]').first().click({ timeout: 2000 }).catch(function () {});
  await page.waitForTimeout(500);`;

/** Reports and Dashboards home carry a one-time "Data Cloud" promo modal. */
const DISMISS_DATA_CLOUD_PROMO = String.raw`  // One-time "Data Cloud" promo modals can cover Reports/Dashboards home (rendered in an iframe):
  // tick "Don't show this again" wherever it lives, close it, and press Escape as a fallback.
  for (const fr of page.frames()) {
    await fr.getByText(/show this again/i).first().click({ timeout: 1500 }).catch(function () {});
    await fr.locator('button[title="Close"], button[aria-label="Close"], .slds-modal__close').first().click({ timeout: 1500 }).catch(function () {});
  }
  await page.keyboard.press('Escape').catch(function () {});
  await page.waitForTimeout(1000);`;

/** Open the first record of a list view and wait for a publisher button. */
function openFirstRecord(
  object: "Account" | "Contact" | "Opportunity",
  listFilter: string,
  publisherButton: string,
): string {
  return String.raw`  stepLogger.log('Step 1: open the first ${object.toLowerCase()} (${listFilter} list)');
  await page.goto(baseUrl + '/lightning/o/${object}/list?filterName=${listFilter}', { waitUntil: 'domcontentloaded' });
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  await firstLink.waitFor({ state: 'visible', timeout: 60000 });
  stepLogger.log('${object}: ' + (await firstLink.innerText()).trim());
  await firstLink.click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/${object}/'); }, { timeout: 30000 });
  // The Activity publisher renders inside shadow DOM; Playwright's role queries pierce it.
  await page.getByRole('button', { name: '${publisherButton}', exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, '${object.toLowerCase()}-record') });`;
}

/** Open a quick-action composer and maximize its docked panel. */
function openComposer(
  publisherButton: string,
  subjectRole: "combobox" | "textbox",
  slug: string,
  settleMs = 1200,
): string {
  return String.raw`  stepLogger.log('Step 2: open the ${publisherButton} composer (quick-action modal)');
  await page.getByRole('button', { name: '${publisherButton}', exact: true }).first().click();
  // On a 1600x900 viewport the composer opens as a DOCKED bottom-right panel whose fields sit
  // below the fold; maximize it into a modal first. Fields are then queried page-wide (.last())
  // because the Subject autocomplete popup is itself a role=dialog.
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^(Maximize|Expand)$/ }).last().click({ timeout: 5000 }).catch(function () {});
  await page.waitForTimeout(1000);
  await page.getByRole('${subjectRole}', { name: 'Subject' }).last().waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(${settleMs});
  await page.screenshot({ path: shot(2, '${slug}') });`;
}

/* ───────────────────────────── data blocks ─────────────────────────────── */

interface DataBinding {
  /** JS constant name inside the test body. */
  constName: string;
  /** Variable name to create on the Vars tab. */
  varName: string;
  /** Column of the sample sheet. */
  column: string;
  /** Inline default used until the variable is bound. */
  value: string;
}

/**
 * Render the DATA block: inline defaults today, one comment on how to bind
 * the same constants to a data sheet. The `{{var:…}}` token shape is spelled
 * out because that is literally what the user types in place of the default.
 */
function dataBlock(
  sheet: "leads" | "rep_activities",
  b: DataBinding[],
): string {
  const vars = b.map((x) => x.varName).join(", ");
  const lines = [
    `  // DATA: inline defaults. To drive this test from a data sheet, upload`,
    `  // ${SALESFORCE_SAMPLE_DATA_DIR}/${sheet}.csv on the test's Vars tab, add assign-mode`,
    `  // variables (${vars}) bound to its columns with row strategy "Increment per run",`,
    `  // and replace each default below with that variable's token from the Vars tab.`,
    ...b.map(
      (x) =>
        `  const ${x.constName} = '${x.value.replace(/'/g, "\\'")}'; // column ${x.column}`,
    ),
  ];
  return lines.join("\n");
}

/* ───────────────────────────── test bodies ─────────────────────────────── */

interface QuickstartTestSpec {
  name: string;
  area: string;
  /** Comment line under the function header. */
  title: string;
  /** Constants that precede the sign-in block (DATA, STAMP, dates). */
  prelude?: string;
  /** Runs before sign-in — the smoke test screenshots the login page first. */
  beforeSignIn?: string;
  /** The steps after sign-in. */
  steps: string;
}

const STAMP = String.raw`  const STAMP = Date.now().toString(36);`;

const SPECS: readonly QuickstartTestSpec[] = [
  // ── Auth & Navigation ──────────────────────────────────────────────────
  {
    name: "Salesforce — sign-in smoke test",
    area: "Auth & Navigation",
    title: "sign-in smoke test",
    beforeSignIn: String.raw`  stepLogger.log('Step 1: open the org login page');
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot(1, 'login-form') });`,
    steps: String.raw`  stepLogger.log('Step 3: dismiss onboarding prompts, capture Home');
  await page.locator('button[title="Close"], .slds-modal__close, button:has-text("Got It"), button:has-text("Skip")').first().click({ timeout: 2000 }).catch(function () {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot(2, 'lightning-home') });
  if (!page.url().includes('/lightning/')) {
    throw new Error('Expected Lightning Experience after sign-in, got ' + page.url());
  }
  stepLogger.log('Step 4: App Launcher is reachable');
  await page.getByRole('button', { name: 'App Launcher' }).first().click();
  await page.locator('input[placeholder*="Search apps"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Signed in as ' + sf.username + ' at ' + page.url());`,
  },
  {
    name: "Home page, App Launcher & Sales app",
    area: "Auth & Navigation",
    title: "Home page + App Launcher + Sales app",
    steps: String.raw`  stepLogger.log('Step 1: Home page');
  await page.goto(baseUrl + '/lightning/page/home', { waitUntil: 'domcontentloaded' });
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.locator('button[title="Close"], .slds-modal__close').first().click({ timeout: 1500 }).catch(function () {});
  await page.screenshot({ path: shot(1, 'home') });

  stepLogger.log('Step 2: open the App Launcher');
  await page.getByRole('button', { name: 'App Launcher' }).first().click();
  await page.locator('input[placeholder*="Search apps"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot(2, 'app-launcher') });

  stepLogger.log('Step 3: search for the Sales app');
  await page.locator('input[placeholder*="Search apps"]').first().pressSequentially('Sales', { delay: 60 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(3, 'app-launcher-search') });

  stepLogger.log('Step 4: open the Sales app');
  const salesTile = page.locator('one-app-launcher-menu-item a, one-app-launcher-app-tile a').filter({ hasText: /^Sales$/ }).first();
  const hasSales = await salesTile.count();
  if (hasSales) {
    await salesTile.click();
  } else {
    await page.goto(baseUrl + '/lightning/app/standard__LightningSales', { waitUntil: 'domcontentloaded' });
  }
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.locator('button[title="Close"], .slds-modal__close').first().click({ timeout: 1500 }).catch(function () {});
  await page.screenshot({ path: shot(4, 'sales-app-home') });

  stepLogger.log('Step 5: read the Sales app navigation tabs');
  const tabs = await page.locator('one-app-nav-bar-item-root a, nav[aria-label="Global"] a').evaluateAll(function (as) {
    return as.map(function (a) { return (a.textContent || '').trim(); }).filter(Boolean).slice(0, 15);
  }).catch(function () { return []; });
  stepLogger.log('Nav tabs: ' + tabs.join(', '));
  await page.screenshot({ path: screenshotPath });`,
  },
  {
    name: "Global search across objects",
    area: "Auth & Navigation",
    title: "Global search across objects",
    steps: String.raw`  stepLogger.log('Step 1: start from the Accounts list and read a real account name');
  await page.goto(baseUrl + '/lightning/o/Account/list?filterName=AllAccounts', { waitUntil: 'domcontentloaded' });
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  await firstLink.waitFor({ state: 'visible', timeout: 60000 });
  const term = (await firstLink.innerText()).trim().split(' ')[0];
  stepLogger.log('Search term: ' + term);

  stepLogger.log('Step 2: open the global search box');
  await page.getByRole('button', { name: /^Search/ }).first().click();
  const box = page.locator('input[placeholder*="Search"]').first();
  await box.waitFor({ state: 'visible', timeout: 15000 });
  await box.pressSequentially(term, { delay: 80 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot(2, 'search-suggestions') });

  stepLogger.log('Step 3: run the search');
  await page.keyboard.press('Enter');
  await page.waitForURL(function (u) { return u.toString().includes('search'); }, { timeout: 30000 }).catch(function () {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: shot(3, 'search-results') });

  stepLogger.log('Step 4: open the first result');
  const result = page.locator('a[href*="/lightning/r/"]').first();
  if (await result.count()) {
    await result.click();
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: screenshotPath });`,
  },

  // ── Leads ──────────────────────────────────────────────────────────────
  {
    name: "Leads — list view, list search, record page",
    area: "Leads",
    title: "Leads: list view, list search, record page",
    steps: String.raw`  stepLogger.log('Step 1: All Open Leads list view');
  await page.goto(baseUrl + '/lightning/o/Lead/list?filterName=AllOpenLeads', { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr, .slds-page-header').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'leads-list') });

  stepLogger.log('Step 2: read the first lead and search the list for it');
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  await firstLink.waitFor({ state: 'visible', timeout: 30000 });
  const leadName = (await firstLink.innerText()).trim();
  stepLogger.log('First lead: ' + leadName);
  const search = page.getByPlaceholder('Search this list...').first();
  await search.click();
  await search.pressSequentially(leadName.split(' ')[0], { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot(2, 'leads-list-search') });

  stepLogger.log('Step 3: switch to the Recently Viewed list view via the list-view picker');
  await page.getByRole('button', { name: /Select a List View/i }).first().click().catch(function () {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot(3, 'list-view-picker') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  stepLogger.log('Step 4: open the lead record');
  await page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first().click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Lead/'); }, { timeout: 30000 });
  await page.locator('.slds-page-header, records-lwc-highlights-panel').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(4, 'lead-record') });

  stepLogger.log('Step 5: Details tab');
  await page.getByRole('tab', { name: 'Details' }).first().click().catch(function () {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: screenshotPath });`,
  },
  {
    name: "Leads — create, advance Path, convert",
    area: "Leads",
    title: "Leads: create a lead, advance the Path, convert",
    prelude: [
      dataBlock("leads", [
        {
          constName: "LEAD_FIRST",
          varName: "leadFirstName",
          column: "firstName",
          value: "Maria",
        },
        {
          constName: "LEAD_LAST",
          varName: "leadLastName",
          column: "lastName",
          value: "Lindqvist",
        },
        {
          constName: "LEAD_COMPANY",
          varName: "leadCompany",
          column: "company",
          value: "Nordic Freight AB",
        },
        {
          constName: "LEAD_EMAIL",
          varName: "leadEmail",
          column: "email",
          value: "maria.lindqvist@example.com",
        },
        {
          constName: "LEAD_PHONE",
          varName: "leadPhone",
          column: "phone",
          value: "+46 8 555 0101",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: String.raw`  stepLogger.log('Step 1: open the New Lead form');
  await page.goto(baseUrl + '/lightning/o/Lead/new', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="lastName"], input[name="Company"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(1, 'new-lead-form') });

  stepLogger.log('Step 2: fill the required fields');
  await page.locator('input[name="firstName"]').first().fill(LEAD_FIRST);
  await page.locator('input[name="lastName"]').first().fill(LEAD_LAST + ' ' + STAMP);
  await page.locator('input[name="Company"]').first().fill(LEAD_COMPANY);
  await page.locator('input[name="Email"]').first().fill(LEAD_EMAIL.replace('@', '+' + STAMP + '@')).catch(function () {});
  await page.locator('input[name="Phone"]').first().fill(LEAD_PHONE).catch(function () {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot(2, 'new-lead-filled') });

  stepLogger.log('Step 3: save');
  await page.locator('button[name="SaveEdit"]').first().click();
  await page.waitForURL(function (u) { return /\/lightning\/r\/(Lead\/)?00Q/.test(u.toString()); }, { timeout: 30000 });
  await page.locator('.slds-page-header, records-lwc-highlights-panel').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(3, 'lead-created') });

  stepLogger.log('Step 4: advance the Path to Working');
  const pathStep = page.locator('.slds-path__item').filter({ hasText: /Working/i }).first();
  if (await pathStep.count()) {
    await pathStep.click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Mark as Current Status|Mark Status as Complete/i }).first().click().catch(function () {});
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: shot(4, 'lead-path-working') });

  stepLogger.log('Step 5: convert the lead');
  const convertBtn = page.getByRole('button', { name: /^Convert$/ }).first();
  if (!(await convertBtn.count())) {
    await page.getByRole('button', { name: /Show more actions/i }).first().click().catch(function () {});
    await page.waitForTimeout(800);
  }
  await page.locator('button:has-text("Convert"), a[title="Convert"], [role="menuitem"]:has-text("Convert")').first().click({ timeout: 10000 });
  await page.locator('.slds-modal__container, runtime_sales_lead_convert-modal').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(5, 'convert-modal') });
  await page.locator('.slds-modal__footer button:has-text("Convert")').first().click();
  await page.locator('.slds-modal__container').filter({ hasText: /converted/i }).first().waitFor({ state: 'visible', timeout: 45000 }).catch(function () {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Lead "' + LEAD_FIRST + ' ' + LEAD_LAST + ' ' + STAMP + '" created and converted');`,
  },

  // ── Accounts & Contacts ────────────────────────────────────────────────
  {
    name: "Accounts — list, record, Related tab, Log a Call",
    area: "Accounts & Contacts",
    title: "Accounts: list, record, Related tab, activity timeline",
    steps: String.raw`  stepLogger.log('Step 1: All Accounts list view');
  await page.goto(baseUrl + '/lightning/o/Account/list?filterName=AllAccounts', { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr, .slds-page-header').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'accounts-list') });

  stepLogger.log('Step 2: open the first account');
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  await firstLink.waitFor({ state: 'visible', timeout: 30000 });
  stepLogger.log('Account: ' + (await firstLink.innerText()).trim());
  await firstLink.click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Account/'); }, { timeout: 30000 });
  await page.locator('.slds-page-header, records-lwc-highlights-panel').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(2, 'account-record') });

  stepLogger.log('Step 3: Related tab (contacts, opportunities, cases)');
  await page.getByRole('tab', { name: 'Related' }).first().click().catch(function () {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(3, 'account-related') });

  stepLogger.log('Step 4: Details tab');
  await page.getByRole('tab', { name: 'Details' }).first().click().catch(function () {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot(4, 'account-details') });

  stepLogger.log('Step 5: log a call from the activity composer');
  await page.getByRole('tab', { name: /Log a Call/i }).first().click().catch(function () {});
  await page.waitForTimeout(1500);
  const subject = page.locator('input[name="Subject"], lightning-input input').first();
  if (await subject.count()) {
    await subject.fill('Lastest QA call ' + Date.now().toString(36)).catch(function () {});
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: screenshotPath });`,
  },
  {
    name: "Contacts — list + create a contact on an account",
    area: "Accounts & Contacts",
    title: "Contacts: list + create a contact linked to an account",
    prelude: [
      dataBlock("leads", [
        {
          constName: "CONTACT_FIRST",
          varName: "contactFirstName",
          column: "firstName",
          value: "Kenji",
        },
        {
          constName: "CONTACT_LAST",
          varName: "contactLastName",
          column: "lastName",
          value: "Watanabe",
        },
        {
          constName: "CONTACT_EMAIL",
          varName: "contactEmail",
          column: "email",
          value: "kenji.watanabe@example.com",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: String.raw`  stepLogger.log('Step 1: All Contacts list view');
  await page.goto(baseUrl + '/lightning/o/Contact/list?filterName=AllContacts', { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr, .slds-page-header').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'contacts-list') });

  stepLogger.log('Step 2: click New');
  await page.getByRole('button', { name: /^New$/ }).first().click();
  await page.locator('input[name="lastName"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(2, 'new-contact-form') });

  stepLogger.log('Step 3: fill name, email and pick an account from the lookup');
  await page.locator('input[name="firstName"]').first().fill(CONTACT_FIRST);
  await page.locator('input[name="lastName"]').first().fill(CONTACT_LAST + ' ' + STAMP);
  await page.locator('input[name="Email"]').first().fill(CONTACT_EMAIL.replace('@', '+' + STAMP + '@')).catch(function () {});
  const acct = page.locator('input[placeholder*="Search Accounts"], lightning-grouped-combobox input').first();
  if (await acct.count()) {
    await acct.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot(3, 'account-lookup-open') });
    await page.locator('lightning-base-combobox-item[role="option"], [role="option"]').filter({ hasNotText: /New Account|Show All/i }).first().click({ timeout: 8000 }).catch(function () {});
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: shot(4, 'new-contact-filled') });

  stepLogger.log('Step 4: save');
  await page.locator('button[name="SaveEdit"]').first().click();
  await page.waitForURL(function (u) { return /\/lightning\/r\/(Contact\/)?003/.test(u.toString()); }, { timeout: 30000 });
  await page.getByRole('button', { name: 'Log a Call', exact: true }).first().waitFor({ state: 'visible', timeout: 30000 }).catch(function () {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Contact "' + CONTACT_FIRST + ' ' + CONTACT_LAST + ' ' + STAMP + '" created');`,
  },

  // ── Opportunities ──────────────────────────────────────────────────────
  {
    name: "Opportunities — list, Kanban board, record + Path",
    area: "Opportunities",
    title: "Opportunities: list, Kanban board, record + Path",
    steps: String.raw`  stepLogger.log('Step 1: All Opportunities list view');
  await page.goto(baseUrl + '/lightning/o/Opportunity/list?filterName=AllOpportunities', { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr, .slds-page-header').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'opps-list') });

  stepLogger.log('Step 2: switch the list display to Kanban');
  await page.getByRole('button', { name: /Select list display/i }).first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot(2, 'display-menu') });
  await page.getByRole('menuitem', { name: /Kanban/i }).first().click();
  await page.locator('.slds-kanban, [class*="kanban"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(function () {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(3, 'opps-kanban') });

  stepLogger.log('Step 3: switch back to Table');
  await page.getByRole('button', { name: /Select list display/i }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('menuitem', { name: /Table/i }).first().click();
  await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);

  stepLogger.log('Step 4: open the first opportunity');
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  stepLogger.log('Opportunity: ' + (await firstLink.innerText()).trim());
  await firstLink.click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Opportunity/'); }, { timeout: 30000 });
  await page.locator('.slds-path, .slds-page-header').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(4, 'opp-record-path') });

  stepLogger.log('Step 5: Related tab (products, contact roles)');
  await page.getByRole('tab', { name: 'Related' }).first().click().catch(function () {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: screenshotPath });`,
  },
  {
    name: "Opportunities — create + advance the stage",
    area: "Opportunities",
    title: "Opportunities: create + advance the sales stage",
    prelude: String.raw`  const STAMP = Date.now().toString(36);
  const close = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const closeDate = (close.getMonth() + 1) + '/' + close.getDate() + '/' + close.getFullYear();`,
    steps: String.raw`  stepLogger.log('Step 1: open the New Opportunity form');
  await page.goto(baseUrl + '/lightning/o/Opportunity/new', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="Name"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(1, 'new-opp-form') });

  stepLogger.log('Step 2: fill name, amount, close date, stage');
  await page.locator('input[name="Name"]').first().fill('Lastest Deal ' + STAMP);
  await page.locator('input[name="Amount"]').first().fill('12500').catch(function () {});
  const dateInput = page.locator('input[name="CloseDate"]').first();
  await dateInput.click();
  await dateInput.fill(closeDate);
  // Do NOT press Escape here: it closes the whole New Opportunity modal. Click the Name field to close the date picker.
  await page.locator('input[name="Name"]').first().click();
  await page.waitForTimeout(300);
  const stage = page.getByRole('combobox', { name: /Stage/i }).first();
  await stage.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(2, 'stage-picklist') });
  await page.getByRole('option', { name: /Prospecting|Qualification/i }).first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(3, 'new-opp-filled') });

  stepLogger.log('Step 3: save');
  await page.locator('button[name="SaveEdit"]').first().click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Opportunity/'); }, { timeout: 30000 });
  await page.locator('.slds-path, .slds-page-header').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(4, 'opp-created') });

  stepLogger.log('Step 4: advance the stage on the Path');
  const next = page.locator('.slds-path__item').filter({ hasText: /Needs Analysis|Value Proposition|Qualification/i }).first();
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Mark as Current Stage|Mark Stage as Complete/i }).first().click().catch(function () {});
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Opportunity "Lastest Deal ' + STAMP + '" created and advanced');`,
  },

  // ── Service (Cases) ────────────────────────────────────────────────────
  {
    name: "Cases — list + create a case",
    area: "Service (Cases)",
    title: "Service: Cases list + create a case",
    prelude: STAMP,
    steps: String.raw`  stepLogger.log('Step 1: All Open Cases list view');
  await page.goto(baseUrl + '/lightning/o/Case/list?filterName=AllOpenCases', { waitUntil: 'domcontentloaded' });
  await page.locator('table tbody tr, .slds-page-header').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'cases-list') });

  stepLogger.log('Step 2: open the New Case form');
  await page.goto(baseUrl + '/lightning/o/Case/new', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="Subject"]').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(2, 'new-case-form') });

  stepLogger.log('Step 3: fill subject, origin, priority, description');
  await page.locator('input[name="Subject"]').first().fill('Lastest QA case ' + STAMP);
  const origin = page.getByRole('combobox', { name: /Case Origin/i }).first();
  if (await origin.count()) {
    await origin.click();
    await page.waitForTimeout(500);
    await page.getByRole('option', { name: /Web|Email|Phone/i }).first().click();
  }
  const priority = page.getByRole('combobox', { name: /Priority/i }).first();
  if (await priority.count()) {
    await priority.click();
    await page.waitForTimeout(500);
    await page.getByRole('option', { name: /High/i }).first().click().catch(function () { return page.keyboard.press('Escape'); });
  }
  await page.locator('textarea[name="Description"]').first().fill('Created by the Lastest Salesforce quickstart suite (' + STAMP + ').').catch(function () {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot(3, 'new-case-filled') });

  stepLogger.log('Step 4: save and view the case');
  await page.locator('button[name="SaveEdit"]').first().click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Case/'); }, { timeout: 30000 });
  await page.locator('.slds-page-header, records-lwc-highlights-panel').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: shot(4, 'case-created') });

  stepLogger.log('Step 5: Feed / activity tab');
  await page.getByRole('tab', { name: /Feed|Chatter/i }).first().click().catch(function () {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Case "Lastest QA case ' + STAMP + '" created');`,
  },

  // ── Reports & Dashboards ───────────────────────────────────────────────
  {
    name: "Reports — home, build a Leads report, run it",
    area: "Reports & Dashboards",
    title: "Reports: home, build a Leads report, run it",
    steps: [
      String.raw`  stepLogger.log('Step 1: Reports home');
  await page.goto(baseUrl + '/lightning/o/Report/home?queryScope=mru', { waitUntil: 'domcontentloaded' });
  await page.locator('.slds-page-header, one-app-nav-bar').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);`,
      DISMISS_DATA_CLOUD_PROMO,
      String.raw`  await page.screenshot({ path: shot(1, 'reports-home') });

  stepLogger.log('Step 2: All Reports folder view');
  await page.goto(baseUrl + '/lightning/o/Report/home?queryScope=everything', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: shot(2, 'all-reports') });

  stepLogger.log('Step 3: New Report → pick the Leads report type');
  await page.getByRole('button', { name: /New Report/i }).first().click();
  const typeSearch = page.locator('input[placeholder*="Search Report Types"], input[placeholder*="Search"]').first();
  await typeSearch.waitFor({ state: 'visible', timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: shot(3, 'report-type-picker') });
  await typeSearch.pressSequentially('Leads', { delay: 60 });
  await page.waitForTimeout(2500);
  await page.locator('[role="option"], [role="row"], li, div').filter({ hasText: /^Leads$/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(4, 'report-type-leads') });
  await page.getByRole('button', { name: /Start Report|Continue/i }).first().click();

  stepLogger.log('Step 4: report builder loads');
  await page.locator('button:has-text("Run"), .report-builder, [data-name="run"]').first().waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: shot(5, 'report-builder') });

  stepLogger.log('Step 5: run the report');
  await page.getByRole('button', { name: /^Run$/ }).first().click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: screenshotPath });`,
    ].join("\n"),
  },
  {
    name: "Dashboards — home + create a dashboard",
    area: "Reports & Dashboards",
    title: "Dashboards: home + New Dashboard dialog",
    steps: [
      String.raw`  stepLogger.log('Step 1: Dashboards home');
  await page.goto(baseUrl + '/lightning/o/Dashboard/home?queryScope=everything', { waitUntil: 'domcontentloaded' });
  await page.locator('.slds-page-header, one-app-nav-bar').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);`,
      DISMISS_DATA_CLOUD_PROMO,
      String.raw`  await page.screenshot({ path: shot(1, 'dashboards-home') });

  stepLogger.log('Step 2: open an existing dashboard if the org has one');
  const firstDash = page.locator('table tbody tr a[href*="/lightning/r/Dashboard/"]').first();
  if (await firstDash.count()) {
    stepLogger.log('Opening dashboard: ' + (await firstDash.innerText()).trim());
    await firstDash.click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: shot(2, 'dashboard-view') });
    await page.goto(baseUrl + '/lightning/o/Dashboard/home?queryScope=everything', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
  } else {
    stepLogger.warn('No dashboards in this org yet');
  }

  stepLogger.log('Step 3: New Dashboard dialog');
  await page.getByRole('button', { name: /New Dashboard/i }).first().click();
  await page.locator('input[name="name"], input[placeholder*="Name"], .slds-modal__container input').first().waitFor({ state: 'visible', timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.locator('input[name="name"], input[placeholder*="Name"], .slds-modal__container input').first().fill('Lastest QA dashboard');
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(3, 'new-dashboard-dialog') });

  stepLogger.log('Step 4: create it and land in the dashboard builder');
  await page.getByRole('button', { name: /^Create$/ }).first().click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: screenshotPath });`,
    ].join("\n"),
  },

  // ── Setup & Admin ──────────────────────────────────────────────────────
  {
    name: "Setup — home, Object Manager, Lead fields, Users, Company Info",
    area: "Setup & Admin",
    title: "Setup: home, Object Manager, Users, Company Info",
    steps: String.raw`  stepLogger.log('Step 1: Setup home');
  await page.goto(baseUrl + '/lightning/setup/SetupOneHome/home', { waitUntil: 'domcontentloaded' });
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: shot(1, 'setup-home') });

  stepLogger.log('Step 2: Object Manager, filtered to Lead');
  await page.goto(baseUrl + '/lightning/setup/ObjectManager/home', { waitUntil: 'domcontentloaded' });
  const q = page.locator('input[placeholder*="Quick Find"]').last();
  await q.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(2, 'object-manager') });
  await q.pressSequentially('Lead', { delay: 60 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: shot(3, 'object-manager-lead') });

  stepLogger.log('Step 3: Lead object → Fields & Relationships');
  await page.goto(baseUrl + '/lightning/setup/ObjectManager/Lead/FieldsAndRelationships/view', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: shot(4, 'lead-fields') });

  stepLogger.log('Step 4: Users');
  await page.goto(baseUrl + '/lightning/setup/ManageUsers/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: shot(5, 'users') });

  stepLogger.log('Step 5: Company Information');
  await page.goto(baseUrl + '/lightning/setup/CompanyProfileInfo/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: screenshotPath });`,
  },

  // ── Rep Activities ─────────────────────────────────────────────────────
  {
    name: "Rep — log a call on an account",
    area: "Rep Activities",
    title: "Rep activity: log a call on an account",
    prelude: [
      dataBlock("rep_activities", [
        {
          constName: "CALL_SUBJECT",
          varName: "callSubject",
          column: "callSubject",
          value: "Discovery call",
        },
        {
          constName: "CALL_NOTES",
          varName: "callNotes",
          column: "callNotes",
          value:
            "Talked through requirements, budget confirmed, next step is a demo.",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: [
      openFirstRecord("Account", "AllAccounts", "Log a Call"),
      "",
      openComposer("Log a Call", "combobox", "log-a-call-form"),
      "",
      String.raw`  stepLogger.log('Step 3: fill subject and comments');
  const subject = page.getByRole('combobox', { name: 'Subject' }).last();
  await subject.click();
  await subject.fill(CALL_SUBJECT + ' ' + STAMP);
  await page.getByRole('textbox', { name: 'Comments' }).last().click();
  await page.getByRole('textbox', { name: 'Comments' }).last().fill(CALL_NOTES);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(3, 'log-a-call-filled') });

  stepLogger.log('Step 4: save and verify the call shows in the activity timeline');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await page.waitForTimeout(4000);
  const logged = page.getByText(CALL_SUBJECT + ' ' + STAMP).filter({ visible: true }).first();
  await logged.waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Call "' + CALL_SUBJECT + ' ' + STAMP + '" logged on the account timeline');`,
    ].join("\n"),
  },
  {
    name: "Rep — schedule a meeting (New Event) + Calendar",
    area: "Rep Activities",
    title: "Rep activity: schedule a meeting (New Event) + Calendar",
    prelude: [
      dataBlock("rep_activities", [
        {
          constName: "MEETING_SUBJECT",
          varName: "meetingSubject",
          column: "meetingSubject",
          value: "Product demo",
        },
        {
          constName: "MEETING_LOCATION",
          varName: "meetingLocation",
          column: "meetingLocation",
          value: "Zoom",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: [
      openFirstRecord("Account", "AllAccounts", "New Event"),
      "",
      openComposer("New Event", "combobox", "new-event-form"),
      "",
      String.raw`  stepLogger.log('Step 3: fill subject and location (start/end keep the defaults)');
  const subject = page.getByRole('combobox', { name: 'Subject' }).last();
  await subject.click();
  await subject.fill(MEETING_SUBJECT + ' ' + STAMP);
  await page.getByRole('textbox', { name: 'Location' }).last().click();
  await page.getByRole('textbox', { name: 'Location' }).last().fill(MEETING_LOCATION);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(3, 'new-event-filled') });

  stepLogger.log('Step 4: save and verify the meeting appears under Upcoming');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await page.waitForTimeout(4000);
  await page.getByText(MEETING_SUBJECT + ' ' + STAMP).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: shot(4, 'event-in-timeline') });

  stepLogger.log('Step 5: open the Calendar');
  await page.goto(baseUrl + '/lightning/o/Event/home', { waitUntil: 'domcontentloaded' });
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Meeting "' + MEETING_SUBJECT + ' ' + STAMP + '" scheduled');`,
    ].join("\n"),
  },
  {
    name: "Rep — create a follow-up task + Tasks list",
    area: "Rep Activities",
    title: "Rep activity: create a follow-up task + Tasks list",
    prelude: [
      dataBlock("rep_activities", [
        {
          constName: "TASK_SUBJECT",
          varName: "taskSubject",
          column: "taskSubject",
          value: "Send proposal",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: [
      openFirstRecord("Account", "AllAccounts", "New Task"),
      "",
      openComposer("New Task", "combobox", "new-task-form"),
      "",
      String.raw`  stepLogger.log('Step 3: fill the subject and a due date three days out');
  const subject = page.getByRole('combobox', { name: 'Subject' }).last();
  await subject.click();
  await subject.fill(TASK_SUBJECT + ' ' + STAMP);
  const due = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const dueDate = (due.getMonth() + 1) + '/' + due.getDate() + '/' + due.getFullYear();
  const dueInput = page.getByRole('textbox', { name: 'Due Date' }).last();
  await dueInput.click();
  await dueInput.fill(dueDate);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot(3, 'new-task-filled') });

  stepLogger.log('Step 4: save and verify the task under Upcoming & Overdue');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await page.waitForTimeout(4000);
  await page.getByText(TASK_SUBJECT + ' ' + STAMP).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: shot(4, 'task-in-timeline') });

  stepLogger.log('Step 5: Tasks list view');
  await page.goto(baseUrl + '/lightning/o/Task/list?filterName=Recent', { waitUntil: 'domcontentloaded' });
  await page.locator('one-app-nav-bar, .oneHeader').first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Task "' + TASK_SUBJECT + ' ' + STAMP + '" created');`,
    ].join("\n"),
  },
  {
    name: "Rep — draft an email from a contact (never sent)",
    area: "Rep Activities",
    title: "Rep activity: draft an email from a contact (never sent)",
    prelude: [
      dataBlock("rep_activities", [
        {
          constName: "EMAIL_SUBJECT",
          varName: "emailSubject",
          column: "emailSubject",
          value: "Following up on our call",
        },
        {
          constName: "EMAIL_BODY",
          varName: "emailBody",
          column: "emailBody",
          value:
            "Hi, thanks for your time today. Attached is a summary of what we discussed.",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: [
      openFirstRecord("Contact", "AllContacts", "Email"),
      "",
      openComposer("Email", "textbox", "email-composer", 2500),
      "",
      String.raw`  stepLogger.log('Step 3: write the subject and body (the draft is never sent)');
  await page.getByRole('textbox', { name: 'Subject' }).last().fill(EMAIL_SUBJECT + ' ' + STAMP);
  // The body is a rich-text editor inside an iframe.
  const body = page.frameLocator('[role="dialog"] iframe').last().locator('body');
  await body.click({ timeout: 15000 });
  await page.keyboard.type(EMAIL_BODY, { delay: 8 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Email draft "' + EMAIL_SUBJECT + ' ' + STAMP + '" composed; not sent');`,
    ].join("\n"),
  },
  {
    name: "Rep — add a note to an opportunity",
    area: "Rep Activities",
    title: "Rep activity: add a note to an opportunity",
    prelude: [
      dataBlock("rep_activities", [
        {
          constName: "NOTE_TITLE",
          varName: "noteTitle",
          column: "noteTitle",
          value: "Call notes",
        },
        {
          constName: "NOTE_BODY",
          varName: "noteBody",
          column: "noteBody",
          value: "Champion identified, decision expected end of quarter.",
        },
      ]),
      STAMP,
    ].join("\n"),
    steps: String.raw`  stepLogger.log('Step 1: open the first opportunity');
  await page.goto(baseUrl + '/lightning/o/Opportunity/list?filterName=AllOpportunities', { waitUntil: 'domcontentloaded' });
  const firstLink = page.locator('table tbody tr th a, table tbody tr a[data-refid="recordId"]').first();
  await firstLink.waitFor({ state: 'visible', timeout: 60000 });
  stepLogger.log('Opportunity: ' + (await firstLink.innerText()).trim());
  await firstLink.click();
  await page.waitForURL(function (u) { return u.toString().includes('/lightning/r/Opportunity/'); }, { timeout: 30000 });
  // The record actions render inside shadow DOM; Playwright's role queries pierce it.
  await page.getByRole('button', { name: 'New Note', exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot(1, 'opportunity-record') });

  stepLogger.log('Step 2: open New Note from the record actions');
  await page.getByRole('button', { name: 'New Note', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New Note' });
  await dlg.getByRole('textbox', { name: /^Title/ }).waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot(2, 'new-note') });

  stepLogger.log('Step 3: write title and body, then save');
  await dlg.getByRole('textbox', { name: /^Title/ }).fill(NOTE_TITLE + ' ' + STAMP);
  await dlg.getByRole('textbox', { name: 'Body' }).click();
  await dlg.getByRole('textbox', { name: 'Body' }).fill(NOTE_BODY);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot(3, 'note-filled') });
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(4000);

  stepLogger.log('Step 4: the note shows under Notes & Attachments on the Related tab');
  await page.getByRole('tab', { name: 'Related' }).first().click().catch(function () {});
  await page.waitForTimeout(3000);
  await page.getByText(NOTE_TITLE + ' ' + STAMP).first().waitFor({ state: 'visible', timeout: 20000 }).catch(function () {});
  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Note "' + NOTE_TITLE + ' ' + STAMP + '" added');`,
  },
];

/* ───────────────────────────── areas ───────────────────────────────────── */

export interface SalesforceQuickstartArea {
  name: string;
  description: string;
}

export const SALESFORCE_QUICKSTART_AREAS: readonly SalesforceQuickstartArea[] =
  [
    {
      name: "Auth & Navigation",
      description:
        "Signs in through the SOAP API and frontdoor.jsp, then checks the Lightning shell: Home, the App Launcher, the Sales app and global search.",
    },
    {
      name: "Leads",
      description:
        "List views, list search and the record page; creating a lead, advancing its Path and converting it.",
    },
    {
      name: "Accounts & Contacts",
      description:
        "Account record, Related and Details tabs, the activity composer; creating a contact with the account lookup.",
    },
    {
      name: "Opportunities",
      description:
        "List, Kanban board, record page and Path; creating an opportunity and advancing its stage.",
    },
    {
      name: "Service (Cases)",
      description:
        "Open cases list and the New Case form with origin, priority and description.",
    },
    {
      name: "Reports & Dashboards",
      description:
        "Reports home, building and running a Leads report; Dashboards home and the New Dashboard dialog.",
    },
    {
      name: "Setup & Admin",
      description:
        "Setup home, Object Manager, Lead fields, Users and Company Information.",
    },
    {
      name: "Rep Activities",
      description:
        "What a rep does all day: log a call, schedule a meeting, create a follow-up task, draft an email (never sent) and add a note. Each one can be driven from the rep_activities data sheet.",
    },
  ];

/* ───────────────────────────── rendering ───────────────────────────────── */

function render(spec: QuickstartTestSpec): string {
  const parts = [
    `export async function test(page, baseUrl, screenshotPath, stepLogger, credentials) {`,
    `  // ── Salesforce CRM quickstart · ${spec.title} ──`,
  ];
  if (spec.prelude) parts.push(spec.prelude);
  parts.push(SHOT_HELPER, "");
  if (spec.beforeSignIn) parts.push(spec.beforeSignIn, "");
  parts.push(SIGN_IN, "", spec.steps, "}", "");
  return parts.join("\n");
}

export interface SalesforceQuickstartTest {
  name: string;
  area: string;
  code: string;
}

export const SALESFORCE_QUICKSTART_TESTS: readonly SalesforceQuickstartTest[] =
  SPECS.map((s) => ({ name: s.name, area: s.area, code: render(s) }));

/** Codes this module seeds. Lets callers recognise an untouched seed. */
export const SALESFORCE_QUICKSTART_CODES: ReadonlySet<string> = new Set(
  SALESFORCE_QUICKSTART_TESTS.map((t) => t.code),
);

/* ───────────────────────────── seeding ─────────────────────────────────── */

/**
 * Seed the Salesforce CRM quickstart suite into a repo and apply the
 * Playwright profile it was validated under.
 *
 * Idempotent: a no-op returning the existing first test when the repo already
 * has any test, matching `seedSandboxTemplate` and `seedPharmaSuite`.
 *
 * `targetUrl` is left null on purpose: every test navigates from the injected
 * `baseUrl`, so the org URL the user types in the next onboarding step applies
 * to all 18 at once instead of needing 18 edits.
 */
export async function seedSalesforceQuickstart(
  repositoryId: string,
): Promise<string | null> {
  const existing = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const now = new Date();
  let firstTestId: string | null = null;

  const areaIds = new Map<string, string>();
  for (const area of SALESFORCE_QUICKSTART_AREAS) {
    const faId = uuid();
    await db.insert(functionalAreas).values({
      id: faId,
      repositoryId,
      name: area.name,
      parentId: null,
      agentPlan: area.description,
      planGeneratedAt: now,
    });
    areaIds.set(area.name, faId);
  }

  for (const seed of SALESFORCE_QUICKSTART_TESTS) {
    const testId = uuid();
    await db.insert(tests).values({
      id: testId,
      repositoryId,
      functionalAreaId: areaIds.get(seed.area) ?? null,
      name: seed.name,
      code: seed.code,
      targetUrl: null,
      executionMode: "procedural",
      // The org URL and the `salesforce` credential are the user's to supply;
      // until both exist the suite cannot sign in. Quarantined tests run but
      // never block a build, so the first build stays green until then.
      quarantined: true,
      isPlaceholder: true,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(testVersions).values({
      id: uuid(),
      testId,
      version: 1,
      code: seed.code,
      name: seed.name,
      targetUrl: null,
      changeReason: "manual_edit",
      createdAt: now,
    });

    firstTestId ??= testId;
  }

  await upsertPlaywrightSettings(
    repositoryId,
    SALESFORCE_QUICKSTART_PLAYWRIGHT_PROFILE,
  );

  return firstTestId;
}
