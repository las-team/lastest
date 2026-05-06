import { redirect } from 'next/navigation';
import { getCurrentSession, describeSubscription, evaluateRuntimeUsage } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { yearMonthOf } from '@/lib/db/schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BillingCard } from '@/components/settings/billing-card-client';
import { UsageCard } from '@/components/settings/usage-card-client';

export const metadata = {
  title: 'Billing — Settings',
};

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; checkout_id?: string }>;
}) {
  const params = await searchParams;
  const session = await getCurrentSession();
  if (!session) redirect('/login?next=/settings/billing');
  if (!session.team) redirect('/settings');

  const team = (await queries.getTeam(session.team.id)) ?? session.team;
  const subscription = describeSubscription(team);
  const isAdmin = session.user.role === 'admin' || session.user.role === 'owner';
  const now = new Date();
  const yearMonth = yearMonthOf(now);
  const fromYearMonth = yearMonthOf(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const [events, currentUsage, usageHistory] = await Promise.all([
    queries.listSubscriptionEvents(team.id, 10),
    queries.getTeamMonthlyUsage(team.id, yearMonth),
    queries.listTeamUsageHistory(team.id, fromYearMonth, yearMonth),
  ]);
  const usage = evaluateRuntimeUsage(
    team,
    currentUsage?.runtimeMs ?? 0,
    currentUsage?.testRunCount ?? 0,
  );
  const monthLabel = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="container mx-auto py-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Subscription, plan, and invoices for {team.name}.</p>
      </div>

      {params.status === 'success' && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-4 text-sm">
          Checkout complete. Your plan will update within a few seconds — refresh if it hasn&apos;t
          changed.
        </div>
      )}

      <BillingCard
        subscription={subscription}
        isAdmin={isAdmin}
        hasCustomer={Boolean(team.polarCustomerId)}
      />

      <UsageCard
        usage={usage}
        monthLabel={monthLabel}
        storageUsedBytes={team.storageUsedBytes ?? null}
        storageQuotaBytes={team.storageQuotaBytes ?? null}
      />

      {usageHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Runtime history</CardTitle>
            <CardDescription>Last 6 months of test runtime per month.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm divide-y">
              {usageHistory.map((row) => {
                const month = `${Math.floor(row.yearMonth / 100)}-${String(row.yearMonth % 100).padStart(2, '0')}`;
                const minutes = (row.runtimeMs / 60_000).toFixed(1);
                return (
                  <li key={row.yearMonth} className="py-2 flex items-center justify-between">
                    <span className="font-mono text-xs">{month}</span>
                    <div className="text-right">
                      <div className="font-medium">{minutes} min</div>
                      <div className="text-xs text-muted-foreground">
                        {row.testRunCount.toLocaleString()} runs
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Plan and status transitions for this team.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscription activity yet.</p>
          ) : (
            <ul className="text-sm divide-y">
              {events.map((event) => (
                <li key={event.id} className="py-2 flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {event.action ? `${event.action}: ` : ''}
                      {event.fromPlan ?? '—'} → {event.toPlan ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {event.fromStatus ?? '—'} → {event.toStatus ?? '—'} · via {event.source}
                    </span>
                    {event.cancellationReason && (
                      <span className="text-xs text-muted-foreground">
                        Reason: {event.cancellationReason.replace(/_/g, ' ')}
                        {event.cancellationComment ? ` — “${event.cancellationComment}”` : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
