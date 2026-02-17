import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';
import { ContextCollectorProvider } from '@/components/bug-report/context-collector';
import { BugReportWidget } from '@/components/bug-report/bug-report-widget';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JobPollingProvider>
      <ContextCollectorProvider>
        <div className="flex h-screen">
          <SidebarServer />
          <main className="flex-1 overflow-auto relative">
            {children}
          </main>
        </div>
        <BugReportWidget />
      </ContextCollectorProvider>
    </JobPollingProvider>
  );
}
