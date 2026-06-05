import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { hasCapability } from '@/lib/auth/capabilities';
import * as queries from '@/lib/db/queries';
import { isStripeConfigured } from '@/lib/billing/stripe';
import { getCatalog, toUiCatalog } from '@/lib/billing/catalog';
import { BillingCard } from '@/components/settings/billing-card-client';

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; billing?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  if (!hasCapability(session, 'team:admin')) {
    redirect('/settings?error=Billing+is+team+admin+only');
  }

  const teamId = session.team!.id;
  const billing = await queries.getTeamBilling(teamId);

  const stripeConfigured = isStripeConfigured();
  // Live paid-tier catalog from Stripe (TTL-cached; static fallback when
  // unconfigured/unreachable). Display prices are computed here so the
  // client never reads the server-only EA flag.
  const catalog = toUiCatalog(await getCatalog());

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Manage your subscription, payment method, and plan.
        </p>
      </div>

      {params.checkout === 'success' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
          Subscription updated. It may take a moment for the new plan to appear here while Stripe sends the webhook.
        </div>
      )}
      {params.billing === 'plan_changed' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
          Plan changed. Stripe will prorate the difference on your next invoice.
        </div>
      )}
      {params.billing === 'downgrade_scheduled' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/5 p-4 text-sm">
          Downgrade scheduled — your current plan stays active until the end of the billing
          period, then the new plan takes over. Nothing is charged today.
        </div>
      )}
      {(params.billing === 'error' || params.checkout === 'cancelled') && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          {params.checkout === 'cancelled' ? 'Checkout cancelled.' : 'Something went wrong with the billing change. Please try again or contact support.'}
        </div>
      )}

      {billing && (
        <BillingCard
          plan={billing.plan}
          catalog={catalog}
          subscriptionStatus={billing.subscriptionStatus}
          currentPeriodEnd={billing.subscriptionCurrentPeriodEnd?.toISOString() ?? null}
          cancelAtPeriodEnd={Boolean(billing.subscriptionCancelAtPeriodEnd)}
          pendingPlanChange={Boolean(billing.subscriptionScheduleId)}
          currentBillingInterval={billing.billingInterval}
          isAdmin={true}
          stripeConfigured={stripeConfigured}
        />
      )}
    </div>
  );
}
