import { UrlDiffClient } from './url-diff-client';
import { getCurrentSession } from '@/lib/auth';
import { notFound } from 'next/navigation';

export default async function UrlDiffPage() {
  const session = await getCurrentSession();
  if (!session?.team) notFound();
  return (
    <div className="flex flex-col h-full">
      <UrlDiffClient />
    </div>
  );
}
