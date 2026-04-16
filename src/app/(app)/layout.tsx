import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';
import { ContextCollectorProvider } from '@/components/bug-report/context-collector';
import { BugReportWidget } from '@/components/bug-report/bug-report-widget';
import { ActivityFeedProvider } from '@/components/activity-feed/activity-feed-provider-client';
import { ActivityFeedPanel } from '@/components/activity-feed/activity-feed-panel-client';
import { CelebrationListener } from '@/components/gamification/celebration-listener-client';
import { ConsentBanner } from '@/components/layout/consent-banner-client';
import { getCurrentSession } from '@/lib/auth';
import { hasAcceptedTerms } from '@/lib/db/queries';
import { startActivityFeedServer } from '@/lib/ws/activity-feed-server';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  startActivityFeedServer();
  const session = await getCurrentSession();
  const showConsentBanner = session?.user
    ? !(await hasAcceptedTerms(session.user.id))
    : false;

  return (
    <JobPollingProvider>
      <ContextCollectorProvider>
        <ActivityFeedProvider>
          <div className="flex h-screen">
            <SidebarServer />
            <div className="flex-1 flex flex-col overflow-hidden">
              {showConsentBanner && <ConsentBanner />}
              <main className="flex-1 overflow-auto relative">
                {children}
              </main>
            </div>
          </div>
          <BugReportWidget />
          <ActivityFeedPanel />
          <CelebrationListener />
        </ActivityFeedProvider>
      </ContextCollectorProvider>
    </JobPollingProvider>
  );
}
