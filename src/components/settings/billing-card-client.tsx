'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Check, ExternalLink, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PLANS, PLAN_RANK, type PlanDefinition } from '@/lib/polar/plans';
import {
  startCheckout,
  openCustomerPortal,
  resumeTeamSubscription,
} from '@/server/actions/billing';
import { CancelSubscriptionDialog } from './cancel-subscription-dialog';
import type { TeamSubscription } from '@/lib/auth';
import type { SubscriptionPlan } from '@/lib/db/schema';

interface BillingCardProps {
  subscription: TeamSubscription;
  isAdmin: boolean;
  hasCustomer: boolean;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusLabel(sub: TeamSubscription): string {
  if (sub.plan === 'free') return 'Free plan';
  if (!sub.status) return 'Inactive';
  if (sub.cancelAtPeriodEnd) return `Cancels ${formatDate(sub.currentPeriodEnd)}`;
  switch (sub.status) {
    case 'active':
      return `Renews ${formatDate(sub.currentPeriodEnd)}`;
    case 'trialing':
      return `Trial ends ${formatDate(sub.currentPeriodEnd)}`;
    case 'past_due':
      return 'Payment past due';
    case 'canceled':
      return 'Canceled';
    case 'unpaid':
      return 'Unpaid';
    default:
      return sub.status;
  }
}

export function BillingCard({ subscription, isAdmin, hasCustomer }: BillingCardProps) {
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);

  function go(label: string, fn: () => Promise<{ url?: string; success?: boolean }>) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.url) {
          window.location.href = res.url;
          return;
        }
        toast.success(`${label} succeeded`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${label} failed`);
      }
    });
  }

  const plans = (Object.values(PLANS) as PlanDefinition[]).sort(
    (a, b) => PLAN_RANK[a.id] - PLAN_RANK[b.id],
  );
  const currentRank = PLAN_RANK[subscription.plan];

  return (
    <Card id="billing">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Billing & Plan
        </CardTitle>
        <CardDescription>
          Manage your team&apos;s subscription. Billing is handled by Polar.sh.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">{PLANS[subscription.plan].name}</span>
              <Badge variant={subscription.isActive ? 'default' : 'destructive'}>
                {subscription.isActive ? 'Active' : 'Inactive'}
              </Badge>
              {subscription.cancelAtPeriodEnd && (
                <Badge variant="secondary">Cancellation scheduled</Badge>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-1">{statusLabel(subscription)}</div>
          </div>
          {isAdmin && hasCustomer && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => go('Open billing portal', openCustomerPortal)}
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              Manage billing
            </Button>
          )}
        </div>

        {subscription.status === 'past_due' && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 text-destructive" />
            <div>
              Your latest payment failed. Update your payment method in the billing portal to keep
              access — paid features are revoked when the grace period ends.
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = plan.id === subscription.plan;
            const rank = PLAN_RANK[plan.id];
            const isUpgrade = rank > currentRank;
            const limits = plan.limits;
            return (
              <div
                key={plan.id}
                className={`rounded-md border p-4 flex flex-col gap-3 ${
                  isCurrent ? 'border-primary' : ''
                }`}
              >
                <div>
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-semibold">{plan.name}</h3>
                    {isCurrent && <Badge variant="outline">Current</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                </div>
                <div className="text-2xl font-bold">
                  ${plan.monthlyPriceUsd}
                  <span className="text-sm text-muted-foreground font-normal">/mo</span>
                </div>
                <ul className="text-sm space-y-1.5 flex-1">
                  <PlanRow label="Repositories" value={limits.maxRepositories === -1 ? 'Unlimited' : `Up to ${limits.maxRepositories}`} />
                  <PlanRow label="Builds / mo" value={limits.maxBuildsPerMonth.toLocaleString()} />
                  <PlanRow
                    label="Test runtime / mo"
                    value={limits.maxRuntimeMinutesPerMonth === -1 ? 'Unlimited' : `${limits.maxRuntimeMinutesPerMonth.toLocaleString()} min`}
                  />
                  <PlanRow label="Storage" value={`${limits.maxStorageGb} GB`} />
                  <PlanFeature on={limits.aiFailureTriage} label="AI failure triage" />
                  <PlanFeature on={limits.customRunners} label="Custom runners" />
                  <PlanFeature on={limits.prioritySupport} label="Priority support" />
                  <PlanFeature on={limits.ssoSaml} label="SSO / SAML" />
                </ul>
                <div className="pt-2">
                  {!isAdmin ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      Admins only
                    </Button>
                  ) : isCurrent ? (
                    subscription.cancelAtPeriodEnd ? (
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={pending}
                        onClick={() => go('Resume subscription', resumeTeamSubscription)}
                      >
                        Resume subscription
                      </Button>
                    ) : plan.id === 'free' ? (
                      <Button variant="outline" size="sm" disabled className="w-full">
                        Current
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={pending}
                        onClick={() => setCancelOpen(true)}
                      >
                        Cancel subscription
                      </Button>
                    )
                  ) : plan.id === 'free' ? (
                    <Button variant="outline" size="sm" disabled className="w-full">
                      Downgrade in portal
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={pending}
                      onClick={() => go('Start checkout', () => startCheckout(plan.id as SubscriptionPlan))}
                    >
                      {isUpgrade ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      {subscription.plan !== 'free' && (
        <CancelSubscriptionDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          currentPlan={subscription.plan}
          periodEndLabel={formatDate(subscription.currentPeriodEnd)}
        />
      )}
    </Card>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}

function PlanFeature({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${on ? '' : 'text-muted-foreground line-through'}`}>
      <Check className={`h-3.5 w-3.5 ${on ? 'text-primary' : 'text-muted-foreground/50'}`} />
      {label}
    </li>
  );
}
