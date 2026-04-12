'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dismissConsentBanner } from '@/server/actions/consent';

export function ConsentBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function handleDismiss() {
    setDismissed(true);
    await dismissConsentBanner();
  }

  return (
    <div className="bg-muted/50 border-b px-4 py-3 flex items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground">
        We&apos;ve updated our{' '}
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground" target="_blank">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank">
          Privacy Policy
        </Link>
        . By continuing to use the service, you agree to the updated terms.
      </p>
      <Button variant="ghost" size="icon" className="shrink-0" onClick={handleDismiss}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
