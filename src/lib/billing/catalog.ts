/**
 * Dynamic billing catalog — Stripe is the source of truth.
 *
 * One `prices.list` call (active recurring prices, products expanded)
 * builds the full paid-tier catalog: prices from `unit_amount`, quotas
 * from product `metadata`, feature bullets from `marketing_features`.
 * Editing a product or price in the Stripe dashboard updates the app
 * without a deploy.
 *
 * Contract with the dashboard (provisioned by
 * `scripts/stripe-provision-test.mjs`):
 *
 *  - Product metadata: `tier` (starter|growth|pro — must match a
 *    purchasable TeamPlan), `monthly_run_quota` (int),
 *    `project_limit` (int or `unlimited`), `concurrent_run_limit`
 *    (int), optional `tagline`.
 *  - Product `marketing_features`: the feature bullets shown in the UI.
 *  - Prices: classified by `recurring.interval` (month|year); a price
 *    is the early-adopter variant when its `lookup_key` ends in `_ea`
 *    or its metadata has `ea=true`.
 *
 * Caching: in-memory, TTL'd (10 min), deduplicated in-flight. The
 * webhook handler calls `invalidateCatalog()` on `product.*` /
 * `price.*` events so dashboard edits propagate within one delivery.
 *
 * Fallbacks: Stripe unconfigured or fetch failure → the static catalog
 * from `plans.ts` with `live: false` and no price IDs, so the UI still
 * renders tiers but checkout stays disabled.
 */
import type Stripe from "stripe";
import type { TeamPlan } from "@/lib/db/schema";
import { getStripeClient } from "./stripe";
import { isEarlyAdopterPricing } from "./config";
import {
  PURCHASABLE_PLANS,
  displayPriceCents,
  type BillingInterval,
  type PlanConfig,
} from "./plans";

export interface CatalogPrice {
  priceId: string;
  lookupKey: string | null;
  unitAmountCents: number;
}

export interface CatalogPlan extends PlanConfig {
  /** True when built from live Stripe data (vs the static fallback). */
  live: boolean;
  prices: {
    monthly: CatalogPrice | null;
    monthlyEa: CatalogPrice | null;
    yearly: CatalogPrice | null;
    yearlyEa: CatalogPrice | null;
  };
}

/** Serializable slice of the catalog for the client billing card. */
export interface UiCatalogPlan {
  id: TeamPlan;
  name: string;
  tagline: string;
  features: string[];
  monthly: { displayCents: number; fullCents: number };
  yearly: { displayCents: number; fullCents: number };
  /** False when Stripe has no monthly price for the tier — checkout disabled. */
  available: boolean;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
/** Shorter TTL after a failed fetch so we retry soon without hammering. */
const FAILURE_TTL_MS = 60 * 1000;

let cache: { at: number; ttl: number; plans: CatalogPlan[] } | null = null;
let inFlight: Promise<CatalogPlan[]> | null = null;

export function invalidateCatalog(): void {
  cache = null;
}

const NO_PRICES: CatalogPlan["prices"] = {
  monthly: null,
  monthlyEa: null,
  yearly: null,
  yearlyEa: null,
};

function staticFallback(): CatalogPlan[] {
  return PURCHASABLE_PLANS.map((p) => ({
    ...p,
    live: false,
    prices: { ...NO_PRICES },
  }));
}

const PURCHASABLE_IDS = new Set(PURCHASABLE_PLANS.map((p) => p.id));

function parseIntOr(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/** `unlimited` → null; integer → n; missing/garbage → static fallback. */
function parseProjectLimit(
  value: string | undefined,
  fallback: number | null,
): number | null {
  if (value === "unlimited") return null;
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function isEaPrice(price: Stripe.Price): boolean {
  return price.lookup_key?.endsWith("_ea") || price.metadata?.ea === "true";
}

function toCatalogPrice(price: Stripe.Price): CatalogPrice {
  return {
    priceId: price.id,
    lookupKey: price.lookup_key ?? null,
    unitAmountCents: price.unit_amount ?? 0,
  };
}

/**
 * Group active recurring prices by product and validate each product's
 * tier metadata. Products that don't pass validation are skipped with a
 * console.error — a typo in the dashboard must never take down billing
 * for the valid tiers.
 */
function buildFromPrices(prices: Stripe.Price[]): CatalogPlan[] {
  const byProduct = new Map<
    string,
    { product: Stripe.Product; prices: Stripe.Price[] }
  >();
  for (const price of prices) {
    const product = price.product;
    // We request `expand: data.product`; anything else is unusable.
    if (typeof product === "string" || !product || product.deleted) continue;
    const entry = byProduct.get(product.id);
    if (entry) entry.prices.push(price);
    else byProduct.set(product.id, { product, prices: [price] });
  }

  const byTier = new Map<TeamPlan, CatalogPlan>();
  for (const { product, prices: productPrices } of byProduct.values()) {
    const tier = product.metadata?.tier as TeamPlan | undefined;
    if (!tier || !PURCHASABLE_IDS.has(tier)) {
      if (tier !== undefined) {
        console.error(
          `[billing/catalog] Product ${product.id} has unknown tier "${tier}" — skipped`,
        );
      }
      continue;
    }
    if (byTier.has(tier)) {
      console.error(
        `[billing/catalog] Duplicate product for tier "${tier}" (${product.id}) — skipped`,
      );
      continue;
    }

    const fallback = PURCHASABLE_PLANS.find((p) => p.id === tier)!;
    const slots: CatalogPlan["prices"] = { ...NO_PRICES };
    for (const price of productPrices) {
      const interval = price.recurring?.interval;
      if (interval !== "month" && interval !== "year") continue;
      const slot =
        interval === "month"
          ? isEaPrice(price)
            ? "monthlyEa"
            : "monthly"
          : isEaPrice(price)
            ? "yearlyEa"
            : "yearly";
      if (slots[slot]) {
        console.error(
          `[billing/catalog] Tier "${tier}" has multiple active ${slot} prices — keeping ${slots[slot]!.priceId}, ignoring ${price.id}`,
        );
        continue;
      }
      slots[slot] = toCatalogPrice(price);
    }

    if (!slots.monthly) {
      console.error(
        `[billing/catalog] Tier "${tier}" has no full monthly price — skipped`,
      );
      continue;
    }

    const features = (product.marketing_features ?? [])
      .map((f) => f.name)
      .filter((n): n is string => Boolean(n));

    byTier.set(tier, {
      id: tier,
      name: product.name || fallback.name,
      tagline: product.metadata?.tagline || fallback.tagline,
      priceCents: slots.monthly.unitAmountCents,
      earlyAdopterPriceCents:
        slots.monthlyEa?.unitAmountCents ?? slots.monthly.unitAmountCents,
      yearlyPriceCents: slots.yearly?.unitAmountCents ?? 0,
      earlyAdopterYearlyPriceCents:
        slots.yearlyEa?.unitAmountCents ?? slots.yearly?.unitAmountCents ?? 0,
      monthlyRunQuota: parseIntOr(
        product.metadata?.monthly_run_quota,
        fallback.monthlyRunQuota,
      ),
      projectLimit: parseProjectLimit(
        product.metadata?.project_limit,
        fallback.projectLimit,
      ),
      concurrentRunLimit: parseIntOr(
        product.metadata?.concurrent_run_limit,
        fallback.concurrentRunLimit,
      ),
      purchasable: true,
      features: features.length ? features : fallback.features,
      live: true,
      prices: slots,
    });
  }

  // Preserve the canonical cheapest→priciest order; fill tiers missing
  // from Stripe with static display data so the pricing grid stays whole.
  return PURCHASABLE_PLANS.map(
    (p) => byTier.get(p.id) ?? { ...p, live: false, prices: { ...NO_PRICES } },
  );
}

async function fetchCatalog(): Promise<CatalogPlan[]> {
  const stripe = getStripeClient();
  if (!stripe) {
    // Unconfigured: don't cache-fail-retry; the static result is stable.
    return staticFallback();
  }
  const result = await stripe.prices.list({
    active: true,
    type: "recurring",
    expand: ["data.product"],
    limit: 100,
  });
  const catalog = buildFromPrices(result.data);
  if (!catalog.some((p) => p.live)) {
    console.error(
      "[billing/catalog] No valid tiers found in Stripe — using static fallback",
    );
  }
  return catalog;
}

export async function getCatalog(): Promise<CatalogPlan[]> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.plans;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const plans = await fetchCatalog();
      cache = { at: Date.now(), ttl: CACHE_TTL_MS, plans };
      return plans;
    } catch (err) {
      console.error(
        "[billing/catalog] Fetch failed — using static fallback",
        err,
      );
      const plans = staticFallback();
      cache = { at: Date.now(), ttl: FAILURE_TTL_MS, plans };
      return plans;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Pick the chargeable price for (plan, interval), honoring the EA flag
 * with fall-through to the full price when no EA variant exists.
 */
export function selectPrice(
  plan: CatalogPlan,
  interval: BillingInterval,
): CatalogPrice | null {
  const ea = isEarlyAdopterPricing();
  if (interval === "yearly")
    return (ea ? plan.prices.yearlyEa : null) ?? plan.prices.yearly;
  return (ea ? plan.prices.monthlyEa : null) ?? plan.prices.monthly;
}

/**
 * Reverse lookup for webhook handlers: which (tier, interval) does a
 * Stripe price ID belong to? Checks the cached catalog first; on a miss
 * (e.g. a price created after the cache was built) refreshes once, then
 * falls back to retrieving the price with its product expanded and
 * reading `metadata.tier`.
 */
export async function resolvePlanForPriceId(
  priceId: string,
): Promise<{ plan: TeamPlan; interval: BillingInterval } | null> {
  const findIn = (catalog: CatalogPlan[]) => {
    for (const plan of catalog) {
      const { monthly, monthlyEa, yearly, yearlyEa } = plan.prices;
      if (monthly?.priceId === priceId || monthlyEa?.priceId === priceId) {
        return { plan: plan.id, interval: "monthly" as const };
      }
      if (yearly?.priceId === priceId || yearlyEa?.priceId === priceId) {
        return { plan: plan.id, interval: "yearly" as const };
      }
    }
    return null;
  };

  const hit = findIn(await getCatalog());
  if (hit) return hit;

  invalidateCatalog();
  const fresh = findIn(await getCatalog());
  if (fresh) return fresh;

  const stripe = getStripeClient();
  if (!stripe) return null;
  try {
    const price = await stripe.prices.retrieve(priceId, {
      expand: ["product"],
    });
    const product = price.product;
    if (typeof product === "string" || !product || product.deleted) return null;
    const tier = product.metadata?.tier as TeamPlan | undefined;
    if (!tier || !PURCHASABLE_IDS.has(tier)) return null;
    return {
      plan: tier,
      interval: price.recurring?.interval === "year" ? "yearly" : "monthly",
    };
  } catch (err) {
    console.error(`[billing/catalog] Could not resolve price ${priceId}`, err);
    return null;
  }
}

/**
 * Serializable catalog for the client billing card. Display prices are
 * computed server-side (the EA flag is server-only env) so SSR and CSR
 * always render the same numbers.
 */
export function toUiCatalog(catalog: CatalogPlan[]): UiCatalogPlan[] {
  return catalog.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    features: p.features,
    monthly: {
      displayCents: displayPriceCents(p, "monthly"),
      fullCents: p.priceCents,
    },
    yearly: {
      displayCents: displayPriceCents(p, "yearly"),
      fullCents: p.yearlyPriceCents,
    },
    available: p.live && p.prices.monthly !== null,
  }));
}
