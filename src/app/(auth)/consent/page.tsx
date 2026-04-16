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

  return (
    <div className="min-h-screen flex items-center justify-center">
      <ConsentFormClient />
    </div>
  );
}
