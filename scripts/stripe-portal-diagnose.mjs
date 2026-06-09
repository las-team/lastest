/**
 * READ-ONLY diagnostic: why is the "change plan" option missing from the
 * Customer Portal for a given customer? Prints the default portal config's
 * subscription_update settings, the customer's live subscriptions, their
 * prices, and any attached schedule. Makes no changes.
 *
 *   node scripts/stripe-portal-diagnose.mjs [customerId]
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

function keyFromEnvFile() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = txt.match(/^STRIPE_SECRET_KEY=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const KEY = process.env.STRIPE_SECRET_KEY || keyFromEnvFile();
const stripe = new Stripe(KEY, { typescript: true });
const CUSTOMER = process.argv[2] || "cus_UduQq0AUyjEoUg";

const cfgs = await stripe.billingPortal.configurations.list({
  is_default: true,
  limit: 1,
});
const cfg = cfgs.data[0];
const su = cfg?.features?.subscription_update;
console.error("=== default portal configuration ===");
console.error("id:", cfg?.id);
console.error("subscription_update.enabled:", su?.enabled);
console.error("default_allowed_updates:", su?.default_allowed_updates);
console.error("proration_behavior:", su?.proration_behavior);
console.error(
  "allowed products/prices:",
  JSON.stringify(su?.products ?? null, null, 2),
);

console.error(`\n=== subscriptions for ${CUSTOMER} ===`);
const subs = await stripe.subscriptions.list({
  customer: CUSTOMER,
  status: "all",
  limit: 100,
  expand: ["data.items.data.price", "data.schedule"],
});
for (const s of subs.data) {
  const item = s.items.data[0];
  console.error(`\nsub ${s.id} status=${s.status}`);
  console.error(`  price=${item?.price?.id} lookup=${item?.price?.lookup_key}`);
  console.error(`  cancel_at_period_end=${s.cancel_at_period_end}`);
  console.error(
    `  schedule=${typeof s.schedule === "string" ? s.schedule : (s.schedule?.id ?? null)}`,
  );
  // Is this price in the portal's allowed list?
  const allowed = (su?.products ?? []).some((p) =>
    p.prices.includes(item?.price?.id),
  );
  console.error(`  price in portal allowed list? ${allowed}`);
}
