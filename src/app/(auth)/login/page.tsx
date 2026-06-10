"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthBrandHeader } from "@/components/auth/auth-brand-header";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import type { SocialProvider } from "@/lib/auth/social-providers";
import { isValidShareSlug } from "@/lib/share/slug";
import {
  checkEmailExists,
  recordRegistrationConsent,
} from "@/server/actions/consent";
import { track } from "@/lib/analytics/umami";
import { Events } from "@/lib/analytics/events";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawClaim = searchParams.get("claim");
  const claim = rawClaim && isValidShareSlug(rawClaim) ? rawClaim : null;
  // `returnTo` lets flows like /oauth/authorize bounce through login and come
  // back. Only same-origin relative paths are honored (no open redirect).
  const rawReturnTo = searchParams.get("returnTo");
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;
  const emailPostAuthUrl = returnTo ?? (claim ? `/r/${claim}/claim` : "/");
  const signupPostAuthUrl =
    returnTo ?? (claim ? `/r/${claim}/claim` : "/onboarding");
  const oauthPostAuthUrl =
    returnTo ?? (claim ? `/r/${claim}/claim` : "/consent");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-signup state — entered when signin fails because the email doesn't exist.
  const [signupMode, setSignupMode] = useState(false);
  const [name, setName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await authClient.signIn.email({ email, password });

    if (result.error) {
      const exists = await checkEmailExists(email).catch(() => true);
      if (!exists) {
        setSignupMode(true);
        setError("");
        setLoading(false);
        return;
      }
      setError(result.error.message ?? "Sign in failed");
      setLoading(false);
      return;
    }

    // returnTo may point at a route handler (e.g. /oauth/authorize) that the
    // client router can't render — use a hard navigation in that case.
    if (returnTo) {
      window.location.href = emailPostAuthUrl;
      return;
    }
    router.push(emailPostAuthUrl);
    router.refresh();
  }

  async function handleAutoSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!termsAccepted) {
      setError(
        "Please accept the Terms of Service and Privacy Policy to continue.",
      );
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
        return;
      }

      try {
        await recordRegistrationConsent({ marketingEmails: marketingConsent });
      } catch (err) {
        console.error("recordRegistrationConsent failed", err);
      }

      track(Events.signup_completed, {
        method: "email",
        marketingOptIn: marketingConsent,
        claim: claim ? "true" : "false",
        source: "login-auto-signup",
      });

      window.location.href = signupPostAuthUrl;
      return;
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: SocialProvider) {
    await authClient.signIn.social({ provider, callbackURL: oauthPostAuthUrl });
  }

  if (signupMode) {
    return (
      <>
        <AuthBrandHeader
          title="Create your account"
          description={`We didn't find an account for ${email}. Finish setting one up to continue.`}
        />

        <Card className="gap-5 py-6 shadow-sm">
          <CardContent className="space-y-5">
            <form onSubmit={handleAutoSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Name</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="signup-terms"
                  checked={termsAccepted}
                  onCheckedChange={(checked) =>
                    setTermsAccepted(checked === true)
                  }
                  className="mt-0.5"
                  required
                />
                <Label
                  htmlFor="signup-terms"
                  className="text-sm font-normal text-muted-foreground leading-snug"
                >
                  I have read and agree to the{" "}
                  <Link
                    href="/terms"
                    className="underline underline-offset-4 hover:text-foreground"
                    target="_blank"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className="underline underline-offset-4 hover:text-foreground"
                    target="_blank"
                  >
                    Privacy Policy
                  </Link>
                  .
                </Label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="signup-marketing"
                  className="text-sm font-normal text-muted-foreground leading-snug"
                >
                  Send me product updates, tips, and feature announcements
                </Label>
                <Switch
                  id="signup-marketing"
                  checked={marketingConsent}
                  onCheckedChange={setMarketingConsent}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !termsAccepted}
              >
                {loading ? "Creating account..." : "Create account"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={() => {
                  setSignupMode(false);
                  setError("");
                }}
              >
                Back to sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <AuthBrandHeader
        title="Welcome back"
        description={
          claim
            ? "Sign in to claim the test that's been shared with you."
            : "Sign in to your account to continue"
        }
      />

      <Card className="gap-5 py-6 shadow-sm">
        <CardContent className="space-y-5">
          <OAuthButtons
            onSelect={handleOAuth}
            dividerLabel="or continue with email"
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-4"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href={claim ? `/register?claim=${claim}` : "/register"}
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}
