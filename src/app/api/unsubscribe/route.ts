import { NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
import * as queries from '@/lib/db/queries';

// One-click unsubscribe per RFC 8058 (List-Unsubscribe-Post header).
// Mail clients POST to the URL — we revoke consent without rendering UI.
export async function POST(request: Request) {
  let token: string | null = null;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    token = (form.get('token') as string | null) ?? null;
  }
  if (!token) {
    token = new URL(request.url).searchParams.get('token');
  }

  const payload = token ? verifyUnsubscribeToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const user = await queries.getUserByEmail(payload.email);
  if (user) {
    await queries.revokeConsent(user.id, 'marketing_emails');
  }
  return NextResponse.json({ success: true });
}
