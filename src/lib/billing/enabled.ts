import "server-only";

/**
 * True when this deployment has billing wired up at all.
 *
 * Self-hosted installs run without `STRIPE_SECRET_KEY` (see the Stripe plugin
 * no-op in `src/lib/auth/auth.ts`), which leaves every team permanently on the
 * `free` plan with no route to upgrade. Feature gates consult this so a missing
 * Stripe config reads as "unmetered install" rather than "locked out forever".
 *
 * Kept in its own module — separate from `stripe.ts` — so callers can ask the
 * question without pulling the Stripe SDK into their import graph, and marked
 * `server-only` so it can never be evaluated in a client bundle where the env
 * var is absent and the answer would silently flip.
 */
export function isBillingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
