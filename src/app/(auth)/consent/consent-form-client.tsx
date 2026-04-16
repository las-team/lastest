'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { recordRegistrationConsent } from '@/server/actions/consent';

export function ConsentFormClient() {
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    setLoading(true);
    await recordRegistrationConsent({ marketingEmails: marketingConsent });
    window.location.href = '/';
  }

  return (
    <div className="w-full max-w-sm space-y-6 px-4">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="text-sm text-muted-foreground">
          Please review our terms before continuing
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          By continuing, you agree to our{' '}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground" target="_blank">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank">
            Privacy Policy
          </Link>
          .
        </p>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="marketing" className="text-sm font-normal text-muted-foreground leading-snug">
            Send me product updates, tips, and feature announcements
          </Label>
          <Switch
            id="marketing"
            checked={marketingConsent}
            onCheckedChange={setMarketingConsent}
          />
        </div>

        <Button className="w-full" onClick={handleContinue} disabled={loading}>
          {loading ? 'Setting up...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
