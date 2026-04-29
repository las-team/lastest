'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth/auth-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthBrandHeader } from '@/components/auth/auth-brand-header';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      });
      setSubmitted(true);
    } catch {
      // Show success regardless to prevent email enumeration
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthBrandHeader
        title="Reset your password"
        description="Enter your email and we'll send you a reset link"
      />

      <Card className="gap-5 py-6 shadow-sm">
        <CardContent className="space-y-5">
          {submitted ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                If an account exists with that email, you&apos;ll receive a password reset link shortly.
              </p>
              <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
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

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {!submitted && (
        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{' '}
          <Link href="/login" className="text-primary font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </>
  );
}
