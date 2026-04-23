import { NextRequest } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { getShareAllowlist } from '@/lib/db/queries/public-shares';
import { resolveStoragePath } from '@/lib/storage/paths';
import { isValidShareSlug } from '@/lib/share/slug';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path: segments } = await params;
  if (!isValidShareSlug(slug)) {
    return new Response('Bad Request', { status: 400 });
  }

  const requested = '/' + segments.join('/');
  if (requested.includes('..')) {
    return new Response('Bad Request', { status: 400 });
  }

  const allowlist = await getShareAllowlist(slug);
  if (!allowlist || !allowlist.has(requested)) {
    return new Response('Not Found', { status: 404 });
  }

  const filePath = resolveStoragePath(requested);
  if (!filePath || !existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const fileStat = await stat(filePath);
  const contentType = getContentType(filePath);
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': fileStat.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
