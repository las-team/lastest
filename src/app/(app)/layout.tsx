import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';
import { ContextCollectorProvider } from '@/components/bug-report/context-collector';
import { BugReportWidget } from '@/components/bug-report/bug-report-widget';
import { ActivityFeedProvider } from '@/components/activity-feed/activity-feed-provider-client';
import { ActivityFeedPanel } from '@/components/activity-feed/activity-feed-panel-client';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JobPollingProvider>
      <ActivityFeedProvider>
        <ContextCollectorProvider>
          <div className="flex h-screen">
            <SidebarServer />
            <main className="flex-1 overflow-auto relative">
              {children}
            </main>
          </div>
          <BugReportWidget />
          <ActivityFeedPanel />
        </ContextCollectorProvider>
      </ActivityFeedProvider>
    </JobPollingProvider>
  );
}
