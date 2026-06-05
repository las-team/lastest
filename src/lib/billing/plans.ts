/**
 * Plan tier definitions + static fallback catalog.
 *
 * The *live* catalog (prices, quotas, feature bullets) is fetched from
 * Stripe at runtime — see `src/lib/billing/catalog.ts`. Stripe products
 * carry a `tier` metadata key that maps back to the `TeamPlan` IDs
 * defined here; prices are classified by recurring interval + lookup
 * key (`{tier}_monthly`, `{tier}_monthly_ea`, `{tier}_yearly`,
 * `{tier}_yearly_ea`).
 *
 * What stays in code, by design:
 *  - Tier identity, ordering, and `purchasable` flags — these gate
 *    server actions and capability checks, so they're not editable
 *    from the Stripe dashboard.
 *  - The free tier — it isn't a Stripe product.
 *  - This static catalog — display-only fallback when Stripe is
 *    unconfigured (self-hosters) or unreachable.
 */
import type { TeamPlan } from "@/lib/db/schema";
import { isEarlyAdopterPricing } from "./config";

export type BillingInterval = "monthly" | "yearly";

export interface PlanConfig {
  /** Tier ID matching the TeamPlan enum. */
  id: TeamPlan;
  /** Display name shown in the UI. */
  name: string;
  /** Marketing one-liner from the pricing page. */
  tagline: string;
  /** Full monthly price in EUR cents. `0` for free tier. */
  priceCents: number;
  /** Discounted launch monthly price in EUR cents. Same as priceCents when no discount. */
  earlyAdopterPriceCents: number;
  /** Full yearly price in EUR cents. `0` for free tier. */
  yearlyPriceCents: number;
  /** Discounted launch yearly price in EUR cents. */
  earlyAdopterYearlyPriceCents: number;
  /** Calendar-month run-minute cap. Soft-displayed only — no overage in v1. */
  monthlyRunQuota: number;
  /** Max projects (repositories) for the tier. `null` = unlimited. */
  projectLimit: number | null;
  /** Concurrent run cap. Informational only today. */
  concurrentRunLimit: number;
  /** True if checkout flows should be offered for this tier. */
  purchasable: boolean;
  /** Feature bullets surfaced in the billing UI. */
  features: string[];
}

export const PLANS: Record<Exclude<TeamPlan, "demo" | "trial">, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    tagline:
      "Try it out — hosted by us. Kick the tires on a real project. No credit card.",
    priceCents: 0,
    earlyAdopterPriceCents: 0,
    yearlyPriceCents: 0,
    earlyAdopterYearlyPriceCents: 0,
    monthlyRunQuota: 500,
    projectLimit: 1,
    concurrentRunLimit: 1,
    purchasable: false,
    features: [
      "1 project",
      "Shared runner pool",
      "500 capped runner-minutes",
      "1 concurrent run",
      "Community support",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    tagline:
      "Solo devs & small teams — for builders shipping regularly. Locked-in early adopter price.",
    priceCents: 2900,
    earlyAdopterPriceCents: 1400,
    yearlyPriceCents: 29000, // 10x monthly — two months free
    earlyAdopterYearlyPriceCents: 14000,
    monthlyRunQuota: 5000,
    projectLimit: 3,
    concurrentRunLimit: 2,
    purchasable: true,
    features: [
      "3 projects",
      "5,000 priority run-minutes",
      "2 concurrent runs",
      "Email support",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline:
      "Growing teams + CI — multiple apps, CI pipelines, Slack-speed support.",
    priceCents: 9900,
    earlyAdopterPriceCents: 4950,
    yearlyPriceCents: 99000,
    earlyAdopterYearlyPriceCents: 49500,
    monthlyRunQuota: 30000,
    projectLimit: 10,
    concurrentRunLimit: 5,
    purchasable: true,
    features: [
      "10 projects",
      "30,000 priority run-minutes",
      "5 concurrent runs",
      "Slack support",
      "CI integrations (GitHub, GitLab, Bitbucket)",
      "Cross-browser add-on €49 / mo",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline:
      "Larger teams + SSO — capacity, SSO, and priority response for serious teams.",
    priceCents: 29900,
    earlyAdopterPriceCents: 14950,
    yearlyPriceCents: 299000,
    earlyAdopterYearlyPriceCents: 149500,
    monthlyRunQuota: 120000,
    projectLimit: null,
    concurrentRunLimit: 15,
    purchasable: true,
    features: [
      "Unlimited projects (reasonable quotas)",
      "120,000 priority run-minutes",
      "15 concurrent runs",
      "SSO / SAML",
      "Priority support",
      "Custom cross-browser pricing",
    ],
  },
};

/**
 * Fallback config used when a team is on the demo or trial plan
 * (read-only sandboxes — they don't pay, so we don't render checkout).
 */
export const FALLBACK_PLAN: PlanConfig = {
  id: "free",
  name: "Sandbox",
  tagline: "Read-only sandbox.",
  priceCents: 0,
  earlyAdopterPriceCents: 0,
  yearlyPriceCents: 0,
  earlyAdopterYearlyPriceCents: 0,
  monthlyRunQuota: 0,
  projectLimit: 0,
  concurrentRunLimit: 0,
  purchasable: false,
  features: [],
};

export function planConfig(plan: TeamPlan): PlanConfig {
  if (plan === "demo" || plan === "trial") return FALLBACK_PLAN;
  const cfg = PLANS[plan];
  // `plan` is typed, but values can arrive from forms/API at runtime —
  // reject unknown tiers ('enterprise', typos) with a clear error rather
  // than returning undefined and crashing later on `.purchasable`.
  if (!cfg) throw new Error(`Unknown plan tier: ${plan}`);
  return cfg;
}

/**
 * Display price respecting the EA window + selected billing interval.
 * Server-only (reads `EARLY_ADOPTER_PRICING`) — the UI receives prices
 * pre-computed via `toUiCatalog()` so SSR/CSR can't disagree.
 */
export function displayPriceCents(
  plan: PlanConfig,
  interval: BillingInterval = "monthly",
): number {
  const ea = isEarlyAdopterPricing();
  if (interval === "yearly")
    return ea ? plan.earlyAdopterYearlyPriceCents : plan.yearlyPriceCents;
  return ea ? plan.earlyAdopterPriceCents : plan.priceCents;
}

/** Ordered list for the upgrade UI (cheapest to priciest). */
export const PURCHASABLE_PLANS: PlanConfig[] = [
  PLANS.starter,
  PLANS.growth,
  PLANS.pro,
];

/**
 * Tier rank for comparisons. Higher = more capacity.
 */
export function planRank(plan: TeamPlan): number {
  switch (plan) {
    case "demo":
      return -1;
    case "trial":
      return 0;
    case "free":
      return 0;
    case "starter":
      return 1;
    case "growth":
      return 2;
    case "pro":
      return 3;
  }
}
