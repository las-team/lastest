/**
 * Tests for the dynamic Stripe catalog.
 *
 * The Stripe SDK is mocked at the `getStripeClient()` boundary; fixtures
 * model the dashboard contract (product `tier` metadata +
 * `marketing_features`, price lookup keys / `recurring.interval`).
 * Covers: catalog assembly, EA price classification, dashboard-typo
 * resilience (skip + static fill-in), caching + invalidation, the
 * price-ID reverse lookup, and the serializable UI projection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getStripeClient } from './stripe';
import {
  getCatalog,
  invalidateCatalog,
  resolvePlanForPriceId,
  selectPrice,
  toUiCatalog,
  type CatalogPlan,
} from './catalog';
import { PLANS } from './plans';

vi.mock('./stripe', () => ({
  getStripeClient: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
}));

const getClient = vi.mocked(getStripeClient);

// ── fixtures ─────────────────────────────────────────────────────────

function product(id: string, tier: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: 'product',
    name: `Lastest ${tier ?? 'Unknown'}`,
    deleted: undefined,
    metadata: tier === undefined ? {} : {
      tier,
      tagline: `${tier} tagline`,
      monthly_run_quota: '500',
      project_limit: '3',
      concurrent_run_limit: '2',
    },
    marketing_features: [{ name: 'Feature A' }, { name: 'Feature B' }],
    ...overrides,
  };
}

function price(
  id: string,
  prod: ReturnType<typeof product>,
  interval: 'month' | 'year',
  amount: number,
  lookupKey: string | null,
  metadata: Record<string, string> = {},
) {
  return {
    id,
    object: 'price',
    product: prod,
    recurring: { interval },
    unit_amount: amount,
    lookup_key: lookupKey,
    metadata,
  };
}

const starterProduct = product('prod_starter', 'starter');
const FULL_STARTER_PRICES = [
  price('price_sm', starterProduct, 'month', 2900, 'starter_monthly'),
  price('price_sme', starterProduct, 'month', 1900, 'starter_monthly_ea'),
  price('price_sy', starterProduct, 'year', 29000, 'starter_yearly'),
  price('price_sye', starterProduct, 'year', 19000, 'starter_yearly_ea'),
];

function mockStripe(prices: unknown[], retrieve?: (id: string) => unknown) {
  const client = {
    prices: {
      list: vi.fn().mockResolvedValue({ data: prices }),
      retrieve: vi.fn().mockImplementation(async (id: string) => {
        if (!retrieve) throw new Error(`No such price: ${id}`);
        return retrieve(id);
      }),
    },
  };
  getClient.mockReturnValue(client as never);
  return client;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
const originalEa = process.env.EARLY_ADOPTER_PRICING;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCatalog();
  delete process.env.EARLY_ADOPTER_PRICING;
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  if (originalEa === undefined) delete process.env.EARLY_ADOPTER_PRICING;
  else process.env.EARLY_ADOPTER_PRICING = originalEa;
});

// ── getCatalog ───────────────────────────────────────────────────────

describe('getCatalog', () => {
  it('returns the static fallback when Stripe is unconfigured', async () => {
    getClient.mockReturnValue(null);

    const catalog = await getCatalog();

    expect(catalog).toHaveLength(3);
    expect(catalog.every((p) => !p.live)).toBe(true);
    expect(catalog.map((p) => p.id)).toEqual(['starter', 'growth', 'pro']);
    expect(catalog[0].priceCents).toBe(PLANS.starter.priceCents);
  });

  it('builds a live tier from Stripe prices + product metadata', async () => {
    mockStripe(FULL_STARTER_PRICES);

    const catalog = await getCatalog();
    const starter = catalog.find((p) => p.id === 'starter')!;

    expect(starter.live).toBe(true);
    expect(starter.priceCents).toBe(2900);
    expect(starter.earlyAdopterPriceCents).toBe(1900);
    expect(starter.yearlyPriceCents).toBe(29000);
    expect(starter.earlyAdopterYearlyPriceCents).toBe(19000);
    expect(starter.monthlyRunQuota).toBe(500);
    expect(starter.projectLimit).toBe(3);
    expect(starter.concurrentRunLimit).toBe(2);
    expect(starter.tagline).toBe('starter tagline');
    expect(starter.features).toEqual(['Feature A', 'Feature B']);
    expect(starter.prices.monthly?.priceId).toBe('price_sm');
    expect(starter.prices.monthlyEa?.priceId).toBe('price_sme');
  });

  it('classifies EA prices via metadata when there is no lookup key', async () => {
    const prod = product('prod_growth', 'growth');
    mockStripe([
      price('price_gm', prod, 'month', 9900, null),
      price('price_gme', prod, 'month', 4950, null, { ea: 'true' }),
    ]);

    const growth = (await getCatalog()).find((p) => p.id === 'growth')!;

    expect(growth.prices.monthly?.priceId).toBe('price_gm');
    expect(growth.prices.monthlyEa?.priceId).toBe('price_gme');
  });

  it('maps project_limit "unlimited" to null', async () => {
    const prod = product('prod_pro', 'pro');
    (prod.metadata as Record<string, string>).project_limit = 'unlimited';
    mockStripe([price('price_pm', prod, 'month', 29900, 'pro_monthly')]);

    const pro = (await getCatalog()).find((p) => p.id === 'pro')!;

    expect(pro.live).toBe(true);
    expect(pro.projectLimit).toBeNull();
  });

  it('skips products with an unknown tier and fills the gap from the static catalog', async () => {
    const badProduct = product('prod_bad', 'enterprise');
    mockStripe([
      ...FULL_STARTER_PRICES,
      price('price_bad', badProduct, 'month', 99900, 'enterprise_monthly'),
    ]);

    const catalog = await getCatalog();

    expect(catalog.map((p) => p.id)).toEqual(['starter', 'growth', 'pro']);
    expect(catalog.find((p) => p.id === 'starter')!.live).toBe(true);
    expect(catalog.find((p) => p.id === 'growth')!.live).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unknown tier "enterprise"'));
  });

  it('skips a tier whose product has no full monthly price', async () => {
    const prod = product('prod_growth', 'growth');
    mockStripe([price('price_gy', prod, 'year', 99000, 'growth_yearly')]);

    const growth = (await getCatalog()).find((p) => p.id === 'growth')!;

    expect(growth.live).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no full monthly price'));
  });

  it('falls back to static feature bullets when marketing_features is empty', async () => {
    const prod = product('prod_starter', 'starter', { marketing_features: [] });
    mockStripe([price('price_sm', prod, 'month', 2900, 'starter_monthly')]);

    const starter = (await getCatalog()).find((p) => p.id === 'starter')!;

    expect(starter.features).toEqual(PLANS.starter.features);
  });

  it('caches the catalog between calls and refetches after invalidateCatalog()', async () => {
    const client = mockStripe(FULL_STARTER_PRICES);

    await getCatalog();
    await getCatalog();
    expect(client.prices.list).toHaveBeenCalledTimes(1);

    invalidateCatalog();
    await getCatalog();
    expect(client.prices.list).toHaveBeenCalledTimes(2);
  });

  it('returns the static fallback when the Stripe fetch throws', async () => {
    const client = mockStripe([]);
    client.prices.list.mockRejectedValue(new Error('stripe down'));

    const catalog = await getCatalog();

    expect(catalog.every((p) => !p.live)).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Fetch failed'),
      expect.any(Error),
    );
  });
});

// ── selectPrice ──────────────────────────────────────────────────────

describe('selectPrice', () => {
  async function liveStarter(): Promise<CatalogPlan> {
    mockStripe(FULL_STARTER_PRICES);
    return (await getCatalog()).find((p) => p.id === 'starter')!;
  }

  it('picks the EA price when the window is open (default)', async () => {
    const starter = await liveStarter();
    expect(selectPrice(starter, 'monthly')?.priceId).toBe('price_sme');
    expect(selectPrice(starter, 'yearly')?.priceId).toBe('price_sye');
  });

  it('picks the full price when EA is off', async () => {
    process.env.EARLY_ADOPTER_PRICING = 'false';
    const starter = await liveStarter();
    expect(selectPrice(starter, 'monthly')?.priceId).toBe('price_sm');
    expect(selectPrice(starter, 'yearly')?.priceId).toBe('price_sy');
  });

  it('falls through to the full price when no EA variant exists', async () => {
    const prod = product('prod_growth', 'growth');
    mockStripe([price('price_gm', prod, 'month', 9900, 'growth_monthly')]);
    const growth = (await getCatalog()).find((p) => p.id === 'growth')!;

    expect(selectPrice(growth, 'monthly')?.priceId).toBe('price_gm');
    expect(selectPrice(growth, 'yearly')).toBeNull();
  });
});

// ── resolvePlanForPriceId ────────────────────────────────────────────

describe('resolvePlanForPriceId', () => {
  it('resolves a cached catalog price to (tier, interval)', async () => {
    mockStripe(FULL_STARTER_PRICES);

    expect(await resolvePlanForPriceId('price_sme')).toEqual({ plan: 'starter', interval: 'monthly' });
    expect(await resolvePlanForPriceId('price_sy')).toEqual({ plan: 'starter', interval: 'yearly' });
  });

  it('refetches once on a cache miss before falling back to price retrieval', async () => {
    const client = mockStripe(FULL_STARTER_PRICES);
    await getCatalog(); // warm the cache with starter only

    // A price created after the cache was built, attached to a pro product.
    client.prices.retrieve.mockResolvedValue(
      price('price_new', product('prod_pro', 'pro'), 'year', 299000, null) as never,
    );

    const result = await resolvePlanForPriceId('price_new');

    expect(client.prices.list.mock.calls.length).toBeGreaterThanOrEqual(2); // warm + refetch
    expect(client.prices.retrieve).toHaveBeenCalledWith('price_new', { expand: ['product'] });
    expect(result).toEqual({ plan: 'pro', interval: 'yearly' });
  });

  it('returns null for prices whose product has no valid tier', async () => {
    const client = mockStripe([]);
    client.prices.retrieve.mockResolvedValue(
      price('price_x', product('prod_x', 'enterprise'), 'month', 1000, null) as never,
    );

    expect(await resolvePlanForPriceId('price_x')).toBeNull();
  });

  it('returns null (not throw) when the price retrieval fails', async () => {
    mockStripe([]);

    expect(await resolvePlanForPriceId('price_gone')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve price price_gone'),
      expect.any(Error),
    );
  });
});

// ── toUiCatalog ──────────────────────────────────────────────────────

describe('toUiCatalog', () => {
  it('pre-computes EA display prices server-side and flags availability', async () => {
    mockStripe(FULL_STARTER_PRICES);

    const ui = toUiCatalog(await getCatalog());
    const starter = ui.find((p) => p.id === 'starter')!;
    const growth = ui.find((p) => p.id === 'growth')!;

    expect(starter.available).toBe(true);
    expect(starter.monthly).toEqual({ displayCents: 1900, fullCents: 2900 });
    expect(starter.yearly).toEqual({ displayCents: 19000, fullCents: 29000 });
    // Growth has no Stripe data in this fixture → static display, not buyable.
    expect(growth.available).toBe(false);
    expect(growth.monthly.fullCents).toBe(PLANS.growth.priceCents);
  });

  it('shows full prices when the EA window is closed', async () => {
    process.env.EARLY_ADOPTER_PRICING = 'false';
    mockStripe(FULL_STARTER_PRICES);

    const starter = toUiCatalog(await getCatalog()).find((p) => p.id === 'starter')!;

    expect(starter.monthly.displayCents).toBe(2900);
    expect(starter.yearly.displayCents).toBe(29000);
  });
});
