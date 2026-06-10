"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { recordRegistrationConsent } from "@/server/actions/consent";
import { isValidShareSlug } from "@/lib/share/slug";
import { track } from "@/lib/analytics/umami";
import { Events } from "@/lib/analytics/events";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const rawClaim = searchParams.get("claim");
  const claim = rawClaim && isValidShareSlug(rawClaim) ? rawClaim : null;
  // Skip `/` — that path forces (app)/layout.tsx (WS bootstrap + 8 providers)
  // to compile just to redirect to /onboarding. Send new users straight there.
  const emailPostAuthUrl = claim ? `/r/${claim}/claim` : "/onboarding";
  const oauthPostAuthUrl = claim ? `/r/${claim}/claim` : "/consent";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
      const result = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
        setLoading(false);
        return;
      }

      try {
        await recordRegistrationConsent({ marketingEmails: marketingConsent });
      } catch (err) {
        // Consent recording is secondary — user is already signed up.
        console.error("recordRegistrationConsent failed", err);
      }

      track(Events.signup_completed, {
        method: "email",
        marketingOptIn: marketingConsent,
        claim: claim ? "true" : "false",
      });

      // Hard navigation — RSC swap was racing with router.refresh and the
      // freshly-set better-auth session cookie wasn't visible to the next
      // server fetch in some cases. window.location.href avoids both.
      // Keep `loading` true so the button stays disabled until the new page paints.
      window.location.href = emailPostAuthUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
      setLoading(false);
    }
  }

  async function handleOAuth(provider: SocialProvider) {
    await authClient.signIn.social({ provider, callbackURL: oauthPostAuthUrl });
  }

  return (
    <>
      <AuthBrandHeader
        title={claim ? "Claim this test" : "Create an account"}
        description={
          claim
            ? "Sign up and we'll copy the test into your own workspace — free."
            : "Get started with visual regression testing"
        }
      />

      <Card className="gap-5 py-6 shadow-sm">
        <CardContent className="space-y-5">
          <OAuthButtons
            onSelect={handleOAuth}
            dividerLabel="or sign up with email"
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
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
                id="terms"
                checked={termsAccepted}
                onCheckedChange={(checked) =>
                  setTermsAccepted(checked === true)
                }
                className="mt-0.5"
                required
              />
              <Label
                htmlFor="terms"
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
                htmlFor="marketing"
                className="text-sm font-normal text-muted-foreground leading-snug"
              >
                Send me product updates, tips, and feature announcements
              </Label>
              <Switch
                id="marketing"
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
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={claim ? `/login?claim=${claim}` : "/login"}
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
