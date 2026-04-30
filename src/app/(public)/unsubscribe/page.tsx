import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Check, X } from 'lucide-react';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import * as queries from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? verifyUnsubscribeToken(token) : null;

  let status: 'success' | 'invalid' = 'invalid';
  let email: string | null = null;

  if (payload) {
    email = payload.email;
    const user = await queries.getUserByEmail(payload.email);
    if (user) {
      await queries.revokeConsent(user.id, 'marketing_emails');
    }
    status = 'success';
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'success' ? (
              <Check className="h-5 w-5 text-green-500" />
            ) : (
              <X className="h-5 w-5 text-destructive" />
            )}
            <Mail className="h-5 w-5" />
            {status === 'success' ? 'Unsubscribed' : 'Invalid unsubscribe link'}
          </CardTitle>
          <CardDescription>
            {status === 'success'
              ? `${email} has been unsubscribed from marketing emails.`
              : 'This unsubscribe link is invalid or has expired.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'success' && (
            <p className="text-sm text-muted-foreground">
              You will continue to receive transactional emails (password resets, security alerts,
              invitations) — those are required to operate your account.
            </p>
          )}
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
