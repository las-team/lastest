'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Check, ExternalLink, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { TeamPlan, SubscriptionStatus } from '@/lib/db/schema';
import { planConfig, planRank, type BillingInterval } from '@/lib/billing/plans';
import type { UiCatalogPlan } from '@/lib/billing/catalog';
import { changeTeamPlan, openCustomerPortal, resumeTeamSubscription } from '@/server/actions/billing';
import { CancelSubscriptionDialog } from './cancel-subscription-dialog';

export interface BillingCardProps {
  /** Current team plan (source of truth for capabilities + quota). */
  plan: TeamPlan;
  /**
   * Paid-tier catalog, built server-side from live Stripe data (display
   * prices pre-computed there — the EA flag is server-only env).
   */
  catalog: UiCatalogPlan[];
  /** Mirrored Stripe subscription status; null on the free tier. */
  subscriptionStatus: SubscriptionStatus | null;
  /** ISO timestamp of the current period end, or null. */
  currentPeriodEnd: string | null;
  /** Whether the user has clicked cancel and is in the grace window. */
  cancelAtPeriodEnd: boolean;
  /** True while a downgrade is scheduled to apply at period end. */
  pendingPlanChange: boolean;
  /** Stripe billing_interval — 'month' | 'year' | null. Drives the toggle preselection. */
  currentBillingInterval: string | null;
  /** Whether the caller can change billing (team admins/owners). */
  isAdmin: boolean;
  /** Whether the Stripe SDK is configured on the server. */
  stripeConfigured: boolean;
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Free';
  const euros = cents / 100;
  // Deterministic format so SSR/CSR don't disagree.
  return `€${euros % 1 === 0 ? euros.toFixed(0) : euros.toFixed(2)}`;
}

function statusBadgeVariant(status: SubscriptionStatus | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'default';
    case 'past_due':
    case 'unpaid':
      return 'destructive';
    case 'canceled':
      return 'outline';
    default:
      return 'secondary';
  }
}

function statusLabel(status: SubscriptionStatus | null, cancelAtPeriodEnd: boolean): string {
  if (!status) return 'Free plan';
  if (cancelAtPeriodEnd && status === 'active') return 'Cancels at period end';
  switch (status) {
    case 'active': return 'Active';
    case 'trialing': return 'In trial';
    case 'past_due': return 'Payment past due';
    case 'unpaid': return 'Unpaid';
    case 'canceled': return 'Canceled';
    case 'incomplete': return 'Incomplete';
    default: return String(status);
  }
}

export function BillingCard({
  plan,
  catalog,
  subscriptionStatus,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  pendingPlanChange,
  currentBillingInterval,
  isAdmin,
  stripeConfigured,
}: BillingCardProps) {
  const [isPending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const initialInterval: BillingInterval = currentBillingInterval === 'year' ? 'yearly' : 'monthly';
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const currentRank = planRank(plan);
  const currentConfig = planConfig(plan);

  const periodEndLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '';

  function go(target: TeamPlan) {
    startTransition(async () => {
      try {
        // One entry point for both first purchase and plan/interval
        // switch: the server resolves whether the team already has a
        // subscription. A `url` means Stripe Checkout (new sub) — redirect;
        // no `url` means the change applied in place via proration — reload
        // so the new plan + period render.
        const { url } = await changeTeamPlan(target, interval);
        if (url) {
          window.location.assign(url);
          return;
        }
        toast.success('Plan updated');
        window.location.reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update plan');
      }
    });
  }

  function resume() {
    startTransition(async () => {
      try {
        await resumeTeamSubscription();
        toast.success('Subscription resumed');
        window.location.reload();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not resume subscription');
      }
    });
  }

  function manage() {
    startTransition(async () => {
      try {
        const { url } = await openCustomerPortal();
        window.location.assign(url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not open billing portal');
      }
    });
  }

  return (
    <Card id="billing">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Billing
          </CardTitle>
          <Badge variant={statusBadgeVariant(subscriptionStatus)}>
            {statusLabel(subscriptionStatus, cancelAtPeriodEnd)}
          </Badge>
        </div>
        <CardDescription>
          Current plan: <span className="font-semibold">{currentConfig.name}</span>
          {currentPeriodEnd && subscriptionStatus === 'active' && !cancelAtPeriodEnd && (
            <> · renews {periodEndLabel}</>
          )}
          {currentPeriodEnd && cancelAtPeriodEnd && (
            <> · access until {periodEndLabel}</>
          )}
          {pendingPlanChange && !cancelAtPeriodEnd && (
            <> · plan change scheduled for {periodEndLabel || 'period end'}</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!stripeConfigured && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Billing is not configured on this instance. Set{' '}
            <code className="font-mono">STRIPE_SECRET_KEY</code> and{' '}
            <code className="font-mono">STRIPE_WEBHOOK_SECRET</code>, then run{' '}
            <code className="font-mono">scripts/stripe-provision-test.mjs</code> to create the
            product catalog in Stripe.
          </div>
        )}

        {/* Monthly/yearly toggle */}
        <div className="flex items-center justify-end gap-2">
          <div className="inline-flex rounded-md border p-1 text-sm">
            {/* Active state mirrors the tests page tabs (ui/tabs TabsTrigger). */}
            <button
              type="button"
              className={`px-3 py-1 rounded ${interval === 'monthly' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => setInterval('monthly')}
              disabled={isPending}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`px-3 py-1 rounded flex items-center gap-1.5 ${interval === 'yearly' ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => setInterval('yearly')}
              disabled={isPending}
            >
              Yearly
              <span className="text-[10px] uppercase tracking-wide opacity-80">2 mo. free</span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {catalog.map((p: UiCatalogPlan) => {
            const targetRank = planRank(p.id);
            const isCurrent = p.id === plan;
            const isUpgrade = targetRank > currentRank;
            const label = isCurrent
              ? 'Current plan'
              : isUpgrade
                ? `Upgrade to ${p.name}`
                : `Switch to ${p.name}`;
            const price = p[interval].displayCents;
            const fullPrice = p[interval].fullCents;
            const discounted = price < fullPrice;
            const priceLabel = interval === 'yearly' ? '/yr' : '/mo';

            return (
              <div
                key={p.id}
                className={`rounded-lg border p-4 flex flex-col gap-3 ${isCurrent ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <div>
                  <div className="flex items-baseline justify-between">
                    <h4 className="font-semibold">{p.name}</h4>
                    <div className="text-right">
                      {/* Until live Stripe prices are available, show an XX
                          placeholder instead of hardcoded amounts. */}
                      <div className="text-lg font-bold">
                        {p.available ? formatPrice(price) : '€XX'}
                        {p.available && price > 0 && (
                          // whitespace-nowrap keeps "/mo + tax" together — at
                          // narrow widths the whole suffix wraps under the
                          // price instead of orphaning "+ tax" onto its own line.
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {priceLabel} + tax
                          </span>
                        )}
                      </div>
                      {p.available && discounted && (
                        <div className="text-xs text-muted-foreground line-through whitespace-nowrap">
                          {formatPrice(fullPrice)}{priceLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{p.tagline}</p>
                </div>

                <ul className="space-y-1 text-xs flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => go(p.id)}
                  disabled={
                    (isCurrent && initialInterval === interval) ||
                    !isAdmin ||
                    !stripeConfigured ||
                    !p.available ||
                    isPending
                  }
                  variant={isCurrent ? 'outline' : isUpgrade ? 'default' : 'secondary'}
                  size="sm"
                >
                  {label}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Free tier reminder */}
        {plan === 'free' && (
          <p className="text-xs text-muted-foreground">
            You&apos;re on the {planConfig('free').name} plan — shared runner pool, 500 capped
            runner-minutes. Paid plans add priority run-minutes, more projects, and CI integrations.
          </p>
        )}

        {/* Subscription controls — only meaningful when there is one */}
        {subscriptionStatus && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            <div className="text-xs text-muted-foreground">
              {cancelAtPeriodEnd ? (
                <>Cancellation pending — access until {periodEndLabel}.</>
              ) : (
                <>Card and invoices are managed by Stripe.</>
              )}
            </div>
            <div className="flex gap-2">
              {cancelAtPeriodEnd ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={resume}
                  disabled={!isAdmin || !stripeConfigured || isPending}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Resume
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                  disabled={!isAdmin || !stripeConfigured || isPending}
                >
                  Cancel subscription
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={manage}
                disabled={!isAdmin || !stripeConfigured || isPending}
              >
                Manage <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">
            Only team owners and admins can change billing.
          </p>
        )}

        <CancelSubscriptionDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          planName={currentConfig.name}
          periodEndLabel={periodEndLabel}
        />
      </CardContent>
    </Card>
  );
}
