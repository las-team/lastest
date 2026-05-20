/**
 * Run a freshly-rendered auth-setup test in a transient Chromium context, then
 * capture the resulting `context.storageState()` and persist it via
 * createStorageState so the QuickStart walkthrough test can re-use it via
 * setupOverrides.extraSteps.
 *
 * Lives outside the EB pod path on purpose — this is a one-shot session that
 * needs to return the auth blob to the caller, not a Lastest test run.
 */

import { chromium } from 'playwright';
import * as queries from '@/lib/db/queries';

export interface CaptureStorageStateInput {
  repositoryId: string;
  baseUrl: string;
  /** Rendered auth-setup test code (output of renderAuthSetupCode). */
  testCode: string;
  /** Display name for the persisted storage state. */
  name: string;
  /** Hard cap so a stuck signup can't burn the agent. Default 90s. */
  timeoutMs?: number;
}

export interface CaptureStorageStateResult {
  captured: boolean;
  storageStateId?: string;
  failureReason?: string;
  durationMs: number;
}

function extractTestBody(code: string): string | null {
  const match = code.match(
    /export\s+async\s+function\s+test\s*\(\s*page[^)]*\)\s*\{([\s\S]*)\}\s*$/,
  );
  return match ? match[1] : null;
}

function buildExpectStub() {
  // The auth-setup template doesn't use expect, but the AsyncFunction signature
  // includes it so the body's `expect` references (none today, but future-proof)
  // resolve. Returning a no-op proxy is safe.
  const noop = () => Promise.resolve();
  return new Proxy(() => noop, {
    get: () => noop,
  });
}

// Transient infrastructure failures that warrant an automatic retry.
// Content failures (form validation, disposable email, captcha) are NOT
// retried — the user needs to see those verbatim and adjust the email template.
const TRANSIENT_ERROR_RE = /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|net::ERR_(?:CONNECTION|NETWORK|TIMED_OUT|SOCKET|EMPTY|TUNNEL)|Target page, context or browser has been closed|Protocol error/i;

async function attemptCapture(
  input: CaptureStorageStateInput,
  body: string,
): Promise<{ ok: true; storageStateJson: string } | { ok: false; reason: string }> {
  const timeoutMs = input.timeoutMs ?? 90_000;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(20_000);

    const stepLogger = {
      log: (msg: string) => console.log(`[QuickStart auth-setup] ${msg}`),
      warn: (msg: string) => console.warn(`[QuickStart auth-setup] ${msg}`),
    };

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('page', 'baseUrl', 'screenshotPath', 'stepLogger', 'expect', body);
    const exec = fn(page, input.baseUrl, '/tmp/quickstart-auth.png', stepLogger, buildExpectStub());

    await Promise.race([
      exec,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`auth-setup timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    const storageStateJson = JSON.stringify(await context.storageState());
    return { ok: true, storageStateJson };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function captureStorageState(
  input: CaptureStorageStateInput,
): Promise<CaptureStorageStateResult> {
  const start = Date.now();
  const body = extractTestBody(input.testCode);
  if (!body) {
    return {
      captured: false,
      failureReason: 'could not extract test() body from rendered code',
      durationMs: Date.now() - start,
    };
  }

  // First attempt; one retry on transient network/browser errors.
  let attempt = await attemptCapture(input, body);
  if (!attempt.ok && TRANSIENT_ERROR_RE.test(attempt.reason)) {
    console.warn(`[QuickStart auth-setup] transient error, retrying once: ${attempt.reason}`);
    attempt = await attemptCapture(input, body);
  }

  if (!attempt.ok) {
    return {
      captured: false,
      failureReason: attempt.reason,
      durationMs: Date.now() - start,
    };
  }

  // Validate the captured state contains at least one cookie. A passing
  // auth-setup script that left an empty cookie jar means the test technically
  // navigated to a non-auth URL but the chain won't actually authenticate the
  // walkthrough. Better to fail loudly here than to ship a useless storage state.
  let cookieCount = 0;
  try {
    const parsed = JSON.parse(attempt.storageStateJson);
    cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
  } catch { /* parse failure handled below */ }
  if (cookieCount === 0) {
    return {
      captured: false,
      failureReason: 'auth-setup completed but captured 0 cookies — storage state would not authenticate the walkthrough. Likely the script navigated off the auth URL without actually signing in.',
      durationMs: Date.now() - start,
    };
  }

  const persisted = await queries.createStorageState({
    repositoryId: input.repositoryId,
    name: input.name,
    storageStateJson: attempt.storageStateJson,
  });

  return {
    captured: true,
    storageStateId: persisted.id,
    durationMs: Date.now() - start,
  };
}
