import { NextRequest } from 'next/server';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { getCurrentSession } from '@/lib/auth';
import { verifyBearerToken } from '@/lib/auth/api-key';
import { resolveStoragePath } from '@/lib/storage/paths';
import { getRepository } from '@/lib/db/queries/repositories';
import { getShareAllowlist } from '@/lib/db/share-public';
import { isValidShareSlug } from '@/lib/share/slug';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.json': 'application/json',
};

function getContentType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

async function verifyAuth(request: NextRequest) {
  const session = await getCurrentSession();
  if (session) return session;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifyBearerToken(authHeader.slice(7));
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  const urlPath = '/' + segments.join('/');

  // Share-scoped access: `?share=<slug>` authorizes a specific set of paths
  // without requiring a session. This is the public share read path and
  // intentionally piggybacks on this route so no separate dynamic route
  // under /api/share/[slug]/ exists to cold-compile in dev.
  const shareSlug = request.nextUrl.searchParams.get('share');
  if (shareSlug) {
    if (!isValidShareSlug(shareSlug)) {
      return new Response('Bad Request', { status: 400 });
    }
    const allowlist = await getShareAllowlist(shareSlug);
    if (!allowlist || !allowlist.has(urlPath)) {
      return new Response('Not Found', { status: 404 });
    }
  } else {
    // Authenticated access. Skip auth for traces — they're fetched
    // cross-origin by trace.playwright.dev and auto-clean after 1 hour.
    const isTrace = segments[0] === 'traces';
    if (!isTrace) {
      const session = await verifyAuth(request);
      if (!session) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Verify team ownership for repo-scoped directories (screenshots use repoId subdirs)
      if (segments[0] === 'screenshots' && segments[1]) {
        const repoId = segments[1];
        const repo = await getRepository(repoId);
        if (!repo || repo.teamId !== session.team?.id) {
          return new Response('Forbidden', { status: 403 });
        }
      }
    }
  }

  const filePath = resolveStoragePath(urlPath);
  if (!filePath) {
    return new Response('Bad Request', { status: 400 });
  }
  if (!existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const fileStat = await stat(filePath);
  const contentType = getContentType(filePath);
  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': fileStat.size.toString(),
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (segments[0] === 'traces') {
    headers['Access-Control-Allow-Origin'] = 'https://trace.playwright.dev';
    headers['Access-Control-Allow-Methods'] = 'GET';
  }

  return new Response(webStream, { status: 200, headers });
}

export async function OPTIONS(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;
  if (segments[0] !== 'traces') {
    return new Response(null, { status: 204 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://trace.playwright.dev',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
