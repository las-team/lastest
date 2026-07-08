import { chromium, type Browser, type Page } from "playwright";
import * as queries from "@/lib/db/queries";
import { injectStorageStateIntoEb } from "@/lib/eb/inject-storage-state";
import { attemptLogin } from "@/lib/qa-agent/crawl";
import { looksLikeAuthUrl, matchAuthLinks } from "@/lib/qa-agent/auth-links";

/**
 * qa_login step helpers: deterministic resolution of how a QA run
 * authenticates. Everything that touches a browser drives the run's Embedded
 * Browser over CDP (never a host-process Chromium), mirroring crawl.ts.
 */

const NAV_TIMEOUT_MS = 30_000;
const SETTLE_TIMEOUT_MS = 8_000;

/** What the repo's existing setup infrastructure offers for auth. */
export interface ExistingAuthSetup {
  /** Newest usable storage state (from default steps, or the repo's list). */
  storageStateId?: string;
  storageStateName?: string;
  /** First default setup step that is a test (its id, for qaAuth.setupTestId). */
  setupTestId?: string;
  /** First default setup step that is a script — runnable to mint a fresh
   *  session when no (valid) storage state exists. */
  setupScriptId?: string;
  setupStepName?: string;
  /** Repo default setup steps include a test/script/storage_state — the
   *  executor already applies them to every test. */
  defaultSetupInUse: boolean;
}

/**
 * Check the repo's existing setup infrastructure, strongest first: default
 * setup steps (storage_state step wins, then test/script steps), then the
 * repo's storage-state list (non-expired, newest first, agent-captured names
 * preferred so a prior QA/QuickStart login is picked over unrelated states).
 */
export async function findExistingAuthSetup(
  repositoryId: string,
): Promise<ExistingAuthSetup> {
  const result: ExistingAuthSetup = { defaultSetupInUse: false };

  const defaults = await queries
    .getDefaultSetupSteps(repositoryId)
    .catch(() => []);
  if (defaults.length > 0) {
    result.defaultSetupInUse = true;
    const storageStep = defaults.find(
      (s) => s.stepType === "storage_state" && s.storageStateId,
    );
    if (storageStep?.storageStateId) {
      result.storageStateId = storageStep.storageStateId;
      result.storageStateName = storageStep.storageStateName ?? undefined;
    }
    const testStep = defaults.find((s) => s.stepType === "test" && s.testId);
    if (testStep?.testId) {
      result.setupTestId = testStep.testId;
      result.setupStepName = testStep.testName ?? undefined;
    } else {
      const scriptStep = defaults.find(
        (s) => s.stepType === "script" && s.scriptId,
      );
      if (scriptStep?.scriptId) {
        result.setupScriptId = scriptStep.scriptId;
        result.setupStepName = scriptStep.scriptName ?? undefined;
      }
    }
  }

  if (!result.storageStateId) {
    const now = Date.now();
    const rows = await queries.getStorageStates(repositoryId).catch(() => []);
    const preferred = (name: string) =>
      /^(QA agent |QuickStart login |QuickStart signup )/i.test(name) ? 0 : 1;
    const candidate = rows
      .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
      .sort(
        (a, b) =>
          preferred(a.name) - preferred(b.name) ||
          (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      )[0];
    if (candidate) {
      result.storageStateId = candidate.id;
      result.storageStateName = candidate.name;
    }
  }

  return result;
}

async function connectToEb(
  cdpUrl: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, page };
}

async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  await page
    .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
    .catch(() => {});
}

/** Authed heuristic: the target page shows no password field and the final
 *  URL is not an auth page. Navigates the page to targetUrl first. */
export async function probeAuthedState(
  page: Page,
  targetUrl: string,
): Promise<boolean> {
  try {
    await gotoAndSettle(page, targetUrl);
    const password = page.locator('input[type="password"]').first();
    const hasPassword = await password
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (hasPassword) return false;
    return !looksLikeAuthUrl(new URL(page.url()).pathname);
  } catch {
    return false;
  }
}

/** Serialize the EB's default-context session if it carries any material
 *  (cookies / localStorage / IndexedDB). Null = nothing worth persisting. */
async function captureStorageStateFromContext(
  page: Page,
): Promise<string | null> {
  const state = await page.context().storageState({ indexedDB: true });
  const origins = (state.origins ?? []) as Array<{
    localStorage?: unknown[];
    indexedDB?: unknown[];
  }>;
  const hasMaterial =
    (state.cookies?.length ?? 0) > 0 ||
    origins.some(
      (o) =>
        (Array.isArray(o.localStorage) && o.localStorage.length > 0) ||
        (Array.isArray(o.indexedDB) && o.indexedDB.length > 0),
    );
  return hasMaterial ? JSON.stringify(state) : null;
}

/**
 * Validate a stored storage state against the target app on the EB.
 * `deferred: true` means the capture is IndexedDB-only and can't be injected
 * over CDP — not a failure; validation falls to discovery/execution (the
 * executor's runner path applies full storage states natively).
 */
export async function validateStorageStateOnEb(
  cdpUrl: string,
  storageStateJson: string,
  targetUrl: string,
): Promise<{ validated: boolean; deferred: boolean }> {
  const injected = await injectStorageStateIntoEb(cdpUrl, storageStateJson);
  if (!injected) return { validated: false, deferred: true };
  let browser: Browser | null = null;
  try {
    const conn = await connectToEb(cdpUrl);
    browser = conn.browser;
    return {
      validated: await probeAuthedState(conn.page, targetUrl),
      deferred: false,
    };
  } catch {
    return { validated: false, deferred: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Extract the login/signup links the target app actually renders. */
export async function findAuthLinksOnEb(
  cdpUrl: string,
  targetUrl: string,
): Promise<{ loginUrl?: string; signupUrl?: string }> {
  let browser: Browser | null = null;
  try {
    const conn = await connectToEb(cdpUrl);
    browser = conn.browser;
    const page = conn.page;
    await gotoAndSettle(page, targetUrl);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: (a as HTMLAnchorElement).getAttribute("href") || "",
      })),
    );
    return matchAuthLinks(links, targetUrl);
  } catch {
    return {};
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Drive a real login with the provided credentials on the EB: navigate to the
 * DOM-discovered login page (or stay put when a password form is already
 * visible), submit, verify the authed heuristic, and capture the session.
 */
export async function loginWithCredsOnEb(opts: {
  cdpUrl: string;
  targetUrl: string;
  loginUrl?: string;
  credentials: { email: string; password: string };
}): Promise<{ ok: boolean; storageStateJson?: string; detail?: string }> {
  let browser: Browser | null = null;
  try {
    const conn = await connectToEb(opts.cdpUrl);
    browser = conn.browser;
    const page = conn.page;
    await gotoAndSettle(page, opts.targetUrl);
    const passwordVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (!passwordVisible) {
      if (!opts.loginUrl) {
        return { ok: false, detail: "no login form or login link found" };
      }
      await gotoAndSettle(page, opts.loginUrl);
    }
    const submitted = await attemptLogin(page, opts.credentials);
    if (!submitted) {
      return { ok: false, detail: "no password form on the login page" };
    }
    const authed = await probeAuthedState(page, opts.targetUrl);
    if (!authed) {
      return { ok: false, detail: "still on an auth page after submit" };
    }
    const storageStateJson = await captureStorageStateFromContext(page);
    if (!storageStateJson) {
      return {
        ok: false,
        detail: "logged-in UI reached but no session material was captured",
      };
    }
    return { ok: true, storageStateJson };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Post-crawl check used by discovery: is the EB's session authed against the
 * target, and if so, what does its session look like? Lets discovery upgrade
 * a `creds_untested` resolution after its inline login succeeded.
 */
export async function probeAndCaptureOnEb(
  cdpUrl: string,
  targetUrl: string,
): Promise<{ authed: boolean; storageStateJson?: string }> {
  let browser: Browser | null = null;
  try {
    const conn = await connectToEb(cdpUrl);
    browser = conn.browser;
    const authed = await probeAuthedState(conn.page, targetUrl);
    if (!authed) return { authed: false };
    const storageStateJson = await captureStorageStateFromContext(conn.page);
    return { authed: true, storageStateJson: storageStateJson ?? undefined };
  } catch {
    return { authed: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
