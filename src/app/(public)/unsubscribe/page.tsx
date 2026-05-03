import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Check, X } from 'lucide-react';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import * as queries from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

// Confirms via POST so anti-phishing prefetchers (Outlook Safe Links, Gmail
// previews, antivirus scanners) can't silently revoke consent on a GET — they
// follow GETs but skip form submissions.
async function confirmUnsubscribe(formData: FormData) {
  'use server';
  const token = formData.get('token');
  if (typeof token !== 'string') return;
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return;
  const user = await queries.getUserByEmail(payload.email);
  if (user) {
    await queries.revokeConsent(user.id, 'marketing_emails');
  }
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; confirmed?: string }>;
}) {
  const { token, confirmed } = await searchParams;
  const payload = token ? verifyUnsubscribeToken(token) : null;

  if (!payload) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <X className="h-5 w-5 text-destructive" />
              <Mail className="h-5 w-5" />
              Invalid unsubscribe link
            </CardTitle>
            <CardDescription>
              This unsubscribe link is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You can manage all email preferences from your{' '}
              <Link href="/settings#email-preferences" className="underline underline-offset-4 hover:text-foreground">
                account settings
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (confirmed === '1') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              <Mail className="h-5 w-5" />
              Unsubscribed
            </CardTitle>
            <CardDescription>
              {payload.email} has been unsubscribed from marketing emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You will continue to receive transactional emails (password resets, security alerts,
              invitations) — those are required to operate your account.
            </p>
            <p className="text-sm text-muted-foreground">
              You can manage all email preferences from your{' '}
              <Link href="/settings#email-preferences" className="underline underline-offset-4 hover:text-foreground">
                account settings
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleConfirm(formData: FormData) {
    'use server';
    await confirmUnsubscribe(formData);
    redirect(`/unsubscribe?token=${encodeURIComponent(token!)}&confirmed=1`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Unsubscribe from marketing emails
          </CardTitle>
          <CardDescription>
            Confirm to stop receiving marketing emails sent to {payload.email}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={handleConfirm}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Unsubscribe {payload.email}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            Transactional emails (password resets, security alerts, invitations) will continue —
            they are required to operate your account.
          </p>
          <p className="text-sm text-muted-foreground">
            Or manage all email preferences from your{' '}
            <Link href="/settings#email-preferences" className="underline underline-offset-4 hover:text-foreground">
              account settings
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
