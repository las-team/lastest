/**
 * Canonical Playwright test bodies the QuickStart agent emits.
 *
 * These are the productized form of the patterns in
 * `~/.claude/skills/gtm-lastest-saas-demo/references/test-template.md`.
 *
 * Two renderers:
 *   - renderAuthSetupCode — Test 1: register + capture auth-completed state.
 *   - renderWalkthroughCode — Test 2: public phase + (optional) authed phase.
 *
 * Both produce plain JavaScript bodies (TS annotations stripped by the runner),
 * use the runner-injected `baseUrl` rather than hardcoded URLs, and screenshot
 * with `fullPage: true` everywhere.
 */

export const SAFE_CTA_PATTERN =
  /^(create|new|add|view|open|explore|browse|start|continue|get started)\b/i;
export const DESTRUCTIVE_CTA_PATTERN =
  /\b(delete|pay|subscribe|upgrade|scan|import|sync|send)\b/i;
export const CAPTCHA_LOCATOR =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="cloudflare"][src*="challenge"]';

/**
 * Stable marker thrown by the walkthrough when chained `storage_state` failed to
 * replay an authenticated session. The orchestrator (`runQsRunAndNotes`) detects
 * this in the failed test's error message and downgrades to a public-only rerun
 * rather than shipping login-page screenshots as if they were authed.
 */
export const AUTH_CHAIN_FAILED_MARKER =
  "QuickStart authed walkthrough: storage_state did not authenticate";

/** Current stable Chrome UA. EB's default `HeadlessChrome` string is rejected by
 *  Cloudflare Turnstile, Clerk, Supabase Auth, and several SaaS edge routers. */
const EB_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

/** Known third-party console-noise scripts to abort before the first navigation.
 *  The EB executor reds a test on ANY console error; Cloudflare's auto-injected
 *  email-decoder is the #1 false positive across customer sites. */
const EB_NOISE_PATTERNS = [
  "**/cdn-cgi/scripts/**/email-decode.min.js",
  "**/cdn-cgi/scripts/**/cloudflare-static/**",
  "**/sentry-cdn.com/**",
  "**/browser.sentry-cdn.com/**",
  "**/cdn.segment.com/**",
  "**/connect.facebook.net/**",
];

/**
 * EB Chromium bootstrap, emitted at the top of every rendered test body (mirrors
 * the mandatory header in the skill's `test-template.md`). Two mitigations that
 * otherwise falsely-fail 50%+ of runs on the EB pod:
 *   1. Override the HeadlessChrome User-Agent with a current stable Chrome string.
 *   2. Abort known third-party console-noise scripts before the first navigation.
 * The route loop is INLINED (run once) rather than wrapped in a `const fn = () =>`
 * arrow — the runner's per-statement instrumentation can scope cross-statement
 * arrow helpers out, throwing "fn is not defined" mid-walk.
 */
export function renderEbBootstrap(): string {
  const patterns = EB_NOISE_PATTERNS.map((p) => `    ${jsString(p)},`).join(
    "\n",
  );
  return [
    `  await page.context().setExtraHTTPHeaders({ 'User-Agent': ${jsString(EB_USER_AGENT)} }).catch(function () {});`,
    `  for (const pattern of [`,
    patterns,
    `  ]) {`,
    `    await page.route(pattern, function (r) { return r.abort(); }).catch(function () {});`,
    `  }`,
  ].join("\n");
}

export interface RenderAuthSetupOptions {
  email: string;
  password: string;
  name?: string;
  /** Register URL observed by the scout in the page DOM. Relative path (starting with /)
   *  for same-origin signup pages; full https:// URL for cross-subdomain auth (e.g.
   *  auth.example.com). REQUIRED — no path-guessing fallback. */
  registerUrl: string;
}

export interface RenderAuthLoginOptions {
  /** User-supplied app credentials (QuickStart runs against the user's own app). */
  email: string;
  password: string;
  /** Login URL observed by the scout in the page DOM. Relative path (starting with /)
   *  or full https:// URL. REQUIRED — no path-guessing fallback. */
  loginUrl: string;
  /** Auth library REST sign-in endpoint observed by the scout (e.g.
   *  "/api/auth/sign-in/email"). When present, the test lands the session cookie
   *  via a direct POST (bypasses React forms that don't persist on .fill()), and
   *  falls back to the visible form submit if the POST is rejected. */
  apiLoginEndpoint?: string | null;
}

export interface RenderWalkthroughOptions {
  authAutomatable: boolean;
  /** When true, walkthrough trusts setupTestId/storageState injection and skips inline login. */
  chainedAuth: boolean;
  /** Same literals as Test 1 — required when chainedAuth=false so inline login can re-auth. */
  email?: string;
  password?: string;
  /** Login URL observed by the scout. Required when chainedAuth=false (fallback mode).
   *  Same format rules as registerUrl: relative path or full https URL. */
  loginUrl?: string;
  /** Primary business interaction extracted by the public scout. When present and the
   *  walkthrough runs authed, the template attempts to type demoInputValue into a
   *  primaryInputLabel-matched input and click a primaryCtaLabel-matched button before
   *  falling back to the generic safe-CTA pattern. */
  primaryInputLabel?: string;
  primaryCtaLabel?: string;
  demoInputValue?: string;
}

function jsString(value: string): string {
  // Single-quoted JS literal with escapes for ' and \ and newlines.
  return (
    "'" +
    value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") +
    "'"
  );
}

function gotoExpr(target: string): string {
  // Support absolute URLs (e.g. auth subdomain) and relative paths interchangeably.
  // No path-guessing — we only navigate to what the scout actually observed in the DOM.
  if (/^https?:\/\//i.test(target)) {
    return `await page.goto(${jsString(target)}, { waitUntil: 'domcontentloaded' });`;
  }
  const path = target.startsWith("/") ? target : `/${target}`;
  return `await page.goto(\`\${baseUrl}${path}\`, { waitUntil: 'domcontentloaded' });`;
}

export function renderAuthSetupCode(opts: RenderAuthSetupOptions): string {
  const name = opts.name ?? "Lastest Demo";
  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const DEMO_EMAIL = ${jsString(opts.email)};
  const DEMO_PASSWORD = ${jsString(opts.password)};
  const DEMO_NAME = ${jsString(name)};

  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(function () {});
    await page.locator('h1, h2, main, [role="main"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(function () {});
    await page.waitForTimeout(300);
  }

${renderEbBootstrap()}

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /accept|allow|got it|ok$/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
  await settle();

  stepLogger.log('Scenario 1: Register form');
  ${gotoExpr(opts.registerUrl)}
  await settle();
  await page.screenshot({ path: shot(1, 'register-form'), fullPage: true });

  const captcha = page.locator(${jsString(CAPTCHA_LOCATOR)});
  if (await captcha.first().isVisible().catch(() => false)) {
    throw new Error('captcha-blocked on register page');
  }

  stepLogger.log('Scenario 2: Submit register');
  const emailField = page.getByLabel(/email/i).first()
    .or(page.getByPlaceholder(/email/i).first())
    .or(page.locator('input[type="email"]').first());
  const passField = page.getByLabel(/^password$/i).first()
    .or(page.getByPlaceholder(/^password$/i).first())
    .or(page.locator('input[type="password"]').first());
  const confirmField = page.getByLabel(/confirm|repeat|verify/i).first()
    .or(page.getByPlaceholder(/confirm|repeat|verify/i).first())
    .or(page.locator('input[type="password"]').nth(1));
  const nameField = page.getByLabel(/^name|full name|your name/i).first()
    .or(page.getByPlaceholder(/name/i).first())
    .or(page.locator('input[name="name"], input#name').first());

  if (await nameField.isVisible().catch(() => false)) {
    await nameField.click();
    await nameField.pressSequentially(DEMO_NAME, { delay: 20 });
  }
  await emailField.click();
  await emailField.pressSequentially(DEMO_EMAIL, { delay: 20 });
  await passField.click();
  await passField.pressSequentially(DEMO_PASSWORD, { delay: 20 });
  if (await confirmField.isVisible().catch(() => false)) {
    await confirmField.click().catch(() => {});
    await confirmField.pressSequentially(DEMO_PASSWORD, { delay: 20 }).catch(() => {});
  }

  const terms = page.getByLabel(/agree|terms|conditions/i).first();
  if (await terms.isVisible().catch(() => false)) {
    await terms.check().catch(() => {});
  }

  const submit = page.getByRole('button', { name: /sign ?up|register|create account|get started/i }).first();
  await submit.click();

  // Success = left the auth page OR a session/auth cookie was set. The Lastest-
  // style register form awaits sign-up, THEN a consent server-action, THEN
  // redirects — so on a cold EB the navigation can lag many seconds. Poll up to
  // 30s for EITHER signal instead of sampling the URL once (a single 15s sample
  // false-failed slow-but-successful signups and discarded the captured session).
  const AUTH_URL_RE = /register|signup|signin|log[\\-]?in|sign-in|sign-up/i;
  async function hasSessionCookie() {
    const cookies = await page.context().cookies().catch(function () { return []; });
    return cookies.some(function (c) {
      return c && c.value && /session|auth|token|sid|jwt/i.test(c.name || '');
    });
  }
  let authed = false;
  const authDeadline = Date.now() + 30000;
  while (Date.now() < authDeadline) {
    if (!AUTH_URL_RE.test(page.url()) || (await hasSessionCookie())) { authed = true; break; }
    const rejected = await page.locator('[role="alert"]:visible, .error:visible, [data-error]:visible').first().isVisible().catch(function () { return false; });
    if (rejected) break;
    await page.waitForTimeout(500);
  }
  await settle();

  stepLogger.log('Scenario 3: Post-signup landing');
  const verifyBanner = page.getByText(
    /verify your email|check your (?:email|inbox)|confirmation (?:email|link)|verification (?:email|link)|we sent (?:a |you a )?(?:link|email|confirmation)|activate your account/i
  ).first();
  if (await verifyBanner.isVisible().catch(() => false)) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    throw new Error('verify-email gate detected after submit');
  }

  // A captured session means auth succeeded even if the post-signup redirect
  // lagged — the session, not the landing URL, is what auth-setup needs.
  const url = page.url();
  if (!authed && AUTH_URL_RE.test(url)) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    // Scrape visible error text verbatim from the site so the user sees the
    // actual rejection (e.g. "Sign-ups from disposable email addresses are not
    // allowed", "business email required", "Password must be at least 12
    // characters"). Look inside the <form> first for tight relevance, then
    // page-wide as a fallback.
    const errSelectors = [
      '[role="alert"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
      '[data-error]',
      '[aria-invalid="true"] ~ *',
      '.error',
      '.field-error',
      '.form-error',
      '[class*="text-red"]',
      '[class*="text-rose"]',
      '[class*="text-destructive"]',
      '[class*="text-error"]',
      '[class*="error-message"]',
    ];
    const ERROR_HINTS = /(not allowed|not supported|invalid|required|must|cannot|disposable|business|already|exists|taken|incorrect|wrong|weak|too (short|long|weak|common)|please|try again|failed|error|denied|blocked|use a different|use another|forbidden|temporarily)/i;
    const NOISE_HINTS = /(privacy policy|terms (and|of)|cookie|all rights reserved|copyright|^\\s*\\d{1,4}\\s*$|^\\W*$)/i;
    // Strong error verbs override the noise filter — "Please accept the Terms of
    // Service and Privacy Policy to continue" is a real validation error, not
    // footer boilerplate, even though it mentions "terms"/"privacy policy".
    const STRONG_ERROR = /(please|must|required|accept|agree to|enter|provide|invalid|already|exists|disposable|not allowed|too (short|long|weak))/i;
    async function collectErrorTexts(scope) {
      const seen = new Set();
      const out = [];
      for (const sel of errSelectors) {
        const locs = scope.locator(sel);
        const count = Math.min(await locs.count().catch(() => 0), 6);
        for (let i = 0; i < count; i++) {
          const loc = locs.nth(i);
          if (!(await loc.isVisible().catch(() => false))) continue;
          const t = ((await loc.textContent().catch(() => '')) || '')
            .replace(/\\s+/g, ' ').trim();
          if (t.length < 4 || t.length > 240) continue;
          if (NOISE_HINTS.test(t) && !STRONG_ERROR.test(t)) continue;
          if (!ERROR_HINTS.test(t)) continue;
          const key = t.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(t);
          if (out.length >= 3) return out;
        }
      }
      return out;
    }
    let errors = [];
    const form = page.locator('form').first();
    if (await form.isVisible().catch(() => false)) {
      errors = await collectErrorTexts(form);
    }
    if (errors.length === 0) errors = await collectErrorTexts(page);
    // Fallback for sites whose error text uses inline styles or CSS variables
    // (e.g. text-[rgb(var(--destructive))]) that don't match any selector class.
    // Scrape all visible text inside the form, filter for error-shaped lines.
    if (errors.length === 0) {
      const haystack = await form.allInnerTexts().catch(() => []);
      const seen = new Set();
      for (const block of haystack) {
        const lines = (block || '').split(/\\r?\\n+|(?<=[.!?])\\s+/);
        for (const raw of lines) {
          const t = raw.replace(/\\s+/g, ' ').trim();
          if (t.length < 6 || t.length > 240) continue;
          if (NOISE_HINTS.test(t) && !STRONG_ERROR.test(t)) continue;
          if (!ERROR_HINTS.test(t)) continue;
          const key = t.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          errors.push(t);
          if (errors.length >= 3) break;
        }
        if (errors.length >= 3) break;
      }
    }
    const joined = errors.join(' | ');
    throw new Error(joined
      ? joined
      : \`auth did not complete — still on \${url}\`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
}
`;
}

/**
 * Test 1 (login variant) — signs into the user's OWN app with user-supplied
 * credentials, captures sign-in screenshots, asserts auth completed. Used when
 * the user provided creds (QuickStart runs against their own baseURL). When the
 * scout found an `apiLoginEndpoint`, the test lands the session cookie via a
 * direct POST (bypasses React forms whose .fill() doesn't persist the session),
 * then falls back to the visible form submit if the POST is rejected.
 *
 * SECURITY: the credentials are baked as literals into the test body, which is
 * stored team-gated (never exposed on the public /r/ share — that renders
 * screenshots + notes only). These are the user's own app credentials.
 */
export function renderAuthLoginCode(opts: RenderAuthLoginOptions): string {
  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const DEMO_EMAIL = ${jsString(opts.email)};
  const DEMO_PASSWORD = ${jsString(opts.password)};
  const API_LOGIN = ${jsString(opts.apiLoginEndpoint ?? "")};

  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(function () {});
    await page.locator('h1, h2, main, [role="main"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(function () {});
    await page.waitForTimeout(300);
  }

${renderEbBootstrap()}

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /accept|allow|got it|ok$/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
  await settle();

  stepLogger.log('Scenario 1: Sign-in page');
  ${gotoExpr(opts.loginUrl)}
  await settle();
  await page.screenshot({ path: shot(1, 'sign-in'), fullPage: true });

  const captcha = page.locator(${jsString(CAPTCHA_LOCATOR)});
  if (await captcha.first().isVisible().catch(() => false)) {
    throw new Error('captcha-blocked on sign-in page');
  }

  stepLogger.log('Scenario 2: Submit sign-in');
  const emailField = page.getByLabel(/email/i).first()
    .or(page.getByPlaceholder(/email/i).first())
    .or(page.locator('input[type="email"]').first());
  const passField = page.getByLabel(/^password$/i).first()
    .or(page.getByPlaceholder(/^password$/i).first())
    .or(page.locator('input[type="password"]').first());

  await emailField.click();
  await emailField.pressSequentially(DEMO_EMAIL, { delay: 20 });
  await passField.click();
  await passField.pressSequentially(DEMO_PASSWORD, { delay: 20 });
  await page.screenshot({ path: shot(2, 'sign-in-filled'), fullPage: true });

  // API-login bypass: POST the credentials directly so the session cookie sticks
  // even when the React form's submit handler swallows programmatic input.
  let apiOk = false;
  if (API_LOGIN) {
    apiOk = await page.evaluate(async function (args) {
      try {
        const r = await fetch(args.url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: args.email, password: args.password }),
        });
        return r.ok;
      } catch (e) {
        return false;
      }
    }, { url: API_LOGIN, email: DEMO_EMAIL, password: DEMO_PASSWORD });
    if (apiOk) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    }
  }
  if (!apiOk) {
    const submit = page.getByRole('button', { name: /sign ?in|log ?in|continue|submit|next/i }).first();
    await submit.click().catch(function () {});
    await Promise.race([
      page.waitForURL(/dashboard|onboarding|welcome|home|app|projects|account/i, { timeout: 15000 }),
      page.waitForSelector('[role="alert"]:visible, .error:visible, [data-error]:visible', { timeout: 15000 }),
    ]).catch(function () {});
  }
  await settle();

  stepLogger.log('Scenario 3: Post-sign-in landing');
  const url = page.url();
  const stillSignInCta = page.getByRole('link', { name: /sign ?in|log ?in/i }).first()
    .or(page.getByRole('button', { name: /sign ?in|log ?in/i }).first());
  const onAuthUrl = /login|signin|sign-in|log-in/i.test(url);
  if (onAuthUrl && (await stillSignInCta.isVisible().catch(() => false))) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    let errText = '';
    const errLoc = page.locator('[role="alert"], [aria-live="polite"], [aria-live="assertive"], .error, .field-error, [class*="text-red"], [class*="text-destructive"]').first();
    if (await errLoc.isVisible().catch(() => false)) {
      errText = ((await errLoc.textContent().catch(() => '')) || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    }
    throw new Error(errText ? ('sign-in failed: ' + errText) : ('sign-in did not complete — still on ' + url));
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
}
`;
}

export function renderWalkthroughCode(opts: RenderWalkthroughOptions): string {
  const authAutomatable = opts.authAutomatable;
  const inputLabel = opts.primaryInputLabel?.trim() ?? "";
  const ctaLabel = opts.primaryCtaLabel?.trim() ?? "";
  const demoValue = opts.demoInputValue?.trim() ?? "";
  const hasBizInteraction = inputLabel.length > 0 && demoValue.length > 0;

  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const AUTH_AUTOMATABLE = ${authAutomatable};
  const BIZ_INPUT_LABEL = ${jsString(inputLabel)};
  const BIZ_CTA_LABEL = ${jsString(ctaLabel)};
  const BIZ_DEMO_VALUE = ${jsString(demoValue)};
  const HAS_BIZ_INTERACTION = ${hasBizInteraction};

  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(function () {});
    await page.locator('h1, h2, main, [role="main"]').first().waitFor({ state: 'visible', timeout: 5000 }).catch(function () {});
    await page.waitForTimeout(300);
  }

${renderEbBootstrap()}

  stepLogger.log('Scenario 1: Homepage');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /accept|allow|got it|ok$/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
  await settle();
  await page.screenshot({ path: shot(1, 'home'), fullPage: true });

  let publicScenario = 2;

  // Primary interaction for canvas / drawing apps (Excalidraw, tldraw, whiteboards,
  // map tools): when the homepage exposes a large drawing <canvas>, perform a REAL
  // coordinate-based action — select the rectangle tool ('r', the de-facto shortcut
  // across drawing apps) and drag a square — so the walkthrough demonstrates the
  // product's core function instead of only screenshotting nav pages. Best-effort:
  // gated on a visibly large canvas and fully wrapped, so non-drawing canvases
  // (charts, games) never break the run.
  try {
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible().catch(() => false)) {
      const box = await canvas.boundingBox().catch(() => null);
      if (box && box.width > 300 && box.height > 200) {
        await canvas.click({ position: { x: 30, y: 30 } }).catch(() => {});
        await page.keyboard.press('r').catch(() => {});
        await page.waitForTimeout(150);
        const side = Math.min(box.width, box.height) * 0.25;
        const x1 = box.x + box.width * 0.4;
        const y1 = box.y + box.height * 0.35;
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        await page.mouse.move(x1 + side * 0.5, y1 + side * 0.5, { steps: 8 });
        await page.mouse.move(x1 + side, y1 + side, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
        stepLogger.log(\`Scenario \${publicScenario}: Drew a square on the canvas\`);
        await page.screenshot({ path: shot(publicScenario, 'draw-square'), fullPage: true });
        publicScenario++;
      }
    }
  } catch (canvasErr) {
    stepLogger.warn(\`Canvas draw step skipped: \${canvasErr && canvasErr.message}\`);
  }

  const navLinks = await page.$$eval('a[href]', as => as
    .map(a => a.getAttribute('href') || '')
    .filter(h => h.startsWith('/') && h.length > 1 && !h.startsWith('/_') && !h.startsWith('/#'))
    .filter(h => !/\\.(js|mjs|css|png|jpe?g|svg|webp|gif|ico|woff2?|map|json|xml|txt|pdf)(\\?|$)/i.test(h))
    .map(h => h.split('#')[0].split('?')[0])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 6)
  ).catch(() => []);

  for (const path of navLinks) {
    if (publicScenario > 4) break;
    const slug = path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'page';
    stepLogger.log(\`Scenario \${publicScenario}: \${slug}\`);
    const resp = await page.goto(\`\${baseUrl}\${path}\`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!resp || !resp.ok()) {
      stepLogger.warn(\`\${path} returned \${resp ? resp.status() : 'no-response'}, skipping\`);
      continue;
    }
    await settle();
    await page.screenshot({ path: shot(publicScenario, slug), fullPage: true });
    publicScenario++;
  }

  let authed = false;
  if (AUTH_AUTOMATABLE) {
    // Hard gate (OUTSIDE the best-effort try/catch below): the runner attached
    // the captured storage_state (cookies + localStorage) via
    // setupOverrides.extraSteps. If it did NOT replay an authenticated session
    // (expired, dropped, or never injected), RED the build instead of silently
    // shipping login-page screenshots as "authed". The orchestrator detects this
    // marker on the failed result and downgrades to a public-only rerun.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await settle();
    const signInCta = page.getByRole('link', { name: /sign ?in|log ?in/i }).first()
      .or(page.getByRole('button', { name: /sign ?in|log ?in/i }).first());
    if (await signInCta.isVisible().catch(() => false)) {
      await page.screenshot({ path: shot(publicScenario, 'auth-failed'), fullPage: true });
      throw new Error(${jsString(AUTH_CHAIN_FAILED_MARKER + " (sign-in CTA still visible)")});
    }
    authed = true;

    try {
      stepLogger.log(\`Scenario \${publicScenario}: Post-auth landing\`);
      await page.screenshot({ path: shot(publicScenario, 'post-auth'), fullPage: true });
      publicScenario++;

      let captured = 0;
      const inAppLinks = await page.$$eval(
        'nav a[href], aside a[href], [role="navigation"] a[href], header a[href]',
        as => as
          .map(a => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim() }))
          .filter(({ href }) => href.startsWith('/') && href.length > 1 && !href.startsWith('/_') && !href.startsWith('/#'))
          .filter(({ text, href }) => !/log\\s?out|sign\\s?out|delete|destroy|cancel\\s?account/.test(text.toLowerCase()) && !/logout|signout/i.test(href))
          .map(o => ({ ...o, href: o.href.split('#')[0].split('?')[0] }))
          .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
          .slice(0, 6)
      ).catch(() => []);

      for (const { href, text } of inAppLinks) {
        if (captured >= 2) break;
        const resp = await page.goto(\`\${baseUrl}\${href}\`, { waitUntil: 'domcontentloaded' }).catch(() => null);
        if (!resp || !resp.ok()) continue;
        const finalUrl = page.url();
        if (/register|signup|signin|log[\\-]?in|sign-in|sign-up/i.test(finalUrl)) continue;
        await settle();
        captured++;
        const slug = (text || href).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'inapp';
        stepLogger.log(\`Scenario \${publicScenario}: In-app \${slug}\`);
        await page.screenshot({ path: shot(publicScenario, \`inapp-\${slug}\`), fullPage: true });
        publicScenario++;
      }

      // Business interaction — only fires when the public scout extracted both
      // an input label and a demo value. We try several locator strategies in
      // order: getByLabel, getByPlaceholder, role=textbox by accessible-name.
      // If any one of them resolves to a visible input, we type the demo value
      // and look for a hero-CTA-shaped button to submit it. This is what shows
      // the founder THEIR app being used, not just generic nav clicks.
      let bizFired = false;
      if (HAS_BIZ_INTERACTION) {
        try {
          const labelRe = new RegExp(BIZ_INPUT_LABEL.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');
          const candidates = [
            page.getByLabel(labelRe).first(),
            page.getByPlaceholder(labelRe).first(),
            page.getByRole('textbox', { name: labelRe }).first(),
            page.locator('textarea').first(),
            page.locator('input[type="text"], input[type="search"], input:not([type])').first(),
          ];
          let input = null;
          for (const cand of candidates) {
            if (await cand.isVisible().catch(() => false)) {
              input = cand;
              break;
            }
          }
          if (input) {
            await input.click({ timeout: 3000 }).catch(() => {});
            await input.pressSequentially(BIZ_DEMO_VALUE, { delay: 15 }).catch(() => {});
            // Submit: prefer the scout-named CTA, else any hero-shape verb.
            const heroVerbRe = /^(validate|generate|create|run|search|find|analy[sz]e|check|test|try|start|go|build|score|review|summarize)\\b/i;
            const ctaCandidates = [];
            if (BIZ_CTA_LABEL) {
              const ctaRe = new RegExp(BIZ_CTA_LABEL.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');
              ctaCandidates.push(page.getByRole('button', { name: ctaRe }).first());
              ctaCandidates.push(page.getByRole('link', { name: ctaRe }).first());
            }
            ctaCandidates.push(page.getByRole('button', { name: heroVerbRe }).first());
            let clicked = false;
            for (const cand of ctaCandidates) {
              if (await cand.isVisible().catch(() => false)) {
                await cand.click({ timeout: 3000 }).catch(() => {});
                clicked = true;
                break;
              }
            }
            if (!clicked) {
              // Some interfaces submit on Enter (search bars, single-input
              // forms). Try pressing Enter as a last resort before giving up.
              await input.press('Enter').catch(() => {});
            }
            // Wait for the page to react: URL change, network settle, or a
            // new result-shaped surface (list / panel / dialog). 8s cap.
            await Promise.race([
              page.waitForLoadState('networkidle', { timeout: 8000 }),
              page.waitForSelector('[role="dialog"], [role="list"], [role="article"], [data-testid*="result"], .results, .result-list', { timeout: 8000 }),
            ]).catch(() => {});
            await settle();
            stepLogger.log(\`Scenario \${publicScenario}: Business interaction "\${BIZ_DEMO_VALUE.slice(0, 40)}"\`);
            await page.screenshot({ path: shot(publicScenario, 'biz-interaction'), fullPage: true });
            publicScenario++;
            bizFired = true;
          } else {
            stepLogger.warn(\`Business-interaction input "\${BIZ_INPUT_LABEL}" not found on authed surface\`);
          }
        } catch (bizErr) {
          stepLogger.warn(\`Business-interaction step skipped: \${bizErr && bizErr.message}\`);
        }
      }

      // Generic safe-CTA fallback — only when the targeted business interaction
      // didn't fire (no scout data, or input not found). Avoids double-clicking
      // when biz fired since both would screenshot near-identical states.
      if (!bizFired) {
        try {
          const beforeUrl = page.url();
          const safeCta = page.getByRole('button', { name: /^(create|new|add|view|open|explore|browse|start|continue|get started)\\b/i }).first();
          if (await safeCta.isVisible().catch(() => false)) {
            await safeCta.click({ timeout: 3000 }).catch(() => {});
            await settle();
            const afterUrl = page.url();
            const dialogVisible = await page.locator('dialog, [role="dialog"], .modal').first().isVisible().catch(() => false);
            if (afterUrl !== beforeUrl || dialogVisible) {
              stepLogger.log(\`Scenario \${publicScenario}: Post-CTA state\`);
              await page.screenshot({ path: shot(publicScenario, 'post-cta'), fullPage: true });
              publicScenario++;
            }
          }
        } catch (ctaErr) {
          stepLogger.warn(\`Safe-CTA step skipped: \${ctaErr && ctaErr.message}\`);
        }
      }
    } catch (e) {
      stepLogger.warn(\`Authed phase aborted: \${e && e.message ? e.message : String(e)}\`);
    }
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle();
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
`;
}

export function renderQuickstartEmail(
  template: string,
  slug: string,
  stamp: string,
): string {
  return template.replace(/\{slug\}/g, slug).replace(/\{stamp\}/g, stamp);
}

export function renderQuickstartPassword(stamp: string): string {
  return `Lastest-Demo-${stamp}!`;
}

export function utcStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  );
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "quickstart"
  );
}
