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

export const SAFE_CTA_PATTERN = /^(create|new|add|view|open|explore|browse|start|continue|get started)\b/i;
export const DESTRUCTIVE_CTA_PATTERN = /\b(delete|pay|subscribe|upgrade|scan|import|sync|send)\b/i;
export const CAPTCHA_LOCATOR = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="cloudflare"][src*="challenge"]';

export interface RenderAuthSetupOptions {
  email: string;
  password: string;
  name?: string;
  /** Register URL observed by the scout in the page DOM. Relative path (starting with /)
   *  for same-origin signup pages; full https:// URL for cross-subdomain auth (e.g.
   *  auth.example.com). REQUIRED — no path-guessing fallback. */
  registerUrl: string;
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
}

function jsString(value: string): string {
  // Single-quoted JS literal with escapes for ' and \ and newlines.
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

function gotoExpr(target: string): string {
  // Support absolute URLs (e.g. auth subdomain) and relative paths interchangeably.
  // No path-guessing — we only navigate to what the scout actually observed in the DOM.
  if (/^https?:\/\//i.test(target)) {
    return `await page.goto(${jsString(target)}, { waitUntil: 'domcontentloaded' });`;
  }
  const path = target.startsWith('/') ? target : `/${target}`;
  return `await page.goto(\`\${baseUrl}${path}\`, { waitUntil: 'domcontentloaded' });`;
}

export function renderAuthSetupCode(opts: RenderAuthSetupOptions): string {
  const name = opts.name ?? 'Lastest Demo';
  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const DEMO_EMAIL = ${jsString(opts.email)};
  const DEMO_PASSWORD = ${jsString(opts.password)};
  const DEMO_NAME = ${jsString(name)};

  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  const settle = () => page.waitForLoadState('networkidle').catch(() => {});

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

  await Promise.race([
    page.waitForURL(/dashboard|onboarding|welcome|home|app|projects/i, { timeout: 15000 }),
    page.waitForSelector('[role="alert"]:visible, .error:visible, [data-error]:visible', { timeout: 15000 }),
  ]).catch(() => {});
  await settle();

  stepLogger.log('Scenario 3: Post-signup landing');
  const verifyBanner = page.getByText(
    /verify your email|check your (?:email|inbox)|confirmation (?:email|link)|verification (?:email|link)|we sent (?:a |you a )?(?:link|email|confirmation)|activate your account/i
  ).first();
  if (await verifyBanner.isVisible().catch(() => false)) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    throw new Error('verify-email gate detected after submit');
  }

  const url = page.url();
  if (/register|signup|signin|log[\\-]?in|sign-in|sign-up/i.test(url)) {
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
          if (NOISE_HINTS.test(t)) continue;
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
          if (NOISE_HINTS.test(t)) continue;
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

export function renderWalkthroughCode(opts: RenderWalkthroughOptions): string {
  const authAutomatable = opts.authAutomatable;

  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const AUTH_AUTOMATABLE = ${authAutomatable};

  const shot = (n, slug) => screenshotPath.replace('.png', \`-\${n}-\${slug}.png\`);
  const settle = () => page.waitForLoadState('networkidle').catch(() => {});

  stepLogger.log('Scenario 1: Homepage');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /accept|allow|got it|ok$/i });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
  await settle();
  await page.screenshot({ path: shot(1, 'home'), fullPage: true });

  let publicScenario = 2;
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
    try {
      // Storage state (cookies + localStorage) was attached by the runner via
      // setupOverrides.extraSteps. Just verify the chain actually authenticated.
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await settle();
      const signInCta = page.getByRole('link', { name: /sign ?in|log ?in/i }).first()
        .or(page.getByRole('button', { name: /sign ?in|log ?in/i }).first());
      if (await signInCta.isVisible().catch(() => false)) {
        throw new Error('Storage state did not authenticate the browser (sign-in CTA still visible)');
      }
      authed = true;

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
    } catch (e) {
      stepLogger.warn(\`Authed phase aborted: \${e && e.message ? e.message : String(e)}\`);
    }
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle();
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (AUTH_AUTOMATABLE && !authed) {
    stepLogger.warn('Authed phase did not run — see warnings above');
  }
}
`;
}

export function renderQuickstartEmail(template: string, slug: string, stamp: string): string {
  return template.replace(/\{slug\}/g, slug).replace(/\{stamp\}/g, stamp);
}

export function renderQuickstartPassword(stamp: string): string {
  return `Lastest-Demo-${stamp}!`;
}

export function utcStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    now.getUTCFullYear().toString() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes())
  );
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'quickstart';
}
