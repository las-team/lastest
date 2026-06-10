/**
 * Enable plan changes (upgrade/downgrade) on the default Stripe Customer
 * Portal so the Manage page offers a "change plan" option next to Cancel.
 *
 * It sets `subscription_update.products` (the field that actually drives
 * the change-plan UI) to the charged prices, resolved by lookup_key from
 * EARLY_ADOPTER_PRICING. It then reads the config back and FAILS LOUDLY if
 * the products didn't persist.
 *
 * IMPORTANT: a *restricted* key (rk_test_/rk_live_) silently drops the
 * `products` field even though it accepts the rest of the call. Run this
 * with a FULL secret key (sk_test_/sk_live_), or set it in the Dashboard:
 * Settings -> Billing -> Customer portal -> "Customers can switch plans".
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-portal-enable-plan-change.mjs
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

function fromEnvFile(name) {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = txt.match(new RegExp(`^${name}=(.*)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const KEY = process.env.STRIPE_SECRET_KEY || fromEnvFile("STRIPE_SECRET_KEY");
if (!KEY) {
  console.error("STRIPE_SECRET_KEY not set and not found in .env.local");
  process.exit(1);
}
const EA =
  (
    process.env.EARLY_ADOPTER_PRICING ??
    fromEnvFile("EARLY_ADOPTER_PRICING") ??
    "true"
  ).toLowerCase() !== "false";
const stripe = new Stripe(KEY, { typescript: true });

if (KEY.startsWith("rk_")) {
  console.error(
    "WARNING: this is a RESTRICTED key (rk_). Stripe silently drops the\n" +
      "portal `products` field for restricted keys. Use a full sk_ key or the\n" +
      "Dashboard if the read-back below shows products did not persist.\n",
  );
}

// Resolve active prices by lookup_key → { id, product }.
const prices = {};
for await (const p of stripe.prices.list({ active: true, limit: 100 })) {
  if (p.lookup_key) prices[p.lookup_key] = { id: p.id, product: p.product };
}

const TIERS = ["starter", "growth", "pro"];
const products = TIERS.map((tier) => {
  const monthly = prices[EA ? `${tier}_monthly_ea` : `${tier}_monthly`];
  const yearly = prices[EA ? `${tier}_yearly_ea` : `${tier}_yearly`];
  if (!monthly || !yearly) {
    throw new Error(
      `Missing prices for ${tier} (EA=${EA}); run stripe-provision-test.mjs first`,
    );
  }
  return { product: monthly.product, prices: [monthly.id, yearly.id] };
});

const cfgs = await stripe.billingPortal.configurations.list({
  is_default: true,
  limit: 1,
});
if (!cfgs.data[0]) {
  console.error(
    "No default portal configuration found; run stripe-provision-test.mjs first",
  );
  process.exit(1);
}
const id = cfgs.data[0].id;

// Send the full dependent feature set: Stripe rejects subscription_update
// unless payment_method_update is also enabled.
const updated = await stripe.billingPortal.configurations.update(id, {
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: {
      enabled: true,
      allowed_updates: ["email", "name", "address"],
    },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price", "promotion_code"],
      proration_behavior: "always_invoice",
      products,
    },
  },
});

const persisted = updated.features.subscription_update.products;
console.error(`EA pricing: ${EA}`);
console.error(`config: ${id}`);
console.error(`products persisted: ${JSON.stringify(persisted) ?? "null"}`);

if (!persisted || persisted.length === 0) {
  console.error(
    "\n✗ products did NOT persist. The key lacks the scope to set portal\n" +
      "  products (restricted keys do). Fix it in the Dashboard:\n" +
      "  Settings -> Billing -> Customer portal -> Customers can switch plans\n" +
      "  -> add Starter, Growth, Pro (monthly + yearly).",
  );
  process.exit(2);
}
console.error("\n✓ Plan changes are now enabled on the Customer Portal.");
