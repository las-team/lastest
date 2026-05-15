import { describe, it, expect } from 'vitest';
import {
  renderAuthSetupCode,
  renderWalkthroughCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  utcStamp,
  slugify,
  SAFE_CTA_PATTERN,
  DESTRUCTIVE_CTA_PATTERN,
  CAPTCHA_LOCATOR,
} from './quickstart-templates';

const sampleEmail = 'viktor+postbox202604030915@lastest.cloud';
const samplePassword = 'Lastest-Demo-202604030915!';

describe('renderAuthSetupCode', () => {
  const code = renderAuthSetupCode({ email: sampleEmail, password: samplePassword });

  it('exports the canonical 4-arg test function', () => {
    expect(code).toMatch(/export async function test\(page, baseUrl, screenshotPath, stepLogger\)/);
  });

  it('does not redeclare expect (provided as runner param)', () => {
    expect(code).not.toMatch(/\bconst\s+expect\s*=/);
    expect(code).not.toMatch(/\bimport[^;]*expect/);
  });

  it('uses baseUrl rather than hardcoding the target URL', () => {
    expect(code).not.toMatch(/https?:\/\//);
    expect(code).toMatch(/baseUrl/);
  });

  it('inlines email + password literals as strings', () => {
    expect(code).toContain(sampleEmail);
    expect(code).toContain(samplePassword);
  });

  it('takes every screenshot at fullPage: true', () => {
    const matches = code.match(/page\.screenshot\([\s\S]*?\)\s*;/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toMatch(/fullPage:\s*true/);
    }
  });

  it('checks for captcha iframes before submitting', () => {
    expect(code).toContain(CAPTCHA_LOCATOR);
    expect(code).toMatch(/captcha-blocked on register page/);
  });

  it('throws on verify-email gate', () => {
    expect(code).toMatch(/verify-email gate detected after submit/);
  });

  it('uses pressSequentially (not .fill) so React-controlled inputs update', () => {
    expect(code).toMatch(/pressSequentially/);
  });
});

describe('renderWalkthroughCode — chained authed mode', () => {
  const code = renderWalkthroughCode({
    authAutomatable: true,
    chainedAuth: true,
    email: sampleEmail,
    password: samplePassword,
  });

  it('declares both AUTH_AUTOMATABLE=true and CHAINED_AUTH=true', () => {
    expect(code).toContain('const AUTH_AUTOMATABLE = true;');
    expect(code).toContain('const CHAINED_AUTH = true;');
  });

  it('takes every screenshot at fullPage: true', () => {
    const matches = code.match(/page\.screenshot\([\s\S]*?\)\s*;/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toMatch(/fullPage:\s*true/);
    }
  });

  it('only uses safe-CTA verbs in the safeCta selector', () => {
    const safeCtaLine = code.match(/getByRole\('button', \{ name: \/\^.*?\$\/i \}\)/)?.[0]
      ?? code.match(/getByRole\('button', \{ name: [^}]+\}\)/g)?.find(s => /create|new|view|open|explore|browse|start|continue|get started/.test(s));
    expect(safeCtaLine).toBeDefined();
    if (safeCtaLine) {
      expect(safeCtaLine).not.toMatch(DESTRUCTIVE_CTA_PATTERN);
    }
  });

  it('does not URL-guess /dashboard or similar — discovers via DOM', () => {
    expect(code).toMatch(/page\.\$\$eval/);
    expect(code).not.toMatch(/page\.goto\(`\$\{baseUrl\}\/dashboard`/);
  });

  it('uses baseUrl rather than hardcoding the target URL', () => {
    expect(code).not.toMatch(/https?:\/\//);
  });

  it('does not redeclare expect', () => {
    expect(code).not.toMatch(/\bconst\s+expect\s*=/);
  });
});

describe('renderWalkthroughCode — public-only mode', () => {
  const code = renderWalkthroughCode({
    authAutomatable: false,
    chainedAuth: false,
  });

  it('disables both AUTH_AUTOMATABLE and CHAINED_AUTH', () => {
    expect(code).toContain('const AUTH_AUTOMATABLE = false;');
    expect(code).toContain('const CHAINED_AUTH = false;');
  });

  it('still walks the public phase', () => {
    expect(code).toMatch(/Scenario 1: Homepage/);
    expect(code).toMatch(/page\.\$\$eval\('a\[href\]'/);
  });
});

describe('SAFE_CTA_PATTERN / DESTRUCTIVE_CTA_PATTERN', () => {
  it('matches additive verbs', () => {
    for (const verb of ['create', 'new', 'view', 'open', 'explore', 'browse', 'start', 'continue', 'get started']) {
      expect(verb).toMatch(SAFE_CTA_PATTERN);
    }
  });

  it('rejects destructive verbs', () => {
    for (const verb of ['delete', 'pay', 'subscribe', 'upgrade', 'scan', 'import', 'sync', 'send']) {
      expect(verb).toMatch(DESTRUCTIVE_CTA_PATTERN);
    }
  });
});

describe('renderQuickstartEmail / renderQuickstartPassword / utcStamp / slugify', () => {
  it('substitutes {slug} and {stamp}', () => {
    const out = renderQuickstartEmail('viktor+{slug}{stamp}@lastest.cloud', 'postbox', '202604030915');
    expect(out).toBe('viktor+postbox202604030915@lastest.cloud');
  });

  it('emits a 12-char UTC stamp', () => {
    const stamp = utcStamp(new Date(Date.UTC(2026, 3, 3, 9, 15)));
    expect(stamp).toBe('202604030915');
  });

  it('renders the canonical password format', () => {
    expect(renderQuickstartPassword('202604030915')).toBe('Lastest-Demo-202604030915!');
  });

  it('slugifies into kebab-case under 32 chars', () => {
    expect(slugify('Postbox HQ — Demo!')).toBe('postbox-hq-demo');
    expect(slugify('')).toBe('quickstart');
    expect(slugify('A'.repeat(50)).length).toBeLessThanOrEqual(32);
  });
});
