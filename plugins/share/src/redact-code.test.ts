import { describe, it, expect } from "vitest";
import { redactCodeSecrets } from "./redact-code";

// The real payload reported as leaking on the public share page: a Supabase
// session baked into a top-level const, containing a JWT access_token, a Google
// `ya29.` provider_token, a refresh_token, and PII (email, user id).
const SUPABASE_SESSION_CODE = `export async function test(page, baseUrl, screenshotPath, stepLogger) {
  const SUPABASE_AUTH_TOKEN_KEY = 'sb-xbtyjdasuhnwpqjunbya-auth-token';
  const SUPABASE_SESSION_JSON = "{\\"provider_token\\":\\"ya29.a0AT3oNZ-aHmrgfmcJlLiBWDOxR7rxuE8BD\\",\\"access_token\\":\\"eyJhbGciOiJFUzI1NiIsImtpZCI6IjU4MGMwZTBjIn0.eyJlbWFpbCI6Imxhc3Rlc3RjbG91ZEBnbWFpbC5jb20ifQ.2GCZBYD7jkVP21LBMt0fz168Nl\\",\\"refresh_token\\":\\"opwd6x5e3xt3\\",\\"email\\":\\"lastestcloud@gmail.com\\"}";
  await page.goto(baseUrl);
}`;

describe("redactCodeSecrets", () => {
  it("masks every secret in a baked Supabase session blob", () => {
    const out = redactCodeSecrets(SUPABASE_SESSION_CODE);
    // No token material survives.
    expect(out).not.toContain("ya29.a0AT3oNZ");
    expect(out).not.toContain("eyJhbGci");
    expect(out).not.toContain("opwd6x5e3xt3");
    // PII riding alongside the tokens is gone too.
    expect(out).not.toContain("lastestcloud@gmail.com");
    // The masked const is collapsed to a bullet placeholder.
    expect(out).toContain("•••");
  });

  it("masks a bare JWT wherever it appears", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk";
    const out = redactCodeSecrets(`const t = "${jwt}";`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("•••");
  });

  it("masks a bare Google OAuth token", () => {
    const out = redactCodeSecrets(
      `const t = "ya29.a0AfH6SMBx7QeExampleTokenValue123456";`,
    );
    expect(out).not.toContain("ya29.a0AfH6SMBx7QeExampleTokenValue123456");
  });

  it("masks a value attached to a sensitive key in an object literal", () => {
    const out = redactCodeSecrets(`const cfg = { password: "hunter2!" };`);
    expect(out).not.toContain("hunter2!");
    expect(out).toContain("•••");
  });

  it("still redacts recorded .fill()/.type() payloads", () => {
    const out = redactCodeSecrets(
      `await page.fill("#email", "user@example.com");\nawait page.type("#pw", "s3cr3t");`,
    );
    expect(out).not.toContain("user@example.com");
    expect(out).not.toContain("s3cr3t");
    // Selectors (first arg) are preserved.
    expect(out).toContain("#email");
    expect(out).toContain("#pw");
  });

  it("does not over-redact benign UI strings", () => {
    const code = [
      `await page.getByRole("button", { name: "Show API key" }).click();`,
      `await expect(page.getByText("Enter your password")).toBeVisible();`,
      `await page.click("text=Reset token");`,
    ].join("\n");
    const out = redactCodeSecrets(code);
    expect(out).toContain("Show API key");
    expect(out).toContain("Enter your password");
    expect(out).toContain("Reset token");
    expect(out).not.toContain("•••");
  });

  it("preserves ordinary code and returns a string for empty input", () => {
    expect(redactCodeSecrets("")).toBe("");
    const code = `await page.goto("https://example.com/dashboard");`;
    expect(redactCodeSecrets(code)).toBe(code);
  });
});
