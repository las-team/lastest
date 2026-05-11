import { redirect, notFound } from 'next/navigation';
import { getCurrentSession } from '@/lib/auth';
import { isValidShareSlug } from '@/lib/share/slug';
import { getPublicShareBySlug } from '@/lib/db/queries/public-shares';
import { ClaimRunner } from './claim-runner-client';

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

  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') notFound();

  return <ClaimRunner slug={slug} />;
}
