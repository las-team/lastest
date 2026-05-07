'use server';

import { randomBytes } from 'crypto';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { ensureDemoEnvironment, DEMO_EMAIL_DOMAIN } from '@/lib/auth/demo';

/**
 * Provisions a fresh, ephemeral demo user and signs them in.
 *
 * The better-auth `user.create` hook detects the `@demo.lastest.local` email
 * suffix and assigns the new user to the shared demo team (plan='demo').
 * The capability layer treats demo plan as read-only for every role, so
 * every `requireCapability` boundary in the server actions rejects mutations.
 *
 * Cookie propagation relies on the `nextCookies()` plugin already configured
 * on the better-auth instance — it forwards the session cookie to the server
 * action response so the client lands authenticated on its next navigation.
 */
export async function signInAsDemo(): Promise<{ ok: true } | { ok: false; error: string }> {
  // Make sure the demo team + sample repo exist before we create a user that
  // will be wired to them by the create hook.
  await ensureDemoEnvironment();

  const suffix = randomBytes(6).toString('hex');
  const email = `demo-${suffix}@${DEMO_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString('base64url');

  try {
    await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: 'Demo user',
      },
      headers: await headers(),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start demo session';
    return { ok: false, error: message };
  }
}
