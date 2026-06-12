/**
 * Sandbox template seeds.
 *
 * Each entry in `SANDBOX_SEEDS` mirrors one of the onboarding sandbox
 * templates (`SANDBOX_TEMPLATES` in `onboarding-client.tsx`) and creates a
 * single real, runnable Playwright test against the template's public
 * playground URL. We seed instead of relying on AI generation so a fresh
 * sandbox repo always has at least one working test the user can run.
 *
 * Pattern mirrors `src/lib/demo/excalidraw-seed.ts` but is intentionally
 * tiny (1 functional area + 1 test per template) so a real first run takes
 * seconds, not minutes.
 *
 * Idempotent: if the repo already has tests, seeding is a no-op.
 */
import { db } from "@/lib/db";
import { tests, testVersions, functionalAreas } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuid } from "crypto";

export type SandboxSeedId = "todomvc" | "the-internet" | "playwright-docs";

type SeedTest = {
  name: string;
  code: string;
  targetUrl: string;
  functionalArea: string;
};

type SeedDefinition = {
  area: { name: string; description: string };
  test: SeedTest;
};

const TODOMVC_CODE = `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  stepLogger.log('Open TodoMVC');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const input = page.locator('.new-todo, input.new-todo, input[placeholder*="What needs"]');
  await input.waitFor({ state: 'visible' });

  const items = ['buy milk', 'walk the dog', 'ship a real test'];
  for (const item of items) {
    await input.fill(item);
    await input.press('Enter');
  }

  await page.waitForSelector('.todo-list li');
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });

  stepLogger.log('Complete the first todo');
  const firstToggle = page.locator('.todo-list li').first().locator('.toggle, input.toggle');
  await firstToggle.click();
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`;

const HEROKUAPP_CODE = `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  function buildUrl(base: string, path: string) {
    const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }

  stepLogger.log('Open the login page');
  await page.goto(buildUrl(baseUrl, '/login'), { waitUntil: 'domcontentloaded' });
  await page.locator('#username').waitFor({ state: 'visible' });
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });

  stepLogger.log('Submit the form authentication credentials');
  await page.locator('#username').fill('tomsmith');
  await page.locator('#password').fill('SuperSecretPassword!');
  await page.locator('button[type="submit"]').click();

  await page.locator('#flash.success, .flash.success').waitFor({ state: 'visible' });
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`;

const PLAYWRIGHT_DOCS_CODE = `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  stepLogger.log('Land on the Playwright homepage');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Playwright/ }).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });

  stepLogger.log('Open the Docs section');
  await page.getByRole('link', { name: 'Docs' }).first().click();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('article, main').first().waitFor({ state: 'visible' });
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`;

/**
 * Generic, URL-agnostic smoke test. Unlike the template seeds, this navigates
 * to whatever `baseUrl` the test runs against and captures a baseline — so it
 * works for a user's *own* app, not a hardcoded third-party playground. Used
 * when a sandbox is created with a custom URL, and when a user later sets a
 * custom base URL (we re-point an untouched sample at their site).
 */
const SMOKE_TEST_CODE = `import { Page } from 'playwright';

export async function test(page: Page, baseUrl: string, screenshotPath: string, stepLogger: any) {
  let screenshotStep = 0;
  function getScreenshotPath() {
    screenshotStep++;
    const ext = screenshotPath.lastIndexOf('.');
    if (ext > 0) {
      return screenshotPath.slice(0, ext) + '-step' + screenshotStep + screenshotPath.slice(ext);
    }
    return screenshotPath + '-step' + screenshotStep;
  }

  stepLogger.log('Open the page');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});

  stepLogger.log('Capture a baseline screenshot');
  await page.screenshot({ path: getScreenshotPath(), fullPage: true });
}
`;

export const SANDBOX_SEEDS: Record<SandboxSeedId, SeedDefinition> = {
  todomvc: {
    area: {
      name: "TodoMVC Sample",
      description:
        "A starter suite that exercises the classic TodoMVC playground.",
    },
    test: {
      name: "Add and complete todos",
      targetUrl: "https://demo.playwright.dev/todomvc/",
      functionalArea: "TodoMVC Sample",
      code: TODOMVC_CODE,
    },
  },
  "the-internet": {
    area: {
      name: "The Internet Sample",
      description:
        "A starter suite against the the-internet.herokuapp.com QA playground.",
    },
    test: {
      name: "Form authentication login",
      targetUrl: "https://the-internet.herokuapp.com/",
      functionalArea: "The Internet Sample",
      code: HEROKUAPP_CODE,
    },
  },
  "playwright-docs": {
    area: {
      name: "Playwright Docs Sample",
      description:
        "A starter suite that walks the public Playwright docs site.",
    },
    test: {
      name: "Homepage to docs navigation",
      targetUrl: "https://playwright.dev",
      functionalArea: "Playwright Docs Sample",
      code: PLAYWRIGHT_DOCS_CODE,
    },
  },
};

export function isSandboxSeedId(
  id: string | null | undefined,
): id is SandboxSeedId {
  return !!id && Object.prototype.hasOwnProperty.call(SANDBOX_SEEDS, id);
}

export async function seedSandboxTemplate(
  repositoryId: string,
  templateId: SandboxSeedId,
): Promise<string | null> {
  const existing = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const seed = SANDBOX_SEEDS[templateId];
  const now = new Date();

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
    name: seed.test.name,
    code: seed.test.code,
    targetUrl: seed.test.targetUrl,
    executionMode: "procedural",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(testVersions).values({
    id: uuid(),
    testId,
    version: 1,
    code: seed.test.code,
    name: seed.test.name,
    targetUrl: seed.test.targetUrl,
    changeReason: "manual_edit",
    createdAt: now,
  });

  return testId;
}

/** Codes we seed automatically. Used to recognise an *untouched* sample so we
 *  can safely re-point or replace it without clobbering user edits. */
const SEED_CODES = new Set<string>([
  TODOMVC_CODE,
  HEROKUAPP_CODE,
  PLAYWRIGHT_DOCS_CODE,
  SMOKE_TEST_CODE,
]);

/**
 * Seed a generic smoke test against an arbitrary base URL. Idempotent: a no-op
 * when the repo already has any test. This is the "bring your own URL" seed —
 * a fresh repo with a custom URL gets a real, runnable first test of *their*
 * app instead of a third-party demo.
 */
export async function seedGenericSmokeTest(
  repositoryId: string,
  targetUrl: string,
): Promise<string | null> {
  const existing = await db
    .select({ id: tests.id })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const now = new Date();
  const faId = uuid();
  await db.insert(functionalAreas).values({
    id: faId,
    repositoryId,
    name: "Smoke test",
    parentId: null,
    agentPlan: "A starter test that loads your app and captures a baseline.",
    planGeneratedAt: now,
  });

  const testId = uuid();
  await db.insert(tests).values({
    id: testId,
    repositoryId,
    functionalAreaId: faId,
    name: "Homepage loads",
    code: SMOKE_TEST_CODE,
    targetUrl,
    executionMode: "procedural",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(testVersions).values({
    id: uuid(),
    testId,
    version: 1,
    code: SMOKE_TEST_CODE,
    name: "Homepage loads",
    targetUrl,
    changeReason: "manual_edit",
    createdAt: now,
  });

  return testId;
}

/**
 * When a user sets a custom base URL during onboarding, re-point an *untouched*
 * seeded sample at their site. Fixes the case where a demo template (e.g. the
 * herokuapp "form auth" test) was seeded but the user actually wants to test
 * their own URL — without this the first test still targets the demo site and
 * fails. No-op when the repo has multiple tests or the sample was edited.
 */
export async function repointSeededSampleToSmoke(
  repositoryId: string,
  newBaseUrl: string,
): Promise<boolean> {
  const repoTests = await db
    .select({
      id: tests.id,
      code: tests.code,
      targetUrl: tests.targetUrl,
      functionalAreaId: tests.functionalAreaId,
    })
    .from(tests)
    .where(eq(tests.repositoryId, repositoryId));

  // Only act when the repo holds exactly one, unedited, auto-seeded sample.
  if (repoTests.length !== 1) return false;
  const t = repoTests[0];
  if (!t.code || !SEED_CODES.has(t.code)) return false;
  // Already a smoke test pointing at the right URL — nothing to do.
  if (t.code === SMOKE_TEST_CODE && t.targetUrl === newBaseUrl) return false;

  const now = new Date();
  await db
    .update(tests)
    .set({
      code: SMOKE_TEST_CODE,
      name: "Homepage loads",
      targetUrl: newBaseUrl,
      executionMode: "procedural",
      updatedAt: now,
    })
    .where(eq(tests.id, t.id));

  if (t.functionalAreaId) {
    await db
      .update(functionalAreas)
      .set({
        name: "Smoke test",
        agentPlan:
          "A starter test that loads your app and captures a baseline.",
      })
      .where(eq(functionalAreas.id, t.functionalAreaId));
  }

  const versionRows = await db
    .select({ version: testVersions.version })
    .from(testVersions)
    .where(eq(testVersions.testId, t.id));
  const nextVersion =
    versionRows.reduce((max, r) => Math.max(max, r.version ?? 0), 0) + 1;

  await db.insert(testVersions).values({
    id: uuid(),
    testId: t.id,
    version: nextVersion,
    code: SMOKE_TEST_CODE,
    name: "Homepage loads",
    targetUrl: newBaseUrl,
    changeReason: "manual_edit",
    createdAt: now,
  });

  return true;
}
