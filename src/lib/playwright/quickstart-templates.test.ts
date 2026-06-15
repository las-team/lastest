import { describe, it, expect } from "vitest";
import {
  renderAuthSetupCode,
  renderAuthLoginCode,
  renderWalkthroughCode,
  renderQuickstartEmail,
  renderQuickstartPassword,
  utcStamp,
  slugify,
  SAFE_CTA_PATTERN,
  DESTRUCTIVE_CTA_PATTERN,
  CAPTCHA_LOCATOR,
  AUTH_CHAIN_FAILED_MARKER,
} from "./quickstart-templates";

const sampleEmail = "viktor+postbox202604030915@lastest.cloud";
const samplePassword = "Lastest-Demo-202604030915!";

describe("renderAuthSetupCode", () => {
  const code = renderAuthSetupCode({
    email: sampleEmail,
    password: samplePassword,
    registerUrl: "/sign-up",
  });

  it("exports the canonical 4-arg test function", () => {
    expect(code).toMatch(
      /export async function test\(page, baseUrl, screenshotPath, stepLogger\)/,
    );
  });

  it("handles relative registerUrl by prefixing baseUrl", () => {
    const rel = renderAuthSetupCode({
      email: sampleEmail,
      password: samplePassword,
      registerUrl: "/sign-up",
    });
    expect(rel).toMatch(/await page\.goto\(`\$\{baseUrl\}\/sign-up`/);
    expect(rel).not.toMatch(/baseUrl}https/);
  });

  it("handles absolute registerUrl (cross-subdomain auth) without prefixing baseUrl", () => {
    const abs = renderAuthSetupCode({
      email: sampleEmail,
      password: samplePassword,
      registerUrl: "https://auth.example.com/register",
    });
    expect(abs).toMatch(
      /await page\.goto\('https:\/\/auth\.example\.com\/register'/,
    );
    expect(abs).not.toMatch(/baseUrl\}https/);
  });

  it("does not URL-guess fallback paths (no /register, /signup, /users/register chain)", () => {
    // Only the observed registerUrl should appear, never the old fallback chain.
    expect(code).not.toMatch(/baseUrl\}\/register`.*\.catch/);
    expect(code).not.toMatch(/baseUrl\}\/users\/register/);
  });

  it("does not redeclare expect (provided as runner param)", () => {
    expect(code).not.toMatch(/\bconst\s+expect\s*=/);
    expect(code).not.toMatch(/\bimport[^;]*expect/);
  });

  it("inlines email + password literals as strings", () => {
    expect(code).toContain(sampleEmail);
    expect(code).toContain(samplePassword);
  });

  it("takes every screenshot at fullPage: true", () => {
    const matches = code.match(/page\.screenshot\([\s\S]*?\)\s*;/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toMatch(/fullPage:\s*true/);
    }
  });

  it("checks for captcha iframes before submitting", () => {
    expect(code).toContain(CAPTCHA_LOCATOR);
    expect(code).toMatch(/captcha-blocked on register page/);
  });

  it("throws on verify-email gate", () => {
    expect(code).toMatch(/verify-email gate detected after submit/);
  });

  it("uses pressSequentially (not .fill) so React-controlled inputs update", () => {
    expect(code).toMatch(/pressSequentially/);
  });
});

describe("renderWalkthroughCode — authed (chained storage state) mode", () => {
  const code = renderWalkthroughCode({
    authAutomatable: true,
    chainedAuth: true,
  });

  it("declares AUTH_AUTOMATABLE=true", () => {
    expect(code).toContain("const AUTH_AUTOMATABLE = true;");
  });

  it("does not contain an inline-login fallback block (no login-URL guessing)", () => {
    expect(code).not.toMatch(/Fallback: inline login/);
    expect(code).not.toMatch(/baseUrl\}\/login/);
    expect(code).not.toMatch(/baseUrl\}\/signin/);
    expect(code).not.toMatch(/baseUrl\}\/users\/sign_in/);
    expect(code).not.toMatch(/CHAINED_AUTH/);
  });

  it("reds the build via the auth-fail marker when the chain doesn't authenticate", () => {
    expect(code).toContain(AUTH_CHAIN_FAILED_MARKER);
    // The marker throw must sit OUTSIDE the best-effort try/catch so it surfaces
    // as a failed test rather than a swallowed warning. It captures an
    // 'auth-failed' frame just before throwing.
    expect(code).toMatch(/shot\(publicScenario, 'auth-failed'\)/);
    const markerIdx = code.indexOf(AUTH_CHAIN_FAILED_MARKER);
    const firstTryIdx = code.indexOf("try {");
    expect(markerIdx).toBeGreaterThan(-1);
    expect(firstTryIdx).toBeGreaterThan(-1);
    // throw appears before the first try block opens (gate runs before the walk).
    expect(markerIdx).toBeLessThan(firstTryIdx);
  });

  it("takes every screenshot at fullPage: true", () => {
    const matches = code.match(/page\.screenshot\([\s\S]*?\)\s*;/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toMatch(/fullPage:\s*true/);
    }
  });

  it("only uses safe-CTA verbs in the safeCta selector", () => {
    const safeCtaLine =
      code.match(/getByRole\('button', \{ name: \/\^.*?\$\/i \}\)/)?.[0] ??
      code
        .match(/getByRole\('button', \{ name: [^}]+\}\)/g)
        ?.find((s) =>
          /create|new|view|open|explore|browse|start|continue|get started/.test(
            s,
          ),
        );
    expect(safeCtaLine).toBeDefined();
    if (safeCtaLine) {
      expect(safeCtaLine).not.toMatch(DESTRUCTIVE_CTA_PATTERN);
    }
  });

  it("does not URL-guess /dashboard or similar — discovers via DOM", () => {
    expect(code).toMatch(/page\.\$\$eval/);
    expect(code).not.toMatch(/page\.goto\(`\$\{baseUrl\}\/dashboard`/);
  });

  it("uses baseUrl rather than hardcoding the target URL", () => {
    expect(code).not.toMatch(/https?:\/\//);
  });

  it("does not redeclare expect", () => {
    expect(code).not.toMatch(/\bconst\s+expect\s*=/);
  });
});

describe("renderWalkthroughCode — public-only mode", () => {
  const code = renderWalkthroughCode({
    authAutomatable: false,
    chainedAuth: false,
  });

  it("disables AUTH_AUTOMATABLE", () => {
    expect(code).toContain("const AUTH_AUTOMATABLE = false;");
  });

  it("still walks the public phase", () => {
    expect(code).toMatch(/Scenario 1: Homepage/);
    expect(code).toMatch(/page\.\$\$eval\('a\[href\]'/);
  });
});

describe("renderAuthLoginCode (user-credential login)", () => {
  const withApi = renderAuthLoginCode({
    email: "owner@myapp.com",
    password: "s3cret-pass",
    loginUrl: "/login",
    apiLoginEndpoint: "/api/auth/sign-in/email",
  });
  const noApi = renderAuthLoginCode({
    email: "owner@myapp.com",
    password: "s3cret-pass",
    loginUrl: "https://auth.example.com/sign-in",
  });

  it("exports the canonical 4-arg test function", () => {
    expect(withApi).toMatch(
      /export async function test\(page, baseUrl, screenshotPath, stepLogger\)/,
    );
  });

  it("inlines the supplied credentials", () => {
    expect(withApi).toContain("owner@myapp.com");
    expect(withApi).toContain("s3cret-pass");
  });

  it("navigates relative loginUrl via baseUrl and absolute loginUrl directly", () => {
    expect(withApi).toMatch(/await page\.goto\(`\$\{baseUrl\}\/login`/);
    expect(noApi).toMatch(
      /await page\.goto\('https:\/\/auth\.example\.com\/sign-in'/,
    );
  });

  it("does the api-login POST bypass when an endpoint is provided", () => {
    expect(withApi).toContain("/api/auth/sign-in/email");
    expect(withApi).toMatch(/fetch\(args\.url/);
  });

  it("bakes an empty API_LOGIN when no endpoint is provided", () => {
    expect(noApi).toMatch(/const API_LOGIN = '';/);
  });

  it("ships the EB bootstrap + hoisted settle", () => {
    expect(withApi).toMatch(/setExtraHTTPHeaders\(\{ 'User-Agent':/);
    expect(withApi).toContain("email-decode.min.js");
    expect(withApi).toMatch(/async function settle\(\)/);
  });

  it("screenshots fullPage everywhere", () => {
    const matches = withApi.match(/page\.screenshot\([\s\S]*?\)\s*;/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) expect(m).toMatch(/fullPage:\s*true/);
  });
});

describe("EB Chromium bootstrap (both renderers)", () => {
  const authCode = renderAuthSetupCode({
    email: sampleEmail,
    password: samplePassword,
    registerUrl: "/sign-up",
  });
  const walkCode = renderWalkthroughCode({
    authAutomatable: true,
    chainedAuth: true,
  });

  for (const [label, code] of [
    ["auth-setup", authCode],
    ["walkthrough", walkCode],
  ] as const) {
    it(`${label}: overrides the HeadlessChrome User-Agent before navigation`, () => {
      expect(code).toMatch(/setExtraHTTPHeaders\(\{ 'User-Agent':/);
      expect(code).toMatch(/Chrome\/\d/);
    });

    it(`${label}: route-blocks known third-party console-noise scripts`, () => {
      expect(code).toContain("email-decode.min.js");
      expect(code).toMatch(/page\.route\(pattern, function \(r\)/);
    });

    it(`${label}: settle is a hoisted function (not a scoped-out const arrow), with a hydration wait`, () => {
      expect(code).toMatch(/async function settle\(\)/);
      expect(code).not.toMatch(/const settle = \(\) =>/);
      expect(code).toMatch(/\[role="main"\]/);
    });
  }
});

describe("SAFE_CTA_PATTERN / DESTRUCTIVE_CTA_PATTERN", () => {
  it("matches additive verbs", () => {
    for (const verb of [
      "create",
      "new",
      "view",
      "open",
      "explore",
      "browse",
      "start",
      "continue",
      "get started",
    ]) {
      expect(verb).toMatch(SAFE_CTA_PATTERN);
    }
  });

  it("rejects destructive verbs", () => {
    for (const verb of [
      "delete",
      "pay",
      "subscribe",
      "upgrade",
      "scan",
      "import",
      "sync",
      "send",
    ]) {
      expect(verb).toMatch(DESTRUCTIVE_CTA_PATTERN);
    }
  });
});

describe("renderQuickstartEmail / renderQuickstartPassword / utcStamp / slugify", () => {
  it("substitutes {slug} and {stamp}", () => {
    const out = renderQuickstartEmail(
      "viktor+{slug}{stamp}@lastest.cloud",
      "postbox",
      "202604030915",
    );
    expect(out).toBe("viktor+postbox202604030915@lastest.cloud");
  });

  it("emits a 12-char UTC stamp", () => {
    const stamp = utcStamp(new Date(Date.UTC(2026, 3, 3, 9, 15)));
    expect(stamp).toBe("202604030915");
  });

  it("renders the canonical password format", () => {
    expect(renderQuickstartPassword("202604030915")).toBe(
      "Lastest-Demo-202604030915!",
    );
  });

  it("slugifies into kebab-case under 32 chars", () => {
    expect(slugify("Postbox HQ — Demo!")).toBe("postbox-hq-demo");
    expect(slugify("")).toBe("quickstart");
    expect(slugify("A".repeat(50)).length).toBeLessThanOrEqual(32);
  });
});
