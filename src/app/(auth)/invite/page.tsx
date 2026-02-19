import { redirect } from 'next/navigation';
import * as queries from '@/lib/db/queries';
import { InviteForm } from './invite-form';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  if (!params.token) {
    redirect('/register');
  }

  const invite = await queries.getInvitationByToken(params.token);

  if (!invite || invite.acceptedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
    redirect('/register');
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <InviteForm email={invite.email} token={params.token} />
    </div>
  );
}
