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
  /** Optional override register path (e.g. '/auth/signup'). Default chain probes /register, /signup, /users/register. */
  registerPath?: string;
}

export interface RenderWalkthroughOptions {
  authAutomatable: boolean;
  /** When true, walkthrough trusts setupTestId/storageState injection and skips inline login. */
  chainedAuth: boolean;
  /** Same literals as Test 1 — required when chainedAuth=false so inline login can re-auth. */
  email?: string;
  password?: string;
  /** Optional explicit login path probe order. Default: /login, /signin, /users/sign_in. */
  loginPath?: string;
}

function jsString(value: string): string {
  // Single-quoted JS literal with escapes for ' and \ and newlines.
  return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

function registerPathChain(override?: string): string {
  if (override) {
    return `await page.goto(\`\${baseUrl}${override}\`, { waitUntil: 'domcontentloaded' });`;
  }
  return [
    "await page.goto(`${baseUrl}/register`, { waitUntil: 'domcontentloaded' }).catch(async () => {",
    "    await page.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' }).catch(async () => {",
    "      await page.goto(`${baseUrl}/users/register`, { waitUntil: 'domcontentloaded' });",
    "    });",
    "  });",
  ].join('\n  ');
}

function loginPathChain(override?: string): string {
  if (override) {
    return `await page.goto(\`\${baseUrl}${override}\`, { waitUntil: 'domcontentloaded' });`;
  }
  return [
    "await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' }).catch(async () => {",
    "    await page.goto(`${baseUrl}/signin`, { waitUntil: 'domcontentloaded' }).catch(async () => {",
    "      await page.goto(`${baseUrl}/users/sign_in`, { waitUntil: 'domcontentloaded' });",
    "    });",
    "  });",
  ].join('\n  ');
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
  ${registerPathChain(opts.registerPath)}
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
    throw new Error(\`auth did not complete — still on \${url}\`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
}
`;
}

export function renderWalkthroughCode(opts: RenderWalkthroughOptions): string {
  const authAutomatable = opts.authAutomatable;
  const chainedAuth = opts.chainedAuth;
  const email = opts.email ?? '';
  const password = opts.password ?? '';

  return `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const AUTH_AUTOMATABLE = ${authAutomatable};
  const CHAINED_AUTH = ${chainedAuth};
  const DEMO_EMAIL = ${jsString(email)};
  const DEMO_PASSWORD = ${jsString(password)};

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
      if (CHAINED_AUTH) {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await settle();
        const signInCta = page.getByRole('link', { name: /sign ?in|log ?in/i }).first()
          .or(page.getByRole('button', { name: /sign ?in|log ?in/i }).first());
        if (await signInCta.isVisible().catch(() => false)) {
          throw new Error('Chained auth did not yield an authenticated context');
        }
        authed = true;
      } else {
        stepLogger.log('Fallback: inline login');
        ${loginPathChain(opts.loginPath)}
        await settle();
        const emailField = page.getByLabel(/email/i).first()
          .or(page.getByPlaceholder(/email/i).first())
          .or(page.locator('input[type="email"]').first());
        const passField = page.getByLabel(/password/i).first()
          .or(page.getByPlaceholder(/password/i).first())
          .or(page.locator('input[type="password"]').first());
        await emailField.click();
        await emailField.pressSequentially(DEMO_EMAIL, { delay: 20 });
        await passField.click();
        await passField.pressSequentially(DEMO_PASSWORD, { delay: 20 });
        const submit = page.getByRole('button', { name: /sign ?in|log ?in|continue/i }).first();
        await submit.click();
        await Promise.race([
          page.waitForURL(/dashboard|onboarding|welcome|home|app|projects/i, { timeout: 15000 }),
          page.waitForLoadState('networkidle', { timeout: 15000 }),
        ]).catch(() => {});
        await settle();
        if (/login|signin|sign-in/i.test(page.url())) throw new Error('inline login did not authenticate');
        authed = true;
      }

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
