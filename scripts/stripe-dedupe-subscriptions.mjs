/**
 * One-off cleanup: cancel duplicate Stripe subscriptions so each customer
 * (team) holds at most ONE live subscription.
 *
 * Background: a local-DB sync gap let the better-auth Stripe plugin create
 * a second subscription on the same customer (see
 * src/server/actions/billing.ts safeguards, added to prevent recurrence).
 * This script finds customers with more than one live subscription, KEEPS
 * the highest-ranked tier, and cancels the rest.
 *
 * SAFE BY DEFAULT: dry-run unless you pass `--apply`. Runs against
 * whatever STRIPE_SECRET_KEY points at (test vs live), so check the key
 * prefix in the banner before applying.
 *
 *   # dry run (prints what it WOULD cancel):
 *   STRIPE_SECRET_KEY=rk_test_... node scripts/stripe-dedupe-subscriptions.mjs
 *
 *   # actually cancel the duplicates:
 *   STRIPE_SECRET_KEY=rk_test_... node scripts/stripe-dedupe-subscriptions.mjs --apply
 *
 *   # cancel at period end instead of immediately:
 *   ... --apply --at-period-end
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";

// Allow running without exporting the key: fall back to .env.local.
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
if (!KEY) {
  console.error("STRIPE_SECRET_KEY not set and not found in .env.local");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const AT_PERIOD_END = process.argv.includes("--at-period-end");
const LIVE_MODE = KEY.includes("_live_");

const stripe = new Stripe(KEY, { typescript: true });

// Statuses that mean a subscription still "occupies" the customer. Mirrors
// OCCUPYING_SUB_STATUSES in src/server/actions/billing.ts.
const OCCUPYING = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

// Tier ranking from product metadata.tier (set by stripe-provision-test.mjs).
const TIER_RANK = { free: 0, starter: 1, growth: 2, pro: 3 };

function monthlyNormalizedAmount(sub) {
  const item = sub.items.data[0];
  const price = item?.price;
  if (!price?.unit_amount) return 0;
  const qty = item.quantity ?? 1;
  const interval = price.recurring?.interval;
  const count = price.recurring?.interval_count ?? 1;
  let monthly = price.unit_amount * qty;
  if (interval === "year") monthly = monthly / (12 * count);
  else if (interval === "week") monthly = monthly * (52 / 12 / count);
  else if (interval === "day") monthly = monthly * (365 / 12 / count);
  else monthly = monthly / count; // month
  return monthly;
}

// Tier from the price lookup_key (e.g. "starter_monthly", "pro_yearly_ea")
// set by stripe-provision-test.mjs — avoids expanding the product (Stripe
// caps expansion at 4 levels).
function tierOf(sub) {
  const lk = sub.items.data[0]?.price?.lookup_key;
  const tier = lk ? lk.split("_")[0] : undefined;
  return tier && tier in TIER_RANK ? tier : undefined;
}

// Higher score = better to KEEP. Prefer higher tier, then higher monthly
// amount, then newer (created later).
function keepScore(sub) {
  const tier = tierOf(sub);
  const tierRank = tier ? TIER_RANK[tier] : -1;
  return [tierRank, monthlyNormalizedAmount(sub), sub.created];
}

function cmpScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function* allLiveSubscriptions() {
  for await (const sub of stripe.subscriptions.list({
    status: "all",
    limit: 100,
    expand: ["data.items.data.price"],
  })) {
    if (OCCUPYING.has(sub.status)) yield sub;
  }
}

function planLabel(sub) {
  const p = sub.items.data[0]?.price;
  const tier = tierOf(sub) ?? p?.lookup_key ?? "?";
  const amt = (monthlyNormalizedAmount(sub) / 100).toFixed(2);
  return `${tier} (~€${amt}/mo, ${p?.recurring?.interval ?? "?"}, ${sub.status})`;
}

async function main() {
  console.error(
    `\n=== Stripe subscription dedupe ===\n` +
      `mode:   ${LIVE_MODE ? "!!! LIVE !!!" : "test"} (key ${KEY.slice(0, 8)}…)\n` +
      `action: ${APPLY ? (AT_PERIOD_END ? "CANCEL AT PERIOD END" : "CANCEL IMMEDIATELY") : "DRY RUN (no changes)"}\n`,
  );

  const byCustomer = new Map();
  for await (const sub of allLiveSubscriptions()) {
    const cust =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (!byCustomer.has(cust)) byCustomer.set(cust, []);
    byCustomer.get(cust).push(sub);
  }

  const dupes = [...byCustomer.entries()].filter(([, subs]) => subs.length > 1);
  if (dupes.length === 0) {
    console.error("No customers with more than one live subscription. ✓");
    return;
  }

  let toCancel = 0;
  for (const [cust, subs] of dupes) {
    subs.sort((a, b) => cmpScore(keepScore(b), keepScore(a))); // best first
    const keep = subs[0];
    const cancel = subs.slice(1);
    console.error(`\ncustomer ${cust} — ${subs.length} live subscriptions`);
    console.error(`  KEEP   ${keep.id}  ${planLabel(keep)}`);
    for (const c of cancel) {
      console.error(`  CANCEL ${c.id}  ${planLabel(c)}`);
      toCancel++;
      if (APPLY) {
        try {
          if (AT_PERIOD_END) {
            await stripe.subscriptions.update(c.id, {
              cancel_at_period_end: true,
            });
            console.error(`         → scheduled cancel at period end`);
          } else {
            await stripe.subscriptions.cancel(c.id, { prorate: true });
            console.error(`         → canceled`);
          }
        } catch (e) {
          console.error(`         → FAILED: ${e.message}`);
        }
      }
    }
  }

  console.error(
    `\n${dupes.length} customer(s) affected, ${toCancel} subscription(s) ${APPLY ? "processed" : "would be canceled"}.`,
  );
  if (!APPLY)
    console.error("Re-run with --apply to perform the cancellations.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
