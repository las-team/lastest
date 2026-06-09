#!/usr/bin/env node
/**
 * One-shot Stripe TEST-mode provisioner for the dynamic billing catalog.
 *
 * Creates one Product per purchasable tier (Starter / Growth / Pro)
 * carrying the metadata contract the app reads at runtime
 * (src/lib/billing/catalog.ts):
 *
 *   - metadata: tier, monthly_run_quota, project_limit,
 *     concurrent_run_limit, tagline
 *   - marketing_features: the feature bullets shown in the billing UI
 *
 * plus four recurring Prices each with lookup keys:
 *
 *   {tier}_monthly  {tier}_monthly_ea  {tier}_yearly  {tier}_yearly_ea
 *
 * No env vars to copy afterwards — the app discovers all of this via
 * the Stripe API. Re-running is safe: products are matched by tier
 * metadata and updated in place; a price whose amount changed gets a
 * fresh Price with the lookup key transferred, and the stale one is
 * archived so the catalog stays unambiguous.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_test_... node scripts/stripe-provision-test.mjs
 *
 * Accepts a test-mode restricted key (rk_test_, needs Products + Prices
 * write) or a test-mode secret key (sk_test_). Live keys are refused.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY=sk_test_... and re-run.");
  process.exit(1);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error(
    "Refusing to run against a non-test key (expected sk_test_... or rk_test_...).",
  );
  process.exit(1);
}

const stripe = new Stripe(key);

// Mirror of the static fallback in src/lib/billing/plans.ts — after
// provisioning, the *Stripe side* is the source of truth and edits
// should happen in the dashboard.
const TIERS = [
  {
    tier: "starter",
    productName: "Lastest Starter",
    tagline:
      "Solo devs & small teams — for builders shipping regularly. Locked-in early adopter price.",
    monthly: 2900,
    monthlyEA: 1400,
    yearly: 29000,
    yearlyEA: 14000,
    monthlyRunQuota: 5000,
    projectLimit: "3",
    concurrentRunLimit: 2,
    features: [
      "3 projects",
      "5,000 priority run-minutes",
      "2 concurrent runs",
      "Email support",
    ],
  },
  {
    tier: "growth",
    productName: "Lastest Growth",
    tagline:
      "Growing teams + CI — multiple apps, CI pipelines, Slack-speed support.",
    monthly: 9900,
    monthlyEA: 4950,
    yearly: 99000,
    yearlyEA: 49500,
    monthlyRunQuota: 30000,
    projectLimit: "10",
    concurrentRunLimit: 5,
    features: [
      "10 projects",
      "30,000 priority run-minutes",
      "5 concurrent runs",
      "Slack support",
      "CI integrations (GitHub, GitLab, Bitbucket)",
      "Cross-browser add-on €49 / mo",
    ],
  },
  {
    tier: "pro",
    productName: "Lastest Pro",
    tagline:
      "Larger teams + SSO — capacity, SSO, and priority response for serious teams.",
    monthly: 29900,
    monthlyEA: 14950,
    yearly: 299000,
    yearlyEA: 149500,
    monthlyRunQuota: 120000,
    projectLimit: "unlimited",
    concurrentRunLimit: 15,
    features: [
      "Unlimited projects (reasonable quotas)",
      "120,000 priority run-minutes",
      "15 concurrent runs",
      "SSO / SAML",
      "Priority support",
      "Custom cross-browser pricing",
    ],
  },
];

async function findOrCreateProduct(spec) {
  const payload = {
    name: spec.productName,
    // Managed Payments requires an eligible tax code on every product —
    // checkout fails with "the product tax code is missing" otherwise.
    // txcd_10103001 = Software as a service (SaaS) — business use.
    tax_code: "txcd_10103001",
    metadata: {
      tier: spec.tier,
      tagline: spec.tagline,
      monthly_run_quota: String(spec.monthlyRunQuota),
      project_limit: spec.projectLimit,
      concurrent_run_limit: String(spec.concurrentRunLimit),
    },
    marketing_features: spec.features.map((name) => ({ name })),
  };
  const existing = await stripe.products.search({
    query: `active:"true" AND metadata["tier"]:"${spec.tier}"`,
  });
  if (existing.data[0]) {
    return stripe.products.update(existing.data[0].id, payload);
  }
  return stripe.products.create(payload);
}

async function ensurePrice(
  product,
  lookupKey,
  amountCents,
  interval,
  nickname,
  isEa,
) {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });
  const current = existing.data[0];
  if (
    current &&
    current.active &&
    current.product === product.id &&
    current.unit_amount === amountCents &&
    current.currency === "eur" &&
    current.recurring?.interval === interval
  ) {
    // tax_behavior is settable while 'unspecified' (immutable after) —
    // upgrade kept prices in place instead of replacing them.
    if (current.tax_behavior === "unspecified") {
      const fixed = await stripe.prices.update(current.id, {
        tax_behavior: "exclusive",
      });
      return { price: fixed, action: "kept (tax_behavior→exclusive)" };
    }
    return { price: current, action: "kept" };
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amountCents,
    currency: "eur",
    recurring: { interval },
    nickname,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    // Tax is charged ON TOP of the listed price (€14 + VAT), never
    // carved out of it. Without this, "unspecified" falls back to the
    // account default, which can silently flip to tax-inclusive.
    tax_behavior: "exclusive",
    metadata: isEa ? { ea: "true" } : {},
  });
  // Archive the superseded price so the app's catalog (active prices
  // only) never sees two candidates for the same slot. Existing
  // subscriptions on the old price keep renewing — archive only blocks
  // *new* checkouts.
  if (current && current.active) {
    await stripe.prices.update(current.id, { active: false });
    return { price, action: "replaced" };
  }
  return { price, action: "created" };
}

/**
 * Configure the default Customer Portal so the flows the app relies on
 * actually work:
 *  - subscription_update: the better-auth Stripe plugin routes plan
 *    changes on an existing subscription through the portal's update
 *    flow — without this enabled (plus the allowed product/price list),
 *    upgrades fail with "subscription update feature in the portal
 *    configuration is disabled".
 *  - subscription_cancel (at period end): the Cancel button flow.
 *  - Also saves the configuration, which test mode requires once before
 *    any portal session can be created at all.
 */
async function ensurePortalConfiguration(productPrices) {
  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: {
      enabled: true,
      allowed_updates: ["email", "name", "address"],
    },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price", "promotion_code"],
      // `always_invoice` bills the prorated difference immediately at
      // confirm, so the user sees the remaining-days credit for their
      // current plan right on the portal confirm page. The default
      // `create_prorations` silently defers the credit to the next
      // invoice, which looks like "no discount" at upgrade time.
      proration_behavior: "always_invoice",
      products: productPrices.map(({ productId, priceIds }) => ({
        product: productId,
        prices: priceIds,
      })),
    },
  };
  const existing = await stripe.billingPortal.configurations.list({
    is_default: true,
    limit: 1,
  });
  if (existing.data[0]) {
    const cfg = await stripe.billingPortal.configurations.update(
      existing.data[0].id,
      { features },
    );
    return { cfg, action: "updated" };
  }
  const cfg = await stripe.billingPortal.configurations.create({
    features,
    business_profile: { headline: "Lastest — visual regression testing" },
  });
  return { cfg, action: "created" };
}

const portalProducts = [];
for (const spec of TIERS) {
  const product = await findOrCreateProduct(spec);
  console.error(`✓ ${spec.productName} (${product.id}) tier=${spec.tier}`);

  const prices = [
    [`${spec.tier}_monthly`, spec.monthly, "month", "Monthly (full)", false],
    [
      `${spec.tier}_monthly_ea`,
      spec.monthlyEA,
      "month",
      "Monthly (early adopter)",
      true,
    ],
    [`${spec.tier}_yearly`, spec.yearly, "year", "Yearly (full)", false],
    [
      `${spec.tier}_yearly_ea`,
      spec.yearlyEA,
      "year",
      "Yearly (early adopter)",
      true,
    ],
  ];
  const byKey = {};
  for (const [lookupKey, amount, interval, nickname, isEa] of prices) {
    const { price, action } = await ensurePrice(
      product,
      lookupKey,
      amount,
      interval,
      nickname,
      isEa,
    );
    byKey[lookupKey] = price.id;
    console.error(
      `  ✓ ${lookupKey}: €${(amount / 100).toFixed(2)}/${interval} → ${price.id} (${action})`,
    );
  }
  // The portal allows only ONE price per billing interval per product, so
  // pick the pair the app actually charges: EA prices while the early-
  // adopter window is open (EARLY_ADOPTER_PRICING != false), full prices
  // after. Re-run this script when flipping the flag.
  const ea =
    (process.env.EARLY_ADOPTER_PRICING ?? "true").toLowerCase() !== "false";
  portalProducts.push({
    productId: product.id,
    priceIds: [
      ea ? byKey[`${spec.tier}_monthly_ea`] : byKey[`${spec.tier}_monthly`],
      ea ? byKey[`${spec.tier}_yearly_ea`] : byKey[`${spec.tier}_yearly`],
    ],
  });
}

const { cfg, action: portalAction } =
  await ensurePortalConfiguration(portalProducts);
console.error(
  `✓ Customer Portal configuration ${cfg.id} (${portalAction}): subscription update + cancel enabled`,
);

console.error("\nDone. The app discovers this catalog via the Stripe API —");
console.error("no STRIPE_PRICE_ID_* env vars needed. Edit prices/features in");
console.error(
  "the Stripe dashboard; changes appear within one webhook delivery",
);
console.error("(or the 10-minute cache TTL).");
