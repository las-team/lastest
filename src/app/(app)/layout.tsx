import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { SidebarServer } from '@/components/layout/sidebar-server';
import { JobPollingProvider } from '@/components/queue/job-polling-context';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <JobPollingProvider>
      <div className="flex h-screen">
        <SidebarServer />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </JobPollingProvider>
  );
}
