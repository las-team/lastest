import { redirect, notFound } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { isValidShareSlug } from '@/lib/share/slug';
import { claimPublicShare } from '@/server/actions/public-shares';
import * as queries from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ClaimPage({ params }: PageProps) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) notFound();

  const session = await getCurrentSession();
  if (!session?.team) {
    redirect(`/login?claim=${slug}`);
  }

  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') notFound();

  const result = await claimPublicShare(slug);
  redirect(result.newTestId ? `/tests/${result.newTestId}` : '/tests');
}
