'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Github } from 'lucide-react';
import { AuthBrandHeader } from '@/components/auth/auth-brand-header';
import { isValidShareSlug } from '@/lib/share/slug';
import { checkEmailExists, recordRegistrationConsent } from '@/server/actions/consent';
import { track } from '@/lib/analytics/umami';
import { Events } from '@/lib/analytics/events';

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
  const rawClaim = searchParams.get('claim');
  const claim = rawClaim && isValidShareSlug(rawClaim) ? rawClaim : null;
  // `returnTo` lets flows like /oauth/authorize bounce through login and come
  // back. Only same-origin relative paths are honored (no open redirect).
  const rawReturnTo = searchParams.get('returnTo');
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : null;
  const emailPostAuthUrl = returnTo ?? (claim ? `/r/${claim}/claim` : '/');
  const signupPostAuthUrl = returnTo ?? (claim ? `/r/${claim}/claim` : '/onboarding');
  const oauthPostAuthUrl = returnTo ?? (claim ? `/r/${claim}/claim` : '/consent');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-signup state — entered when signin fails because the email doesn't exist.
  const [signupMode, setSignupMode] = useState(false);
  const [name, setName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await authClient.signIn.email({ email, password });

    if (result.error) {
      const exists = await checkEmailExists(email).catch(() => true);
      if (!exists) {
        setSignupMode(true);
        setError('');
        setLoading(false);
        return;
      }
      setError(result.error.message ?? 'Sign in failed');
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
    setError('');

    if (!termsAccepted) {
      setError('Please accept the Terms of Service and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setError(result.error.message ?? 'Sign up failed');
        return;
      }

      try {
        await recordRegistrationConsent({ marketingEmails: marketingConsent });
      } catch (err) {
        console.error('recordRegistrationConsent failed', err);
      }

      track(Events.signup_completed, {
        method: 'email',
        marketingOptIn: marketingConsent,
        claim: claim ? 'true' : 'false',
        source: 'login-auto-signup',
      });

      window.location.href = signupPostAuthUrl;
      return;
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: 'github' | 'google' | 'discord') {
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
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  className="mt-0.5"
                  required
                />
                <Label htmlFor="signup-terms" className="text-sm font-normal text-muted-foreground leading-snug">
                  I have read and agree to the{' '}
                  <Link href="/terms" className="underline underline-offset-4 hover:text-foreground" target="_blank">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank">
                    Privacy Policy
                  </Link>
                  .
                </Label>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="signup-marketing" className="text-sm font-normal text-muted-foreground leading-snug">
                  Send me product updates, tips, and feature announcements
                </Label>
                <Switch
                  id="signup-marketing"
                  checked={marketingConsent}
                  onCheckedChange={setMarketingConsent}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading || !termsAccepted}>
                {loading ? 'Creating account...' : 'Create account'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={loading}
                onClick={() => {
                  setSignupMode(false);
                  setError('');
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
            : 'Sign in to your account to continue'
        }
      />

      <Card className="gap-5 py-6 shadow-sm">
        <CardContent className="space-y-5">
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => handleOAuth('github')}
            >
              <Github className="mr-2 h-4 w-4" />
              GitHub
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleOAuth('google')}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => handleOAuth('discord')}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
                  fill="#5865F2"
                />
              </svg>
              Discord
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or continue with email</span>
            </div>
          </div>

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

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link
          href={claim ? `/register?claim=${claim}` : '/register'}
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}
