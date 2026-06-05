/**
 * Stripe SDK client.
 *
 * Subscription lifecycle (create / cancel / restore / change-plan /
 * billing portal) is owned by the better-auth Stripe plugin, configured
 * in `src/lib/auth/auth.ts`. This module exists for the rare case where
 * a server action needs direct SDK access — there are none in v1, but
 * the export stays so future code that needs the client doesn't have
 * to re-wire the env-var plumbing.
 */
import Stripe from 'stripe';

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cachedClient = new Stripe(key, {
    typescript: true,
    appInfo: { name: 'lastest', version: '0.1.0' },
  });
  return cachedClient;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
