'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { recordRegistrationConsent } from '@/server/actions/consent';

export function ConsentFormClient({ nextUrl = '/' }: { nextUrl?: string }) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    if (!termsAccepted) return;
    setLoading(true);
    try {
      await recordRegistrationConsent({ marketingEmails: marketingConsent });
    } catch (err) {
      console.error('recordRegistrationConsent failed', err);
    }
    window.location.href = nextUrl;
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
        <div className="flex items-start gap-2">
          <Checkbox
            id="terms"
            checked={termsAccepted}
            onCheckedChange={(checked) => setTermsAccepted(checked === true)}
            className="mt-0.5"
          />
          <Label htmlFor="terms" className="text-sm font-normal text-muted-foreground leading-snug">
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
          <Label htmlFor="marketing" className="text-sm font-normal text-muted-foreground leading-snug">
            Send me product updates, tips, and feature announcements
          </Label>
          <Switch
            id="marketing"
            checked={marketingConsent}
            onCheckedChange={setMarketingConsent}
          />
        </div>

        <Button className="w-full" onClick={handleContinue} disabled={loading || !termsAccepted}>
          {loading ? 'Setting up...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}
