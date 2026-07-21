/**
 * Run a freshly-rendered auth-setup test, then capture the resulting
 * `context.storageState()` and persist it via createStorageState so the
 * QuickStart walkthrough test can re-use it via setupOverrides.extraSteps.
 *
 * SECURITY: the auth-setup code is AI/user-derived arbitrary Playwright code.
 * On a provisioned (Kubernetes) deployment it is executed in a disposable
 * runner/EB pod via executeSetupViaRunner — never `eval`'d in the host process
 * (which holds DATABASE_URL / STRIPE_* / SYSTEM_EB_TOKEN). Only a self-hosted
 * single-tenant install with no runner pool falls back to in-process execution.
 */

import { chromium } from "playwright";
import * as queries from "@/lib/db/queries";
import { executeSetupViaRunner } from "@/lib/execution/executor";
import {
  claimOrProvisionPoolEB,
  releasePoolEB,
} from "@/server/actions/embedded-sessions";
import { isKubernetesMode } from "@lastest/pool-service/common";

export interface CaptureStorageStateInput {
  repositoryId: string;
  baseUrl: string;
  /** Rendered auth-setup test code (output of renderAuthSetupCode/renderAuthLoginCode). */
  testCode: string;
  /** Display name for the persisted storage state. */
  name: string;
  /** Hard cap so a stuck signup can't burn the agent. Default 90s. */
  timeoutMs?: number;
  /** Best-effort token location from the scout — only used as a provenance
   *  fallback when the captured state's actual locations can't be derived. */
  tokenLocation?:
    | "cookie"
    | "localstorage"
    | "indexeddb"
    | "sessionstorage"
    | "unknown";
  /** Best-effort auth library guess (better-auth, firebase, ...). Stored as
   *  authFlavor provenance so re-runs can pick a re-auth strategy. */
  authFlavor?: string;
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
const TRANSIENT_ERROR_RE =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|net::ERR_(?:CONNECTION|NETWORK|TIMED_OUT|SOCKET|EMPTY|TUNNEL)|Target page, context or browser has been closed|Protocol error/i;

async function attemptCapture(
  input: CaptureStorageStateInput,
  body: string,
): Promise<
  { ok: true; storageStateJson: string } | { ok: false; reason: string }
> {
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

    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const fn = new AsyncFunction(
      "page",
      "baseUrl",
      "screenshotPath",
      "stepLogger",
      "expect",
      body,
    );
    const exec = fn(
      page,
      input.baseUrl,
      "/tmp/quickstart-auth.png",
      stepLogger,
      buildExpectStub(),
    );

    await Promise.race([
      exec,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`auth-setup timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);

    // { indexedDB: true } (PW 1.51+) captures Firebase Auth / Clerk / Supabase-v2
    // sessions that the bare call drops. The runner/EB paths already do this; the
    // host fallback must match or those apps replay unauthenticated.
    const storageStateJson = JSON.stringify(
      await context.storageState({ indexedDB: true }),
    );
    return { ok: true, storageStateJson };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Run the auth-setup code in a disposable runner/EB pod and return its captured
 * storage state. Returns null when no pooled browser could be claimed (so the
 * caller can decide whether a host fallback is permitted).
 */
async function tryCaptureViaRunner(
  input: CaptureStorageStateInput,
): Promise<
  { ok: true; storageStateJson: string } | { ok: false; reason: string } | null
> {
  let runnerId: string | null = null;
  try {
    const poolEB = await claimOrProvisionPoolEB({ purpose: "interactive" });
    runnerId = poolEB?.runnerId ?? null;
  } catch {
    runnerId = null;
  }
  if (!runnerId) return null;

  try {
    const result = await executeSetupViaRunner(
      input.testCode,
      `quickstart-auth-${input.repositoryId}`,
      runnerId,
      input.baseUrl,
      undefined,
      input.timeoutMs ?? 90_000,
      null,
    );
    const json = result.storageStateJson;
    if (!json) {
      return { ok: false, reason: "runner returned no storage state" };
    }
    return { ok: true, storageStateJson: json };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await releasePoolEB(runnerId).catch(() => {});
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
      failureReason: "could not extract test() body from rendered code",
      durationMs: Date.now() - start,
    };
  }

  // Preferred path: execute off-host in a disposable runner/EB pod.
  let attempt = await tryCaptureViaRunner(input);

  if (!attempt) {
    // No pooled browser available. On a provisioned deployment we must NOT fall
    // back to in-process eval of arbitrary auth code.
    if (isKubernetesMode()) {
      return {
        captured: false,
        failureReason: "All browsers are busy. Please try again later.",
        durationMs: Date.now() - start,
      };
    }

    // Self-hosted / local-dev fallback: no runner pool configured. Such
    // deployments are single-tenant, so in-process execution is acceptable.
    // First attempt; one retry on transient network/browser errors.
    attempt = await attemptCapture(input, body);
    if (!attempt.ok && TRANSIENT_ERROR_RE.test(attempt.reason)) {
      console.warn(
        `[QuickStart auth-setup] transient error, retrying once: ${attempt.reason}`,
      );
      attempt = await attemptCapture(input, body);
    }
  }

  if (!attempt.ok) {
    return {
      captured: false,
      failureReason: attempt.reason,
      durationMs: Date.now() - start,
    };
  }

  // Validate the captured state carries SOME session material. HttpOnly-cookie
  // shops (better-auth, NextAuth) put it in cookies; Firebase/Clerk/Supabase-v2
  // keep it in localStorage or IndexedDB (captured via { indexedDB: true }).
  // Accept any of them — a truly empty jar means the script navigated off the
  // auth URL without actually signing in. Also derive the real token locations
  // for provenance (more accurate than the scout's guess).
  let cookieCount = 0;
  let hasStorage = false;
  const tokenLocations: string[] = [];
  try {
    const parsed = JSON.parse(attempt.storageStateJson) as {
      cookies?: unknown[];
      origins?: Array<{ localStorage?: unknown[]; indexedDB?: unknown[] }>;
    };
    cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    const origins = Array.isArray(parsed.origins) ? parsed.origins : [];
    const hasLocal = origins.some(
      (o) => Array.isArray(o.localStorage) && o.localStorage.length > 0,
    );
    const hasIdb = origins.some(
      (o) => Array.isArray(o.indexedDB) && o.indexedDB.length > 0,
    );
    hasStorage = hasLocal || hasIdb;
    if (cookieCount > 0) tokenLocations.push("cookie");
    if (hasLocal) tokenLocations.push("localStorage");
    if (hasIdb) tokenLocations.push("indexedDB");
  } catch {
    /* parse failure handled below */
  }
  if (cookieCount === 0 && !hasStorage) {
    return {
      captured: false,
      failureReason:
        "auth-setup completed but captured no cookies, localStorage, or IndexedDB session material — storage state would not authenticate the walkthrough. Likely the script navigated off the auth URL without actually signing in.",
      durationMs: Date.now() - start,
    };
  }

  const provenanceLocations =
    tokenLocations.length > 0
      ? tokenLocations
      : input.tokenLocation
        ? [input.tokenLocation]
        : null;

  const persisted = await queries.createStorageState({
    repositoryId: input.repositoryId,
    name: input.name,
    storageStateJson: attempt.storageStateJson,
    tokenLocations: provenanceLocations,
    authFlavor: input.authFlavor ?? null,
  });

  return {
    captured: true,
    storageStateId: persisted.id,
    durationMs: Date.now() - start,
  };
}
