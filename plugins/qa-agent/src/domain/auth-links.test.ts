import { describe, it, expect } from "vitest";
import { isAuthLink, looksLikeAuthUrl, matchAuthLinks } from "./auth-links";

describe("isAuthLink", () => {
  it("matches login/signin/signup/register in text or href", () => {
    expect(isAuthLink("Log in", "/whatever")).toBe(true);
    expect(isAuthLink("Sign In", "/x")).toBe(true);
    expect(isAuthLink("Sign up free", "/x")).toBe(true);
    expect(isAuthLink("Register", "/x")).toBe(true);
    expect(isAuthLink("Create an account", "/x")).toBe(true);
    expect(isAuthLink("", "/login")).toBe(true);
    expect(isAuthLink("", "/auth/sign-in")).toBe(true);
  });

  it("does not match unrelated links", () => {
    expect(isAuthLink("Pricing", "/pricing")).toBe(false);
    expect(isAuthLink("Blog", "/blog/sign-language")).toBe(false);
    expect(isAuthLink("Design tokens", "/design")).toBe(false);
  });
});

describe("looksLikeAuthUrl", () => {
  it("matches auth-page pathnames", () => {
    expect(looksLikeAuthUrl("/login")).toBe(true);
    expect(looksLikeAuthUrl("/sign-in")).toBe(true);
    expect(looksLikeAuthUrl("/signup")).toBe(true);
    expect(looksLikeAuthUrl("/register")).toBe(true);
    expect(looksLikeAuthUrl("/auth/callback")).toBe(true);
    expect(looksLikeAuthUrl("/app/login")).toBe(true);
  });

  it("does not match content paths containing auth-ish words", () => {
    expect(looksLikeAuthUrl("/blog/sign-language")).toBe(false);
    expect(looksLikeAuthUrl("/author/jane")).toBe(false);
    expect(looksLikeAuthUrl("/dashboard")).toBe(false);
    expect(looksLikeAuthUrl("/")).toBe(false);
  });
});

describe("matchAuthLinks", () => {
  const base = "https://app.example.com";

  it("picks login and signup from observed links (text and href)", () => {
    const { loginUrl, signupUrl } = matchAuthLinks(
      [
        { text: "Home", href: "/" },
        { text: "Sign in", href: "/session/new" },
        { text: "Get started", href: "/onboarding/create-account" },
      ],
      base,
    );
    expect(loginUrl).toBe("https://app.example.com/session/new");
    expect(signupUrl).toBe("https://app.example.com/onboarding/create-account");
  });

  it("ignores cross-origin and javascript links", () => {
    const { loginUrl, signupUrl } = matchAuthLinks(
      [
        { text: "Log in", href: "https://other.example.org/login" },
        { text: "Sign up", href: "javascript:void(0)" },
      ],
      base,
    );
    expect(loginUrl).toBeUndefined();
    expect(signupUrl).toBeUndefined();
  });

  it("returns nothing when no auth links are rendered (no guessing)", () => {
    const result = matchAuthLinks(
      [
        { text: "Docs", href: "/docs" },
        { text: "Pricing", href: "/pricing" },
      ],
      base,
    );
    expect(result.loginUrl).toBeUndefined();
    expect(result.signupUrl).toBeUndefined();
  });

  it("resolves relative hrefs against the base and strips hashes", () => {
    const { loginUrl } = matchAuthLinks(
      [{ text: "", href: "login#top" }],
      `${base}/deep/page`,
    );
    expect(loginUrl).toBe("https://app.example.com/deep/login");
  });

  it("a signup-only page yields no loginUrl", () => {
    const { loginUrl, signupUrl } = matchAuthLinks(
      [{ text: "Register", href: "/register" }],
      base,
    );
    expect(loginUrl).toBeUndefined();
    expect(signupUrl).toBe("https://app.example.com/register");
  });
});
