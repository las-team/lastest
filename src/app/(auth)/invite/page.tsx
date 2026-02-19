import { redirect } from 'next/navigation';
import { SignUp } from '@clerk/nextjs';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; ticket?: string }>;
}) {
  const params = await searchParams;

  // If there's a Clerk invitation ticket, show the sign-up with it
  if (params.ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SignUp
          forceRedirectUrl="/"
          initialValues={{}}
        />
      </div>
    );
  }

  // Legacy token — redirect to login
  if (params.token) {
    redirect('/login');
  }

  redirect('/register');
}
