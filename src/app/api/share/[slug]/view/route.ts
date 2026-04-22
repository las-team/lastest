import { NextRequest } from 'next/server';
import * as queries from '@/lib/db/queries';
import { isValidShareSlug } from '@/lib/share/slug';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  const share = await queries.getPublicShareBySlug(slug);
  if (!share || share.status !== 'public') {
    return new Response('Not Found', { status: 404 });
  }

  await queries.incrementPublicShareView(slug);
  return new Response(null, { status: 204 });
}
