'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Mail } from 'lucide-react';
import { getMyConsents, updateMarketingConsent } from '@/server/actions/consent';

export function EmailPreferencesCard() {
  const [marketingEnabled, setMarketingEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyConsents().then((consents) => {
      const hasMarketing = consents.some(
        (c) => c.consentType === 'marketing_emails' && c.granted && !c.revokedAt
      );
      setMarketingEnabled(hasMarketing);
      setLoaded(true);
    });
  }, []);

  async function handleToggle(enabled: boolean) {
    setMarketingEnabled(enabled);
    setSaving(true);
    await updateMarketingConsent(enabled);
    setSaving(false);
  }

  if (!loaded) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Preferences
        </CardTitle>
        <CardDescription>Manage your email communication preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="marketing-toggle" className="text-sm font-medium">
              Marketing emails
            </Label>
            <p className="text-xs text-muted-foreground">
              Receive product updates, tips, tutorials, and feature announcements
            </p>
          </div>
          <Switch
            id="marketing-toggle"
            checked={marketingEnabled}
            onCheckedChange={handleToggle}
            disabled={saving}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Transactional emails (password resets, security alerts) are always sent regardless of this setting.{' '}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank">
            Privacy Policy
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
