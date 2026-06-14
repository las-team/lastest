import { redirect } from "next/navigation";
import { SidebarServer } from "@/components/layout/sidebar-server";
import { MobileTopBarServer } from "@/components/layout/mobile-shell-server";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav-client";
import { JobPollingProvider } from "@/components/queue/job-polling-context";
import { ContextCollectorProvider } from "@/components/bug-report/context-collector";
import { BugReportWidget } from "@/components/bug-report/bug-report-widget";
import { ActivityFeedProvider } from "@/components/activity-feed/activity-feed-provider-client";
import { ActivityFeedPanel } from "@/components/activity-feed/activity-feed-panel-client";
import { CelebrationListener } from "@/components/gamification/celebration-listener-client";
import { UmamiIdentifyClient } from "@/components/analytics/umami-identify-client";
import { getCurrentSession } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();

  // First-run gate: send users who haven't completed onboarding to /onboarding.
  // Backfilled timestamp on existing users → no redirect for them.
  if (session?.user && !session.user.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  // Resolve every async server component used in this layout up-front so
  // the JSX tree below contains only plain React elements. The previous
  // shape had two `<SidebarServer />` JSX nodes (desktop rail + Sheet prop
  // on the client-side MobileBottomNav) and a `<MobileTopBarServer />`
  // sibling, each an independent async server-component boundary nested
  // inside the client provider chain. Under React 19 / Next 16 streaming
  // SSR, that pair of nested async resolutions could complete in an order
  // that left the desktop `<aside>` hoisted to be a direct child of
  // `<ActivityFeedProvider>`, mismatching the client tree that wraps it in
  // `<div className="flex h-screen">`. Awaiting here also dedupes the
  // sidebar's DB/GitHub calls that used to run twice.
  const [sidebarEl, mobileTopBarEl] = await Promise.all([
    SidebarServer(),
    MobileTopBarServer(),
  ]);

  return (
    <JobPollingProvider>
      <ContextCollectorProvider>
        <ActivityFeedProvider>
          <div className="flex h-screen">
            {/* Desktop rail wrapper is a static <div> now — safe because the
             *  async <SidebarServer /> has already been resolved above, so
             *  the wrapper no longer creates a nested async boundary inside
             *  the client provider chain (which was the SSR/client hydration
             *  hazard the previous "merge class onto <aside>" hack was
             *  working around). */}
            <div className="hidden md:flex">{sidebarEl}</div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {mobileTopBarEl}
              <main className="flex-1 overflow-auto relative pb-14 md:pb-0">
                {children}
              </main>
              <MobileBottomNav sidebar={sidebarEl} />
            </div>
          </div>
          <BugReportWidget />
          <ActivityFeedPanel />
          <CelebrationListener />
          {session?.user && (
            <UmamiIdentifyClient
              userId={session.user.id}
              teamId={session.team?.id ?? null}
            />
          )}
        </ActivityFeedProvider>
      </ContextCollectorProvider>
    </JobPollingProvider>
  );
}
