/**
 * Pharma / life-sciences onboarding seed.
 *
 * Creates the two suites a Veeva consultant actually came for — Vault release
 * regression and Salesforce release regression — plus the regulated
 * check-layer defaults, so the pharma fork of onboarding lands on a repo that
 * already looks like their job rather than on an empty project.
 *
 * Both tests read their logins from the repo's Credentials store
 * (`credentials.vault.username`, `credentials.salesforce.password`), which is
 * what makes them runnable: they used to reach for `process.env.VAULT_USER`,
 * which resolved against the embedded browser's own process environment and so
 * could never be satisfied — the blocker `docs/pharma-restricted-scope.md`
 * §2.1 named, closed by `docs/credentials-plan.md`.
 *
 * Those handles are what a Vault or Salesforce **connector** provisions
 * (Settings → Integrations): naming a connector `vault` creates the
 * `credentials.vault.*` fields with exactly these keys, in the environment it
 * belongs to. A consultant with PROD and UAT connectors runs this same test
 * against both without editing a line of it.
 *
 * They stay seeded **quarantined** for a different and smaller reason: the
 * target URL is a placeholder, because pointing a seeded test at a real Vault
 * would be pointing it at somebody else's tenant. Quarantined tests run but
 * never block a build, so the first build stays green while the consultant
 * fills in their sandbox URL and adds the two credentials — at which point
 * un-quarantining is one toggle rather than a platform gap.
 *
 * Sibling of `sandbox-seeds.ts` and deliberately shaped like it: same
 * area→test→version insert, same "no-op if the repo already has tests"
 * idempotence.
 */
import { db } from "@/lib/db";
import { tests, testVersions, functionalAreas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuid } from "crypto";
import { upsertPlaywrightSettings } from "@/lib/db/queries/settings";
import { REGULATED_CHECK_MODES } from "@/lib/segment/regulated";

const VAULT_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger, credentials) {
  // ───────────────────────────────────────────────────────────────────────────
  // QUARANTINED until you point it at your sandbox — so it never reds your
  // first build. Quarantined tests still run; they just don't block.
  //
  // Vault ships three general releases a year. Each lands in your sandbox
  // weeks before production, and every validated configuration on top of it
  // has to be re-checked. That re-check is a person with a script and a
  // screenshot folder. This is that person's checklist, executed on every
  // release and diffed against the last known-good run.
  //
  // To run it:
  //   1. Settings → Environments → add a UAT environment pointing at a Vault
  //      SANDBOX (never production).
  //   2. Settings → Integrations → Veeva Vault → Add connector, named
  //      \`vault\`, in that environment. Use a service account with a fixed,
  //      known role — a permission change should surface as a test failure,
  //      not as noise. Then add a \`docId\` field to the credential it created
  //      (Setup → Credentials), naming a fixture document it may move through
  //      the lifecycle. A sandbox refresh changes that id and nothing else:
  //      re-point it there rather than in this source, so the baselines
  //      survive.
  //   3. Un-quarantine.
  //
  // The values below are read from that store at run time. They are never
  // written into this source, never hashed into the baseline, and never
  // recorded in run history — so rotating the password changes nothing here.
  // ───────────────────────────────────────────────────────────────────────────
  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  const vault = credentials?.vault;
  const DOC_ID = vault?.docId; // seeded fixture document

  if (!vault?.username || !vault?.password) {
    throw new Error('This test needs a credential named "vault" with username and password fields. Add a Veeva Vault connector named "vault" under Settings → Integrations (or a credential under Setup → Credentials), then reference it as credentials.vault.username.');
  }

  // ── 1. Authentication ─────────────────────────────────────────────────────
  stepLogger.log('Scenario 1: Vault login');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/user name|username/i).fill(credentials.vault.username);
  await page.getByLabel(/password/i).fill(credentials.vault.password);
  await page.getByRole('button', { name: /log ?in|sign in/i }).click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: shot(1, 'vault-home') });

  // ── 2. Document lifecycle state and available user actions ────────────────
  // A release regression most often shows up as an action that quietly
  // disappears from the lifecycle menu for a given role.
  stepLogger.log('Scenario 2: document lifecycle actions');
  await page.goto(new URL(\`/ui/#doc_info/\${DOC_ID}\`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[class*="doc-info"], [data-testid="document-header"]', { timeout: 30000 });

  const state = await page.locator('[class*="lifecycle-state"], [data-field="status__v"]').first().innerText();
  stepLogger.log(\`lifecycle state: \${state}\`);

  const actions = await page.locator('[class*="user-action"], [role="menuitem"]').allInnerTexts();
  stepLogger.log(\`available user actions: \${actions.join(' | ')}\`);
  await page.screenshot({ path: shot(2, 'doc-lifecycle-actions') });

  // ── 3. 21 CFR Part 11 eSignature manifestation ────────────────────────────
  // Part 11 §11.50 requires the signature manifestation to carry the signer's
  // printed name, the date and time of signing, and the MEANING of the
  // signature. Those three are asserted literally, because a template change
  // that drops "Meaning" is a compliance finding, not a cosmetic one.
  stepLogger.log('Scenario 3: eSignature manifestation (21 CFR Part 11 §11.50)');
  await page.getByRole('button', { name: /approve|complete review/i }).click();
  const signature = page.locator('[class*="esignature"], [role="dialog"]').first();
  await signature.waitFor({ state: 'visible', timeout: 20000 });
  await page.screenshot({ path: shot(3, 'esignature-dialog') });

  const manifest = await signature.innerText();
  const missing = ['name', 'date', 'meaning'].filter((token) => !new RegExp(token, 'i').test(manifest));
  if (missing.length) throw new Error(\`eSignature manifestation is missing required Part 11 element(s): \${missing.join(', ')}\`);

  // Cancel — do not actually sign. A signed record in a validated sandbox is
  // an audit-trail entry that cannot be removed.
  await page.getByRole('button', { name: /cancel/i }).click();

  // ── 4. Audit trail ────────────────────────────────────────────────────────
  stepLogger.log('Scenario 4: audit trail renders and is ordered');
  await page.goto(new URL(\`/ui/#doc_info/\${DOC_ID}/audit_trail\`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table, [role="grid"]', { timeout: 30000 });
  const rows = await page.locator('table tbody tr, [role="row"]').count();
  if (rows === 0) throw new Error('Audit trail rendered no entries — Part 11 §11.10(e) requires a retrievable audit trail.');
  stepLogger.log(\`audit trail rows: \${rows}\`);
  await page.screenshot({ path: shot(4, 'audit-trail') });

  // ── 5. Visual baseline of the configured surfaces ─────────────────────────
  // Everything above is a functional assertion. This is the part that catches
  // what assertions never do: a Vault release restyling a custom layout,
  // truncating a field label, or reflowing a section so it no longer prints.
  stepLogger.log('Scenario 5: visual baselines for configured layouts');
  for (const [n, [slug, hash]] of [['doc-viewer', \`#doc_info/\${DOC_ID}\`], ['library', '#library'], ['my-tasks', '#tasks']].entries()) {
    await page.goto(new URL(\`/ui/\${hash}\`, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.screenshot({ path: shot(5 + n, \`vault-\${slug}\`), fullPage: true });
  }

  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Vault release regression pass complete.');
}
`;

const SALESFORCE_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger, credentials) {
  // ───────────────────────────────────────────────────────────────────────────
  // QUARANTINED until you point it at your org — so it never reds your first
  // build. Quarantined tests still run; they just don't block.
  //
  // Salesforce ships three seasonal releases a year (Spring, Summer, Winter)
  // and pushes them to sandboxes on a published preview window. The regression
  // surface that actually breaks is rarely Apex — it is Lightning page
  // layouts, LWC rendering, validation rules and Flow screens, none of which
  // unit tests see. This test walks those.
  //
  // To run it: add an environment pointing at a Salesforce SANDBOX or
  // Developer org, then Settings → Integrations → Salesforce → Add connector
  // named \`salesforce\` using \"Browser login\" — the method a regression test
  // drives. (Salesforce disabled new Connected App creation in Spring '26, and
  // External Client Apps dropped the username-password grant, so the form
  // login is the UI path and the OAuth methods are for API work.) Then
  // un-quarantine. The values are read from the credential store at run time —
  // never written into this source, never hashed into the baseline, never
  // recorded in run history.
  // ───────────────────────────────────────────────────────────────────────────
  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  const sf = credentials?.salesforce;

  if (!sf?.username || !sf?.password) {
    throw new Error('This test needs a credential named "salesforce" with username and password fields. Add a Salesforce connector named "salesforce" under Settings → Integrations (or a credential under Setup → Credentials), then reference it as credentials.salesforce.username.');
  }

  // ── 1. Login ──────────────────────────────────────────────────────────────
  stepLogger.log('Scenario 1: Salesforce login');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').fill(credentials.salesforce.username);
  await page.locator('#password').fill(credentials.salesforce.password);
  await page.locator('#Login').click();
  await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => {});
  await page.screenshot({ path: shot(1, 'sf-home') });

  // ── 2. Lightning record page renders its configured components ────────────
  stepLogger.log('Scenario 2: Lightning record page layout');
  await page.goto(new URL('/lightning/o/Account/list', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table[role="grid"], .slds-table', { timeout: 40000 });
  await page.locator('table a[data-refid="recordId"]').first().click();
  await page.waitForSelector('.slds-page-header, records-lwc-highlights-panel', { timeout: 40000 });

  // A release regression here reads as "a component silently stopped rendering".
  for (const region of ['records-lwc-highlights-panel', 'flexipage-component2', 'records-record-layout-section']) {
    const count = await page.locator(region).count();
    stepLogger.log(\`\${region}: \${count} instance(s)\`);
    if (count === 0) throw new Error(\`Lightning record page rendered no <\${region}> — a configured component is missing after the release.\`);
  }
  await page.screenshot({ path: shot(2, 'sf-record-page'), fullPage: true });

  // ── 3. Validation rules still fire ────────────────────────────────────────
  // Assert the org's declarative guardrails survive the upgrade. Edit and
  // cancel — never save.
  stepLogger.log('Scenario 3: validation rules');
  await page.getByRole('button', { name: /^edit$/i }).first().click();
  const modal = page.locator('.slds-modal, [role="dialog"]').first();
  await modal.waitFor({ state: 'visible', timeout: 20000 });
  await modal.getByLabel(/account name/i).fill('');
  await modal.getByRole('button', { name: /save/i }).click();
  const error = modal.locator('.slds-form-element__help, [role="alert"]').first();
  await error.waitFor({ state: 'visible', timeout: 15000 });
  stepLogger.log(\`validation message: \${(await error.innerText()).slice(0, 120)}\`);
  await page.screenshot({ path: shot(3, 'sf-validation') });
  await modal.getByRole('button', { name: /cancel/i }).click();

  // ── 4. Visual baselines for the configured surfaces ───────────────────────
  stepLogger.log('Scenario 4: visual baselines');
  for (const [n, [slug, path]] of [['home', '/lightning/page/home'], ['accounts', '/lightning/o/Account/list'], ['reports', '/lightning/o/Report/home']].entries()) {
    await page.goto(new URL(path, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.screenshot({ path: shot(4 + n, \`sf-\${slug}\`), fullPage: true });
  }

  await page.screenshot({ path: screenshotPath });
  stepLogger.log('Salesforce release regression pass complete.');
}
`;

interface PharmaSeedTest {
  name: string;
  code: string;
  targetUrl: string;
  area: { name: string; description: string };
}

export const PHARMA_SEED_TESTS: readonly PharmaSeedTest[] = [
  {
    name: "Vault release regression",
    code: VAULT_CODE,
    // Placeholder host: the test is quarantined, and pointing a seeded test at
    // a real Vault would be pointing it at somebody else's tenant.
    targetUrl: "https://your-vault-sandbox.veevavault.com",
    area: {
      name: "Veeva Vault Release Regression",
      description:
        "Re-checks the customer's validated Vault configuration against each general release: lifecycle actions by role, the 21 CFR Part 11 §11.50 signature manifestation, a retrievable audit trail (§11.10(e)), and visual baselines of the configured document, library and task surfaces.",
    },
  },
  {
    name: "Salesforce release regression",
    code: SALESFORCE_CODE,
    targetUrl: "https://your-sandbox.my.salesforce.com",
    area: {
      name: "Salesforce Release Regression",
      description:
        "Walks the seasonal-release surface that unit tests never see: Lightning page layouts, LWC rendering, declarative validation rules, and visual baselines of home, list and report surfaces.",
    },
  },
];

/** Codes this module seeds. Lets callers recognise an untouched seed. */
export const PHARMA_SEED_CODES: ReadonlySet<string> = new Set([
  VAULT_CODE,
  SALESFORCE_CODE,
]);

/**
 * Seed the Vault + Salesforce suites into a repo and apply the regulated
 * check-layer defaults.
 *
 * Idempotent: a no-op returning the existing first test when the repo already
 * has any test, matching `seedSandboxTemplate`.
 */
export async function seedPharmaSuite(
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

  for (const seed of PHARMA_SEED_TESTS) {
    const faId = uuid();
    await db.insert(functionalAreas).values({
      id: faId,
      repositoryId,
      name: seed.area.name,
      parentId: null,
      agentPlan: seed.area.description,
      planGeneratedAt: now,
    });

    const testId = uuid();
    await db.insert(tests).values({
      id: testId,
      repositoryId,
      functionalAreaId: faId,
      name: seed.name,
      code: seed.code,
      targetUrl: seed.targetUrl,
      executionMode: "procedural",
      // The platform block is gone — both read their logins from the repo's
      // Credentials store now. What remains is per-customer setup: the target
      // URL is a placeholder (pointing a seeded test at a real Vault would be
      // pointing it at somebody else's tenant) and the `vault` / `salesforce`
      // credentials don't exist until the consultant adds them. Quarantined
      // tests run but never block a build, so the first build stays green
      // until both are filled in.
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
      targetUrl: seed.targetUrl,
      changeReason: "manual_edit",
      createdAt: now,
    });

    firstTestId ??= testId;
  }

  await applyRegulatedCheckModes(repositoryId);

  return firstTestId;
}

/**
 * Write `REGULATED_CHECK_MODES` onto the repo's Playwright settings row.
 *
 * Split out so the settings toggle can re-apply the profile to an existing
 * repo without re-seeding tests. Uses `upsert` rather than
 * `updatePlaywrightSettingsByRepo`, because a repo created seconds ago has no
 * settings row yet and the modes are the entire point of the profile.
 */
export async function applyRegulatedCheckModes(
  repositoryId: string,
): Promise<void> {
  await upsertPlaywrightSettings(repositoryId, {
    visualMode: REGULATED_CHECK_MODES.visual,
    textMode: REGULATED_CHECK_MODES.text,
    domMode: REGULATED_CHECK_MODES.dom,
    networkMode: REGULATED_CHECK_MODES.network,
    consoleMode: REGULATED_CHECK_MODES.console,
    perfMode: REGULATED_CHECK_MODES.perf,
    urlMode: REGULATED_CHECK_MODES.url,
    apiMode: REGULATED_CHECK_MODES.api,
    storageMode: REGULATED_CHECK_MODES.storage,
    a11yMode: REGULATED_CHECK_MODES.a11y,
    designMode: REGULATED_CHECK_MODES.design,
  });
}
