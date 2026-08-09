import { gotoAndSettle, SETTLE_TIMEOUT_MS, type ExplorerPage } from "./page";

/**
 * Live credential login on the page core handed over.
 *
 * ### Why this is here and not a shared import
 *
 * It used to be `loginWithCredsOnEb()` in `@/lib/qa-agent/auth` — a
 * `cross-plugin` violation, and one of the five this migration had to remove.
 * Three resolutions were available and only one survives contact with the rule
 * set:
 *
 * - **Promote to `libs/`.** Tempting, and probably right *later*. Today
 *   qa-agent's version is entangled with its own auth-link discovery and its
 *   own storage-state capture; lifting it would mean lifting those too, which
 *   is a qa-agent refactor wearing an explorer migration's clothes. Two callers
 *   is not yet a library.
 * - **Compose via `ctx.jobs`** — the brief's initial guess. It does not work.
 *   A job is asynchronous by construction, and this must *complete* before
 *   research runs: an unauthenticated first iteration explores the logged-out
 *   marketing site and poisons the frontier for every iteration after it. You
 *   cannot enqueue a precondition.
 * - **Keep it in the plugin** — what this is. `core-scope.md` §5 says driving a
 *   page is the feature's business, and the credentials involved are
 *   explorer's own (its knowledge notes, or the operator's start form), not a
 *   core-held secret. Stored credentials go the other way entirely: explorer
 *   passes `storageStateId` on the claim and never sees the material.
 *
 * Cost of that choice, stated plainly: ~50 lines now exist twice, and a fix to
 * one will not reach the other until `libs/browser-kit` exists.
 */

/** Paths that mean "still logged out", used to tell success from a redirect. */
const AUTH_PATH_RE =
  /(^|\/)(login|signin|sign-in|auth|register|signup|sign-up|sso)(\/|$)/i;

export interface LoginAttempt {
  ok: boolean;
  detail?: string;
}

/**
 * Fill and submit whatever password form is on screen.
 *
 * Selector-guessing rather than configuration on purpose: the explorer runs
 * against an app it was pointed at five seconds ago, so there is nothing to
 * configure. It fails soft — a wrong guess ends as "no password form", and the
 * run continues against the public surface.
 */
async function submitCredentials(
  page: ExplorerPage,
  credentials: { email: string; password: string },
): Promise<boolean> {
  try {
    const password = page.locator('input[type="password"]').first();
    if (!(await password.isVisible({ timeout: 2000 }).catch(() => false))) {
      return false;
    }
    const user = page
      .locator(
        'input[type="email"], input[autocomplete="username"], input[name*="mail" i], input[name*="user" i], input[type="text"]',
      )
      .first();
    if (await user.isVisible({ timeout: 1000 }).catch(() => false)) {
      await user.fill(credentials.email);
    }
    await password.fill(credentials.password);
    const submit = page
      .locator(
        'button[type="submit"], input[type="submit"], form button, [role="button"]',
      )
      .first();
    await submit.click({ timeout: 3000 });
    await page
      .waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Authenticated = the target renders without a password field and without
 *  having bounced us to an auth path. Cheap, and wrong only for apps that keep
 *  a password field on an authenticated page. */
async function looksAuthenticated(
  page: ExplorerPage,
  targetUrl: string,
): Promise<boolean> {
  try {
    await gotoAndSettle(page, targetUrl);
    const hasPassword = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (hasPassword) return false;
    return !AUTH_PATH_RE.test(new URL(page.url()).pathname);
  } catch {
    return false;
  }
}

/**
 * Log in with the given credentials, starting from the target URL.
 *
 * Best-effort by design: every failure path returns rather than throws, because
 * exploring the public surface of an app is still useful and is strictly better
 * than failing the session.
 */
export async function loginWithCredentials(opts: {
  page: ExplorerPage;
  targetUrl: string;
  loginUrl?: string;
  credentials: { email: string; password: string };
}): Promise<LoginAttempt> {
  const { page, targetUrl, loginUrl, credentials } = opts;
  try {
    await gotoAndSettle(page, targetUrl);
    const passwordVisible = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (!passwordVisible) {
      if (!loginUrl) return { ok: false, detail: "no login form found" };
      await gotoAndSettle(page, loginUrl);
    }
    if (!(await submitCredentials(page, credentials))) {
      return { ok: false, detail: "no password form on the login page" };
    }
    if (!(await looksAuthenticated(page, targetUrl))) {
      return { ok: false, detail: "still on an auth page after submit" };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
