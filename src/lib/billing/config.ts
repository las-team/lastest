/**
 * Billing configuration — just the early-adopter pricing flag.
 *
 * v1 has no admin gates: no dry-run flag, no review queue, no
 * threshold knobs. Plan price IDs live in `plans.ts`; the EA discount
 * window is the only operator-visible switch.
 */

/**
 * Early-adopter pricing window. When true (default), the UI surfaces
 * the discounted launch price and checkout uses the EA Stripe Price
 * IDs (with fall-through to full prices when EA isn't configured per
 * tier). Flip to "false" to display + charge catalog prices.
 */
export function isEarlyAdopterPricing(): boolean {
  return (
    (process.env.EARLY_ADOPTER_PRICING ?? "true").toLowerCase() !== "false"
  );
}
