'use server';

import { headers } from 'next/headers';
import { requireAuth } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { TERMS_VERSION, PRIVACY_VERSION } from '@/lib/legal/versions';
import type { ConsentType } from '@/lib/db/schema';

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
