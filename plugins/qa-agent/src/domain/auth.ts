import { attemptLogin } from "./crawl";
import { looksLikeAuthUrl, matchAuthLinks } from "./auth-links";
import { gotoAndSettle, type QaPage } from "./page";

/**
 * qa_login step helpers: deterministic resolution of how a QA run
 * authenticates.
 *
 * Every function here used to take a `cdpUrl: string` and call
 * `chromium.connectOverCDP` itself — the third of RFC §1.1's six direct-CDP
 * offenders. They now take a page core claimed. Two consequences worth naming:
 *
 * - **Storage-state injection left this file entirely.** `validateStorageStateOnEb`
 *   used to call `injectStorageStateIntoEb(cdpUrl, storageStateJson)`, i.e. it
 *   held decrypted session material. The caller now claims the browser with
 *   `{ storageStateId }` and core resolves, ownership-checks and injects it
 *   host-side; the plugin only ever holds the id. What is left here is the
 *   probe.
 * - **`findExistingAuthSetup` is gone from this file, not moved into it.** It
 *   reads two core tables and had a second consumer before this migration —
 *   `src/lib/core/explorer-host.ts` — so it is shared composition-root code,
 *   not qa-agent's. It lives in `src/lib/core/auth-setup-resolution.ts` and
 *   both plugins' hosts call it (recipe §1.6.2, the `quickstart-storage-shared`
 *   shape).
 */

/** What the repo's existing setup infrastructure offers for auth. Declared
 *  here because it is the shape the host port hands back; the resolution
 *  itself is core's. */
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

/** Authed heuristic: the target page shows no password field and the final
 *  URL is not an auth page. Navigates the page to targetUrl first. */
export async function probeAuthedState(
  page: QaPage,
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
  page: QaPage,
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
  page: QaPage,
  targetUrl: string,
  injected: boolean,
): Promise<{ validated: boolean; deferred: boolean }> {
  // `injected` is core's answer to "did the storage state actually take" —
  // false covers both "no such state" and "IndexedDB-only, not injectable over
  // CDP". Only the second is a *deferral* rather than a failure, and core does
  // not distinguish them today; see `host.ts` item 7 for the one-field core PR
  // that would. Preserving the pre-migration reading (treat a failed injection
  // as deferred) keeps behaviour constant, which is the RFC §2 rule.
  if (!injected) return { validated: false, deferred: true };
  try {
    return {
      validated: await probeAuthedState(page, targetUrl),
      deferred: false,
    };
  } catch {
    return { validated: false, deferred: false };
  }
}

/** Extract the login/signup links the target app actually renders. */
export async function findAuthLinksOnEb(
  page: QaPage,
  targetUrl: string,
): Promise<{ loginUrl?: string; signupUrl?: string }> {
  try {
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
  }
}

/**
 * Drive a real login with the provided credentials on the EB: navigate to the
 * DOM-discovered login page (or stay put when a password form is already
 * visible), submit, verify the authed heuristic, and capture the session.
 */
export async function loginWithCredsOnEb(opts: {
  page: QaPage;
  targetUrl: string;
  loginUrl?: string;
  credentials: { email: string; password: string };
}): Promise<{ ok: boolean; storageStateJson?: string; detail?: string }> {
  const { page } = opts;
  try {
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
  }
}

/**
 * Post-crawl check used by discovery: is the EB's session authed against the
 * target, and if so, what does its session look like? Lets discovery upgrade
 * a `creds_untested` resolution after its inline login succeeded.
 */
export async function probeAndCaptureOnEb(
  page: QaPage,
  targetUrl: string,
): Promise<{ authed: boolean; storageStateJson?: string }> {
  try {
    const authed = await probeAuthedState(page, targetUrl);
    if (!authed) return { authed: false };
    const storageStateJson = await captureStorageStateFromContext(page);
    return { authed: true, storageStateJson: storageStateJson ?? undefined };
  } catch {
    return { authed: false };
  }
}
