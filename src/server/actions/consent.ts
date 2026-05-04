'use server';

import { headers } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal/versions';
import { check as rateLimitCheck } from '@/lib/rate-limit/limiter';

// Per-IP gate on the (unauthenticated) account-existence probe used by the
// auto-signup flow. Throttle is intentionally tight — the legitimate caller
// fires once per failed sign-in, so 20/min/IP is more headroom than any real
// user needs while making bulk enumeration expensive.
const CHECK_EMAIL_LIMIT = Number(process.env.RATE_LIMIT_CHECK_EMAIL_PER_MIN || 20);
const CHECK_EMAIL_WINDOW_MS = 60_000;

export async function checkEmailExists(email: string): Promise<boolean> {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed) return false;

  const hdrs = await headers();
  const ip =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    hdrs.get('cf-connecting-ip')?.trim() ||
    hdrs.get('x-real-ip')?.trim() ||
    'unknown';
  const result = rateLimitCheck(`check-email:${ip}`, CHECK_EMAIL_LIMIT, CHECK_EMAIL_WINDOW_MS);
  if (!result.allowed) {
    // Caller (login page) treats false as "show signup form". Returning false
    // when throttled means a rate-limited attacker still can't extract truth.
    return false;
  }

  const user = await queries.getUserByEmail(trimmed);
  return Boolean(user);
}

export async function recordRegistrationConsent(data: { marketingEmails: boolean }) {
  const session = await requireAuth();
  const userId = session.user.id;
  const hdrs = await headers();
  const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? undefined;
  const userAgent = hdrs.get('user-agent') ?? undefined;

  // Record ToS and Privacy Policy consent (always granted at registration)
  await Promise.all([
    queries.recordConsent({
      userId,
      consentType: 'terms_of_service',
      granted: true,
      version: TERMS_VERSION,
      ipAddress,
      userAgent,
    }),
    queries.recordConsent({
      userId,
      consentType: 'privacy_policy',
      granted: true,
      version: PRIVACY_VERSION,
      ipAddress,
      userAgent,
    }),
    ...(data.marketingEmails
      ? [
          queries.recordConsent({
            userId,
            consentType: 'marketing_emails',
            granted: true,
            version: PRIVACY_VERSION,
            ipAddress,
            userAgent,
          }),
        ]
      : []),
  ]);
}

export async function updateMarketingConsent(enabled: boolean) {
  const session = await requireAuth();
  const userId = session.user.id;
  const hdrs = await headers();
  const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? undefined;
  const userAgent = hdrs.get('user-agent') ?? undefined;

  if (enabled) {
    await queries.recordConsent({
      userId,
      consentType: 'marketing_emails',
      granted: true,
      version: PRIVACY_VERSION,
      ipAddress,
      userAgent,
    });
  } else {
    await queries.revokeConsent(userId, 'marketing_emails');
  }
}

export async function getMyConsents() {
  const session = await requireAuth();
  return queries.getUserActiveConsents(session.user.id);
}

export async function dismissConsentBanner() {
  const session = await requireAuth();
  const userId = session.user.id;
  const hdrs = await headers();
  const ipAddress = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? undefined;
  const userAgent = hdrs.get('user-agent') ?? undefined;

  const existing = await queries.hasAcceptedTerms(userId);
  if (existing) return;

  await Promise.all([
    queries.recordConsent({
      userId,
      consentType: 'terms_of_service',
      granted: true,
      version: `${TERMS_VERSION}-migration`,
      ipAddress,
      userAgent,
    }),
    queries.recordConsent({
      userId,
      consentType: 'privacy_policy',
      granted: true,
      version: `${PRIVACY_VERSION}-migration`,
      ipAddress,
      userAgent,
    }),
  ]);
}
