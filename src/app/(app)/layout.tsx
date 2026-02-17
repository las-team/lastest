import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JobPollingProvider>
      <div className="flex h-screen">
        <SidebarServer />
        <main className="flex-1 overflow-auto relative">
          {children}
        </main>
      </div>
    </JobPollingProvider>
  );
}
