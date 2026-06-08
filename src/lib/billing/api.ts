/**
 * Typed shim around the better-auth Stripe plugin endpoints.
 *
 * The plugin is registered conditionally (`buildStripePlugin()` in
 * `src/lib/auth/auth.ts` returns `[]` when `STRIPE_SECRET_KEY` is
 * unset) so TypeScript can't statically see the `auth.api.upgrade*`
 * surface. This module exposes typed wrappers via narrow casts —
 * runtime errors when stripe is unconfigured are caught by the
 * server actions, which check `isStripeConfigured()` first.
 */
import { auth } from "@/lib/auth/auth";

type AuthApiAny = typeof auth.api &
  Record<string, (...args: unknown[]) => Promise<unknown>>;

interface UpgradeBody {
  plan: string;
  customerType?: "user" | "organization";
  referenceId?: string;
  /**
   * Pin the plan change to a SPECIFIC Stripe subscription id. The plugin
   * otherwise decides "update vs new Checkout" from our local
   * `subscription` table; when that row is briefly out of sync it can
   * create a second subscription. Passing the live Stripe id forces the
   * in-place update path (plugin index.mjs:709).
   */
  subscriptionId?: string;
  successUrl?: string;
  cancelUrl?: string;
  /**
   * Where the Stripe billing portal sends the user back after a plan
   * change on an EXISTING subscription. The plugin's portal path reads
   * this (not successUrl/cancelUrl, which are Checkout-only) and
   * defaults to "/" when absent.
   */
  returnUrl?: string;
  disableRedirect?: boolean;
  annual?: boolean;
  seats?: number;
  /**
   * Apply the plan change at the END of the current billing period via
   * a Stripe subscription schedule (no proration, nothing due today).
   * Used for downgrades — the customer keeps what they paid for.
   */
  scheduleAtPeriodEnd?: boolean;
}

interface CancelBody {
  referenceId?: string;
  customerType?: "user" | "organization";
  returnUrl: string;
}

interface RestoreBody {
  referenceId?: string;
  customerType?: "user" | "organization";
}

interface PortalBody {
  referenceId?: string;
  customerType?: "user" | "organization";
  returnUrl: string;
}

interface UrlResult {
  url?: string;
  redirect?: boolean;
}

export async function callUpgradeSubscription(
  body: UpgradeBody,
  headers: Headers,
): Promise<UrlResult> {
  const api = auth.api as AuthApiAny;
  if (typeof api.upgradeSubscription !== "function") {
    throw new Error("Stripe billing is not configured on this instance.");
  }
  return (await api.upgradeSubscription({
    body,
    headers,
  } as never)) as UrlResult;
}

export async function callCancelSubscription(
  body: CancelBody,
  headers: Headers,
): Promise<UrlResult> {
  const api = auth.api as AuthApiAny;
  if (typeof api.cancelSubscription !== "function") {
    throw new Error("Stripe billing is not configured on this instance.");
  }
  return (await api.cancelSubscription({
    body,
    headers,
  } as never)) as UrlResult;
}

export async function callRestoreSubscription(
  body: RestoreBody,
  headers: Headers,
): Promise<void> {
  const api = auth.api as AuthApiAny;
  if (typeof api.restoreSubscription !== "function") {
    throw new Error("Stripe billing is not configured on this instance.");
  }
  await api.restoreSubscription({ body, headers } as never);
}

export async function callBillingPortal(
  body: PortalBody,
  headers: Headers,
): Promise<UrlResult> {
  const api = auth.api as AuthApiAny;
  if (typeof api.createBillingPortal !== "function") {
    throw new Error("Stripe billing is not configured on this instance.");
  }
  return (await api.createBillingPortal({
    body,
    headers,
  } as never)) as UrlResult;
}
