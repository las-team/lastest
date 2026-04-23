import { NextRequest } from 'next/server';
import { getPublicShareBySlug, incrementPublicShareView } from '@/lib/db/queries/public-shares';
import { isValidShareSlug } from '@/lib/share/slug';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  const share = await getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') {
    return new Response('Not Found', { status: 404 });
  }

  await incrementPublicShareView(slug);
  return new Response(null, { status: 204 });
}
