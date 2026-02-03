import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from '@/components/auth/login-form';
import { Circle } from 'lucide-react';
import Link from 'next/link';

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect('/');
  }

  const githubEnabled = !!process.env.GITHUB_CLIENT_ID;
  const googleEnabled = !!process.env.GOOGLE_CLIENT_ID;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Link href="/" className="flex items-center gap-2 font-bold text-lg mb-8">
        <Circle className="h-6 w-6 fill-primary text-primary" />
        LASTEST2
      </Link>
      <LoginForm githubEnabled={githubEnabled} googleEnabled={googleEnabled} />
    </div>
  );
}
