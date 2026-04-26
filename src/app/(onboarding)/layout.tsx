import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session?.user) {
    redirect('/login');
  }
  // If onboarding is already done, bounce back to dashboard. Reset flow re-nulls
  // the timestamp via Settings → Restore Setup Guide.
  if (session.user.onboardingCompletedAt) {
    redirect('/');
  }
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
