import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';
import { ContextCollectorProvider } from '@/components/bug-report/context-collector';
import { BugReportWidget } from '@/components/bug-report/bug-report-widget';
import { ActivityFeedProvider } from '@/components/activity-feed/activity-feed-provider-client';
import { ActivityFeedPanel } from '@/components/activity-feed/activity-feed-panel-client';
import { getCurrentSession } from '@/lib/auth';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  const earlyAdopter = session?.team?.earlyAdopterMode ?? false;

  return (
    <JobPollingProvider>
      <ContextCollectorProvider>
        {earlyAdopter ? (
          <ActivityFeedProvider>
            <div className="flex h-screen">
              <SidebarServer />
              <main className="flex-1 overflow-auto relative">
                {children}
              </main>
            </div>
            <BugReportWidget />
            <ActivityFeedPanel />
          </ActivityFeedProvider>
        ) : (
          <>
            <div className="flex h-screen">
              <SidebarServer />
              <main className="flex-1 overflow-auto relative">
                {children}
              </main>
            </div>
            <BugReportWidget />
          </>
        )}
      </ContextCollectorProvider>
    </JobPollingProvider>
  );
}
