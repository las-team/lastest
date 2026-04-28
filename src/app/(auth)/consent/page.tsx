import { redirect } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { hasAcceptedTerms } from '@/lib/db/queries';
import { ConsentFormClient } from './consent-form-client';

export default async function ConsentPage() {
  const session = await getCurrentSession();

  if (!session?.user) {
    redirect('/login');
  }

  const accepted = await hasAcceptedTerms(session.user.id);
  if (accepted) {
    redirect('/');
  }

  // Brand-new users (no onboarding done) bypass `/` so (app)/layout.tsx —
  // WS bootstrap + 8 providers — doesn't cold-compile only to redirect.
  const nextUrl = session.user.onboardingCompletedAt ? '/' : '/onboarding';

  return (
    <div className="min-h-screen flex items-center justify-center">
      <ConsentFormClient nextUrl={nextUrl} />
    </div>
  );
}
