import { redirect } from 'next/navigation';
import { getCurrentSession, describeSubscription } from '@/lib/auth';
import * as queries from '@/lib/db/queries';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BillingCard } from '@/components/settings/billing-card-client';

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
  const events = await queries.listSubscriptionEvents(team.id, 10);

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
                <li key={event.id} className="py-2 flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {event.fromPlan ?? '—'} → {event.toPlan ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {event.fromStatus ?? '—'} → {event.toStatus ?? '—'} · via {event.source}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
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
