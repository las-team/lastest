import type { SubscriptionPlan } from '@/lib/db/schema';

export interface PlanLimits {
  maxRepositories: number; // -1 = unlimited
  maxBuildsPerMonth: number;
  maxStorageGb: number;
  aiFailureTriage: boolean;
  customRunners: boolean;
  prioritySupport: boolean;
  ssoSaml: boolean;
}

export interface PlanDefinition {
  id: SubscriptionPlan;
  name: string;
  description: string;
  monthlyPriceUsd: number;
  // Polar product id — read at request time so we never bake env into bundles.
  // `undefined` means the plan isn't sold (free) or isn't configured yet.
  productEnv?: 'POLAR_PRODUCT_PRO' | 'POLAR_PRODUCT_BUSINESS';
  limits: PlanLimits;
}

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Hobby projects and evaluations',
    monthlyPriceUsd: 0,
    limits: {
      maxRepositories: 1,
      maxBuildsPerMonth: 100,
      maxStorageGb: 1,
      aiFailureTriage: false,
      customRunners: false,
      prioritySupport: false,
      ssoSaml: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Growing teams shipping daily',
    monthlyPriceUsd: 49,
    productEnv: 'POLAR_PRODUCT_PRO',
    limits: {
      maxRepositories: 10,
      maxBuildsPerMonth: 5_000,
      maxStorageGb: 50,
      aiFailureTriage: true,
      customRunners: true,
      prioritySupport: false,
      ssoSaml: false,
    },
  },
  business: {
    id: 'business',
    name: 'Business',
    description: 'Scale, compliance, and SSO',
    monthlyPriceUsd: 199,
    productEnv: 'POLAR_PRODUCT_BUSINESS',
    limits: {
      maxRepositories: -1,
      maxBuildsPerMonth: 50_000,
      maxStorageGb: 500,
      aiFailureTriage: true,
      customRunners: true,
      prioritySupport: true,
      ssoSaml: true,
    },
  },
};

export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  pro: 1,
  business: 2,
};

export function getPlan(id: SubscriptionPlan): PlanDefinition {
  return PLANS[id];
}

export function planAtLeast(actual: SubscriptionPlan, required: SubscriptionPlan): boolean {
  return PLAN_RANK[actual] >= PLAN_RANK[required];
}

// Resolve a Polar product id from the configured plan. Returns undefined if
// the env var is missing — caller should surface a clear error to the admin.
export function getProductIdForPlan(plan: SubscriptionPlan): string | undefined {
  const def = PLANS[plan];
  if (!def.productEnv) return undefined;
  const value = process.env[def.productEnv];
  return value && value.length > 0 ? value : undefined;
}

// Reverse lookup used by the webhook to map a Polar product back to a plan.
export function planForProductId(productId: string): SubscriptionPlan | undefined {
  for (const plan of Object.keys(PLANS) as SubscriptionPlan[]) {
    if (getProductIdForPlan(plan) === productId) return plan;
  }
  return undefined;
}
