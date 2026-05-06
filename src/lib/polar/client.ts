// Thin REST client for Polar.sh. We avoid pulling in @polar-sh/sdk so the
// runtime dep tree stays small — we only need a handful of endpoints.

const SERVERS = {
  production: 'https://api.polar.sh',
  sandbox: 'https://sandbox-api.polar.sh',
} as const;

export type PolarServer = keyof typeof SERVERS;

export interface PolarConfig {
  accessToken: string;
  organizationId: string;
  server: PolarServer;
}

export function getPolarConfig(): PolarConfig {
  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  const organizationId = process.env.POLAR_ORGANIZATION_ID;
  const server = (process.env.POLAR_SERVER as PolarServer | undefined) ?? 'production';
  if (!accessToken || !organizationId) {
    throw new Error('Polar is not configured: set POLAR_ACCESS_TOKEN and POLAR_ORGANIZATION_ID');
  }
  if (server !== 'production' && server !== 'sandbox') {
    throw new Error(`Invalid POLAR_SERVER "${server}" — must be "production" or "sandbox"`);
  }
  return { accessToken, organizationId, server };
}

async function polarFetch<T>(
  path: string,
  init: RequestInit & { config?: PolarConfig } = {},
): Promise<T> {
  const config = init.config ?? getPolarConfig();
  const baseUrl = SERVERS[config.server];
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Polar API ${res.status} ${res.statusText} on ${path}: ${body}`);
  }
  // Some endpoints return 204 with no body.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- Customers ----------

export interface PolarCustomer {
  id: string;
  email: string;
  name?: string | null;
  external_id?: string | null;
  organization_id: string;
}

export async function getOrCreateCustomer(args: {
  email: string;
  name?: string;
  externalId: string; // we use the team id
}): Promise<PolarCustomer> {
  const config = getPolarConfig();

  // Look up by external_id first — idempotent across retries.
  const existing = await polarFetch<{ items: PolarCustomer[] }>(
    `/v1/customers/?organization_id=${encodeURIComponent(config.organizationId)}&external_id=${encodeURIComponent(args.externalId)}`,
    { method: 'GET', config },
  );
  if (existing.items?.[0]) return existing.items[0];

  return polarFetch<PolarCustomer>('/v1/customers/', {
    method: 'POST',
    config,
    body: JSON.stringify({
      email: args.email,
      name: args.name,
      external_id: args.externalId,
      organization_id: config.organizationId,
    }),
  });
}

// ---------- Checkout ----------

export interface PolarCheckout {
  id: string;
  url: string;
  status: string;
  customer_id?: string | null;
  product_id: string;
}

export async function createCheckout(args: {
  productId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  metadata?: Record<string, string>;
}): Promise<PolarCheckout> {
  return polarFetch<PolarCheckout>('/v1/checkouts/', {
    method: 'POST',
    body: JSON.stringify({
      products: [args.productId],
      customer_id: args.customerId,
      customer_email: args.customerEmail,
      success_url: args.successUrl,
      metadata: args.metadata,
      allow_discount_codes: true,
    }),
  });
}

// ---------- Customer portal ----------

export interface CustomerPortalSession {
  customer_session_token: string;
  customer_portal_url: string;
}

export async function createCustomerPortalSession(customerId: string): Promise<CustomerPortalSession> {
  return polarFetch<CustomerPortalSession>('/v1/customer-sessions/', {
    method: 'POST',
    body: JSON.stringify({ customer_id: customerId }),
  });
}

// ---------- Subscriptions ----------

export interface PolarSubscription {
  id: string;
  status: string;
  customer_id: string;
  product_id: string;
  price_id?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  ended_at?: string | null;
}

export async function getSubscription(subscriptionId: string): Promise<PolarSubscription> {
  return polarFetch<PolarSubscription>(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
  });
}

export type CancellationReason =
  | 'too_expensive'
  | 'missing_features'
  | 'switched_service'
  | 'unused'
  | 'customer_service'
  | 'low_quality'
  | 'too_complex'
  | 'other';

export async function cancelSubscription(
  subscriptionId: string,
  opts: {
    atPeriodEnd: boolean;
    reason?: CancellationReason;
    comment?: string;
  } = { atPeriodEnd: true },
): Promise<PolarSubscription> {
  if (opts.atPeriodEnd) {
    // Soft cancel — keeps the customer on the plan until period end and lets
    // them resume by clearing the flag.
    return polarFetch<PolarSubscription>(
      `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          cancel_at_period_end: true,
          customer_cancellation_reason: opts.reason,
          customer_cancellation_comment: opts.comment,
        }),
      },
    );
  }
  // Hard cancel — Polar's DELETE endpoint terminates the subscription
  // immediately, prorating any unused time.
  return polarFetch<PolarSubscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        customer_cancellation_reason: opts.reason,
        customer_cancellation_comment: opts.comment,
      }),
    },
  );
}

export async function resumeSubscription(subscriptionId: string): Promise<PolarSubscription> {
  return polarFetch<PolarSubscription>(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ cancel_at_period_end: false }),
    },
  );
}
